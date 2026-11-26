# ==============================================================================
# MODULE KẾT NỐI GEMINI 2.5 FLASH API - NHẬN DIỆN NÉT VẼ ĐA PHƯƠNG THỨC
# (TASK TF28508) - Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
# ==============================================================================

import asyncio
import base64
from contextvars import ContextVar
import json
import logging
from pathlib import Path
import random
import sys
import time
from io import BytesIO
from typing import Dict, Any, List, Optional, Tuple
import httpx
from PIL import Image

from app.core.config import settings, parse_gemini_api_keys
from app.schemas.canvas import RecognizeCanvasResponse, AmbiguousToken, VisualizationData
from app.ai.prompts import SYSTEM_PROMPT_TEMPLATE, get_prompt_for_subject

logger = logging.getLogger(__name__)

# Cho phép client/giáo viên truyền thêm API key dự phòng theo từng request qua header X-Gemini-Api-Keys
request_extra_gemini_keys_ctx: ContextVar[Tuple[str, ...]] = ContextVar(
    "request_extra_gemini_keys_ctx", default=()
)


class GeminiAIService:
    """
    Dịch vụ kết nối Google Gemini đa phương thức (Multimodal Vision) trên chuẩn REST v1beta:
      - Xoay vòng tự động nhiều API Key (Round-Robin Multi-Key Pool + Auto-Cooldown khi gặp 429).
      - Gọi trực tiếp endpoint chuẩn v1beta (khắc phục triệt để lỗi 400 JSON mode on v1 với key AQ.*
        và lỗi 400 thinkingBudget=0 trên dòng Gemini 3.x).
      - Tự động hạ cấu hình về plain text JSON nếu model từ chối tham số nâng cao.
      - Cung cấp Fallback Mock Engine thông minh khi chạy kiểm thử (pytest) hoặc chưa cấu hình key.
    """

    V1BETA_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self):
        self.api_keys: List[str] = list(getattr(settings, "GEMINI_API_KEYS", []) or [])
        if not self.api_keys and settings.GEMINI_API_KEY:
            self.api_keys = parse_gemini_api_keys(settings.GEMINI_API_KEY)
        self.api_key: str = self.api_keys[0] if self.api_keys else ""
        self.model_name = (settings.GEMINI_MODEL or "gemini-3.5-flash-lite").strip()
        self._preferred_model: Optional[str] = None
        self.client = None
        self.model = None
        self.is_configured = False
        self._client_type: Optional[str] = None
        self._http_client: Optional[httpx.AsyncClient] = None
        self._http_client_loop_id: Optional[int] = None
        self._rr_counter: int = 0
        self._key_cooldown_until: Dict[str, float] = {}
        self._dead_keys: set[str] = set()
        self._unsupported_models: set[str] = set()
        self._runtime_keys: List[str] = self._load_persisted_runtime_keys()
        self._sync_combined_keys()
        self._init_client()

    @staticmethod
    def _runtime_key_file() -> Path:
        base_dir = Path(settings.SNAPSHOT_DIR).resolve().parent
        base_dir.mkdir(parents=True, exist_ok=True)
        return base_dir / ".runtime_gemini_keys.json"

    def _load_persisted_runtime_keys(self) -> List[str]:
        if "pytest" in sys.modules:
            return []
        try:
            fp = self._runtime_key_file()
            if fp.exists():
                data = json.loads(fp.read_text(encoding="utf-8"))
                if isinstance(data, dict) and isinstance(data.get("keys"), list):
                    return parse_gemini_api_keys(*[str(x) for x in data["keys"]])
        except Exception:
            pass
        return []

    def _sync_combined_keys(self) -> None:
        merged = parse_gemini_api_keys(
            *self._runtime_keys,
            *(getattr(settings, "GEMINI_API_KEYS", []) or []),
            settings.GEMINI_API_KEY,
        )
        self.api_keys = merged
        self.api_key = merged[0] if merged else ""
        if self.api_key:
            settings.GEMINI_API_KEY = self.api_key
            settings.GEMINI_API_KEYS = list(merged)

    def set_runtime_keys(self, raw_keys: List[str], persist: bool = True) -> Dict[str, Any]:
        """Cập nhật nóng cụm API Key Gemini trên server (không cần khởi động lại container)."""
        parsed = parse_gemini_api_keys(*raw_keys)
        self._runtime_keys = parsed
        self._dead_keys.clear()
        self._key_cooldown_until.clear()
        self._sync_combined_keys()
        if persist and "pytest" not in sys.modules:
            try:
                self._runtime_key_file().write_text(
                    json.dumps({"keys": parsed, "updated_at": time.time()}),
                    encoding="utf-8",
                )
            except Exception as exc:
                logger.warning(f"Không thể lưu file runtime Gemini keys: {exc}")
        self._init_client()
        return self.get_pool_status()

    @property
    def pool_size(self) -> int:
        extra = request_extra_gemini_keys_ctx.get()
        return len(parse_gemini_api_keys(*extra, *self.api_keys))

    @property
    def healthy_key_count(self) -> int:
        now = time.monotonic()
        keys = parse_gemini_api_keys(*request_extra_gemini_keys_ctx.get(), *self.api_keys)
        return sum(
            1
            for k in keys
            if k not in self._dead_keys and self._key_cooldown_until.get(k, 0.0) <= now
        )

    def has_any_key(self) -> bool:
        return self.pool_size > 0

    def get_pool_status(self) -> Dict[str, Any]:
        now = time.monotonic()
        masked = []
        for idx, k in enumerate(self.api_keys, start=1):
            tail = k[-4:] if len(k) >= 8 else "****"
            head = k[:5] if len(k) >= 8 else "***"
            cooldown_rem = max(0.0, self._key_cooldown_until.get(k, 0.0) - now)
            status_str = (
                "invalid"
                if k in self._dead_keys
                else (f"cooldown_{int(cooldown_rem)}s" if cooldown_rem > 0 else "healthy")
            )
            masked.append({"slot": idx, "masked_key": f"{head}...{tail}", "status": status_str})
        return {
            "total_keys": len(self.api_keys),
            "healthy_keys": self.healthy_key_count,
            "active_model": self.active_model_name,
            "transport": self._client_type or "mock",
            "keys": masked,
        }

    @property
    def active_model_name(self) -> str:
        return self._preferred_model or self.model_name or settings.GEMINI_MODEL

    def ensure_configured(self) -> bool:
        """
        Kiểm tra và tự động nạp lại GEMINI_API_KEYS / GEMINI_API_KEY từ file .env,
        runtime pool hoặc header X-Gemini-Api-Keys của request hiện tại.
        """
        if "pytest" in sys.modules:
            return self.is_configured

        extra_req_keys = request_extra_gemini_keys_ctx.get()
        if self.is_configured and (self.api_keys or extra_req_keys):
            return True

        import os
        from dotenv import load_dotenv

        candidate_envs = [
            Path(__file__).resolve().parent.parent.parent / ".env",
            Path(__file__).resolve().parent.parent.parent.parent / ".env",
        ]
        for env_path in candidate_envs:
            if env_path.exists():
                load_dotenv(env_path, override=True)

        fresh_keys = parse_gemini_api_keys(
            *extra_req_keys,
            *self._runtime_keys,
            os.getenv("GEMINI_API_KEYS", ""),
            os.getenv("GEMINI_API_KEY", ""),
            os.getenv("GOOGLE_API_KEY", ""),
            *(getattr(settings, "GEMINI_API_KEYS", []) or []),
            settings.GEMINI_API_KEY,
        )

        fresh_model = (os.getenv("GEMINI_MODEL", "") or settings.GEMINI_MODEL or "gemini-3.5-flash-lite").strip()
        if fresh_model:
            self.model_name = fresh_model
            settings.GEMINI_MODEL = fresh_model

        if fresh_keys:
            self.api_keys = fresh_keys
            self.api_key = fresh_keys[0]
            settings.GEMINI_API_KEY = fresh_keys[0]
            settings.GEMINI_API_KEYS = list(fresh_keys)
            self._init_client()

        return self.is_configured or bool(extra_req_keys)

    def _init_client(self):
        """Khởi tạo kết nối REST v1beta đa Key (trong pytest giữ chế độ Mock để chạy test tức thì)."""
        if "pytest" in sys.modules:
            self.is_configured = False
            return

        if not self.api_keys and not self.api_key:
            self.is_configured = False
            return

        self._client_type = "httpx-v1beta"
        self.is_configured = True
        logger.info(
            f"Gemini Multi-Key Pool ({len(self.api_keys)} keys, model={self.model_name}) sẵn sàng trên chuẩn REST v1beta."
        )

    def _get_async_http_client(self) -> httpx.AsyncClient:
        loop_id = id(asyncio.get_running_loop())
        if self._http_client is None or self._http_client.is_closed or self._http_client_loop_id != loop_id:
            self._http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=4.0, read=12.0, write=6.0, pool=4.0),
                limits=httpx.Limits(max_keepalive_connections=12, max_connections=24),
            )
            self._http_client_loop_id = loop_id
        return self._http_client

    def _select_ordered_keys_for_request(self) -> List[str]:
        """Lấy danh sách key xoay vòng Round-Robin, ưu tiên key khỏe mạnh trước, key đang cooldown xếp cuối."""
        req_extra = request_extra_gemini_keys_ctx.get()
        all_keys = parse_gemini_api_keys(*req_extra, *self.api_keys, self.api_key)
        live_keys = [k for k in all_keys if k not in self._dead_keys]
        if not live_keys:
            # Nếu tất cả đều từng bị đánh dấu lỗi thì thử lại toàn bộ một vòng để tự phục hồi
            live_keys = all_keys
        if not live_keys:
            return []

        start_idx = self._rr_counter % len(live_keys)
        self._rr_counter += 1
        rotated = live_keys[start_idx:] + live_keys[:start_idx]

        now = time.monotonic()
        healthy = [k for k in rotated if self._key_cooldown_until.get(k, 0.0) <= now]
        cooling = sorted(
            [k for k in rotated if self._key_cooldown_until.get(k, 0.0) > now],
            key=lambda k: self._key_cooldown_until.get(k, 0.0),
        )
        return healthy + cooling

    @staticmethod
    def _ensure_min_vision_image(raw_bytes: bytes, mime_type: str) -> Tuple[bytes, str]:
        """Đảm bảo ảnh gửi lên Vision có kích thước tối thiểu >= 48x48px tránh lỗi 400 ảnh quá bé."""
        try:
            with Image.open(BytesIO(raw_bytes)) as im:
                w, h = im.size
                if w >= 48 and h >= 48:
                    return raw_bytes, mime_type
                target_w = max(64, w + 24)
                target_h = max(64, h + 24)
                canvas = Image.new("RGB", (target_w, target_h), (255, 255, 255))
                im_rgb = im.convert("RGB")
                canvas.paste(im_rgb, ((target_w - w) // 2, (target_h - h) // 2))
                out = BytesIO()
                canvas.save(out, format="PNG")
                return out.getvalue(), "image/png"
        except Exception:
            return raw_bytes, mime_type

    @staticmethod
    def _build_v1beta_gen_config(model_name: str, json_mode: bool, max_tokens: int, minimal_thinking: bool = True) -> Dict[str, Any]:
        cfg: Dict[str, Any] = {
            "temperature": 0.1,
            "maxOutputTokens": max_tokens,
        }
        if json_mode:
            cfg["responseMimeType"] = "application/json"
        if minimal_thinking:
            m_low = model_name.lower()
            if "gemini-3" in m_low and "pro" not in m_low:
                cfg["thinkingConfig"] = {"thinkingLevel": "MINIMAL"}
            elif "gemini-2.5-flash" in m_low:
                cfg["thinkingConfig"] = {"thinkingBudget": 0}
        return cfg

    async def _post_v1beta_with_pool(
        self,
        contents_parts: List[Dict[str, Any]],
        *,
        json_mode: bool = True,
        max_tokens: int = 650,
        timeout: float = 18.0,
    ) -> str:
        """
        Gọi REST v1beta xoay vòng qua toàn bộ API keys & fallback models:
        - Gặp 429: đưa key hiện tại vào cooldown 45s và đổi sang key kế tiếp ngay lập tức.
        - Gặp 400 do tham số config (thinkingConfig / responseMimeType): tự hạ về config tối giản ngay trong cùng lượt gọi.
        - Gặp 404 model không khả dụng: ghi nhớ bỏ qua model đó và sang model kế tiếp.
        """
        keys = self._select_ordered_keys_for_request()
        if not keys:
            raise RuntimeError("Chưa có API Key Gemini hợp lệ nào trong cấu hình.")

        candidate_models: List[str] = []
        for m in [
            self._preferred_model,
            self.model_name,
            "gemini-3.5-flash-lite",
            "gemini-3.5-flash",
            "gemini-3.1-flash-lite",
            "gemini-flash-lite-latest",
            *settings.GEMINI_FALLBACK_MODELS,
        ]:
            if m and m not in candidate_models and m not in self._unsupported_models:
                candidate_models.append(m)
        if not candidate_models:
            self._unsupported_models.clear()
            candidate_models = [self.model_name or "gemini-3.5-flash-lite"]

        total_budget = max(6.0, float(timeout or 18.0))
        deadline = time.perf_counter() + total_budget
        http_client = self._get_async_http_client()
        last_err: Optional[Exception] = None

        for mod in candidate_models[:4]:
            for key in keys:
                remaining = deadline - time.perf_counter()
                if remaining <= 0.8:
                    break
                per_call_timeout = min(remaining, 9.5)
                url = f"{self.V1BETA_BASE_URL}/{mod}:generateContent"

                # Lần 1: Gửi cấu hình chuẩn (JSON mode + minimal thinking phù hợp từng dòng model)
                # Lần 2 (chỉ khi dính 400 INVALID_ARGUMENT): Tự gọi lại cấu hình tối giản không thinking/json_mode
                for strip_advanced in (False, True):
                    gen_cfg = (
                        {"temperature": 0.1, "maxOutputTokens": max_tokens}
                        if strip_advanced
                        else self._build_v1beta_gen_config(
                            mod, json_mode=json_mode, max_tokens=max_tokens, minimal_thinking=True
                        )
                    )
                    payload = {
                        "contents": [{"parts": contents_parts}],
                        "generationConfig": gen_cfg,
                    }
                    try:
                        resp = await http_client.post(
                            url,
                            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                            json=payload,
                            timeout=per_call_timeout,
                        )
                    except (httpx.TimeoutException, asyncio.TimeoutError) as t_err:
                        last_err = TimeoutError(f"Model {mod} phản hồi quá {per_call_timeout:.1f}s ({t_err})")
                        break
                    except Exception as net_err:
                        last_err = net_err
                        break

                    if resp.status_code == 200:
                        body = resp.json()
                        cands = body.get("candidates") or []
                        text_chunks: List[str] = []
                        if cands:
                            parts_out = (cands[0].get("content") or {}).get("parts") or []
                            for p in parts_out:
                                if isinstance(p, dict) and p.get("text") and not p.get("thought"):
                                    text_chunks.append(str(p["text"]))
                        joined = "\n".join(text_chunks).strip()
                        if joined:
                            self._preferred_model = mod
                            self._key_cooldown_until.pop(key, None)
                            return joined
                        last_err = RuntimeError(f"Model {mod} trả về nội dung rỗng ({cands[0].get('finishReason') if cands else 'NO_CANDIDATES'})")
                        if not strip_advanced:
                            max_tokens = max(max_tokens, 950)
                            continue
                        break

                    err_Snippet = resp.text[:220].replace("\n", " ")
                    if resp.status_code == 429:
                        # Đưa key này vào trạng thái nghỉ 45s và đổi sang key tiếp theo ngay lập tức!
                        self._key_cooldown_until[key] = time.monotonic() + 45.0
                        last_err = RuntimeError(f"429 RESOURCE_EXHAUSTED trên 1 key (đã tự xoay sang key dự phòng)")
                        logger.warning(f"[Gemini Pool] Key ...{key[-4:]} chạm trần 429 trên {mod}, chuyển sang key tiếp theo.")
                        break

                    if resp.status_code in (401, 403) or (
                        resp.status_code == 400 and "API_KEY_INVALID" in err_Snippet
                    ):
                        self._dead_keys.add(key)
                        last_err = RuntimeError(f"API Key ...{key[-4:]} không hợp lệ hoặc bị khóa ({resp.status_code})")
                        logger.warning(f"[Gemini Pool] Đánh dấu hỏng key ...{key[-4:]}: {err_Snippet[:120]}")
                        break

                    if resp.status_code == 404:
                        self._unsupported_models.add(mod)
                        last_err = RuntimeError(f"Model {mod} không khả dụng (404)")
                        break

                    if resp.status_code == 400 and not strip_advanced:
                        logger.info(f"[Gemini v1beta] {mod} từ chối tham số nâng cao (400), tự thử lại cấu hình chuẩn...")
                        continue

                    last_err = RuntimeError(f"HTTP {resp.status_code} ({mod}): {err_Snippet}")
                    break

                # Nếu model vừa bị đánh dấu 404 thì thoát sang model kế tiếp luôn
                if mod in self._unsupported_models:
                    break

        raise last_err or RuntimeError("Không thể kết nối tới cụm máy chủ Gemini AI.")

    async def generate_text_with_pool(
        self,
        prompt: str,
        *,
        json_mode: bool = True,
        max_tokens: int = 700,
        timeout: float = 10.0,
    ) -> str:
        """Hàm dùng chung cho Chấm tự luận AI & Sinh câu hỏi biến thể qua Multi-Key Pool v1beta."""
        if not self.ensure_configured():
            return ""
        if self._client_type == "httpx-v1beta":
            return await self._post_v1beta_with_pool(
                [{"text": prompt}],
                json_mode=json_mode,
                max_tokens=max_tokens,
                timeout=timeout,
            )
        if self._client_type == "google-generativeai" and self.model is not None:
            resp = await asyncio.wait_for(asyncio.to_thread(self.model.generate_content, prompt), timeout=timeout)
            return (resp.text or "").strip()
        return ""

    async def analyze_board(
        self,
        image_base64: str,
        subject: str = "MATH",
        grade_level: Optional[str] = "THPT",
        timeout: float = 18.0,
        fast_mode: bool = False,
    ) -> RecognizeCanvasResponse:
        """
        Phân tích ảnh vùng nét vẽ bằng Gemini Vision:
        - Nếu chưa cấu hình GEMINI_API_KEY (hoặc đang chạy pytest mặc định): dùng _mock_result().
        - Ở môi trường thực tế: chạy qua Multi-Key Pool REST v1beta tự xoay key & model dự phòng.
        """
        clean_b64 = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64

        if not self.is_configured:
            self.ensure_configured()

        if not self.is_configured and not request_extra_gemini_keys_ctx.get():
            logger.info("Gemini API Key chưa cấu hình. Kích hoạt Gemini Mock Engine dự phòng.")
            return self._mock_result(subject, clean_b64)

        try:
            raw_bytes = base64.b64decode(clean_b64)
            mime_type = (
                "image/webp"
                if image_base64.startswith("data:image/webp") or raw_bytes[:4] == b"RIFF"
                else "image/png"
            )
            prompt = get_prompt_for_subject(subject=subject, grade_level=grade_level or "THPT")
            total_budget = max(6.0, float(timeout or 18.0))

            if self._client_type == "httpx-v1beta" or (
                not self._client_type and request_extra_gemini_keys_ctx.get()
            ):
                safe_bytes, safe_mime = self._ensure_min_vision_image(raw_bytes, mime_type)
                b64_payload = base64.b64encode(safe_bytes).decode("ascii")
                parts = [
                    {"inlineData": {"mimeType": safe_mime, "data": b64_payload}},
                    {"text": prompt},
                ]
                raw_text = await self._post_v1beta_with_pool(
                    parts,
                    json_mode=True,
                    max_tokens=550 if fast_mode else 800,
                    timeout=total_budget,
                )
                parsed_data = self._parse_json_robust(raw_text, subject=subject)
                return self._build_validated_response(parsed_data, subject=subject)

            pil_image = None
            raw_text = ""
            deadline = time.perf_counter() + total_budget

            candidate_models: list[str] = []
            for m in [
                self._preferred_model,
                self.model_name,
                "gemini-3.5-flash-lite",
                "gemini-3.1-flash-lite",
                *settings.GEMINI_FALLBACK_MODELS,
            ]:
                if m and m not in candidate_models:
                    candidate_models.append(m)

            if self._client_type == "google-genai":
                last_err: Optional[Exception] = None
                use_native_aio = (
                    type(self.client).__module__.startswith("google")
                    and hasattr(self.client, "aio")
                    and hasattr(self.client.aio, "models")
                )
                image_part = None
                if use_native_aio:
                    try:
                        from google.genai import types
                        image_part = types.Part.from_bytes(data=raw_bytes, mime_type=mime_type)
                    except Exception:
                        image_part = None
                if image_part is None:
                    pil_image = Image.open(BytesIO(raw_bytes))
                media_input = image_part if image_part is not None else pil_image

                for mod_idx, mod in enumerate(candidate_models[:4]):
                    max_attempts = 2 if mod_idx == 0 else 1
                    for attempt in range(max_attempts):
                        remaining = deadline - time.perf_counter()
                        if remaining <= 0.8:
                            last_err = last_err or asyncio.TimeoutError(
                                f"Hết thời gian chờ tổng ({total_budget:.0f}s) khi gọi Gemini API"
                            )
                            break

                        per_attempt_timeout = min(remaining, 4.5 if mod_idx == 0 else 4.0)

                        try:
                            gen_config = None
                            try:
                                from google.genai import types
                                cfg_kwargs: Dict[str, Any] = {
                                    "response_mime_type": "application/json",
                                    "temperature": 0.1,
                                    "max_output_tokens": 350 if fast_mode else 550,
                                }
                                if hasattr(types, "ThinkingConfig"):
                                    try:
                                        cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
                                    except Exception:
                                        pass
                                gen_config = types.GenerateContentConfig(**cfg_kwargs)
                            except Exception:
                                pass

                            if use_native_aio:
                                try:
                                    response = await asyncio.wait_for(
                                        self.client.aio.models.generate_content(
                                            model=mod,
                                            contents=[media_input, prompt],
                                            config=gen_config,
                                        ),
                                        timeout=per_attempt_timeout,
                                    )
                                except RuntimeError as loop_err:
                                    if "Event loop is closed" in str(loop_err):
                                        self._init_client()
                                        response = await asyncio.wait_for(
                                            asyncio.to_thread(
                                                self.client.models.generate_content,
                                                model=mod,
                                                contents=[media_input, prompt],
                                                config=gen_config,
                                            ),
                                            timeout=per_attempt_timeout,
                                        )
                                    else:
                                        raise
                            else:
                                response = await asyncio.wait_for(
                                    asyncio.to_thread(
                                        self.client.models.generate_content,
                                        model=mod,
                                        contents=[media_input, prompt],
                                        config=gen_config,
                                    ),
                                    timeout=per_attempt_timeout,
                                )

                            raw_text = (response.text or "").strip()
                            if raw_text:
                                self._preferred_model = mod
                                break

                        except asyncio.TimeoutError:
                            last_err = asyncio.TimeoutError(
                                f"Model {mod} phản hồi quá {per_attempt_timeout:.1f}s"
                            )
                            logger.warning(f"[Gemini Timeout] {last_err} (lần {attempt + 1}/{max_attempts})")
                            if attempt < max_attempts - 1 and (deadline - time.perf_counter()) > 2.5:
                                backoff = (0.4 * (2 ** attempt)) + random.uniform(0.05, 0.25)
                                await asyncio.sleep(backoff)
                                continue
                            if self._preferred_model == mod:
                                self._preferred_model = None
                            break

                        except Exception as mod_err:
                            last_err = mod_err
                            err_str = str(mod_err)
                            is_transient = any(
                                kw in err_str
                                for kw in [
                                    "503",
                                    "429",
                                    "UNAVAILABLE",
                                    "high demand",
                                    "temporarily unavailable",
                                    "Connection",
                                    "Timeout",
                                ]
                            )
                            if is_transient and attempt < max_attempts - 1 and (deadline - time.perf_counter()) > 2.5:
                                backoff = (0.5 * (2 ** attempt)) + random.uniform(0.1, 0.3)
                                logger.warning(
                                    f"[Gemini Transient] {mod} lỗi ({err_str[:90]}), thử lại sau {backoff:.2f}s..."
                                )
                                await asyncio.sleep(backoff)
                                continue
                            if self._preferred_model == mod:
                                self._preferred_model = None
                            logger.warning(f"[Gemini Fallback] Bỏ qua model {mod}: {err_str[:120]}")
                            break

                    if raw_text:
                        break

                if not raw_text:
                    raise last_err or RuntimeError("Không nhận được phản hồi hợp lệ từ Gemini API.")
            else:
                if pil_image is None:
                    pil_image = Image.open(BytesIO(raw_bytes))
                response = await asyncio.wait_for(
                    asyncio.to_thread(self.model.generate_content, [prompt, pil_image]),
                    timeout=total_budget,
                )
                raw_text = (response.text or "").strip()

            parsed_data = self._parse_json_robust(raw_text, subject=subject)
            return self._build_validated_response(parsed_data, subject=subject)

        except Exception as err:
            err_msg = str(err).strip() or "Kết nối tới máy chủ AI vượt quá thời gian cho phép"
            reason = f"{type(err).__name__}: {err_msg}"
            logger.error(f"Lỗi gọi Gemini ({self.active_model_name}) Vision: {reason}")
            return self._error_result(subject=subject, reason=reason)

    def _build_validated_response(
        self, parsed_data: Dict[str, Any], subject: str
    ) -> RecognizeCanvasResponse:
        """Chuẩn hóa dữ liệu JSON từ Gemini về RecognizeCanvasResponse."""
        raw_tokens = parsed_data.get("ambiguous_tokens", [])
        normalized_tokens = []
        if isinstance(raw_tokens, list):
            for item in raw_tokens:
                if isinstance(item, str):
                    normalized_tokens.append(
                        AmbiguousToken(detected_text=item, confidence=0.8, suggestions=[])
                    )
                elif isinstance(item, dict):
                    detected = item.get("detected_text") or item.get("token") or item.get("text") or ""
                    conf = float(item.get("confidence", 0.8))
                    suggs = (
                        item.get("suggestions")
                        or item.get("possible_readings")
                        or item.get("possible_interpretations")
                        or []
                    )
                    bbox = item.get("bbox") or [0, 0, 0, 0]
                    normalized_tokens.append(
                        AmbiguousToken(
                            bbox=bbox,
                            detected_text=str(detected),
                            confidence=conf,
                            suggestions=[str(s) for s in suggs],
                        )
                    )
        parsed_data["ambiguous_tokens"] = normalized_tokens

        vis = parsed_data.get("visualization")
        if isinstance(vis, dict):
            if not vis.get("type"):
                vis["type"] = "NONE"
            if not vis.get("engine"):
                vis["engine"] = "image"
            try:
                parsed_data["visualization"] = VisualizationData(**vis)
            except Exception:
                parsed_data["visualization"] = None

        try:
            return RecognizeCanvasResponse(**parsed_data)
        except Exception as schema_err:
            logger.warning(f"Cảnh báo schema validation từ Gemini: {schema_err}, phục hồi trực tiếp.")
            return RecognizeCanvasResponse(
                recognized_text=str(parsed_data.get("recognized_text", "")),
                latex=str(parsed_data.get("latex") or parsed_data.get("recognized_text", "")),
                subject=str(parsed_data.get("subject", subject)),
                confidence=float(parsed_data.get("confidence", 0.95)),
                has_ambiguity=bool(parsed_data.get("has_ambiguity", False)),
                ambiguous_tokens=normalized_tokens,
                visualization=(
                    parsed_data.get("visualization")
                    if isinstance(parsed_data.get("visualization"), VisualizationData)
                    else None
                ),
                explanation=parsed_data.get("explanation"),
                subject_details=parsed_data.get("subject_details"),
            )

    def _error_result(self, subject: str, reason: str) -> RecognizeCanvasResponse:
        """
        Trả về trạng thái lỗi minh bạch khi AI timeout/gián đoạn.
        TUYỆT ĐỐI không sinh công thức giả (như y = x^2 - 4x + 3) gây hiểu lầm cho giáo viên.
        """
        norm_subj = (subject or "TOAN").strip().upper()
        return RecognizeCanvasResponse(
            recognized_text="",
            latex="",
            subject=norm_subj,
            confidence=0.0,
            has_ambiguity=False,
            ambiguous_tokens=[],
            visualization=None,
            explanation=(
                f"Dịch vụ AI ({self.active_model_name}) tạm thời gián đoạn ({reason[:160]}). "
                "Nét vẽ trên bảng vẫn được giữ nguyên — vui lòng bấm 'Thử lại nhận diện' để quét lại."
            ),
            subject_details={
                "status": "error",
                "retryable": True,
                "error_reason": reason,
            },
            degraded_reason=reason,
        )

    def _parse_json_robust(self, raw_text: str, subject: str = "TOAN") -> Dict[str, Any]:
        """Phân tích JSON chống dị tật, tự động sửa escape backslash trong LaTeX và unescaped quotes."""
        import re
        clean_text = (raw_text or "").strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        elif clean_text.startswith("```"):
            clean_text = clean_text[3:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]
        clean_text = clean_text.strip()

        json_match = re.search(r"\{.*\}", clean_text, re.DOTALL)
        candidate = json_match.group(0) if json_match else clean_text

        # 1. Thử parse trực tiếp với strict=False
        try:
            return json.loads(candidate, strict=False)
        except Exception:
            pass

        # 2. Thử sửa lỗi unescaped backslashes (\frac, \times, \alpha...)
        fixed_slashes = re.sub(r'\\(?![/\\bfnrtu"U])', r'\\\\', candidate)
        try:
            return json.loads(fixed_slashes, strict=False)
        except Exception:
            pass

        # 3. Trích xuất trực tiếp bằng Regex khi có unescaped quotes trong explanation
        m_rec = re.search(r'"recognized_text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', candidate)
        if not m_rec:
            m_rec = re.search(r'"recognized_text"\s*:\s*"(.*?)"\s*[,}]', candidate, re.DOTALL)

        m_lat = re.search(r'"latex"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', candidate)
        if not m_lat:
            m_lat = re.search(r'"latex"\s*:\s*"(.*?)"\s*[,}]', candidate, re.DOTALL)

        m_exp = re.search(r'"explanation"\s*:\s*"(.*)', candidate, re.DOTALL)
        exp_text = None
        if m_exp:
            exp_text = re.sub(r'"\s*\}\s*$', '', m_exp.group(1)).strip()

        m_fn = re.search(r'"function"\s*:\s*"([^"]+)"', candidate)

        if m_rec or m_lat:
            rec_str = (m_rec.group(1) if m_rec else (m_lat.group(1) if m_lat else "")).replace(r'\"', '"').strip()
            lat_str = (m_lat.group(1) if m_lat else (m_rec.group(1) if m_rec else "")).replace(r'\"', '"').strip()
            data = {
                "recognized_text": rec_str,
                "latex": lat_str,
                "subject": subject,
                "confidence": 0.95,
                "has_ambiguity": False,
                "ambiguous_tokens": [],
                "explanation": exp_text or f"Nhận diện công thức: {rec_str}",
            }
            if m_fn:
                data["visualization"] = {
                    "type": "2D_GRAPH",
                    "engine": "plotly",
                    "title": f"Đồ thị {rec_str}",
                    "parameters": {"function": m_fn.group(1)},
                    "latex_formula": lat_str,
                }
            return data

        # 4. Nếu hoàn toàn không thể parse và không có công thức (chuỗi rác / lỗi server),
        # raise để kích hoạt fallback an toàn _mock_result
        return json.loads(candidate)

    def _mock_result(
        self,
        subject: str,
        clean_b64: str = "",
        degraded_reason: Optional[str] = None,
    ) -> RecognizeCanvasResponse:
        """
        Dữ liệu mẫu phản hồi tức thì khi CHƯA cấu hình GEMINI_API_KEY.
        Cung cấp các kịch bản mẫu phong phú theo đặc thù môn học (Task TF2850B):
        - Toán: Phương trình bậc hai, tích phân, ma trận.
        - Lý: Dao động điều hòa, vector lực, định luật Ohm / mạch điện.
        - Hóa: Phản ứng hữu cơ (este hóa), phản ứng vô cơ cân bằng, cấu tạo phân tử 3D SMILES.
        - Anh: Từ vựng chuẩn IPA, từ loại, câu ví dụ và phân tích ngữ pháp.
        """
        subj_raw = (subject or "TOAN").strip()
        subj = subj_raw.upper()

        # Xác định kịch bản mock: mặc định 0 để đảm bảo tính ổn định và tương thích,
        # hỗ trợ các modifier rõ ràng hoặc chủ đề chuyên sâu
        scenario_idx = 0
        if any(k in subj for k in [":1", "#1", ":INTEGRAL", ":TICH_PHAN", ":OSCILLATION", ":DAO_DONG", ":ORGANIC", ":ESTE", ":ADJ"]):
            scenario_idx = 1
        elif any(k in subj for k in [":2", "#2", ":MATRIX", ":MA_TRAN", ":CIRCUIT", ":MACH_DIEN", ":KMNO4", ":NHIET_PHAN", ":GRAMMAR", ":NGU_PHAP"]):
            scenario_idx = 2
        elif any(k in subj for k in [":0", "#0", ":EQUATION", ":BAC_HAI", ":FORCE", ":LUC", ":WATER", ":NUOC", ":VOCAB"]):
            scenario_idx = 0

        if degraded_reason:
            mock_notice = (
                f"⚠️ Dịch vụ Gemini ({self.model_name}) tạm thời gián đoạn ({degraded_reason[:120]}). "
                f"Đang hiển thị kết quả dự phòng nội bộ."
            )
        else:
            mock_notice = f"⚠️ Đang ở chế độ Mock dự phòng (chưa cấu hình GEMINI_API_KEY). Thêm key vào file backend/.env để nhận diện AI thực tế bằng Gemini ({self.model_name})."

        # ----------------------------------------------------------------------
        # MÔN TOÁN HỌC (MATH / TOAN)
        # ----------------------------------------------------------------------
        if "MATH" in subj or "TOAN" in subj:
            if scenario_idx == 0:
                # Kịch bản 1: Phương trình / hàm số bậc hai
                return RecognizeCanvasResponse(
                    recognized_text="y = x^2 - 4x + 3",
                    latex=r"y = x^2 - 4x + 3",
                    subject="TOAN",
                    confidence=0.97,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "EQUATION",
                        "equation_type": "Hàm số bậc hai / Parabol",
                        "delta": 4,
                        "roots": [1, 3],
                        "vertex": [2, -1],
                        "roots_description": "Phương trình có 2 nghiệm phân biệt x1 = 1, x2 = 3. Tọa độ đỉnh parabol I(2, -1)."
                    },
                    visualization=VisualizationData(
                        type="2D_GRAPH",
                        engine="plotly",
                        title="Đồ thị hàm số bậc hai y = x^2 - 4x + 3",
                        parameters={
                            "function": "x**2 - 4*x + 3",
                            "x_range": [-1, 5],
                            "vertex": [2, -1]
                        },
                        latex_formula=r"y = x^2 - 4x + 3"
                    ),
                    explanation=f"{mock_notice}\nĐã bóc tách hàm số bậc hai y = x^2 - 4x + 3. Bề lõm quay lên trên, đỉnh I(2, -1), cắt trục hoành tại x=1 và x=3."
                )
            elif scenario_idx == 1:
                # Kịch bản 2: Tích phân xác định
                return RecognizeCanvasResponse(
                    recognized_text="int_0^1 (3x^2 + 2x) dx = 2",
                    latex=r"\int_{0}^{1} (3x^2 + 2x) \, dx = 2",
                    subject="TOAN",
                    confidence=0.98,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "INTEGRAL",
                        "lower_bound": 0,
                        "upper_bound": 1,
                        "antiderivative": "x^3 + x^2",
                        "result": 2
                    },
                    visualization=VisualizationData(
                        type="2D_GRAPH",
                        engine="plotly",
                        title="Diện tích hình phẳng dưới đồ thị y = 3x^2 + 2x từ 0 đến 1",
                        parameters={
                            "function": "3*x**2 + 2*x",
                            "x_range": [0, 1],
                            "integral_value": 2
                        },
                        latex_formula=r"\int_{0}^{1} (3x^2 + 2x) \, dx"
                    ),
                    explanation=f"{mock_notice}\nNguyên hàm F(x) = x^3 + x^2. Áp dụng công thức Newton-Leibniz: F(1) - F(0) = 2."
                )
            else:
                # Kịch bản 3: Ma trận vuông cấp 2 và định thức
                return RecognizeCanvasResponse(
                    recognized_text="A = [[1, 2], [3, 4]], det(A) = -2",
                    latex=r"A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}, \quad \det(A) = -2",
                    subject="TOAN",
                    confidence=0.96,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "MATRIX",
                        "matrix_dimensions": [2, 2],
                        "determinant": -2,
                        "is_invertible": True
                    },
                    visualization=None,
                    explanation=f"{mock_notice}\nMa trận vuông cấp 2x2. Định thức det(A) = 1*4 - 2*3 = -2 khác 0 nên A khả nghịch."
                )

        # ----------------------------------------------------------------------
        # MÔN VẬT LÝ (PHYSICS / VAT_LY)
        # ----------------------------------------------------------------------
        elif "PHYS" in subj or "VAT_LY" in subj:
            if scenario_idx == 0:
                # Kịch bản 1: Vector lực và Định luật II Newton
                return RecognizeCanvasResponse(
                    recognized_text=r"F = m * a, \sum \vec{F} = m \vec{a}",
                    latex=r"\vec{F} = m \vec{a}",
                    subject="VAT_LY",
                    confidence=0.96,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "FORCE_VECTOR",
                        "law": "Định luật II Newton",
                        "forces": [
                            {"name": "Lực F", "magnitude": "m*a", "direction": "cùng hướng gia tốc a"}
                        ],
                        "vector_sum": r"\sum \vec{F} = m \vec{a}"
                    },
                    visualization=VisualizationData(
                        type="2D_GRAPH",
                        engine="plotly",
                        title="Biểu diễn Vector Lực và Gia tốc (F = m*a)",
                        parameters={"slope": 2.0, "x_label": "Gia tốc a (m/s2)", "y_label": "Hợp lực F (N)"},
                        latex_formula=r"\vec{F} = m\vec{a}"
                    ),
                    explanation=f"{mock_notice}\nĐịnh luật II Newton: Gia tốc của một vật tỉ lệ thuận với hợp lực tác dụng lên vật và tỉ lệ nghịch với khối lượng."
                )
            elif scenario_idx == 1:
                # Kịch bản 2: Dao động điều hòa
                return RecognizeCanvasResponse(
                    recognized_text="x = 5*cos(10t + pi/3) (cm)",
                    latex=r"x = 5\cos\left(10t + \frac{\pi}{3}\right) \text{ (cm)}",
                    subject="VAT_LY",
                    confidence=0.96,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "OSCILLATION",
                        "amplitude": "5 cm",
                        "angular_frequency": "10 rad/s",
                        "initial_phase": "pi/3 rad",
                        "period_T": "0.628 s"
                    },
                    visualization=VisualizationData(
                        type="2D_GRAPH",
                        engine="plotly",
                        title="Đồ thị li độ - thời gian x = 5cos(10t + pi/3)",
                        parameters={
                            "function": "5 * cos(10*x + 1.047)",
                            "x_range": [0, 1.5],
                            "amplitude": 5,
                            "period": 0.628
                        },
                        latex_formula=r"x = 5\cos\left(10t + \frac{\pi}{3}\right)"
                    ),
                    explanation=f"{mock_notice}\nDao động điều hòa có biên độ A = 5cm, tần số góc omega = 10 rad/s, pha ban đầu phi = pi/3 rad."
                )
            else:
                # Kịch bản 3: Mạch điện xoay chiều RLC & Định luật Ohm
                return RecognizeCanvasResponse(
                    recognized_text="I = U / Z, Z = sqrt(R^2 + (ZL - ZC)^2)",
                    latex=r"I = \frac{U}{Z}, \quad Z = \sqrt{R^2 + (Z_L - Z_C)^2}",
                    subject="VAT_LY",
                    confidence=0.97,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "ELECTRIC_CIRCUIT",
                        "components": ["Điện trở R", "Cuộn cảm L", "Tụ điện C"],
                        "impedance_formula": r"Z = \sqrt{R^2 + (Z_L - Z_C)^2}"
                    },
                    visualization=None,
                    explanation=f"{mock_notice}\nĐịnh luật Ohm cho đoạn mạch xoay chiều RLC nối tiếp: Cường độ dòng điện hiệu dụng tỉ lệ nghịch với tổng trở Z của mạch."
                )

        # ----------------------------------------------------------------------
        # MÔN HÓA HỌC (CHEMISTRY / HOA_HOC)
        # ----------------------------------------------------------------------
        elif "CHEM" in subj or "HOA" in subj:
            if scenario_idx == 0:
                # Kịch bản 1: Phản ứng tổng hợp nước (Vô cơ cơ bản)
                return RecognizeCanvasResponse(
                    recognized_text="2H2 + O2 -> 2H2O (t*)",
                    latex=r"2\text{H}_2 + \text{O}_2 \xrightarrow{\text{t}^\circ} 2\text{H}_2\text{O}",
                    subject="HOA_HOC",
                    confidence=0.97,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "INORGANIC_REACTION",
                        "reaction_type": "Phản ứng tổng hợp nước (Oxi hóa - Khử)",
                        "is_balanced": True,
                        "reactants": ["2H2", "O2"],
                        "products": ["2H2O"],
                        "condition": r"t^\circ",
                        "smiles": "O"
                    },
                    visualization=VisualizationData(
                        type="3D_MOLECULE",
                        engine="3dmol",
                        title="Mô hình phân tử Nước (H2O)",
                        parameters={"smiles": "O", "formula": "H2O"}
                    ),
                    explanation=f"{mock_notice}\nKhí Hydro cháy trong khí Oxy ở nhiệt độ cao tạo thành hơi nước, phản ứng tỏa nhiệt mạnh."
                )
            elif scenario_idx == 1:
                # Kịch bản 2: Phản ứng este hóa (Hóa hữu cơ)
                return RecognizeCanvasResponse(
                    recognized_text="CH3COOH + C2H5OH <=> CH3COOC2H5 + H2O (H2SO4 d, t*)",
                    latex=r"\text{CH}_3\text{COOH} + \text{C}_2\text{H}_5\text{OH} \xrightleftharpoons[\text{t}^\circ]{\text{H}_2\text{SO}_4 \text{ đ}} \text{CH}_3\text{COOC}_2\text{H}_5 + \text{H}_2\text{O}",
                    subject="HOA_HOC",
                    confidence=0.96,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "ORGANIC_REACTION",
                        "reaction_type": "Phản ứng Este hóa (Thuận nghịch)",
                        "reactants": ["CH3COOH (Axit axetic)", "C2H5OH (Ethanol)"],
                        "products": ["CH3COOC2H5 (Etyl axetat)", "H2O"],
                        "smiles": "CCOC(=O)C",
                        "iupac_name": "Ethyl acetate"
                    },
                    visualization=VisualizationData(
                        type="3D_MOLECULE",
                        engine="3dmol",
                        title="Mô hình phân tử Etyl axetat (CH3COOC2H5)",
                        parameters={"smiles": "CCOC(=O)C", "formula": "C4H8O2"}
                    ),
                    explanation=f"{mock_notice}\nPhản ứng este hóa giữa axit axetic và ancol etylic xúc tác H2SO4 đặc tạo thành etyl axetat có mùi thơm hoa quả đặc trưng."
                )
            else:
                # Kịch bản 3: Phản ứng nhiệt phân sinh khí (Hóa vô cơ)
                return RecognizeCanvasResponse(
                    recognized_text="2KMnO4 -> K2MnO4 + MnO2 + O2^ (t*)",
                    latex=r"2\text{KMnO}_4 \xrightarrow{\text{t}^\circ} \text{K}_2\text{MnO}_4 + \text{MnO}_2 + \text{O}_2\uparrow",
                    subject="HOA_HOC",
                    confidence=0.97,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "INORGANIC_REACTION",
                        "reaction_type": "Phản ứng phân hủy / Oxi hóa - Khử",
                        "is_balanced": True,
                        "gas_released": "O2 (Khí Oxy)",
                        "arrow_up": r"\uparrow"
                    },
                    visualization=None,
                    explanation=f"{mock_notice}\nNhiệt phân thuốc tím (KMnO4) trong phòng thí nghiệm giải phóng khí Oxy làm tàn đóm đỏ bùng cháy."
                )

        # ----------------------------------------------------------------------
        # MÔN SINH HỌC (BIOLOGY / SINH_HOC)
        # ----------------------------------------------------------------------
        elif "SINH" in subj or "BIO" in subj:
            if "CELL" in subj or "TE_BAO" in subj:
                return RecognizeCanvasResponse(
                    recognized_text="Cell Structure (Cấu tạo tế bào)",
                    latex=None,
                    subject="SINH_HOC",
                    confidence=0.98,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "CELL_STRUCTURE",
                        "concept": "Cell",
                        "vietnamese_name": "Cấu tạo Tế bào",
                        "organelles": ["Màng tế bào", "Nhân (Nucleus)", "Ty thể (Mitochondria)", "Tế bào chất"]
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Cấu tạo Tế bào",
                        parameters={"concept": "cell", "style": "white_chalk"}
                    ),
                    explanation=f"{mock_notice}\nTế bào là đơn vị cấu trúc và chức năng cơ bản của mọi sinh vật sống."
                )
            else:
                # Kịch bản tiêu biểu: Quang hợp (Photosynthesis)
                return RecognizeCanvasResponse(
                    recognized_text="Photosynthesis: 6CO2 + 6H2O -> C6H12O6 + 6O2 (Ánh sáng, Diệp lục)",
                    latex=r"6\text{CO}_2 + 6\text{H}_2\text{O} \xrightarrow[\text{Diệp lục}]{\text{Ánh sáng}} \text{C}_6\text{H}_{12}\text{O}_6 + 6\text{O}_2\uparrow",
                    subject="SINH_HOC",
                    confidence=0.99,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "PHOTOSYNTHESIS",
                        "concept": "Photosynthesis",
                        "vietnamese_name": "Quá trình Quang hợp",
                        "formula": "6CO2 + 6H2O -> C6H12O6 + 6O2",
                        "raw_materials": ["Khí CO2", "Nước H2O", "Ánh sáng mặt trời"],
                        "products": ["Glucose C6H12O6", "Khí Oxy O2"]
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Quá trình Quang hợp ở cây xanh",
                        parameters={"concept": "photosynthesis", "style": "white_chalk"}
                    ),
                    explanation=f"{mock_notice}\nQuá trình quang hợp giúp cây xanh chuyển hóa năng lượng ánh sáng thành năng lượng hóa học trong hợp chất hữu cơ."
                )

        # ----------------------------------------------------------------------
        # MÔN ĐỊA LÝ & THIÊN VĂN (GEOGRAPHY / DIA_LY)
        # ----------------------------------------------------------------------
        elif "DIA" in subj or "GEO" in subj:
            if "SOLAR" in subj or "MAT_TROI" in subj or "HE_MAT_TROI" in subj:
                return RecognizeCanvasResponse(
                    recognized_text="Solar System (Hệ Mặt Trời)",
                    latex=None,
                    subject="DIA_LY",
                    confidence=0.98,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "ASTRONOMY",
                        "concept": "Solar System",
                        "vietnamese_name": "Hệ Mặt Trời",
                        "planets": ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"]
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Hệ Mặt Trời và các hành tinh",
                        parameters={"concept": "solarsystem", "style": "white_chalk"}
                    ),
                    explanation=f"{mock_notice}\nHệ Mặt Trời gồm Mặt Trời ở trung tâm và 8 hành tinh quay xung quanh theo quỹ đạo hình elip."
                )
            else:
                # Kịch bản tiêu biểu: Núi lửa (Volcano)
                return RecognizeCanvasResponse(
                    recognized_text="Volcano Eruption (Núi lửa phun trào)",
                    latex=None,
                    subject="DIA_LY",
                    confidence=0.98,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "VOLCANO_TECTONICS",
                        "concept": "Volcano",
                        "vietnamese_name": "Núi Lửa",
                        "components": ["Miệng núi lửa (Crater)", "Ống dẫn magma", "Dòng dung nham (Lava)", "Cột tro bụi (Ash cloud)"]
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Cấu tạo và hoạt động núi lửa",
                        parameters={"concept": "volcano", "style": "white_chalk"}
                    ),
                    explanation=f"{mock_notice}\nNúi lửa là nơi magma từ dưới sâu lòng đất phun trào lên bề mặt qua các đứt gãy của vỏ Trái Đất."
                )

        # ----------------------------------------------------------------------
        # MÔN TIẾNG ANH (ENGLISH / TIENG_ANH)
        # ----------------------------------------------------------------------
        else:

            if scenario_idx == 0:
                # Kịch bản 1: Từ vựng danh từ chuyên ngành giáo dục
                return RecognizeCanvasResponse(
                    recognized_text="Education /ˌedʒuˈkeɪʃn/ (n): Sự giáo dục",
                    latex=None,
                    subject="TIENG_ANH",
                    confidence=0.98,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "VOCABULARY",
                        "word": "Education",
                        "word_type": "Noun (Danh từ)",
                        "ipa": "/ˌedʒuˈkeɪʃn/",
                        "vietnamese_meaning": "Sự giáo dục, nền giáo dục",
                        "synonyms": ["learning", "schooling", "instruction"],
                        "example_sentence": "Education is the key to unlock the golden door of freedom.",
                        "example_translation": "Giáo dục là chiếc chìa khóa mở ra cánh cửa vàng của sự tự do."
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Khái niệm Từ vựng: Education",
                        parameters={"word": "education", "category": "learning"}
                    ),
                    explanation=f"{mock_notice}\nTừ loại: Danh từ không đếm được. Trọng âm rơi vào âm tiết thứ ba: /keɪ/."
                )
            elif scenario_idx == 1:
                # Kịch bản 2: Tính từ tương tác (Interactive)
                return RecognizeCanvasResponse(
                    recognized_text="Interactive /ˌɪntərˈæktɪv/ (adj): Có tính tương tác",
                    latex=None,
                    subject="TIENG_ANH",
                    confidence=0.96,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "VOCABULARY",
                        "word": "Interactive",
                        "word_type": "Adjective (Tính từ)",
                        "ipa": "/ˌɪntərˈæktɪv/",
                        "vietnamese_meaning": "Có tính tương tác, tương tác lẫn nhau",
                        "synonyms": ["reciprocal", "two-way"],
                        "example_sentence": "Teachers and students love using the interactive flat panel display.",
                        "example_translation": "Thầy cô và học sinh rất thích sử dụng màn hình tương tác thông minh."
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Khái niệm: Interactive Flat Panel",
                        parameters={"word": "interactive"}
                    ),
                    explanation=f"{mock_notice}\nTừ ghép tiền tố 'inter-' (giữa, lẫn nhau) và 'active' (hoạt động). Thường dùng trong cụm: interactive whiteboards, interactive learning."
                )
            else:
                # Kịch bản 3: Câu ngữ pháp điều kiện
                return RecognizeCanvasResponse(
                    recognized_text="If you practice every day, your English will improve rapidly.",
                    latex=None,
                    subject="TIENG_ANH",
                    confidence=0.97,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "GRAMMAR_SENTENCE",
                        "grammar_structure": "First Conditional (Câu điều kiện loại 1)",
                        "if_clause": "If you practice every day (Hiện tại đơn)",
                        "main_clause": "your English will improve rapidly (Tương lai đơn will + V)",
                        "usage": "Diễn tả hành động có thể xảy ra ở hiện tại hoặc tương lai."
                    },
                    visualization=None,
                    explanation=f"{mock_notice}\nCấu trúc câu điều kiện loại 1: If + S + V(hiện tại đơn), S + will + V-nguyên thể."
                )


gemini_service = GeminiAIService()
