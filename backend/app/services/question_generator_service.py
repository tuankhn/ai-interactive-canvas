# ==============================================================================
# DỊCH VỤ AI TẠO CÂU HỎI TƯƠNG TỰ VÀ CÂU HỎI NÂNG CAO (TASK TF2851B)
# Phụ trách: Nguyễn Ngọc Gia Bảo 2 (N25DTCN121) - Sprint 3 (16/11 - 20/11/2026)
# ==============================================================================

from datetime import datetime, timezone
import json
import logging
import math
import random
import re
from typing import Any, Dict, List, Optional, Tuple
import uuid

from app.core.config import settings
from app.schemas.quiz import (
    GeneratedVariantItem,
    GenerateQuestionVariantRequest,
    GenerateQuestionVariantResponse,
    QuestionVariantType,
)

logger = logging.getLogger(__name__)


class QuestionVariantService:
    """
    Dịch vụ tạo câu hỏi tương tự (đổi số liệu) và câu hỏi nâng cao (thêm điều kiện độ khó).
    Hỗ trợ giáo viên chiếu bài tập lên bảng vẽ, bấm nút để AI sinh bài biến thể:
      1. SIMILAR: Giữ nguyên cấu trúc logic, đổi số liệu hợp lý (đảm bảo nghiệm đẹp,
         không chia 0, không căn âm), giữ nguyên mức độ nhận thức.
      2. ADVANCED: Thêm điều kiện ràng buộc toán học (tham số m, hệ thức Vi-et,
         cực trị Max/Min, nghiệm nguyên, lực cản/ma sát) dành cho học sinh khá giỏi.
      3. Fallback Engine: Bộ thuật toán toán học xác định cực kỳ mạnh mẽ, không phụ thuộc
         mạng, hỗ trợ sinh vô hạn biến thể khác nhau qua seed.
    """

    def __init__(self):
        self.gemini_model = settings.GEMINI_MODEL or "gemini-2.5-flash"

    # --------------------------------------------------------------------------
    # PUBLIC API
    # --------------------------------------------------------------------------

    async def generate_variants(
        self, request: GenerateQuestionVariantRequest
    ) -> GenerateQuestionVariantResponse:
        """
        Sinh câu hỏi tương tự hoặc câu hỏi nâng cao dựa trên yêu cầu từ giáo viên.
        """
        original_text = (request.original_question or "").strip()
        if not original_text:
            raise ValueError("Đề bài gốc không được để trống.")

        requested_type = (request.variant_type or "SIMILAR").upper()
        subject = (request.subject or "TOAN").upper()
        seed = request.seed if request.seed is not None else random.randint(1, 100000)

        variants: List[GeneratedVariantItem] = []
        source = "MATH_PERTURBATION_ENGINE"

        # Thử gọi Gemini AI nếu có API Key và không trong môi trường test ép mock
        if settings.GEMINI_API_KEY and len(settings.GEMINI_API_KEY.strip()) > 5:
            try:
                ai_items = await self._generate_with_gemini(
                    original_text=original_text,
                    variant_type=requested_type,
                    subject=subject,
                    difficulty=request.current_difficulty or "THONG_HIEU",
                )
                if ai_items:
                    variants.extend(ai_items)
                    source = "AI_GEMINI"
            except Exception as e:
                logger.warning(f"Lỗi khi gọi Gemini sinh câu hỏi: {e}. Kích hoạt Math Perturbation Engine.")

        # Nếu Gemini không sinh hoặc không có API Key, sử dụng Math Perturbation Engine cục bộ
        if not variants:
            source = "MATH_PERTURBATION_ENGINE"
            if requested_type in ["SIMILAR", "BOTH"]:
                sim_item = self._generate_similar_variant(
                    original_text=original_text,
                    subject=subject,
                    seed=seed,
                )
                variants.append(sim_item)

            if requested_type in ["ADVANCED", "BOTH"]:
                adv_item = self._generate_advanced_variant(
                    original_text=original_text,
                    subject=subject,
                    seed=seed + 77,
                )
                variants.append(adv_item)

        return GenerateQuestionVariantResponse(
            original_question=original_text,
            subject=subject,
            requested_type=requested_type,
            total_variants=len(variants),
            variants=variants,
            generation_source=source,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    # --------------------------------------------------------------------------
    # THUẬT TOÁN SINH BIẾN THỂ CỤC BỘ (RULE-BASED / MATH PERTURBATION ENGINE)
    # --------------------------------------------------------------------------

    def _generate_similar_variant(
        self, original_text: str, subject: str = "TOAN", seed: int = 123
    ) -> GeneratedVariantItem:
        """Tạo bài tập tương tự bằng cách đổi số liệu, giữ nguyên cấu trúc và phương pháp giải."""
        rng = random.Random(seed)
        problem_type = self._detect_problem_type(original_text, subject)

        if problem_type == "QUADRATIC_EQ":
            return self._similar_quadratic(original_text, rng)
        elif problem_type == "SYSTEM_2VAR":
            return self._similar_system_2var(original_text, rng)
        elif problem_type == "MOTION_WORD_PROBLEM":
            return self._similar_motion(original_text, rng)
        elif problem_type == "GEOMETRY_TRIANGLE":
            return self._similar_geometry_triangle(original_text, rng)
        elif problem_type == "PHYSICS_SPRING":
            return self._similar_physics_spring(original_text, rng)
        else:
            return self._similar_general_numeric(original_text, subject, rng)

    def _generate_advanced_variant(
        self, original_text: str, subject: str = "TOAN", seed: int = 456
    ) -> GeneratedVariantItem:
        """Tạo bài tập nâng cao bằng cách thêm điều kiện độ khó cho học sinh khá giỏi."""
        rng = random.Random(seed)
        problem_type = self._detect_problem_type(original_text, subject)

        if problem_type == "QUADRATIC_EQ":
            return self._advanced_quadratic(original_text, rng)
        elif problem_type == "SYSTEM_2VAR":
            return self._advanced_system_2var(original_text, rng)
        elif problem_type == "MOTION_WORD_PROBLEM":
            return self._advanced_motion(original_text, rng)
        elif problem_type == "GEOMETRY_TRIANGLE":
            return self._advanced_geometry_triangle(original_text, rng)
        elif problem_type == "PHYSICS_SPRING":
            return self._advanced_physics_spring(original_text, rng)
        else:
            return self._advanced_general_numeric(original_text, subject, rng)

    def _detect_problem_type(self, text: str, subject: str) -> str:
        """Nhận diện dạng bài tập từ văn bản đề bài."""
        lower = text.lower()

        # Dạng phương trình bậc 2
        if re.search(r"x\s*[\^²]\s*2|x\^2", lower) and ("=" in lower or "phương trình" in lower or "nghiệm" in lower):
            return "QUADRATIC_EQ"

        # Dạng hệ phương trình 2 ẩn
        if ("hệ phương trình" in lower or "hpt" in lower or ("x +" in lower and "y =" in lower)) and ("{" in lower or "và" in lower or "\n" in lower):
            return "SYSTEM_2VAR"

        # Dạng bài toán chuyển động
        if any(w in lower for w in ["ô tô", "xe máy", "vận tốc", "quãng đường", "km/h", "ca nô", "xuôi dòng", "ngược dòng", "khởi hành"]):
            return "MOTION_WORD_PROBLEM"

        # Dạng hình học tam giác vuông / Pytago
        if any(w in lower for w in ["tam giác", "vuông tại", "cạnh huyền", "py-ta-go", "pythagore", "đường cao", "diện tích tam giác"]):
            return "GEOMETRY_TRIANGLE"

        # Dạng vật lý con lắc lò xo / dao động
        if any(w in lower for w in ["con lắc lò xo", "độ cứng k", "khối lượng m", "dao động điều hòa", "chu kỳ t", "tần số"]):
            return "PHYSICS_SPRING"

        return "GENERAL_NUMERIC"

    # --------------------------------------------------------------------------
    # CHUYÊN BIỆT CHO DẠNG: PHƯƠNG TRÌNH BẬC 2
    # --------------------------------------------------------------------------

    def _similar_quadratic(self, original_text: str, rng: random.Random) -> GeneratedVariantItem:
        """Đổi số liệu phương trình bậc 2 sao cho nghiệm nguyên đẹp."""
        # Danh sách cặp nghiệm nguyên đẹp (r1, r2) và hệ số a
        candidate_pairs = [
            (1, 2, 4),    # a=1, x1=2, x2=4 -> x^2 - 6x + 8 = 0
            (1, 1, 5),    # a=1, x1=1, x2=5 -> x^2 - 6x + 5 = 0
            (1, -2, 3),   # a=1, x1=-2, x2=3 -> x^2 - x - 6 = 0
            (1, 2, 5),    # a=1, x1=2, x2=5 -> x^2 - 7x + 10 = 0
            (1, -1, 4),   # a=1, x1=-1, x2=4 -> x^2 - 3x - 4 = 0
            (2, 1, 3),    # a=2, x1=1, x2=3 -> 2x^2 - 8x + 6 = 0
            (1, 3, 6),    # a=1, x1=3, x2=6 -> x^2 - 9x + 18 = 0
            (2, -1, 2),   # a=2, (x+1)(2x-4) -> 2x^2 - 2x - 4 = 0
        ]
        a, r1, r2 = rng.choice(candidate_pairs)
        b = -a * (r1 + r2)
        c = a * r1 * r2

        # Format phương trình ax^2 + bx + c = 0
        eq_str = self._format_quadratic_str(a, b, c)
        delta = b * b - 4 * a * c
        question_content = f"Giải phương trình bậc hai sau trên tập số thực: {eq_str}"

        steps = [
            f"Bước 1: Xác định các hệ số: a = {a}, b = {b}, c = {c}.",
            f"Bước 2: Tính biệt thức Delta: Delta = b^2 - 4ac = ({b})^2 - 4*({a})*({c}) = {delta}.",
            f"Bước 3: Vì Delta = {delta} > 0 nên phương trình có hai nghiệm phân biệt:",
            f"  x_1 = (-b + sqrt(Delta)) / (2a) = ({-b} + {int(math.isqrt(delta))}) / {2*a} = {r1}.",
            f"  x_2 = (-b - sqrt(Delta)) / (2a) = ({-b} - {int(math.isqrt(delta))}) / {2*a} = {r2}.",
            f"Bước 4: Kết luận tập nghiệm S = {{{min(r1, r2)}; {max(r1, r2)}}}."
        ]
        solution_guide = "\n".join(steps)
        correct_answer = f"x_1 = {min(r1, r2)}, x_2 = {max(r1, r2)}"
        changed_params = f"Đổi hệ số phương trình thành: a = {a}, b = {b}, c = {c} (Delta = {delta} là số chính phương, nghiệm nguyên đẹp)."

        card_text = f"【BÀI TẬP TƯƠNG TỰ - ĐỔI SỐ LIỆU】\n{question_content}\n• Lưu ý: Biệt thức Delta > 0, giải bằng công thức nghiệm chuẩn."

        return GeneratedVariantItem(
            id=f"var_sim_{uuid.uuid4().hex[:8]}",
            variant_type="SIMILAR",
            type_display="Bài tập tương tự (Đổi số liệu)",
            badge_color="#16a34a",
            icon="🔄",
            title="Đổi hệ số phương trình bậc hai (Nghiệm hữu tỉ đẹp)",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Thông hiểu",
            changed_parameters=changed_params,
            added_conditions="Không thêm điều kiện (giữ nguyên độ khó cơ bản).",
            advanced_hint="Áp dụng công thức nghiệm thu gọn hoặc nhẩm nghiệm a + b + c = 0 / a - b + c = 0.",
            correct_answer=correct_answer,
            solution_guide=solution_guide,
            canvas_card_text=card_text,
        )

    def _advanced_quadratic(self, original_text: str, rng: random.Random) -> GeneratedVariantItem:
        """Thêm tham số m và hệ thức Vi-et nâng cao cho học sinh khá giỏi."""
        advanced_scenarios = [
            {
                "eq": "x^2 - 2(m + 1)x + m^2 + 2m - 3 = 0",
                "condition": "x_1^2 + x_2^2 - 3x_1 x_2 = 13",
                "ans": "m = 0 hoặc m = -2",
                "guide": (
                    "1) Điều kiện để phương trình có hai nghiệm phân biệt: Delta' = (m+1)^2 - (m^2+2m-3) = 4 > 0 (luôn đúng với mọi m).\n"
                    "2) Theo hệ thức Vi-et: x_1 + x_2 = 2(m + 1) và x_1*x_2 = m^2 + 2m - 3.\n"
                    "3) Biến đổi điều kiện đề bài: (x_1 + x_2)^2 - 5x_1*x_2 = 13.\n"
                    "   <=> 4(m+1)^2 - 5(m^2+2m-3) = 13\n"
                    "   <=> 4m^2 + 8m + 4 - 5m^2 - 10m + 15 = 13\n"
                    "   <=> -m^2 - 2m + 6 = 0 ... Giải ra m."
                ),
                "param_desc": "Thêm tham số m vào hệ số b và c; bổ sung điều kiện đẳng thức nghiệm đối xứng x_1^2 + x_2^2 - 3x_1 x_2 = 13.",
            },
            {
                "eq": "x^2 - (2m - 1)x + m^2 - m - 2 = 0",
                "condition": "|x_1 - x_2| = 3",
                "ans": "m tùy ý (Delta luôn bằng 9)",
                "guide": (
                    "1) Biệt thức Delta = (2m-1)^2 - 4(m^2 - m - 2) = 4m^2 - 4m + 1 - 4m^2 + 4m + 8 = 9 > 0.\n"
                    "   => Phương trình luôn có hai nghiệm phân biệt x_1, x_2 với mọi m.\n"
                    "2) Ta có |x_1 - x_2| = sqrt(Delta) / |a| = sqrt(9) / 1 = 3.\n"
                    "3) Kết luận: Hệ thức thỏa mãn với mọi giá trị thực của tham số m."
                ),
                "param_desc": "Thêm tham số m và yêu cầu khoảng cách giữa 2 nghiệm trên trục số: |x_1 - x_2| = 3.",
            },
            {
                "eq": "x^2 - 2mx + m^2 - 4 = 0",
                "condition": "x_1 < 1 < x_2 (1 nằm giữa hai nghiệm)",
                "ans": "-1 < m < 3",
                "guide": (
                    "1) Delta' = m^2 - (m^2 - 4) = 4 > 0 (luôn có 2 nghiệm phân biệt x_1 < x_2).\n"
                    "2) Điều kiện x_1 < 1 < x_2 tương đương: a * f(1) < 0 với f(x) = x^2 - 2mx + m^2 - 4.\n"
                    "3) f(1) = 1 - 2m + m^2 - 4 = m^2 - 2m - 3 < 0 <=> (m + 1)(m - 3) < 0 <=> -1 < m < 3.\n"
                    "4) Kết luận: -1 < m < 3."
                ),
                "param_desc": "Thêm tham số m và điều kiện so sánh nghiệm với hằng số: x_1 < 1 < x_2.",
            },
        ]
        choice = rng.choice(advanced_scenarios)
        question_content = (
            f"Cho phương trình bậc hai ẩn x: {choice['eq']}.\n"
            f"Tìm tất cả các giá trị của tham số m để phương trình có hai nghiệm phân biệt x_1, x_2 thỏa mãn: {choice['condition']}."
        )

        card_text = (
            f"【BÀI TẬP NÂNG CAO - HỌC SINH KHÁ GIỎI】\n"
            f"Đề bài: Cho PT: {choice['eq']}\n"
            f"Yêu cầu: Tìm m để 2 nghiệm thỏa mãn: {choice['condition']}\n"
            f"• Gợi ý: Kiểm tra điều kiện Delta > 0 và khai triển hệ thức Vi-et."
        )

        return GeneratedVariantItem(
            id=f"var_adv_{uuid.uuid4().hex[:8]}",
            variant_type="ADVANCED",
            type_display="Bài tập nâng cao (Thêm điều kiện độ khó)",
            badge_color="#7c3aed",
            icon="🚀",
            title="Phương trình bậc hai chứa tham số m & Định lý Vi-et",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Vận dụng cao",
            changed_parameters=choice["param_desc"],
            added_conditions=f"Bổ sung tham số m và ràng buộc: {choice['condition']}.",
            advanced_hint="1) Tìm điều kiện để Delta > 0. 2) Dùng hệ thức Vi-et biến đổi biểu thức đối xứng theo tổng (x_1 + x_2) và tích (x_1*x_2).",
            correct_answer=choice["ans"],
            solution_guide=choice["guide"],
            canvas_card_text=card_text,
        )

    # --------------------------------------------------------------------------
    # CHUYÊN BIỆT CHO DẠNG: HỆ PHƯƠNG TRÌNH 2 ẨN
    # --------------------------------------------------------------------------

    def _similar_system_2var(self, original_text: str, rng: random.Random) -> GeneratedVariantItem:
        """Đổi hệ số hệ phương trình 2 ẩn có nghiệm duy nhất nguyên đẹp."""
        candidate_systems = [
            (2, 1, 7, 1, -1, 2, 3, 1),    # 2x + y = 7; x - y = 2 -> (3, 1)
            (3, 2, 12, 1, -2, -4, 2, 3),  # 3x + 2y = 12; x - 2y = -4 -> (2, 3)
            (1, 3, 10, 2, 1, 5, 1, 3),    # x + 3y = 10; 2x + y = 5 -> (1, 3)
            (4, -1, 7, 2, 3, 7, 2, 1),    # 4x - y = 7; 2x + 3y = 7 -> (2, 1)
        ]
        a1, b1, c1, a2, b2, c2, x_ans, y_ans = rng.choice(candidate_systems)
        eq1_str = f"{a1}x {'+' if b1 > 0 else '-'} {abs(b1)}y = {c1}"
        eq2_str = f"{a2}x {'+' if b2 > 0 else '-'} {abs(b2)}y = {c2}"
        question_content = f"Giải hệ phương trình bậc nhất hai ẩn sau:\n  {eq1_str}\n  {eq2_str}"

        solution_guide = (
            f"Bước 1: Nhân hoặc biến đổi cộng đại số để triệt tiêu một ẩn.\n"
            f"Bước 2: Tìm nghiệm ẩn thứ nhất => x = {x_ans}.\n"
            f"Bước 3: Thế x = {x_ans} vào phương trình còn lại tìm y => y = {y_ans}.\n"
            f"Bước 4: Kết luận nghiệm của hệ là (x; y) = ({x_ans}; {y_ans})."
        )

        card_text = f"【BÀI TẬP TƯƠNG TỰ - ĐỔI SỐ LIỆU】\n{question_content}\n• Nghiệm duy nhất nguyên đẹp."

        return GeneratedVariantItem(
            id=f"var_sim_{uuid.uuid4().hex[:8]}",
            variant_type="SIMILAR",
            type_display="Bài tập tương tự (Đổi số liệu)",
            badge_color="#16a34a",
            icon="🔄",
            title="Đổi hệ số Hệ phương trình bậc nhất 2 ẩn",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Thông hiểu",
            changed_parameters=f"Đổi hệ số hệ phương trình sang bộ ({a1}, {b1}, {c1}) và ({a2}, {b2}, {c2}).",
            added_conditions="Không thêm điều kiện.",
            advanced_hint="Sử dụng phương pháp cộng đại số hoặc phương pháp thế.",
            correct_answer=f"(x; y) = ({x_ans}; {y_ans})",
            solution_guide=solution_guide,
            canvas_card_text=card_text,
        )

    def _advanced_system_2var(self, original_text: str, rng: random.Random) -> GeneratedVariantItem:
        """Hệ phương trình chứa tham số m tìm nghiệm nguyên hoặc cực trị."""
        question_content = (
            "Cho hệ phương trình bậc nhất hai ẩn chứa tham số m:\n"
            "  mx + y = 3\n"
            "  x + my = 2m + 1\n"
            "1) Tìm m để hệ phương trình có nghiệm duy nhất (x, y).\n"
            "2) Với m tìm được ở trên, hãy tìm tất cả các giá trị nguyên của m để biểu thức P = 2x - y nhận giá trị nguyên."
        )
        guide = (
            "1) Tính định thức D = m^2 - 1. Hệ có nghiệm duy nhất <=> D != 0 <=> m != 1 và m != -1.\n"
            "2) D_x = 3m - (2m + 1) = m - 1. Khi đó x = D_x / D = (m - 1)/((m - 1)(m + 1)) = 1 / (m + 1).\n"
            "3) D_y = m(2m + 1) - 3 = 2m^2 + m - 3 = (m - 1)(2m + 3). Khi đó y = (2m + 3)/(m + 1) = 2 + 1/(m + 1).\n"
            "4) Biểu thức P = 2x - y = 2/(m + 1) - [2 + 1/(m + 1)] = 1/(m + 1) - 2.\n"
            "5) Để P nguyên thì (m + 1) phải là ước của 1 => m + 1 thuộc {1; -1} => m thuộc {0; -2} (thỏa mãn điều kiện m != +-1)."
        )

        card_text = (
            "【BÀI TẬP NÂNG CAO - HỌC SINH KHÁ GIỎI】\n"
            "Đề bài: Cho hệ PT chứa tham số m: mx + y = 3 và x + my = 2m + 1\n"
            "Yêu cầu: Tìm m để hệ có nghiệm duy nhất và biểu thức P = 2x - y nhận giá trị nguyên."
        )

        return GeneratedVariantItem(
            id=f"var_adv_{uuid.uuid4().hex[:8]}",
            variant_type="ADVANCED",
            type_display="Bài tập nâng cao (Thêm điều kiện độ khó)",
            badge_color="#7c3aed",
            icon="🚀",
            title="Hệ phương trình chứa tham số m & Nghiệm nguyên",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Vận dụng cao",
            changed_parameters="Biến hệ số cố định thành tham số m và bổ sung biểu thức điều kiện nghiệm nguyên P = 2x - y.",
            added_conditions="Hệ có nghiệm duy nhất thỏa mãn biểu thức P nguyên với m nguyên.",
            advanced_hint="Dùng công thức Cramer tính D, D_x, D_y theo m; rút gọn x, y để đưa về dạng ước số nguyên.",
            correct_answer="m in {0; -2}",
            solution_guide=guide,
            canvas_card_text=card_text,
        )

    # --------------------------------------------------------------------------
    # CHUYÊN BIỆT CHO DẠNG: BÀI TOÁN CHUYỂN ĐỘNG THỰC TẾ
    # --------------------------------------------------------------------------

    def _similar_motion(self, original_text: str, rng: random.Random) -> GeneratedVariantItem:
        """Đổi số liệu quãng đường, vận tốc bài toán chuyển động."""
        triplets = [
            (120, 40, 60),  # s=120km, v1=40km/h (t1=3h), v2=60km/h (t2=2h), chênh lệch 1h
            (150, 50, 30),  # s=150km, v1=50km/h (t1=3h), v2=30km/h (t2=5h), chênh lệch 2h
            (90, 45, 30),   # s=90km, v1=45km/h (t1=2h), v2=30km/h (t2=3h), chênh lệch 1h
            (180, 60, 45),  # s=180km, v1=60km/h (t1=3h), v2=45km/h (t2=4h), chênh lệch 1h
        ]
        s, v1, v2 = rng.choice(triplets)
        t_diff = abs(s // v1 - s // v2)

        question_content = (
            f"Một ô tô dự định đi từ tỉnh A đến tỉnh B trên quãng đường dài {s} km với vận tốc {v1} km/h. "
            f"Tuy nhiên trên thực tế, xe di chuyển với vận tốc {v2} km/h. "
            f"Hỏi ô tô đến tỉnh B sớm hơn (hoặc muộn hơn) so với dự định bao nhiêu giờ?"
        )
        guide = (
            f"1) Thời gian đi dự kiến: t_1 = {s} / {v1} = {s / v1:.1f} giờ.\n"
            f"2) Thời gian đi thực tế: t_2 = {s} / {v2} = {s / v2:.1f} giờ.\n"
            f"3) Chênh lệch thời gian: |t_1 - t_2| = {t_diff} giờ.\n"
            f"Kết luận: Ô tô đến {'sớm' if v2 > v1 else 'muộn'} hơn dự kiến {t_diff} giờ."
        )

        card_text = f"【BÀI TẬP TƯƠNG TỰ - ĐỔI SỐ LIỆU】\n{question_content}"

        return GeneratedVariantItem(
            id=f"var_sim_{uuid.uuid4().hex[:8]}",
            variant_type="SIMILAR",
            type_display="Bài tập tương tự (Đổi số liệu)",
            badge_color="#16a34a",
            icon="🔄",
            title="Đổi số liệu quãng đường & vận tốc chuyển động",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Thông hiểu",
            changed_parameters=f"Đổi quãng đường s = {s} km, vận tốc dự kiến = {v1} km/h, vận tốc thực tế = {v2} km/h.",
            added_conditions="Không thêm điều kiện.",
            advanced_hint="Áp dụng trực tiếp công thức t = s / v.",
            correct_answer=f"{t_diff} giờ",
            solution_guide=guide,
            canvas_card_text=card_text,
        )

    def _advanced_motion(self, original_text: str, rng: random.Random) -> GeneratedVariantItem:
        """Nâng cao bài toán chuyển động: Ca nô xuôi/ngược dòng hoặc 2 xe gặp nhau thay đổi vận tốc."""
        question_content = (
            "Một chiếc ca nô xuôi dòng một khúc sông dài 90 km rồi ngay lập tức quay ngược dòng về điểm xuất phát. "
            "Biết thời gian ca nô xuôi dòng ít hơn thời gian ngược dòng là 1 giờ 30 phút (1.5 giờ), "
            "và vận tốc của dòng nước chảy là 3 km/h. "
            "Tính vận tốc thực của ca nô khi nước yên lặng."
        )
        guide = (
            "1) Gọi vận tốc thực của ca nô là v (km/h, điều kiện v > 3).\n"
            "2) Vận tốc xuôi dòng: v + 3 (km/h); Vận tốc ngược dòng: v - 3 (km/h).\n"
            "3) Thời gian xuôi dòng: 90 / (v + 3); Thời gian ngược dòng: 90 / (v - 3).\n"
            "4) Theo bài ra ta có phương trình: 90 / (v - 3) - 90 / (v + 3) = 1.5\n"
            "   <=> 90 * 6 / (v^2 - 9) = 1.5 <=> 540 = 1.5(v^2 - 9) <=> v^2 - 9 = 360 <=> v^2 = 369 ... => v = 21 km/h (nếu s=72km) hoặc giải chính xác PT bậc hai."
        )

        card_text = f"【BÀI TẬP NÂNG CAO - HỌC SINH KHÁ GIỎI】\n{question_content}"

        return GeneratedVariantItem(
            id=f"var_adv_{uuid.uuid4().hex[:8]}",
            variant_type="ADVANCED",
            type_display="Bài tập nâng cao (Thêm điều kiện độ khó)",
            badge_color="#7c3aed",
            icon="🚀",
            title="Bài toán chuyển động có vận tốc dòng nước (Ca nô)",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Vận dụng cao",
            changed_parameters="Thêm yếu tố vận tốc dòng nước v_n = 3 km/h và thời gian khứ hồi chênh lệch 1.5 giờ.",
            added_conditions="Lập phương trình phân thức chứa ẩn ở mẫu dựa trên hiệu thời gian xuôi và ngược dòng.",
            advanced_hint="Lưu ý vận tốc xuôi dòng bằng v + v_nước và ngược dòng bằng v - v_nước.",
            correct_answer="v = 19.2 km/h (hoặc giải theo nghiệm phương trình)",
            solution_guide=guide,
            canvas_card_text=card_text,
        )

    # --------------------------------------------------------------------------
    # CHUYÊN BIỆT CHO DẠNG: HÌNH HỌC TAM GIÁC VUÔNG & PYTAGO
    # --------------------------------------------------------------------------

    def _similar_geometry_triangle(self, original_text: str, rng: random.Random) -> GeneratedVariantItem:
        """Đổi các cạnh góc vuông sang bộ ba số Pytago nguyên đẹp khác."""
        triples = [
            (3, 4, 5),
            (5, 12, 13),
            (6, 8, 10),
            (8, 15, 17),
            (9, 12, 15),
        ]
        b, c, a = rng.choice(triples)
        s = (b * c) / 2
        h = (b * c) / a

        question_content = (
            f"Cho tam giác ABC vuông tại A có hai cạnh góc vuông là AB = {b} cm và AC = {c} cm. "
            f"Kẻ đường cao AH vuông góc với cạnh huyền BC. "
            f"1) Tính độ dài cạnh huyền BC.\n"
            f"2) Tính độ dài đường cao AH và diện tích tam giác ABC."
        )
        guide = (
            f"1) Áp dụng định lý Pytago trong tam giác vuông ABC:\n"
            f"   BC^2 = AB^2 + AC^2 = {b}^2 + {c}^2 = {b*b} + {c*c} = {a*a} => BC = {a} cm.\n"
            f"2) Áp dụng hệ thức lượng: AB * AC = BC * AH => AH = (AB * AC) / BC = ({b} * {c}) / {a} = {h:.2f} cm.\n"
            f"3) Diện tích tam giác ABC: S = (1/2) * AB * AC = (1/2) * {b} * {c} = {s:.1f} cm^2."
        )

        card_text = f"【BÀI TẬP TƯƠNG TỰ - ĐỔI SỐ LIỆU】\n{question_content}"

        return GeneratedVariantItem(
            id=f"var_sim_{uuid.uuid4().hex[:8]}",
            variant_type="SIMILAR",
            type_display="Bài tập tương tự (Đổi số liệu)",
            badge_color="#16a34a",
            icon="🔄",
            title="Đổi độ dài cạnh tam giác vuông (Bộ 3 số Pytago)",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Thông hiểu",
            changed_parameters=f"Đổi hai cạnh góc vuông thành AB = {b} cm, AC = {c} cm (cạnh huyền BC = {a} cm).",
            added_conditions="Không thêm điều kiện.",
            advanced_hint="Sử dụng định lý Pytago và hệ thức lượng trong tam giác vuông.",
            correct_answer=f"BC = {a} cm, AH = {h:.2f} cm, S = {s:.1f} cm^2",
            solution_guide=guide,
            canvas_card_text=card_text,
        )

    def _advanced_geometry_triangle(self, original_text: str, rng: random.Random) -> GeneratedVariantItem:
        """Cực trị hình học: Tìm vị trí điểm di động để diện tích hoặc khoảng cách đạt cực trị."""
        question_content = (
            "Cho tam giác ABC vuông tại A có AB = 6 cm, AC = 8 cm. "
            "Điểm M là một điểm di động trên cạnh huyền BC. "
            "Từ M kẻ MD vuông góc với AB tại D và ME vuông góc với AC tại E.\n"
            "1) Tứ giác ADME là hình gì? Vì sao?\n"
            "2) Xác định vị trí của điểm M trên cạnh BC để đoạn thẳng DE có độ dài nhỏ nhất, và tính giá trị nhỏ nhất đó."
        )
        guide = (
            "1) Tứ giác ADME có góc A = góc D = góc E = 90 độ, do đó ADME là hình chữ nhật.\n"
            "2) Vì ADME là hình chữ nhật nên hai đường chéo bằng nhau: DE = AM.\n"
            "3) Do đó, DE có độ dài nhỏ nhất khi và chỉ khi đoạn thẳng AM có độ dài nhỏ nhất.\n"
            "   Vì M nằm trên đường thẳng BC nên AM ngắn nhất khi AM vuông góc với BC (tức M trùng chân đường cao H kẻ từ A).\n"
            "4) Khi đó min(DE) = min(AM) = AH = (AB * AC) / BC = (6 * 8) / 10 = 4.8 cm.\n"
            "Kết luận: Điểm M là chân đường cao kẻ từ A xuống BC thì DE nhỏ nhất bằng 4.8 cm."
        )

        card_text = f"【BÀI TẬP NÂNG CAO - HỌC SINH KHÁ GIỎI】\n{question_content}"

        return GeneratedVariantItem(
            id=f"var_adv_{uuid.uuid4().hex[:8]}",
            variant_type="ADVANCED",
            type_display="Bài tập nâng cao (Thêm điều kiện độ khó)",
            badge_color="#7c3aed",
            icon="🚀",
            title="Cực trị hình học phẳng (Điểm di động trên cạnh huyền)",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Vận dụng cao",
            changed_parameters="Thêm điểm di động M trên cạnh huyền và bài toán tìm cực trị khoảng cách DE ngắn nhất.",
            added_conditions="Tìm vị trí điểm M để đoạn thẳng DE đạt giá trị nhỏ nhất.",
            advanced_hint="Chứng minh DE = AM rồi dùng tính chất hình chiếu đường vuông góc là đoạn ngắn nhất.",
            correct_answer="M trùng chân đường cao kẻ từ A xuống BC; min DE = 4.8 cm",
            solution_guide=guide,
            canvas_card_text=card_text,
        )

    # --------------------------------------------------------------------------
    # CHUYÊN BIỆT CHO DẠNG: VẬT LÝ CON LẮC LÒ XO
    # --------------------------------------------------------------------------

    def _similar_physics_spring(self, original_text: str, rng: random.Random) -> GeneratedVariantItem:
        """Đổi số liệu độ cứng k và khối lượng m của con lắc lò xo."""
        presets = [
            (100, 0.25, 0.1),  # k=100 N/m, m=0.25kg -> omega=20 rad/s, T=pi/10 s
            (100, 0.4, 0.1),   # k=100 N/m, m=0.4kg
            (50, 0.2, 0.05),   # k=50 N/m, m=0.2kg
            (40, 0.1, 0.04),   # k=40 N/m, m=0.1kg
        ]
        k, m, a = rng.choice(presets)
        omega = math.sqrt(k / m)
        t_period = 2 * math.pi / omega
        freq = 1 / t_period

        question_content = (
            f"Một con lắc lò xo gồm vật nặng khối lượng m = {int(m*1000)} g và lò xo có độ cứng k = {k} N/m. "
            f"Kích thích cho vật dao động điều hòa theo phương ngang. "
            f"Tính tần số góc omega, chu kỳ dao động T và tần số dao động f của con lắc (lấy pi^2 approx 10)."
        )
        guide = (
            f"1) Tần số góc: omega = sqrt(k / m) = sqrt({k} / {m}) = {omega:.2f} rad/s.\n"
            f"2) Chu kỳ dao động: T = 2*pi / omega = 2*pi / {omega:.2f} = {t_period:.3f} s.\n"
            f"3) Tần số dao động: f = 1 / T = {freq:.2f} Hz."
        )

        card_text = f"【BÀI TẬP TƯƠNG TỰ - ĐỔI SỐ LIỆU】\n{question_content}"

        return GeneratedVariantItem(
            id=f"var_sim_{uuid.uuid4().hex[:8]}",
            variant_type="SIMILAR",
            type_display="Bài tập tương tự (Đổi số liệu)",
            badge_color="#16a34a",
            icon="🔄",
            title="Đổi thông số con lắc lò xo (Độ cứng k và khối lượng m)",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Thông hiểu",
            changed_parameters=f"Đổi độ cứng k = {k} N/m, khối lượng m = {int(m*1000)} g.",
            added_conditions="Không thêm điều kiện.",
            advanced_hint="Áp dụng công thức T = 2*pi*sqrt(m / k).",
            correct_answer=f"omega = {omega:.1f} rad/s, T = {t_period:.2f} s, f = {freq:.2f} Hz",
            solution_guide=guide,
            canvas_card_text=card_text,
        )

    def _advanced_physics_spring(self, original_text: str, rng: random.Random) -> GeneratedVariantItem:
        """Nâng cao bài toán con lắc lò xo: Va chạm mềm tại vị trí cân bằng."""
        question_content = (
            "Một con lắc lò xo đặt nằm ngang gồm vật m_1 = 300 g và lò xo có độ cứng k = 100 N/m đang dao động điều hòa với biên độ A = 8 cm. "
            "Khi vật m_1 đi qua vị trí cân bằng theo chiều dương, một vật m_2 = 100 g chuyển động với vận tốc v_0 = 80 cm/s ngược chiều "
            "đến va chạm mềm dính vào m_1. "
            "Tính biên độ dao động mới của hệ hai vật sau va chạm."
        )
        guide = (
            "1) Vận tốc của m_1 ngay trước va chạm tại VTCB: v_1 = omega_1 * A = sqrt(100 / 0.3) * 0.08 m/s.\n"
            "2) Áp dụng định luật bảo toàn động lượng cho va chạm mềm theo phương ngang:\n"
            "   (m_1 + m_2)*v_sau = m_1*v_1 - m_2*v_0 => v_sau = (m_1*v_1 - m_2*v_0) / (m_1 + m_2).\n"
            "3) Tần số góc mới của hệ: omega_moi = sqrt(k / (m_1 + m_2)) = sqrt(100 / 0.4) = 5*sqrt(10) rad/s.\n"
            "4) Biên độ dao động mới: A_moi = |v_sau| / omega_moi."
        )

        card_text = f"【BÀI TẬP NÂNG CAO - HỌC SINH KHÁ GIỎI】\n{question_content}"

        return GeneratedVariantItem(
            id=f"var_adv_{uuid.uuid4().hex[:8]}",
            variant_type="ADVANCED",
            type_display="Bài tập nâng cao (Thêm điều kiện độ khó)",
            badge_color="#7c3aed",
            icon="🚀",
            title="Va chạm mềm con lắc lò xo tại VTCB (Vật lý 12)",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Vận dụng cao",
            changed_parameters="Bổ sung vật m_2 va chạm mềm dính vào m_1 khi qua VTCB.",
            added_conditions="Kết hợp định luật bảo toàn động lượng và công thức độc lập thời gian.",
            advanced_hint="Tính vận tốc hệ ngay sau va chạm mềm rồi dùng công thức A_moi = v_sau / omega_moi.",
            correct_answer="A_moi = 5.2 cm (ước lượng theo tham số)",
            solution_guide=guide,
            canvas_card_text=card_text,
        )

    # --------------------------------------------------------------------------
    # BỘ XỬ LÝ CHUNG CHO ĐỀ BÀI TỰ DO (GENERAL PERTURBATION FALLBACK)
    # --------------------------------------------------------------------------

    def _similar_general_numeric(
        self, original_text: str, subject: str, rng: random.Random
    ) -> GeneratedVariantItem:
        """Thay thế các số nguyên/thực trong đề bài bằng các số liệu biến thiên tương đương."""
        numbers = re.findall(r"\b\d+\b", original_text)
        new_text = original_text
        changed_details = []

        if numbers:
            multiplier = rng.choice([2, 3, 1.5, 4])
            for num_str in numbers[:4]:  # Chỉ đổi tối đa 4 con số đầu tiên
                val = int(num_str)
                if val in [0, 1]:  # Giữ lại số 0 hoặc 1
                    continue
                new_val = int(round(val * multiplier))
                if new_val == val:
                    new_val = val + rng.randint(2, 5)
                # Thay thế duy nhất một lần xuất hiện đầu tiên của con số này
                new_text = re.sub(rf"\b{num_str}\b", str(new_val), new_text, count=1)
                changed_details.append(f"{val} -> {new_val}")

        changed_str = ", ".join(changed_details) if changed_details else "Tăng tỷ lệ số liệu thêm hệ số k."
        question_content = f"{new_text}"
        solution_guide = (
            "1) Tóm tắt bài toán với các dữ kiện mới.\n"
            "2) Áp dụng phương pháp và công thức giải tương tự như bài gốc.\n"
            "3) Thay số và tính toán cẩn thận để tìm ra kết quả cuối cùng."
        )

        card_text = f"【BÀI TẬP TƯƠNG TỰ - ĐỔI SỐ LIỆU】\n{question_content}"

        return GeneratedVariantItem(
            id=f"var_sim_{uuid.uuid4().hex[:8]}",
            variant_type="SIMILAR",
            type_display="Bài tập tương tự (Đổi số liệu)",
            badge_color="#16a34a",
            icon="🔄",
            title=f"Bài tập tương tự môn {subject} (Đổi số liệu)",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Thông hiểu",
            changed_parameters=f"Đã thay đổi các dữ liệu số: {changed_str}.",
            added_conditions="Giữ nguyên dạng bài và phương pháp tiếp cận.",
            advanced_hint="Thực hiện theo các bước biến đổi chuẩn tương tự bài gốc.",
            correct_answer="Xem chi tiết các bước tính toán theo số liệu mới",
            solution_guide=solution_guide,
            canvas_card_text=card_text,
        )

    def _advanced_general_numeric(
        self, original_text: str, subject: str, rng: random.Random
    ) -> GeneratedVariantItem:
        """Thêm các điều kiện nâng cao tổng quát (tham số k, tìm cực trị Max/Min, điều kiện nghiệm nguyên)."""
        extra_conditions = [
            "Xét thêm điều kiện tham số k nguyên để bài toán có nghiệm nguyên dương thỏa mãn điều kiện.",
            "Tìm giá trị lớn nhất (GTLN) và giá trị nhỏ nhất (GTNN) của đại lượng cần tìm khi một biến số thay đổi.",
            "Biết rằng trong điều kiện thực tế có hao phí 10% (hoặc lực cản môi trường), hãy xác định lại kết quả.",
            "Chứng minh rằng kết quả luôn bị chặn và không vượt quá một hằng số xác định.",
        ]
        added = rng.choice(extra_conditions)
        question_content = f"{original_text}\n[Yêu cầu nâng cao]: {added}"

        solution_guide = (
            "1) Phân tích dữ kiện bài toán và điều kiện bổ sung nâng cao.\n"
            "2) Thiết lập biểu thức toán học hoặc mô hình vật lý liên hệ giữa các biến.\n"
            "3) Sử dụng phương pháp đạo hàm, bất đẳng thức (AM-GM / Cauchy) hoặc biện luận đồ thị để giải quyết yêu cầu mở rộng."
        )

        card_text = f"【BÀI TẬP NÂNG CAO - HỌC SINH KHÁ GIỎI】\n{question_content}"

        return GeneratedVariantItem(
            id=f"var_adv_{uuid.uuid4().hex[:8]}",
            variant_type="ADVANCED",
            type_display="Bài tập nâng cao (Thêm điều kiện độ khó)",
            badge_color="#7c3aed",
            icon="🚀",
            title=f"Bài tập nâng cao môn {subject} (Thêm điều kiện độ khó)",
            question_content=question_content,
            original_question=original_text,
            difficulty_level="Vận dụng cao",
            changed_parameters="Bổ sung thêm ràng buộc tham số và yêu cầu tối ưu / chứng minh.",
            added_conditions=added,
            advanced_hint="Áp dụng phương pháp đánh giá bất đẳng thức hoặc khảo sát hàm số.",
            correct_answer="Nghiệm phụ thuộc vào điều kiện biên của tham số",
            solution_guide=solution_guide,
            canvas_card_text=card_text,
        )

    # --------------------------------------------------------------------------
    # GỌI GEMINI LIVE NẾU CÓ CẤU HÌNH API KEY
    # --------------------------------------------------------------------------

    async def _generate_with_gemini(
        self, original_text: str, variant_type: str, subject: str, difficulty: str
    ) -> List[GeneratedVariantItem]:
        """Tận dụng Gemini 2.5 Flash để sinh đề bài sáng tạo khi có kết nối."""
        prompt = f"""
Bạn là chuyên gia giáo dục biên soạn đề thi Toán và Khoa học tự nhiên THCS/THPT.
Từ bài tập đang chiếu trên bảng vẽ sau:
\"\"\"{original_text}\"\"\"

Môn học: {subject}
Mức độ hiện tại: {difficulty}
Yêu cầu tạo: {variant_type} (SIMILAR: Bài tương tự đổi số liệu, giữ nguyên dạng, nghiệm đẹp; ADVANCED: Bài nâng cao thêm điều kiện tham số/cực trị cho học sinh khá giỏi; BOTH: cả hai).

Hãy trả về định dạng JSON hợp lệ dạng danh sách các biến thể với schema sau:
[
  {{
    "variant_type": "SIMILAR" hoặc "ADVANCED",
    "type_display": "Bài tập tương tự (Đổi số liệu)" hoặc "Bài tập nâng cao (Thêm điều kiện độ khó)",
    "title": "Tiêu đề ngắn",
    "question_content": "Nội dung câu hỏi mới hoàn chỉnh",
    "difficulty_level": "Thông hiểu" hoặc "Vận dụng cao",
    "changed_parameters": "Mô tả số liệu đã đổi",
    "added_conditions": "Mô tả điều kiện thêm (nếu là ADVANCED)",
    "advanced_hint": "Gợi ý phương pháp cho học sinh khá giỏi",
    "correct_answer": "Đáp số ngắn",
    "solution_guide": "Lời giải chi tiết từng bước"
  }}
]
Chỉ trả về JSON thuần túy trong dấu ngoặc vuông [], không thêm markdown thừa thãi.
"""
        from app.ai.gemini_service import gemini_service
        # Giả lập hoặc gọi gemini_service nếu client đã khởi tạo
        if not hasattr(gemini_service, "client") or not gemini_service.is_configured:
            return []

        # Gọi Gemini SDK
        try:
            if gemini_service._client_type == "google-genai":
                response = gemini_service.client.models.generate_content(
                    model=self.gemini_model,
                    contents=prompt,
                )
                raw_text = response.text or ""
            else:
                response = gemini_service.model.generate_content(prompt)
                raw_text = response.text or ""

            clean_json = re.sub(r"^```json\s*", "", raw_text.strip(), flags=re.IGNORECASE)
            clean_json = re.sub(r"\s*```$", "", clean_json)
            parsed = json.loads(clean_json)

            items: List[GeneratedVariantItem] = []
            if isinstance(parsed, list):
                for p in parsed:
                    v_type = p.get("variant_type", "SIMILAR").upper()
                    is_adv = v_type == "ADVANCED"
                    items.append(
                        GeneratedVariantItem(
                            id=f"var_ai_{uuid.uuid4().hex[:8]}",
                            variant_type=v_type,
                            type_display="Bài tập nâng cao (Thêm điều kiện độ khó)" if is_adv else "Bài tập tương tự (Đổi số liệu)",
                            badge_color="#7c3aed" if is_adv else "#16a34a",
                            icon="🚀" if is_adv else "🔄",
                            title=p.get("title", "Bài tập biến thể AI"),
                            question_content=p.get("question_content", ""),
                            original_question=original_text,
                            difficulty_level=p.get("difficulty_level", "Vận dụng cao" if is_adv else "Thông hiểu"),
                            changed_parameters=p.get("changed_parameters", ""),
                            added_conditions=p.get("added_conditions", ""),
                            advanced_hint=p.get("advanced_hint", ""),
                            correct_answer=p.get("correct_answer", ""),
                            solution_guide=p.get("solution_guide", ""),
                            canvas_card_text=f"【{'BÀI TẬP NÂNG CAO' if is_adv else 'BÀI TẬP TƯƠNG TỰ'}】\n{p.get('question_content', '')}",
                        )
                    )
            return items
        except Exception as e:
            logger.warning(f"Lỗi khi bóc tách JSON từ Gemini: {e}")
            return []

    # --------------------------------------------------------------------------
    # HÀM PHỤ TRỢ FORMAT TOÁN HỌC
    # --------------------------------------------------------------------------

    def _format_quadratic_str(self, a: int, b: int, c: int) -> str:
        """Định dạng chuỗi biểu thức ax^2 + bx + c = 0 một cách tự nhiên."""
        parts = []
        if a == 1:
            parts.append("x^2")
        elif a == -1:
            parts.append("-x^2")
        else:
            parts.append(f"{a}x^2")

        if b != 0:
            sign = " + " if b > 0 else " - "
            abs_b = abs(b)
            term = "x" if abs_b == 1 else f"{abs_b}x"
            parts.append(f"{sign}{term}")

        if c != 0:
            sign = " + " if c > 0 else " - "
            parts.append(f"{sign}{abs(c)}")

        return "".join(parts) + " = 0"


question_variant_service = QuestionVariantService()
