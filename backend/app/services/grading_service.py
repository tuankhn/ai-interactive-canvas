import ast
import asyncio
import json
import logging
import math
import operator
import re
import sys
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple
from app.schemas.quiz import (
    GradeMCQResponse,
    GradeEssayStepResponse,
    GradeEssaySolutionResponse,
)

logger = logging.getLogger(__name__)

_SAFE_AST_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
}
_SAFE_AST_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}

_VN_NUMBER_WORDS: Dict[str, int] = {
    "không": 0,
    "một": 1,
    "mốt": 1,
    "hai": 2,
    "ba": 3,
    "bốn": 4,
    "tư": 4,
    "năm": 5,
    "lăm": 5,
    "sáu": 6,
    "bảy": 7,
    "bẩy": 7,
    "tám": 8,
    "chín": 9,
    "mười": 10,
}


def _safe_eval_math_expr(expr: str, var_map: Optional[Dict[str, float]] = None) -> Optional[float]:
    """Tính giá trị biểu thức số học an toàn bằng AST (không dùng eval)."""
    cleaned = (expr or "").strip()
    if not cleaned or len(cleaned) > 160:
        return None
    # Chuẩn hóa chữ số mũ Unicode (⁰¹²³⁴⁵⁶⁷⁸⁹) sang lũy thừa **
    cleaned = re.sub(
        r"([⁰¹²³⁴⁵⁶⁷⁸⁹]+)",
        lambda m: "**" + m.group(1).translate(str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")),
        cleaned,
    )
    cleaned = (
        cleaned.replace("×", "*")
        .replace("⋅", "*")
        .replace("·", "*")
        .replace("÷", "/")
        .replace(":", "/")
        .replace("^", "**")
        .replace("−", "-")
        .replace("–", "-")
    )
    # Hỗ trợ nhân ẩn cơ bản như 2x, 3(x+1)
    cleaned = re.sub(r"(\d)\s*([a-zA-Z_(])", r"\1*\2", cleaned)
    cleaned = re.sub(r"(\))\s*(\d|[a-zA-Z_(])", r"\1*\2", cleaned)
    try:
        tree = ast.parse(cleaned, mode="eval")
    except Exception:
        return None

    variables = var_map or {}

    def _eval_node(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return _eval_node(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id in variables:
                return float(variables[node.id])
            raise ValueError(f"Unknown symbol: {node.id}")
        if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_AST_UNARY_OPS:
            return _SAFE_AST_UNARY_OPS[type(node.op)](_eval_node(node.operand))
        if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_AST_BIN_OPS:
            left_v = _eval_node(node.left)
            right_v = _eval_node(node.right)
            if isinstance(node.op, ast.Pow) and abs(right_v) > 20:
                raise ValueError("Exponent too large")
            return _SAFE_AST_BIN_OPS[type(node.op)](left_v, right_v)
        raise ValueError("Unsupported AST node")

    try:
        val = _eval_node(tree)
        if val != val or abs(val) == float("inf"):
            return None
        return float(val)
    except Exception:
        return None


def _extract_option_numeric_value(raw_opt: str) -> Optional[float]:
    """Trích xuất giá trị số duy nhất từ nội dung phương án A/B/C/D (VD: '5308', '5 308', '3,14', '3/4', '72 cm')."""
    s = (raw_opt or "").strip()
    if not s:
        return None
    # Loại bỏ tiền tố x = ..., ? = ..., y = ...
    s = re.sub(r"^[xXyY?]\s*=\s*", "", s).strip()
    # Bỏ hậu tố đơn vị đo thông dụng ở cuối nếu chỉ có 1 con số ở đầu
    m_frac = re.match(r"^([+-]?\d+)\s*/\s*(\d+)(?:\s*[a-zA-ZÀ-ỹ%/²³^0-9]*)?$", s)
    if m_frac:
        den = int(m_frac.group(2))
        return (int(m_frac.group(1)) / den) if den != 0 else None

    # Chuẩn hóa số viết cách hàng nghìn "5 308" hoặc "5.308" (khi có đúng 3 chữ số sau dấu chấm)
    s_num = re.match(r"^([+-]?(?:\d{1,3}(?:[\s.]\d{3})+|\d+(?:[.,]\d+)?))(?:\s*[a-zA-ZÀ-ỹ%°/²³^0-9]*)?$", s)
    if not s_num:
        return None
    token = s_num.group(1).replace(" ", "")
    if re.match(r"^[+-]?\d{1,3}(?:\.\d{3})+$", token):
        token = token.replace(".", "")
    else:
        token = token.replace(",", ".")
    try:
        return float(token)
    except ValueError:
        return None


def _format_num_clean(val: float) -> str:
    if abs(val - round(val)) < 1e-9:
        return str(int(round(val)))
    return f"{val:.4f}".rstrip("0").rstrip(".")


_ROMAN_PAIRS: List[Tuple[int, str]] = [
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
    (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
    (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
]


def _int_to_roman(num: int) -> Optional[str]:
    if num <= 0 or num > 3999:
        return None
    out: List[str] = []
    rem = num
    for val, sym in _ROMAN_PAIRS:
        while rem >= val:
            out.append(sym)
            rem -= val
    return "".join(out)


def _roman_to_int(roman: str) -> Optional[int]:
    token = (roman or "").strip().upper()
    if not token or not re.fullmatch(r"[IVXLCDM]+", token):
        return None
    vals = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    total = 0
    prev = 0
    for ch in reversed(token):
        v = vals[ch]
        if v < prev:
            total -= v
        else:
            total += v
            prev = v
    # Kiểm tra tính chính tắc (loại bỏ cách viết sai quy tắc như IXX cho 19)
    return total if _int_to_roman(total) == token else None


class GradingService:
    """
    Logic chấm bài trắc nghiệm tự động, phân tích chuyên sâu các phương án gây nhiễu,
    hiển thị tích xanh (khi đúng) hoặc cảnh báo đỏ (khi sai) kèm hướng dẫn tìm đáp án đúng.
    Nhiệm vụ: Task TF28519 - Sprint 3 (Nguyễn Ngọc Gia Bảo 2 - N25DTCN121).
    """

    # Bộ mẫu phân tích phương án gây nhiễu mặc định theo môn học và nhãn lựa chọn
    SUBJECT_DISTRACTORS: Dict[str, Dict[str, Dict[str, str]]] = {
        "TOAN": {
            "A": {
                "reason": "Phương án A nhầm lẫn dấu khi thực hiện chuyển vế đổi dấu hoặc ngộ nhận điều kiện xác định.",
                "guidance": "Gợi ý: Kiểm tra lại điều kiện nghiệm và quy tắc chuyển vế: khi chuyển vế hạng tử phải đổi dấu.",
                "category": "SIGN_ERROR",
            },
            "B": {
                "reason": "Phương án B nhầm lẫn giữa công thức đạo hàm và nguyên hàm, hoặc quên hệ số nhân của hàm hợp u'(x).",
                "guidance": "Gợi ý: Áp dụng quy tắc đạo hàm hàm hợp (f(u))' = u' * f'(u) thay vì chỉ lấy đạo hàm cơ bản.",
                "category": "CONCEPTUAL_ERROR",
            },
            "C": {
                "reason": "Phương án C tính sai mẫu số chung khi quy đồng hoặc quên điều kiện mẫu thức phải khác 0.",
                "guidance": "Gợi ý: Xác định tập nghiệm thỏa mãn mẫu khác không và căn bậc hai có nghĩa.",
                "category": "PREMISES_MISREADING",
            },
            "D": {
                "reason": "Phương án D chưa rút gọn phân thức về dạng tối giản hoặc tính nhầm giá trị hằng số tự do C.",
                "guidance": "Gợi ý: Rút gọn triệt để các số hạng đồng dạng và cộng hằng số C trong tích phân bất định.",
                "category": "CALCULATION_ERROR",
            },
        },
        "VAT_LY": {
            "A": {
                "reason": "Phương án A quên đổi đơn vị đo lường (chưa đổi km/h sang m/s hoặc cm sang m).",
                "guidance": "Gợi ý: Trong hệ đơn vị chuẩn SI, vận tốc dùng m/s (1 m/s = 3.6 km/h) và chiều dài dùng mét (m).",
                "category": "UNIT_CONVERSION_ERROR",
            },
            "B": {
                "reason": "Phương án B áp dụng sai công thức: nhầm lẫn giữa thế năng hấp dẫn và động năng (quên thừa số 1/2 hoặc bình phương v^2).",
                "guidance": "Gợi ý: Động năng là Wd = 1/2 * m * v^2; Thế năng là Wt = m * g * h.",
                "category": "CONCEPTUAL_ERROR",
            },
            "C": {
                "reason": "Phương án C nhầm lẫn giữa đại lượng vô hướng (công, năng lượng) và đại lượng vector (lực, gia tốc, vận tốc).",
                "guidance": "Gợi ý: Chú ý phương và chiều của lực tác dụng so với hướng chuyển dời của vật.",
                "category": "CONCEPTUAL_ERROR",
            },
            "D": {
                "reason": "Phương án D tính sai giá trị gia tốc trọng trường g (lấy g = 1 thay vì 9.8 hoặc 10 m/s^2).",
                "guidance": "Gợi ý: Sử dụng giá trị gia tốc trọng trường g = 9.8 m/s^2 theo đề bài yêu cầu.",
                "category": "CALCULATION_ERROR",
            },
        },
        "HOA_HOC": {
            "A": {
                "reason": "Phương án A nhầm lẫn giữa chất khử (chất cho electron) và chất oxi hóa (chất nhận electron).",
                "guidance": "Gợi ý: Ghi nhớ quy tắc 'Khử cho - O nhận': chất khử có số oxi hóa tăng sau phản ứng.",
                "category": "CONCEPTUAL_ERROR",
            },
            "B": {
                "reason": "Phương án B chưa cân bằng đúng hệ số electron trao đổi giữa các bán phản ứng.",
                "guidance": "Gợi ý: Tổng số electron cho phải bằng tổng số electron nhận trong phản ứng oxi hóa - khử.",
                "category": "CALCULATION_ERROR",
            },
            "C": {
                "reason": "Phương án C xác định sai hóa trị hoặc số oxi hóa của kim loại chuyển tiếp.",
                "guidance": "Gợi ý: Xác định số oxi hóa của O là -2 và H là +1 để suy ra số oxi hóa của nguyên tố còn lại.",
                "category": "PREMISES_MISREADING",
            },
            "D": {
                "reason": "Phương án D chưa tính đến lượng chất dư hoặc hiệu suất phản ứng dưới 100%.",
                "guidance": "Gợi ý: So sánh tỉ lệ số mol giữa các chất tham gia để biết chất nào phản ứng hết trước.",
                "category": "CALCULATION_ERROR",
            },
        },
        "TIENG_ANH": {
            "A": {
                "reason": "Phương án A chia sai thì của động từ (chưa hòa hợp giữa chủ ngữ và thì của câu).",
                "guidance": "Gợi ý: Chú ý trạng từ chỉ thời gian trong câu (yesterday, now, every day, since...) để chọn thì thích hợp.",
                "category": "GRAMMAR_ERROR",
            },
            "B": {
                "reason": "Phương án B nhầm lẫn giữa danh động từ (V-ing) và động từ nguyên mẫu có 'to' (to V).",
                "guidance": "Gợi ý: Kiểm tra cấu trúc động từ đi kèm (ví dụ: avoid/enjoy + V-ing, decide/hope + to V).",
                "category": "CONCEPTUAL_ERROR",
            },
            "C": {
                "reason": "Phương án C dùng sai từ loại (nhầm lẫn giữa tính từ và trạng từ bổ nghĩa cho động từ).",
                "guidance": "Gợi ý: Trạng từ (adv) dùng để bổ nghĩa cho động từ thường; tính từ (adj) bổ nghĩa cho danh từ hoặc sau linking verb.",
                "category": "NOTATION_ERROR",
            },
            "D": {
                "reason": "Phương án D chọn sai đại từ quan hệ (nhầm lẫn giữa who, whom, which và whose).",
                "guidance": "Gợi ý: 'Who' thay thế cho danh từ chỉ người làm chủ ngữ; 'Which' thay cho danh từ chỉ vật.",
                "category": "GRAMMAR_ERROR",
            },
        },
    }

    @classmethod
    def infer_mcq_correct_option_deterministic(
        cls,
        question_content: Optional[str],
        options: Optional[List[Dict[str, Any]]],
    ) -> Optional[Tuple[str, str]]:
        """
        Giải tự động chính xác (< 1ms) các dạng câu hỏi trắc nghiệm Toán học phổ biến khi đề tải lên không đính kèm đáp án:
        1. Cấu tạo số thập phân / tự nhiên (VD: 'Số gồm 5 nghìn, 3 trăm và 8 đơn vị' -> 5308)
        2. Tìm thành phần chưa biết / phương trình 1 ẩn ('? × 6 = 432', '432 : x = 6', '2x - 4 = 0')
        3. Tính giá trị biểu thức số học ('848 : 4', '125 + 375 × 2', 'tổng/hiệu/tích/thương', 'số liền sau/trước')
        4. Tìm số lớn nhất / số bé nhất trong các phương án.
        Trả về (correct_label, explanation) nếu xác định chắc chắn duy nhất 1 đáp án đúng, ngược lại trả về None.
        """
        if not question_content or not options or len(options) < 2:
            return None

        stem = question_content.strip()
        stem_lower = stem.lower()

        # 0. Chữ số La Mã (hai chiều: Số tự nhiên -> La Mã như 'Số 19 viết bằng chữ số La Mã' -> XIX, và La Mã -> Số tự nhiên)
        if "la mã" in stem_lower:
            m_arabic = re.search(r"(?:số\s+)?(\d{1,4})\b", stem_lower)
            if m_arabic:
                n_val = int(m_arabic.group(1))
                expected_roman = _int_to_roman(n_val)
                if expected_roman:
                    roman_hits = [
                        str(o.get("label", "")).strip().upper()
                        for o in options
                        if str(o.get("content", "")).strip().upper() == expected_roman
                    ]
                    if len(roman_hits) == 1:
                        return (
                            roman_hits[0],
                            f"Số {n_val} viết bằng chữ số La Mã đúng quy tắc là {expected_roman}. Vậy đáp án đúng là {roman_hits[0]} ({expected_roman}).",
                        )
            m_rom = re.search(r"\b([IVXLCDM]{1,10})\b", stem)
            if m_rom:
                conv_int = _roman_to_int(m_rom.group(1))
                if conv_int is not None:
                    int_hits = [
                        str(o.get("label", "")).strip().upper()
                        for o in options
                        if _extract_option_numeric_value(str(o.get("content", ""))) == float(conv_int)
                    ]
                    if len(int_hits) == 1:
                        return (
                            int_hits[0],
                            f"Chữ số La Mã {m_rom.group(1).upper()} có giá trị là {conv_int}. Vậy đáp án đúng là {int_hits[0]} ({conv_int}).",
                        )

        numeric_opts: List[Tuple[str, float, str]] = []
        for opt in options:
            lbl = str(opt.get("label", "")).strip().upper()
            txt = str(opt.get("content", "")).strip()
            val = _extract_option_numeric_value(txt)
            if lbl and val is not None:
                numeric_opts.append((lbl, val, txt))

        if len(numeric_opts) < 2:
            return None

        def _match_unique_value(target_val: float) -> Optional[Tuple[str, str]]:
            matched = [item for item in numeric_opts if abs(item[1] - target_val) < 1e-6]
            if len(matched) == 1:
                return matched[0][0], matched[0][2]
            return None

        # 1. Cấu tạo số theo hàng (tỉ, triệu, trăm nghìn, chục nghìn, nghìn/ngàn, trăm, chục, đơn vị, phần mười/trăm/nghìn)
        place_units = [
            (r"trăm\s+triệu", 100_000_000.0, "trăm triệu"),
            (r"chục\s+triệu", 10_000_000.0, "chục triệu"),
            (r"triệu", 1_000_000.0, "triệu"),
            (r"trăm\s+(?:nghìn|ngàn)", 100_000.0, "trăm nghìn"),
            (r"(?:chục\s+(?:nghìn|ngàn)|vạn)", 10_000.0, "chục nghìn"),
            (r"(?:nghìn|ngàn)", 1_000.0, "nghìn"),
            (r"phần\s+(?:nghìn|ngàn)", 0.001, "phần nghìn"),
            (r"phần\s+trăm", 0.01, "phần trăm"),
            (r"phần\s+mười", 0.1, "phần mười"),
            (r"trăm", 100.0, "trăm"),
            (r"chục", 10.0, "chục"),
            (r"đơn\s+vị", 1.0, "đơn vị"),
        ]
        if any(kw in stem_lower for kw in ("số gồm", "gồm có", "viết số", "được viết là")) and any(
            u in stem_lower for u in ("nghìn", "ngàn", "trăm", "chục", "đơn vị", "triệu")
        ):
            working = stem_lower
            total_place_val = 0.0
            parts_desc: List[str] = []
            matched_count = 0
            word_alts = "|".join(sorted(_VN_NUMBER_WORDS.keys(), key=len, reverse=True))
            for unit_pat, mult, unit_label in place_units:
                pat = re.compile(rf"(?<!\w)(\d+|{word_alts})\s+{unit_pat}(?!\w)")
                for m in list(pat.finditer(working)):
                    raw_qty = m.group(1)
                    qty = float(raw_qty) if raw_qty.isdigit() else float(_VN_NUMBER_WORDS.get(raw_qty, 0))
                    total_place_val += qty * mult
                    parts_desc.append(f"{_format_num_clean(qty)} {unit_label} ({_format_num_clean(qty * mult)})")
                    matched_count += 1
                working = pat.sub(" ", working)
            if matched_count >= 2:
                hit = _match_unique_value(total_place_val)
                if hit:
                    lbl, _ = hit
                    clean_total = _format_num_clean(total_place_val)
                    return (
                        lbl,
                        f"Ta có: {' + '.join(parts_desc)} = {clean_total}. Vậy đáp án đúng là {lbl} ({clean_total}).",
                    )

        # 2. Tìm ẩn chưa biết (? / x / y) bằng cách thế trực tiếp từng phương án vào phương trình LHS = RHS
        if "=" in stem:
            # Ưu tiên lấy biểu thức sau dấu ':' cuối cùng trước dấu '=' (nhưng cẩn thận ':' cũng là phép chia!)
            # Cắt bỏ phần chữ tiếng Việt mở đầu câu hỏi đến ký tự toán học đầu tiên của phương trình
            eq_candidates: List[str] = []
            for seg in re.split(r"[;\n]", stem):
                if "=" not in seg:
                    continue
                # Tìm đoạn chứa phép toán + dấu '=' ở cuối câu
                m_eq = re.search(
                    r"([?□xXyY0-9(\-+][?□xXyY0-9\s+\-*/×⋅·÷:^²³(),.]*=\s*[?□xXyY0-9\s+\-*/×⋅·÷:^²³(),.\-]+)",
                    seg,
                )
                if m_eq:
                    eq_candidates.append(m_eq.group(1).strip().rstrip(".:?"))

            for eq_raw in eq_candidates:
                if eq_raw.count("=") != 1:
                    continue
                lhs_raw, rhs_raw = [p.strip() for p in eq_raw.split("=", 1)]
                if not lhs_raw or not rhs_raw:
                    continue

                has_qmark = ("?" in eq_raw) or ("□" in eq_raw)
                # Nếu dùng '?' làm ẩn thì chữ 'x'/'X' đứng giữa 2 hạng tử là dấu nhân '×'
                def _prep_side(side_s: str) -> str:
                    s_out = side_s.replace(",", ".")
                    if has_qmark:
                        s_out = re.sub(r"(?<=[\d?□)\s])[xX](?=[\d?□(\s])", "*", s_out)
                        s_out = s_out.replace("?", "_u_").replace("□", "_u_")
                    else:
                        # Nếu cả x và dấu nhân chữ x: ưu tiên biến x/y
                        s_out = re.sub(r"\b[xX]\b", "_u_", s_out)
                        s_out = re.sub(r"(\d)[xX]\b", r"\1*_u_", s_out)
                        s_out = re.sub(r"\b[yY]\b", "_u_", s_out)
                        s_out = re.sub(r"(\d)[yY]\b", r"\1*_u_", s_out)
                    return s_out

                lhs_p = _prep_side(lhs_raw)
                rhs_p = _prep_side(rhs_raw)
                if "_u_" in lhs_p or "_u_" in rhs_p:
                    satisfying: List[Tuple[str, float, str]] = []
                    for lbl, val, raw_txt in numeric_opts:
                        lv = _safe_eval_math_expr(lhs_p, {"_u_": val})
                        rv = _safe_eval_math_expr(rhs_p, {"_u_": val})
                        if lv is not None and rv is not None and abs(lv - rv) < 1e-6:
                            satisfying.append((lbl, val, raw_txt))
                    if len(satisfying) == 1:
                        lbl, val, _ = satisfying[0]
                        val_s = _format_num_clean(val)
                        pretty_eq = eq_raw.replace("?", val_s).replace("□", val_s)
                        return (
                            lbl,
                            f"Thay {val_s} vào phép tính: {pretty_eq} (thoả mãn hai vế bằng nhau). Vậy đáp án đúng là {lbl} ({val_s}).",
                        )

        # 3. Tính giá trị biểu thức số học trực tiếp (VD: 'Kết quả của phép chia 848 : 4 là:', '1 + 1 bằng mấy?')
        expr_clean = re.sub(r"=\s*\??\s*$", "", stem)
        # Bỏ chữ 'Câu 1:' nếu có
        expr_clean = re.sub(r"^(?:câu|bài|question)\s*\d+\s*[:.]\s*", "", expr_clean, flags=re.IGNORECASE)
        # Dạng lời văn cơ bản: số liền sau / số liền trước
        m_after = re.search(r"số\s+liền\s+sau\s+(?:của\s+)?(?:số\s+)?(\d+)", stem_lower)
        if m_after:
            target = float(m_after.group(1)) + 1
            hit = _match_unique_value(target)
            if hit:
                return hit[0], f"Số liền sau của {m_after.group(1)} là {_format_num_clean(target)} (cộng thêm 1). Đáp án đúng là {hit[0]}."
        m_before = re.search(r"số\s+liền\s+trước\s+(?:của\s+)?(?:số\s+)?(\d+)", stem_lower)
        if m_before:
            target = float(m_before.group(1)) - 1
            hit = _match_unique_value(target)
            if hit:
                return hit[0], f"Số liền trước của {m_before.group(1)} là {_format_num_clean(target)} (trừ đi 1). Đáp án đúng là {hit[0]}."

        # Tìm các cụm biểu thức toán học có ít nhất 1 toán tử (+, -, *, ×, :, ÷, /, ^)
        expr_matches = re.findall(
            r"(?<![A-Za-zÀ-ỹ])(\(?\d+(?:[.,]\d+)?\)?(?:\s*[+\-*/×⋅·÷:^]\s*\(?\d+(?:[.,]\d+)?\)?)+)(?![A-Za-zÀ-ỹ])",
            expr_clean.replace(" x ", " × "),
        )
        if expr_matches:
            # Lấy biểu thức dài nhất trong đề bài
            candidate_expr = max(expr_matches, key=len).strip()
            norm_expr = candidate_expr.replace(",", ".")
            val = _safe_eval_math_expr(norm_expr)
            if val is not None:
                hit = _match_unique_value(val)
                if hit:
                    lbl, _ = hit
                    val_s = _format_num_clean(val)
                    return (
                        lbl,
                        f"Thực hiện phép tính: {candidate_expr} = {val_s}. Vậy đáp án đúng là {lbl} ({val_s}).",
                    )

        # 4. So sánh lớn nhất / bé nhất (nhỏ nhất) trong các phương án
        if len(numeric_opts) == len(options):
            if re.search(r"số\s+(?:nào\s+)?lớn\s+nhất", stem_lower) and "không" not in stem_lower:
                best_opt = max(numeric_opts, key=lambda x: x[1])
                return best_opt[0], f"Trong các số đã cho, {best_opt[2]} là số lớn nhất. Vậy đáp án đúng là {best_opt[0]}."
            if re.search(r"số\s+(?:nào\s+)?(?:bé|nhỏ)\s+nhất", stem_lower) and "không" not in stem_lower:
                best_opt = min(numeric_opts, key=lambda x: x[1])
                return best_opt[0], f"Trong các số đã cho, {best_opt[2]} là số bé nhất. Vậy đáp án đúng là {best_opt[0]}."

        return None

    @classmethod
    async def solve_mcqs_batch_with_ai(
        cls,
        questions: List[Dict[str, Any]],
        subject: str = "TOAN",
        timeout: float = 10.0,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Dùng Gemini AI giải nhanh danh sách câu hỏi trắc nghiệm chưa có đáp án trong file đề tải lên.
        Trả về map theo question_id: { q_id: {"correct_option": "C", "explanation": "...", "distractors": {...}} }.
        """
        if not questions or "pytest" in sys.modules:
            return {}

        from app.ai.gemini_service import gemini_service
        if not gemini_service.ensure_configured():
            return {}

        items_payload = []
        for q in questions[:25]:
            opts = [
                {"label": str(o.get("label", "")).upper(), "content": str(o.get("content", ""))}
                for o in (q.get("options") or [])
            ]
            if len(opts) >= 2:
                items_payload.append({
                    "id": str(q.get("id", "")),
                    "number": q.get("number", 1),
                    "question": str(q.get("content", "")),
                    "options": opts,
                })
        if not items_payload:
            return {}

        prompt = (
            f"Bạn là giáo viên chấm thi chính xác tuyệt đối môn {subject}.\n"
            "Hãy giải cẩn thận từng câu trắc nghiệm dưới đây và xác định đáp án đúng (A, B, C hoặc D) kèm lời giải ngắn gọn, dễ hiểu.\n"
            "Trả về DUY NHẤT một mảng JSON hợp lệ (không markdown thừa) theo mẫu:\n"
            '[{"id": "...", "correct_option": "C", "explanation": "Lời giải ngắn gọn chính xác"}]\n\n'
            f"Danh sách câu hỏi:\n{json.dumps(items_payload, ensure_ascii=False)}"
        )

        from app.core.config import settings

        candidate_models: List[str] = []
        for m in [
            getattr(gemini_service, "_preferred_model", None),
            gemini_service.active_model_name,
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
            *(getattr(settings, "GEMINI_FALLBACK_MODELS", []) or []),
        ]:
            if m and m not in candidate_models:
                candidate_models.append(m)

        def _call_sync() -> str:
            last_exc: Optional[Exception] = None
            for model_name in candidate_models[:4]:
                try:
                    if gemini_service._client_type == "google-genai":
                        resp = gemini_service.client.models.generate_content(model=model_name, contents=prompt)
                        if resp and resp.text:
                            return resp.text
                    else:
                        resp = gemini_service.model.generate_content(prompt)
                        if resp and resp.text:
                            return resp.text
                except Exception as inner_exc:
                    last_exc = inner_exc
                    continue
            if last_exc:
                raise last_exc
            return ""

        try:
            raw_text = await asyncio.wait_for(asyncio.to_thread(_call_sync), timeout=timeout)
            cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text.strip(), flags=re.IGNORECASE)
            cleaned = re.sub(r"\s*```$", "", cleaned)
            parsed = json.loads(cleaned)
            out: Dict[str, Dict[str, Any]] = {}
            if isinstance(parsed, list):
                for entry in parsed:
                    qid = str(entry.get("id", "")).strip()
                    corr = str(entry.get("correct_option", "")).strip().upper()
                    if qid and corr in ("A", "B", "C", "D"):
                        out[qid] = {
                            "correct_option": corr,
                            "explanation": str(entry.get("explanation") or "").strip() or None,
                        }
            return out
        except Exception as exc:
            logger.warning("Không thể giải batch MCQ bằng Gemini AI: %s", exc)
            return {}

    @classmethod
    async def resolve_correct_answer(
        cls,
        question_content: Optional[str],
        options: Optional[List[Dict[str, Any]]],
        subject: str = "TOAN",
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        Xác định đáp án đúng khi câu hỏi chưa có sẵn key:
        1) Giải tất định tức thời (< 1ms) cho Toán số học / cấu tạo số / phương trình.
        2) Nếu là câu lý thuyết / đọc hiểu / Lý - Hoá - Anh phức tạp: hỏi nhanh Gemini AI.
        """
        det = cls.infer_mcq_correct_option_deterministic(question_content, options)
        if det:
            return det[0], det[1]

        if question_content and options and len(options) >= 2:
            ai_map = await cls.solve_mcqs_batch_with_ai(
                [{"id": "_single", "number": 1, "content": question_content, "options": options}],
                subject=subject,
                timeout=7.5,
            )
            if "_single" in ai_map:
                hit = ai_map["_single"]
                return hit.get("correct_option"), hit.get("explanation")

        return None, None

    @classmethod
    def analyze_distractor(
        cls,
        selected_label: str,
        correct_label: str,
        subject: str = "TOAN",
        question_content: Optional[str] = None,
        custom_distractor_map: Optional[Dict[str, str]] = None,
        options: Optional[List[Dict[str, Any]]] = None,
        correct_explanation: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        Phân tích chuyên sâu tại sao phương án học sinh chọn lại sai (phương án gây nhiễu).
        Trả về dictionary gồm lý do sai, hướng dẫn khắc phục và nhóm lỗi.
        """
        sel = selected_label.strip().upper()
        corr = correct_label.strip().upper()
        subj = (subject or "TOAN").strip().upper()

        # 1. Ưu tiên custom_distractor_map do giáo viên cung cấp trực tiếp
        if custom_distractor_map and sel in custom_distractor_map:
            custom_reason = custom_distractor_map[sel]
            return {
                "reason": custom_reason,
                "guidance": f"💡 Gợi ý: Hãy xem lại các bước giải để loại bỏ sai lầm ở phương án {sel} và tìm ra đáp án {corr}.",
                "category": "CUSTOM_TEACHER_EXPLANATION",
            }

        # 2. Phân tích theo ngữ cảnh nội dung câu hỏi
        q_text = (question_content or "").lower()
        if "đạo hàm" in q_text:
            if sel == "B":
                return {
                    "reason": "Phương án B nhầm lẫn giữa đạo hàm và nguyên hàm, dẫn đến sai dấu hoặc sai số mũ của biến số.",
                    "guidance": "💡 Gợi ý: Nhớ rằng công thức (x^n)' = n * x^(n-1), số mũ sẽ giảm đi 1 đơn vị.",
                    "category": "FORMULA_CONFUSION",
                }
            elif sel in ["C", "D"]:
                return {
                    "reason": f"Phương án {sel} tính sai hệ số tự do hoặc bỏ quên quy tắc nhân đạo hàm hàm hợp u'(x).",
                    "guidance": f"💡 Gợi ý: Đặt u là biểu thức bên trong, tính u' rồi nhân với đạo hàm ngoài để ra đáp án {corr}.",
                    "category": "CHAIN_RULE_ERROR",
                }
        elif "nguyên hàm" in q_text or "tích phân" in q_text:
            return {
                "reason": f"Phương án {sel} nhầm lẫn công thức lấy nguyên hàm (quên chia cho số mũ mới n+1 hoặc quên hằng số C).",
                "guidance": f"💡 Gợi ý: Áp dụng công thức nguyên hàm cơ bản ∫ x^n dx = (x^(n+1))/(n+1) + C.",
                "category": "INTEGRAL_ERROR",
            }
        elif "giới hạn" in q_text or "lim" in q_text:
            return {
                "reason": f"Phương án {sel} chưa khử dạng vô định (0/0 hoặc ∞/∞) trước khi thay giá trị.",
                "guidance": f"💡 Gợi ý: Phân tích tử và mẫu thành nhân tử hoặc chia cho lũy thừa bậc cao nhất để tìm đáp án {corr}.",
                "category": "INDETERMINATE_LIMIT",
            }
        elif "phương trình" in q_text:
            return {
                "reason": f"Phương án {sel} là nghiệm ngoại lai do chưa đối chiếu với điều kiện xác định của phương trình ban đầu.",
                "guidance": f"💡 Gợi ý: Luôn đặt điều kiện xác định ở bước đầu và thử lại nghiệm vào phương trình gốc.",
                "category": "EXTRANEOUS_ROOT",
            }

        # 2B. Nếu có danh sách phương án cụ thể (từ đề tải lên / bảng trắc nghiệm), giải thích sát đúng nội dung câu hỏi thực tế
        if options and question_content:
            opt_lookup = {
                str(o.get("label", "")).strip().upper(): str(o.get("content", "")).strip()
                for o in options
            }
            sel_val_txt = opt_lookup.get(sel, "")
            corr_val_txt = opt_lookup.get(corr, "")
            if sel_val_txt or corr_val_txt:
                sel_disp = f"{sel} ({sel_val_txt})" if sel_val_txt else sel
                corr_disp = f"{corr} ({corr_val_txt})" if corr_val_txt else corr
                guide_detail = (
                    f"💡 Gợi ý: {correct_explanation}"
                    if correct_explanation and "theo định luật và số liệu bài toán" not in correct_explanation
                    else f"💡 Gợi ý: Kiểm tra lại phép tính và dữ kiện đề bài để suy ra đáp án đúng là {corr_disp}."
                )
                return {
                    "reason": f"Giá trị ở phương án {sel_disp} chưa thoả mãn yêu cầu hoặc phép tính của đề bài (kết quả đúng phải là {corr_disp}).",
                    "guidance": guide_detail,
                    "category": "CALCULATION_ERROR",
                }

        # 3. Phân tích theo từ điển lỗi bộ môn
        subj_dict = cls.SUBJECT_DISTRACTORS.get(subj, cls.SUBJECT_DISTRACTORS["TOAN"])
        fallback = subj_dict.get(sel, {
            "reason": f"Phương án {sel} không thỏa mãn giả thiết và logic giải của bài toán.",
            "guidance": f"💡 Gợi ý: Đọc kỹ lại đề bài và kiểm tra lại từng bước tính toán để suy ra đáp án đúng {corr}.",
            "category": "LOGICAL_FALLACY",
        })

        return fallback

    @classmethod
    def evaluate_mcq_choice(
        cls,
        question_id: str,
        selected_label: str,
        correct_label: str = "A",
        correct_explanation: str = "Phương án chính xác theo định luật và số liệu bài toán.",
        distractor_map: Optional[Dict[str, str]] = None,
        question_content: Optional[str] = None,
        subject: str = "TOAN",
        session_id: Optional[str] = None,
        student_id: Optional[str] = None,
        options: Optional[List[Dict[str, Any]]] = None,
    ) -> GradeMCQResponse:
        """
        Chấm bài trắc nghiệm khoanh tròn trên bảng hoặc click chọn phương án.
        - ĐÚNG: Hiện icon tích xanh (✓), mã màu #16a34a, giải thích lý do chính xác và thưởng 1.0 điểm.
        - SAI: Hiện icon cảnh báo đỏ (✕), mã màu #dc2626, chỉ rõ lý do sai của phương án đã chọn,
          và hướng dẫn từng bước cách tìm ra đáp án đúng.
        """
        sel = selected_label.strip().upper() if selected_label else ""
        corr = correct_label.strip().upper() if correct_label else "A"
        is_correct = (sel == corr)

        if is_correct:
            # Đáp án đúng: Hiện tích xanh và giải thích nguyên nhân đúng
            return GradeMCQResponse(
                is_correct=True,
                selected_label=sel,
                correct_label=corr,
                status="CORRECT",
                explanation=correct_explanation or f"Phương án {sel} hoàn toàn chính xác theo định lý và giả thiết bài toán.",
                distractor_analysis=None,
                guidance="Xuất sắc! Bạn đã nắm vững lý thuyết và kỹ năng giải bài tập này.",
                error_category=None,
                badge_color="#16a34a",
                icon="✓",
                suggested_bonus_points=1.0,
            )
        else:
            # Đáp án sai: Hiện cảnh báo đỏ, phân tích phương án gây nhiễu và hướng dẫn tìm đáp án đúng
            analysis = cls.analyze_distractor(
                selected_label=sel,
                correct_label=corr,
                subject=subject,
                question_content=question_content,
                custom_distractor_map=distractor_map,
                options=options,
                correct_explanation=correct_explanation,
            )

            reason_text = analysis.get("reason", f"Phương án {sel} không chính xác.")
            guidance_text = analysis.get("guidance", f"Hãy áp dụng lý thuyết bài học để tìm ra đáp án {corr}.")
            category = analysis.get("category", "CONCEPTUAL_ERROR")

            return GradeMCQResponse(
                is_correct=False,
                selected_label=sel,
                correct_label=corr,
                status="INCORRECT",
                explanation=correct_explanation or f"Đáp án đúng của câu này là {corr}.",
                distractor_analysis=f"⚠️ Lý do sai của phương án {sel}: {reason_text}",
                guidance=guidance_text,
                error_category=category,
                badge_color="#dc2626",
                icon="✕",
                suggested_bonus_points=0.0,
            )

    # =========================================================================
    # TASK TF2851A: CHẤM BÀI GIẢI TỰ LUẬN THEO TỪNG DÒNG VIẾT TAY
    # Đánh dấu tích xanh ở bước đúng, gạch chân đỏ dòng sai và gợi ý không lộ đáp án
    # =========================================================================

    _MATH_FN_MAP: Dict[str, Any] = {
        "sin": math.sin,
        "cos": math.cos,
        "tan": math.tan,
        "cot": lambda x: 1.0 / math.tan(x),
        "asin": math.asin,
        "acos": math.acos,
        "atan": math.atan,
        "sqrt": lambda x: math.sqrt(x) if x >= 0 else float("nan"),
        "ln": lambda x: math.log(x) if x > 0 else float("nan"),
        "log": lambda x: math.log10(x) if x > 0 else float("nan"),
        "exp": math.exp,
        "abs": abs,
    }
    _KNOWN_MATH_WORDS: Set[str] = {
        "sin", "cos", "tan", "cot", "asin", "acos", "atan",
        "sqrt", "ln", "log", "exp", "abs", "pi", "delta",
    }

    @classmethod
    def _is_meaningless_step_text(cls, raw_text: str) -> bool:
        s = re.sub(
            r"\\(?:cdot|bullet|quad|qquad|,|;|!|:|displaystyle|textstyle)\b",
            " ",
            str(raw_text or ""),
        )
        s = re.sub(r"[$.,;:!?'\"`\-_·⋅=+<>→⇒⇔/\\()\s]", "", s).strip()
        return len(s) == 0

    @classmethod
    def _replace_latex_brace_1(cls, text: str, cmd: str, fmt: str) -> Optional[str]:
        s = text
        needle = f"\\{cmd}{{"
        guard = 0
        while needle in s and guard < 24:
            guard += 1
            idx = s.find(needle)
            depth = 1
            cur = idx + len(needle)
            while cur < len(s) and depth > 0:
                if s[cur] == "{":
                    depth += 1
                elif s[cur] == "}":
                    depth -= 1
                cur += 1
            if depth != 0:
                return None
            inner = s[idx + len(needle) : cur - 1]
            s = s[:idx] + fmt.format(inner) + s[cur:]
        return s

    @classmethod
    def _replace_latex_frac(cls, text: str, cmd: str) -> Optional[str]:
        s = text
        needle = f"\\{cmd}{{"
        guard = 0
        while needle in s and guard < 24:
            guard += 1
            idx = s.find(needle)
            depth = 1
            c1 = idx + len(needle)
            while c1 < len(s) and depth > 0:
                if s[c1] == "{":
                    depth += 1
                elif s[c1] == "}":
                    depth -= 1
                c1 += 1
            if depth != 0:
                return None
            num = s[idx + len(needle) : c1 - 1]
            while c1 < len(s) and s[c1].isspace():
                c1 += 1
            if c1 >= len(s) or s[c1] != "{":
                return None
            depth = 1
            c2 = c1 + 1
            while c2 < len(s) and depth > 0:
                if s[c2] == "{":
                    depth += 1
                elif s[c2] == "}":
                    depth -= 1
                c2 += 1
            if depth != 0:
                return None
            den = s[c1 + 1 : c2 - 1]
            s = f"{s[:idx]}(({num})/({den})){s[c2:]}"
        return s

    @classmethod
    def _latex_to_python_ast_expr(cls, raw_expr: str) -> Optional[Tuple[ast.AST, Set[str]]]:
        s = str(raw_expr or "").strip()
        if not s or len(s) > 220:
            return None
        if re.search(r"[à-ỹÀ-Ỹ]", s):
            return None

        s = s.replace("$", "")
        s = re.sub(r"\\(?:displaystyle|textstyle|quad|qquad|,|;|!)", " ", s)
        s = re.sub(r"\\left\s*\(", "(", s)
        s = re.sub(r"\\right\s*\)", ")", s)
        s = re.sub(r"\\left\s*\[", "(", s)
        s = re.sub(r"\\right\s*\]", ")", s)
        s = re.sub(r"\\left\s*\|([^|]+)\\right\s*\|", r"abs(\1)", s)

        for frac_cmd in ("dfrac", "tfrac", "frac"):
            s_next = cls._replace_latex_frac(s, frac_cmd)
            if s_next is None:
                return None
            s = s_next

        s = re.sub(r"\\sqrt\s*\[\s*([^\]]+)\s*\]\s*\{([^{}]+)\}", r"((\2)**(1/(\1)))", s)
        s_sqrt = cls._replace_latex_brace_1(s, "sqrt", "sqrt({0})")
        if s_sqrt is None:
            return None
        s = s_sqrt

        sup_map = {"²": "2", "³": "3", "⁴": "4"}
        s = re.sub(
            r"\\?(sin|cos|tan|cot)\s*(?:\^\s*\{?\s*(\d+)\s*\}?|([²³⁴]))\s*(\([^()]+\)|[a-zA-Z0-9]+)",
            lambda m: f"(({m.group(1).lower()}({m.group(4)}))**{m.group(2) or sup_map.get(m.group(3), '2')})",
            s,
            flags=re.IGNORECASE,
        )
        s = re.sub(
            r"\\?(sin|cos|tan|cot|ln|log|sqrt)\s+(?!\()([+-]?\d*[a-zA-Z]+(?:\^\s*\{?\d+\}?)?)",
            lambda m: f"{m.group(1).lower()}({m.group(2)})",
            s,
            flags=re.IGNORECASE,
        )
        s = re.sub(
            r"\\(sin|cos|tan|cot|ln|log|exp|pi|Delta|delta)\b",
            lambda m: m.group(1).lower(),
            s,
        )

        guard = 0
        while "^{" in s and guard < 24:
            guard += 1
            idx = s.find("^{")
            depth = 1
            cur = idx + 2
            while cur < len(s) and depth > 0:
                if s[cur] == "{":
                    depth += 1
                elif s[cur] == "}":
                    depth -= 1
                cur += 1
            if depth != 0:
                return None
            exp_inner = s[idx + 2 : cur - 1]
            s = f"{s[:idx]}**({exp_inner}){s[cur:]}"

        s = re.sub(r"_\s*\{([a-zA-Z0-9]+)\}", r"_\1", s)
        s = re.sub(
            r"([⁰¹²³⁴⁵⁶⁷⁸⁹]+)",
            lambda m: "**" + m.group(1).translate(str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")),
            s,
        )
        s = (
            s.replace("\\cdot", "*")
            .replace("\\times", "*")
            .replace("×", "*")
            .replace("⋅", "*")
            .replace("·", "*")
            .replace("\\div", "/")
            .replace("÷", "/")
            .replace("−", "-")
            .replace("–", "-")
            .replace("[", "(")
            .replace("]", ")")
            .replace("{", "(")
            .replace("}", ")")
            .replace("^", "**")
        )

        fn_tokens: List[str] = []

        def _protect_word(match: re.Match) -> str:
            w = match.group(0)
            lw = w.lower()
            if lw in cls._KNOWN_MATH_WORDS or re.match(r"^[a-z]_\d+$", lw):
                idx_tok = len(fn_tokens)
                fn_tokens.append(lw)
                return f"__MFN{idx_tok}__"
            if len(w) == 1:
                return lw
            if len(w) <= 3 and re.match(r"^[abcxyzmnptuvw]+$", lw):
                return "*".join(list(lw))
            return "__INVALID_PROSE__"

        s = re.sub(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", _protect_word, s)
        if "__INVALID_PROSE__" in s:
            return None

        s = re.sub(r"(\d)\s*([a-z(]|__MFN\d+__)", r"\1*\2", s)
        s = re.sub(r"(\))\s*(\d|[a-z(]|__MFN\d+__)", r"\1*\2", s)
        s = re.sub(r"\b([a-z])\s*(\(|__MFN\d+__)", r"\1*\2", s)
        s = re.sub(r"__MFN(\d+)__", lambda m: fn_tokens[int(m.group(1))], s)

        try:
            tree = ast.parse(s, mode="eval")
        except Exception:
            return None

        free_vars: Set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if not isinstance(node.func, ast.Name) or node.func.id not in cls._MATH_FN_MAP or len(node.args) != 1:
                    return None
            elif isinstance(node, ast.Name):
                if node.id not in cls._MATH_FN_MAP and node.id not in ("pi", "e"):
                    free_vars.add(node.id)
            elif not isinstance(
                node,
                (
                    ast.Expression,
                    ast.Constant,
                    ast.BinOp,
                    ast.UnaryOp,
                    ast.Load,
                    ast.Add,
                    ast.Sub,
                    ast.Mult,
                    ast.Div,
                    ast.Pow,
                    ast.UAdd,
                    ast.USub,
                ),
            ):
                return None

        return tree, free_vars

    @classmethod
    def _eval_parsed_ast(cls, tree: ast.AST, env: Dict[str, float]) -> Optional[float]:
        def _ev(node: ast.AST) -> float:
            if isinstance(node, ast.Expression):
                return _ev(node.body)
            if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
                return float(node.value)
            if isinstance(node, ast.Name):
                if node.id == "pi":
                    return math.pi
                if node.id == "e" and "e" not in env:
                    return math.e
                if node.id in env:
                    return float(env[node.id])
                raise ValueError(f"Unbound var {node.id}")
            if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_AST_UNARY_OPS:
                return float(_SAFE_AST_UNARY_OPS[type(node.op)](_ev(node.operand)))
            if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_AST_BIN_OPS:
                lv = _ev(node.left)
                rv = _ev(node.right)
                if isinstance(node.op, ast.Pow):
                    if abs(rv) > 24 and abs(lv) > 2:
                        raise ValueError("Exponent overflow")
                    if lv < 0 and abs(rv - round(rv)) > 1e-9:
                        return float("nan")
                res_v = _SAFE_AST_BIN_OPS[type(node.op)](lv, rv)
                if isinstance(res_v, complex):
                    return float("nan")
                return float(res_v)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                fn = cls._MATH_FN_MAP[node.func.id]
                return float(fn(_ev(node.args[0])))
            raise ValueError("Unsupported AST")

        try:
            out = _ev(tree)
            if isinstance(out, complex) or math.isnan(out) or math.isinf(out):
                return None
            return float(out)
        except Exception:
            return None

    @classmethod
    def _parse_side_with_derivative(cls, raw_side: str) -> Optional[Dict[str, Any]]:
        s = str(raw_side or "").strip()
        m_deriv = re.match(r"^\((.+)\)\s*'$", s) or re.match(r"^\\left\((.+)\\right\)\s*'$", s)
        if m_deriv:
            parsed = cls._latex_to_python_ast_expr(m_deriv.group(1))
            if not parsed:
                return None
            tree, fvars = parsed
            if len(fvars) > 1:
                return None
            v_name = next(iter(fvars), "x")

            def _eval_deriv(env: Dict[str, float]) -> Optional[float]:
                if not fvars:
                    return 0.0
                x0 = env.get(v_name, 1.0)
                h = 1e-4
                pts = [
                    cls._eval_parsed_ast(tree, {**env, v_name: x0 + 2 * h}),
                    cls._eval_parsed_ast(tree, {**env, v_name: x0 + h}),
                    cls._eval_parsed_ast(tree, {**env, v_name: x0 - h}),
                    cls._eval_parsed_ast(tree, {**env, v_name: x0 - 2 * h}),
                ]
                if any(p is None for p in pts):
                    return None
                return (-pts[0] + 8.0 * pts[1] - 8.0 * pts[2] + pts[3]) / (12.0 * h)  # type: ignore[operator]

            return {"vars": fvars, "is_derivative": True, "eval": _eval_deriv}

        parsed = cls._latex_to_python_ast_expr(s)
        if not parsed:
            return None
        tree, fvars = parsed
        return {
            "vars": fvars,
            "is_derivative": False,
            "eval": lambda env: cls._eval_parsed_ast(tree, env),
        }

    @classmethod
    def _are_sides_equivalent(cls, lhs_raw: str, rhs_raw: str) -> Optional[bool]:
        lhs = cls._parse_side_with_derivative(lhs_raw)
        rhs = cls._parse_side_with_derivative(rhs_raw)
        if not lhs or not rhs:
            return None

        all_vars = sorted(lhs["vars"] | rhs["vars"])
        if not all_vars:
            v1 = lhs["eval"]({})
            v2 = rhs["eval"]({})
            if v1 is None or v2 is None:
                return None
            return abs(v1 - v2) <= 1e-5 * max(1.0, abs(v1), abs(v2))

        bases = [1.37, 2.41, 0.73, 3.19, 1.83, -0.73, -1.89, -2.63]
        valid_pts = 0
        for b in bases:
            env = {v: b + idx * 0.31 for idx, v in enumerate(all_vars)}
            v1 = lhs["eval"](env)
            v2 = rhs["eval"](env)
            if v1 is None or v2 is None:
                continue
            valid_pts += 1
            tol = 1e-4 * max(1.0, abs(v1), abs(v2))
            if abs(v1 - v2) > tol:
                return False

        return True if valid_pts >= 3 else None

    @classmethod
    def _find_real_roots_1d(cls, lhs_obj: Dict[str, Any], rhs_obj: Dict[str, Any], var_name: str) -> List[float]:
        def _f(x: float) -> Optional[float]:
            lv = lhs_obj["eval"]({var_name: x})
            rv = rhs_obj["eval"]({var_name: x})
            if lv is None or rv is None:
                return None
            return lv - rv

        roots: List[float] = []

        def _add_root(r: float) -> None:
            lv = lhs_obj["eval"]({var_name: r})
            rv = rhs_obj["eval"]({var_name: r})
            if lv is None or rv is None:
                return
            if abs(lv - rv) > 1e-4 * max(1.0, abs(lv), abs(rv)):
                return
            if not any(abs(existing - r) < 1e-3 for existing in roots):
                roots.append(r)

        grid: List[float] = []
        for i in range(-30, 31):
            grid.append(float(i))
            if i < 30:
                grid.append(i + 0.5)

        prev_x: Optional[float] = None
        prev_y: Optional[float] = None
        for x in grid:
            y = _f(x)
            if y is None:
                prev_x, prev_y = None, None
                continue
            if abs(y) <= 1e-7:
                _add_root(x)
            if prev_x is not None and prev_y is not None and prev_y * y < 0:
                lo, hi, flo = prev_x, x, prev_y
                for _ in range(36):
                    mid = 0.5 * (lo + hi)
                    fmid = _f(mid)
                    if fmid is None:
                        break
                    if abs(fmid) <= 1e-10:
                        lo = hi = mid
                        break
                    if flo * fmid <= 0:
                        hi = mid
                    else:
                        lo, flo = mid, fmid
                _add_root(0.5 * (lo + hi))
            prev_x, prev_y = x, y

        return roots

    @staticmethod
    def _strip_step_prefix(raw_line: str) -> str:
        s = str(raw_line or "").strip()
        s = re.sub(r"^(?:bước\s*\d+|buoc\s*\d+|ta\s*có|suy\s*ra|vậy|vay)\s*[:.]?\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^(?:\\Leftrightarrow|\\Rightarrow|<=>|⇔|=>|⇒|->)\s*", "", s)
        return s.strip()

    @staticmethod
    def _split_top_level_equals(expr_str: str) -> List[str]:
        parts: List[str] = []
        depth = 0
        start = 0
        n = len(expr_str)
        for i, ch in enumerate(expr_str):
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth = max(0, depth - 1)
            elif depth == 0 and ch == "=":
                prev_c = expr_str[i - 1] if i > 0 else ""
                next_c = expr_str[i + 1] if i + 1 < n else ""
                if prev_c in "<>!=" or next_c in "=>":
                    continue
                parts.append(expr_str[start:i].strip())
                start = i + 1
        parts.append(expr_str[start:].strip())
        return parts

    @classmethod
    def _verify_math_step_equivalence(
        cls,
        current_text: str,
        previous_steps: List[str],
        question_content: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, str]], bool]:
        """
        Kiểm chứng tương đương toán học tổng quát bằng AST đa điểm & nghiệm phương trình.
        Trả về: (error_dict_hoặc_None, đã_xác_minh_bằng_toán_học_hay_chưa).
        """
        body = cls._strip_step_prefix(current_text)
        if not body:
            return None, False

        q_raw = str(question_content or "").strip()
        q_clean = re.sub(r"^[^:]{1,45}:\s*", "", q_raw).strip()
        q_is_solve = bool(re.search(r"giải\s+phương\s+trình|tìm\s+[a-z]|nghiệm", q_raw, flags=re.IGNORECASE))

        anchor_expr: Optional[str] = None
        problem_eq: Optional[Dict[str, Any]] = None

        if q_clean:
            q_parts = cls._split_top_level_equals(q_clean)
            if len(q_parts) == 1:
                if cls._parse_side_with_derivative(q_parts[0]):
                    anchor_expr = q_parts[0]
            elif len(q_parts) == 2:
                is_label = (
                    not q_is_solve
                    and bool(re.match(r"^(?:[A-Z]|[fghPQMNS]\s*\(\s*[a-z]\s*\))$", q_parts[0]))
                    and q_parts[0] not in ("X", "Y", "Z")
                )
                if is_label and cls._parse_side_with_derivative(q_parts[1]):
                    anchor_expr = q_parts[1]
                else:
                    lp = cls._parse_side_with_derivative(q_parts[0])
                    rp = cls._parse_side_with_derivative(q_parts[1])
                    if lp and rp:
                        eq_vars = lp["vars"] | rp["vars"]
                        if len(eq_vars) == 1:
                            v_eq = next(iter(eq_vars))
                            problem_eq = {
                                "lhs": lp,
                                "rhs": rp,
                                "var": v_eq,
                                "roots": cls._find_real_roots_1d(lp, rp, v_eq),
                            }
        elif previous_steps:
            first_prev = cls._strip_step_prefix(previous_steps[0])
            p_parts = cls._split_top_level_equals(first_prev)
            if len(p_parts) == 1 and cls._parse_side_with_derivative(p_parts[0]):
                anchor_expr = p_parts[0]
            elif len(p_parts) == 2 and p_parts[0]:
                lp = cls._parse_side_with_derivative(p_parts[0])
                rp = cls._parse_side_with_derivative(p_parts[1])
                if lp and rp:
                    eq_vars = lp["vars"] | rp["vars"]
                    if len(eq_vars) == 1:
                        v_eq = next(iter(eq_vars))
                        problem_eq = {
                            "lhs": lp,
                            "rhs": rp,
                            "var": v_eq,
                            "roots": cls._find_real_roots_1d(lp, rp, v_eq),
                        }

        # Trường hợp A: Dòng nối tiếp bắt đầu bằng dấu '=' (VD: '= x^3 + 20x + 10')
        if body.startswith("="):
            rhs_chain = [p for p in cls._split_top_level_equals(body[1:].strip()) if p]
            if not rhs_chain:
                return None, False
            ref_expr = anchor_expr
            if not ref_expr and previous_steps:
                ref_expr = re.sub(r"^=\s*", "", cls._strip_step_prefix(previous_steps[-1])).strip()
            if ref_expr:
                verified_any = False
                for rhs_part in rhs_chain:
                    eq_res = cls._are_sides_equivalent(ref_expr, rhs_part)
                    if eq_res is False:
                        is_binom = bool(re.search(r"\([^()]+\)\s*(?:\^|\*\*)\s*\{?\s*[23]\s*\}?|[²³]", ref_expr))
                        if is_binom:
                            return (
                                {
                                    "error_type": "FORMULA_ERROR",
                                    "reason": "Khai triển hằng đẳng thức chưa chính xác: Bậc lũy thừa hoặc các hệ số không khớp với biểu thức đề bài.",
                                    "guidance": "💡 Gợi ý: Hãy kiểm tra lại hằng đẳng thức (A ± B)² = A² ± 2AB + B² (hoặc bậc 3), chú ý đúng số mũ của biến và từng hệ số.",
                                },
                                True,
                            )
                        return (
                            {
                                "error_type": "CALCULATION_ERROR",
                                "reason": "Biến đổi đại số chưa tương đương: Giá trị biểu thức sau dấu '=' không bằng biểu thức trước đó.",
                                "guidance": "💡 Gợi ý: Hãy kiểm tra lại dấu, số mũ và hệ số của từng hạng tử ở dòng biến đổi này.",
                            },
                            True,
                        )
                    if eq_res is True:
                        verified_any = True
                return None, verified_any
            return None, False

        # Trường hợp B: Chuỗi nhiều dấu '=' trên cùng dòng (VD: 3x = 15 + 12 = 25)
        parts = cls._split_top_level_equals(body)
        if len(parts) >= 3:
            verified_chain = False
            for i in range(len(parts) - 1):
                pa = cls._parse_side_with_derivative(parts[i])
                pb = cls._parse_side_with_derivative(parts[i + 1])
                if pa and pb and pa["vars"] == pb["vars"]:
                    eq_pair = cls._are_sides_equivalent(parts[i], parts[i + 1])
                    if eq_pair is False:
                        return (
                            {
                                "error_type": "CALCULATION_ERROR",
                                "reason": "Các vế biến đổi nối tiếp trên cùng dòng không bằng nhau.",
                                "guidance": "💡 Gợi ý: Kiểm tra lại phép tính hoặc rút gọn giữa các dấu '=' trên dòng này.",
                            },
                            True,
                        )
                    if eq_pair is True:
                        verified_chain = True
            if verified_chain:
                return None, True

        # Trường hợp C: Đẳng thức hoặc phương trình 2 vế LHS = RHS
        if len(parts) == 2 and parts[0] and parts[1]:
            lhs_str, rhs_str = parts
            lhs_p = cls._parse_side_with_derivative(lhs_str)
            rhs_p = cls._parse_side_with_derivative(rhs_str)
            if not lhs_p or not rhs_p:
                return None, False

            union_vars = lhs_p["vars"] | rhs_p["vars"]
            is_identity = cls._are_sides_equivalent(lhs_str, rhs_str)

            # 1. Biểu thức số thuần túy (0 biến)
            if len(union_vars) == 0:
                if is_identity is False:
                    return (
                        {
                            "error_type": "CALCULATION_ERROR",
                            "reason": f"Tính toán sai giá trị số học: {lhs_str} không bằng {rhs_str}.",
                            "guidance": "💡 Gợi ý: Hãy thực hiện lại phép tính cộng, trừ, nhân, chia hoặc lũy thừa ở dòng này.",
                        },
                        True,
                    )
                return None, bool(is_identity)

            # 2. Đạo hàm (f(x))' = g(x)
            if lhs_p["is_derivative"] or rhs_p["is_derivative"]:
                if is_identity is False:
                    return (
                        {
                            "error_type": "FORMULA_ERROR",
                            "reason": "Áp dụng chưa đúng quy tắc tính đạo hàm.",
                            "guidance": "💡 Gợi ý: Kiểm tra lại bảng đạo hàm cơ bản và quy tắc nhân hệ số / dấu khi lấy đạo hàm.",
                        },
                        True,
                    )
                return None, bool(is_identity)

            # 3. Đề bài là biểu thức khai triển / rút gọn (không phải giải phương trình)
            if anchor_expr and not problem_eq:
                vs_anchor = cls._are_sides_equivalent(anchor_expr, rhs_str)
                if is_identity is False or vs_anchor is False:
                    return (
                        {
                            "error_type": "FORMULA_ERROR",
                            "reason": "Phép khai triển hoặc rút gọn chưa tương đương với biểu thức đề bài.",
                            "guidance": "💡 Gợi ý: Đối chiếu lại từng số mũ và hệ số khi khai triển hoặc thu gọn biểu thức.",
                        },
                        True,
                    )
                return None, True

            # 4. Đề bài là giải phương trình 1 ẩn: đối chiếu tập nghiệm thực
            if problem_eq and len(union_vars) == 1 and next(iter(union_vars)) == problem_eq["var"]:
                if is_identity is True:
                    return None, True
                v_name = problem_eq["var"]
                step_roots = cls._find_real_roots_1d(lhs_p, rhs_p, v_name)
                is_radical_eq = bool(re.search(r"sqrt|\\sqrt", q_clean))
                p_roots: List[float] = problem_eq["roots"]
                if p_roots:
                    preserves_any_root = any(
                        (lv := lhs_p["eval"]({v_name: r0})) is not None
                        and (rv := rhs_p["eval"]({v_name: r0})) is not None
                        and abs(lv - rv) <= 1e-3 * max(1.0, abs(lv), abs(rv))
                        for r0 in p_roots
                    )
                    has_wrong_root = (not is_radical_eq) and any(
                        (lv0 := problem_eq["lhs"]["eval"]({v_name: rk})) is None
                        or (rv0 := problem_eq["rhs"]["eval"]({v_name: rk})) is None
                        or abs(lv0 - rv0) > 1e-3 * max(1.0, abs(lv0), abs(rv0))
                        for rk in step_roots
                    )
                    if not preserves_any_root or has_wrong_root:
                        return (
                            {
                                "error_type": "CALCULATION_ERROR",
                                "reason": "Phương trình biến đổi không tương đương (nhầm dấu chuyển vế hoặc tính sai hệ số/nghiệm).",
                                "guidance": "💡 Gợi ý: Kiểm tra lại dấu khi chuyển vế và phép tính rút gọn hai vế của phương trình.",
                            },
                            True,
                        )
                    return None, True

            # 5. Dòng đơn lẻ không có đề bài: bắt các hằng đẳng thức / lượng giác / căn thức sai
            if not problem_eq:
                if is_identity is True:
                    return None, True
                if is_identity is False:
                    looks_like_identity = (
                        len(union_vars) >= 2
                        or bool(re.search(r"\([^()]+\)\s*(?:\^|\*\*)\s*\{?\s*[234]\s*\}?|[²³⁴]", lhs_str))
                        or bool(re.search(r"\)\s*\(", lhs_str))
                        or bool(re.search(r"sin|cos|tan|cot|sqrt|ln|log", body, flags=re.IGNORECASE))
                    )
                    if looks_like_identity and rhs_str != "0" and len(rhs_p["vars"]) > 0:
                        return (
                            {
                                "error_type": "FORMULA_ERROR",
                                "reason": "Hai vế của đẳng thức không bằng nhau với mọi giá trị của biến.",
                                "guidance": "💡 Gợi ý: Kiểm tra lại hằng đẳng thức hoặc công thức biến đổi ở dòng này.",
                            },
                            True,
                        )

        return None, False

    @classmethod
    def detect_step_error(
        cls,
        current_text: str,
        previous_steps: List[str],
        question_content: Optional[str] = None,
        subject: str = "TOAN",
        target_answer: Optional[str] = None,
    ) -> Optional[Dict[str, str]]:
        """
        Phát hiện sai sót trong dòng biến đổi tự luận hiện tại:
        - Nhầm công thức toán/lý/hóa (Hằng đẳng thức, Đạo hàm, Tích phân, Lượng giác...)
        - Nhầm dấu (chuyển vế không đổi dấu, nhân chia số âm không đổi chiều...)
        - Tính sai số học & kiểm chứng tương đương đại số / nghiệm phương trình bằng AST đa điểm
        Trả về dict {error_type, reason, guidance} hoặc None nếu bước biến đổi hợp lệ.
        """
        if cls._is_meaningless_step_text(current_text):
            return {
                "error_type": "INCOMPLETE_STEP",
                "reason": "Dòng viết chưa có biểu thức hoặc nội dung hợp lệ để chấm.",
                "guidance": "💡 Gợi ý: Hãy xóa nét chấm thừa hoặc viết đầy đủ phép biến đổi tiếp theo.",
            }

        text = current_text.strip()
        text_norm_latex = (
            text.replace("\\left(", "(")
            .replace("\\right)", ")")
            .replace("$", "")
        )
        text_norm_latex = re.sub(r"\^\s*\{\s*(\d+)\s*\}", r"^\1", text_norm_latex)
        text_clean = re.sub(r"\s+", " ", text_norm_latex.lower())

        # Hỗ trợ học sinh viết dòng bắt đầu bằng '=' liên kết với bước trước hoặc đề bài
        chained_text = text_clean
        if text_clean.startswith("=") and (previous_steps or question_content):
            anchor_raw = (previous_steps[-1] if previous_steps else question_content or "").strip()
            anchor_norm = re.sub(
                r"\^\s*\{\s*(\d+)\s*\}",
                r"^\1",
                anchor_raw.replace("\\left(", "(").replace("\\right)", ")").replace("$", ""),
            ).lower()
            chained_text = f"{anchor_norm} {text_clean}"

        # 1. Kiểm tra nhầm hằng đẳng thức đáng nhớ (x + b)^2 hoặc (a + b)^2
        # Khai triển bình phương nhưng vế phải chỉ có 2 số hạng (thiếu 2ab)
        # Ví dụ: (x + 3)^2 = x^2 + 9, (x + 2)^2 = x^2 + 4, (a + b)^2 = a^2 + b^2
        m_plus = re.search(r"\(([a-z0-9]+)\s*\+\s*([a-z0-9]+)\)\s*\^?\s*2\s*=\s*(.+)$", chained_text)
        if m_plus:
            v_a = m_plus.group(1).strip()
            v_b = m_plus.group(2).strip()
            rhs = m_plus.group(3).strip()
            # Nếu vế phải chỉ có 2 số hạng (chỉ có 1 dấu '+', không có số hạng tích 2ab)
            # hoặc không chứa tích 2*a*b
            has_2ab = False
            try:
                # Nếu b là số, ví dụ b = 3 -> 2ab = 6a; b = 2 -> 2ab = 4a
                b_num = int(v_b)
                coef = 2 * b_num
                if f"{coef}{v_a}" in rhs or f"{coef}*{v_a}" in rhs or f"{coef} * {v_a}" in rhs or f"2*{v_a}*{v_b}" in rhs:
                    has_2ab = True
            except Exception:
                if f"2{v_a}{v_b}" in rhs or f"2*{v_a}*{v_b}" in rhs or f"2 * {v_a}" in rhs or "2ab" in rhs:
                    has_2ab = True

            if rhs.count("+") == 1 and not has_2ab:
                return {
                    "error_type": "FORMULA_ERROR",
                    "reason": "Nhầm lẫn hằng đẳng thức: Bỏ quên số hạng hai lần tích (2ab) khi khai triển bình phương của một tổng.",
                    "guidance": "💡 Gợi ý: Hãy xem lại công thức hằng đẳng thức: (A + B)² = A² + 2AB + B².",
                }

        # Khai triển (x - y)^2 = x^2 - y^2 hoặc x^2 - 4 (quên 2ab và nhầm dấu)
        m_minus = re.search(r"\(([a-z0-9]+)\s*-\s*([a-z0-9]+)\)\s*\^?\s*2\s*=\s*(.+)$", text_clean)
        if m_minus:
            rhs = m_minus.group(3).strip()
            if rhs.count("-") == 1 and rhs.count("+") == 0:
                return {
                    "error_type": "FORMULA_ERROR",
                    "reason": "Khai triển sai bình phương của một hiệu: (A - B)² không bằng A² - B².",
                    "guidance": "💡 Gợi ý: Hằng đẳng thức đúng là (A - B)² = A² - 2AB + B².",
                }

        # Căn bậc hai của tổng: sqrt(a^2 + b^2) = a + b
        if re.search(r"(?:\\sqrt|sqrt)\s*\(?\s*[a-z0-9]+\s*\^?\s*2\s*\+\s*[a-z0-9]+\s*\^?\s*2\s*\)?\s*=\s*[a-z0-9]+\s*\+\s*[a-z0-9]+", text_clean):
            return {
                "error_type": "FORMULA_ERROR",
                "reason": "Áp dụng sai tính chất căn thức: Căn bậc hai của một tổng không thể tách thành tổng hai căn bậc hai.",
                "guidance": "💡 Gợi ý: √(A² + B²) ≠ A + B. Cần giữ nguyên căn thức hoặc tìm cách phân tích nhân tử thích hợp.",
            }

        # 2. Kiểm tra nhầm công thức đạo hàm / tích phân / lượng giác (H14: neo đúng vế trái/phải)
        # Đạo hàm của +sin(x) = -cos(x) (sai dấu)
        if re.search(r"\(\s*\+?\s*\\?sin\b[^)]*\)\s*'\s*=\s*-\s*\\?cos\b", text_clean):
            return {
                "error_type": "FORMULA_ERROR",
                "reason": "Nhầm dấu đạo hàm: Đạo hàm của hàm sin(x) là +cos(x), không có dấu âm.",
                "guidance": "💡 Gợi ý: Nhớ lại bảng đạo hàm lượng giác: (sin x)' = cos x; còn (cos x)' mới bằng -sin x.",
            }

        # Đạo hàm của +cos(x) = +sin(x) (quên dấu trừ; loại trừ (-cos x)' = sin x là đúng)
        if re.search(r"\(\s*\+?\s*\\?cos\b[^)]*\)\s*'\s*=\s*\+?\s*\\?sin\b", text_clean):
            return {
                "error_type": "FORMULA_ERROR",
                "reason": "Quên dấu âm khi lấy đạo hàm: Đạo hàm của cos(x) phải có dấu trừ đằng trước.",
                "guidance": "💡 Gợi ý: Đạo hàm của cos(x) là -sin(x). Chú ý đổi dấu của hàm số lượng giác.",
            }

        # Đạo hàm x^n = x^(n-1) (quên nhân hệ số n)
        if re.search(r"\(\s*x\s*\^?\s*(\d+)\s*\)\s*'\s*=\s*x\s*\^?\s*(\d+)", text_clean):
            m = re.search(r"\(\s*x\s*\^?\s*(\d+)\s*\)\s*'\s*=\s*x\s*\^?\s*(\d+)", text_clean)
            if m:
                n_orig = int(m.group(1))
                return {
                    "error_type": "FORMULA_ERROR",
                    "reason": f"Quên nhân số mũ {n_orig}: Đạo hàm của x^{n_orig} phải nhân với số mũ ban đầu.",
                    "guidance": "💡 Gợi ý: Áp dụng công thức lũy thừa: (xⁿ)' = n · xⁿ⁻¹.",
                }

        # Công thức lượng giác sai: sin^2 + cos^2 = 0 hoặc sin^2 - cos^2 = 1 (không bắt nhầm sin^2 = 1 - cos^2)
        if (
            re.search(r"\\?sin\s*(?:\^2|²)[^=]*\+\s*\\?cos\s*(?:\^2|²)[^=]*=\s*0\b", text_clean)
            or re.search(r"\\?sin\s*(?:\^2|²)[^=]*-\s*\\?cos\s*(?:\^2|²)[^=]*=\s*1\b", text_clean)
        ):
            return {
                "error_type": "FORMULA_ERROR",
                "reason": "Nhầm lẫn hệ thức lượng giác cơ bản giữa sin và cos.",
                "guidance": "💡 Gợi ý: Hệ thức cơ bản luôn là sin²(x) + cos²(x) = 1 với mọi góc x.",
            }

        # 3. Kiểm tra lỗi chuyển vế không đổi dấu (SIGN_ERROR)
        # So sánh với bước trước đó nếu có dạng: ax - b = 0 => ax = -b (hoặc ax + b = c => ax = c + b)
        if previous_steps:
            prev_line = previous_steps[-1].strip().lower()
            # Ví dụ: prev "2x - 4 = 0" -> curr "2x = -4"
            if re.search(r"(\d*[a-z](?:\^2)?)\s*-\s*(\d+)\s*=\s*0", prev_line):
                m_prev = re.search(r"(\d*[a-z](?:\^2)?)\s*-\s*(\d+)\s*=\s*0", prev_line)
                var_part = m_prev.group(1)
                num_part = m_prev.group(2)
                # Dòng hiện tại lại ghi var_part = -num_part
                if f"{var_part} = -{num_part}" in text_clean or f"{var_part}=-{num_part}" in text_clean:
                    return {
                        "error_type": "SIGN_ERROR",
                        "reason": f"Lỗi chuyển vế: Khi chuyển số -{num_part} từ vế trái sang vế phải phải đổi thành +{num_part}.",
                        "guidance": "💡 Gợi ý: Quy tắc chuyển vế: Khi chuyển một số hạng qua dấu '=', phải đổi dấu của số hạng đó.",
                    }

            # Ví dụ: prev "x + 5 = 10" -> curr "x = 10 + 5"
            if re.search(r"([a-z])\s*\+\s*(\d+)\s*=\s*(\d+)", prev_line):
                m_p = re.search(r"([a-z])\s*\+\s*(\d+)\s*=\s*(\d+)", prev_line)
                var_p = m_p.group(1)
                n1 = m_p.group(2)
                n2 = m_p.group(3)
                if f"{var_p} = {n2} + {n1}" in text_clean or f"{var_p}={n2}+{n1}" in text_clean:
                    return {
                        "error_type": "SIGN_ERROR",
                        "reason": f"Lỗi dấu khi chuyển vế: Số +{n1} chuyển vế phải mang dấu trừ.",
                        "guidance": "💡 Gợi ý: Chuyển vế đổi dấu: Số hạng mang dấu (+) sang vế đối diện phải mang dấu (-).",
                    }

        # Bất đẳng thức: nhân chia số âm không đảo chiều (ví dụ: -2x > 4 => x > -2)
        if previous_steps:
            prev_ineq = previous_steps[-1].strip().lower()
            if "-" in prev_ineq and (">" in prev_ineq or "<" in prev_ineq):
                if (">" in prev_ineq and ">" in text_clean) or ("<" in prev_ineq and "<" in text_clean):
                    if re.search(r"-\s*\d*[a-z]\s*(>|<)\s*\d+", prev_ineq):
                        return {
                            "error_type": "SIGN_ERROR",
                            "reason": "Lỗi chia số âm trong bất đẳng thức: Quên đảo chiều dấu bất đẳng thức khi chia cho số âm.",
                            "guidance": "💡 Gợi ý: Khi nhân hoặc chia cả hai vế của bất đẳng thức cho một số âm, bắt buộc phải đổi chiều dấu (từ > thành < hoặc ngược lại).",
                        }

        # 4. Kiểm tra lỗi tính toán số học hiển nhiên (CALCULATION_ERROR)
        # Chỉ kiểm tra khi có biểu thức tính số đứng độc lập (không dính biến chữ x^2 hoặc mũ)
        math_matches = re.finditer(r"(?<![\^a-zA-Z0-9])(\d+)\s*([\+\-\*\/])\s*(\d+)\s*=\s*(-?\d+)(?![a-zA-Z])", text_clean)
        for m in math_matches:
            n1 = int(m.group(1))
            op = m.group(2)
            n2 = int(m.group(3))
            reported = int(m.group(4))

            actual = None
            if op == "+":
                actual = n1 + n2
            elif op == "-":
                actual = n1 - n2
            elif op == "*":
                actual = n1 * n2
            elif op == "/" and n2 != 0:
                actual = n1 / n2

            if actual is not None and abs(actual - reported) > 1e-6:
                return {
                    "error_type": "CALCULATION_ERROR",
                    "reason": f"Tính toán sai số học: Phép tính {n1} {op} {n2} không bằng {reported}.",
                    "guidance": f"💡 Gợi ý: Hãy nhẩm hoặc đặt phép tính lại cẩn thận cho cụm biểu thức số ở dòng này.",
                }

        # 6. Kiểm tra quy tắc ngôn ngữ Tiếng Anh (Môn TIENG_ANH)
        # Nhận diện dòng lời giải bắt đầu bằng dấu gạch đầu dòng '-', '->', '=>' hoặc ':'
        if (subject or "").upper() == "TIENG_ANH":
            m_en = re.search(r"^(?:-|\+|->|=>|:)\s*(.+)$", text_clean)
            en_ans = m_en.group(1).strip() if m_en else text_clean
            q_en = (question_content or "").lower()
            if "(go)" in q_en and any(t in q_en for t in ["yesterday", "last", "ago", "in 20"]):
                if "goed" in en_ans:
                    return {
                        "error_type": "GRAMMAR_ERROR",
                        "reason": "Sai dạng quá khứ: Động từ bất quy tắc 'go' có dạng quá khứ V2 là 'went', không chia theo quy tắc thêm -ed ('goed').",
                        "guidance": "💡 Gợi ý: Tra cứu bảng động từ bất quy tắc cho động từ 'go' ở thì Quá khứ đơn.",
                    }
                elif "go" == en_ans or "goes" == en_ans:
                    return {
                        "error_type": "GRAMMAR_ERROR",
                        "reason": "Chưa chia thì quá khứ: Trong câu có dấu hiệu thời gian quá khứ, động từ 'go' cần chia ở thì Quá khứ đơn.",
                        "guidance": "💡 Gợi ý: Chuyển động từ 'go' sang dạng quá khứ thích hợp.",
                    }

        # 7. Kiểm tra bài giải Sinh học (Môn SINH_HOC / BIO)
        # Nhận diện dòng lời giải bắt đầu bằng dấu '-', '+', '->'
        if (subject or "").upper() in ["SINH_HOC", "BIO"]:
            q_bio = (question_content or "").lower()
            m_bio = re.search(r"^(?:-|\+|->|=>)\s*(.+)$", text_clean)
            bio_ans = m_bio.group(1).strip() if m_bio else text_clean
            if "aa x aa" in q_bio and "f1" in bio_ans:
                # Phép lai Aa x Aa: tỉ lệ đúng 1 AA : 2 Aa : 1 aa
                if "1 aa : 1 aa" in bio_ans and "2 aa" not in bio_ans:
                    return {
                        "error_type": "CONCEPTUAL_ERROR",
                        "reason": "Sai tỉ lệ phân li kiểu gen F1: Phép lai thể dị hợp Aa x Aa cho tỉ lệ 1 AA : 2 Aa : 1 aa.",
                        "guidance": "💡 Gợi ý: Lập khung Punnett 2x2 để kết hợp giao tử đực và cái chính xác.",
                    }

        # 8. Kiểm chứng tương đương toán học tổng quát (Đa thức, Lượng giác, Đạo hàm, Phương trình)
        math_err, _ = cls._verify_math_step_equivalence(
            current_text=current_text,
            previous_steps=previous_steps,
            question_content=question_content,
        )
        if math_err is not None:
            return math_err

        return None

    @classmethod
    def sanitize_guidance_no_leak(cls, guidance: Optional[str], target_answer: Optional[str]) -> Optional[str]:
        """
        Bảo đảm tuyệt đối không rò rỉ đáp án cuối cùng trong gợi ý:
        Loại bỏ các cụm từ khẳng định đáp số (ví dụ: 'đáp án là x = 5', 'nghiệm là 2').
        """
        if not guidance:
            return guidance

        cleaned = guidance
        if target_answer:
            target_str = str(target_answer).strip()
            # Xóa cụm target_answer nếu có trong gợi ý
            if target_str.lower() in cleaned.lower():
                cleaned = re.sub(re.escape(target_str), "[đáp số cần tìm]", cleaned, flags=re.IGNORECASE)

        # Loại bỏ các cụm tiết lộ đáp số
        cleaned = re.sub(r"(?:kết quả|đáp số|nghiệm cuối cùng)\s*(?:là|=)\s*[^,.\n]+", "hãy tự tính toán kết quả", cleaned, flags=re.IGNORECASE)
        return cleaned

    @classmethod
    def evaluate_essay_step(
        cls,
        question_id: str,
        step_number: int,
        written_text: str,
        previous_steps: Optional[List[str]] = None,
        question_content: Optional[str] = None,
        subject: str = "TOAN",
        target_answer: Optional[str] = None,
        line_bounding_box: Optional[Dict[str, Any]] = None,
    ) -> GradeEssayStepResponse:
        """
        Chấm từng bước giải tự luận toán/lý/hóa realtime theo từng dòng viết tay.
        - Bước đúng: Đánh dấu tích xanh (GREEN_CHECK, #16a34a, icon '✓').
        - Dòng sai hoặc nhầm công thức: Đánh dấu gạch chân đỏ (RED_UNDERLINE, #dc2626, icon '✕'),
          chỉ rõ lý do sai và hiện gợi ý sửa mà TUYỆT ĐỐI KHÔNG LỘ ĐÁP ÁN CUỐI.
        """
        prev = previous_steps or []
        error_info = cls.detect_step_error(
            current_text=written_text,
            previous_steps=prev,
            question_content=question_content,
            subject=subject,
            target_answer=target_answer,
        )

        # Mặc định tọa độ vẽ trên canvas nếu client chưa truyền
        default_box = line_bounding_box or {
            "left": 50,
            "top": 50 + (step_number - 1) * 36,
            "width": max(200, len(written_text) * 12),
            "height": 28,
        }

        if error_info is None:
            # Bước biến đổi ĐÚNG: Tích xanh
            canvas_annot = {
                "step_number": step_number,
                "type": "green_check",
                "color": "#16a34a",
                "icon": "✓",
                "left": default_box.get("left", 50) - 30,
                "top": default_box.get("top", 50),
                "tooltip": f"Bước {step_number}: Biến đổi logic chính xác.",
            }
            return GradeEssayStepResponse(
                step_number=step_number,
                written_text=written_text,
                is_step_correct=True,
                status="CORRECT",
                icon="✓",
                badge_color="#16a34a",
                decoration_type="GREEN_CHECK",
                has_math_error=False,
                error_type=None,
                feedback=f"Bước {step_number} biến đổi logic chính xác.",
                guidance="Rất tốt! Hãy tiếp tục triển khai bước giải tiếp theo.",
                no_leak_guarantee=True,
                canvas_annotation=canvas_annot,
            )
        else:
            # Dòng tính SAI hoặc NHẦM CÔNG THỨC: Gạch chân đỏ
            safe_guidance = cls.sanitize_guidance_no_leak(
                error_info.get("guidance", "Hãy kiểm tra lại phép biến đổi ở dòng này."),
                target_answer=target_answer,
            )
            canvas_annot = {
                "step_number": step_number,
                "type": "red_underline",
                "color": "#dc2626",
                "icon": "✕",
                "left": default_box.get("left", 50),
                "top": default_box.get("top", 50) + default_box.get("height", 24),
                "width": default_box.get("width", 300),
                "tooltip": f"⚠️ Lỗi dòng {step_number}: {error_info.get('reason')}",
                "guidance": safe_guidance,
            }
            return GradeEssayStepResponse(
                step_number=step_number,
                written_text=written_text,
                is_step_correct=False,
                status="INCORRECT",
                icon="✕",
                badge_color="#dc2626",
                decoration_type="RED_UNDERLINE",
                has_math_error=True,
                error_type=error_info.get("error_type", "FORMULA_ERROR"),
                feedback=f"⚠️ Dòng {step_number} phát hiện lỗi: {error_info.get('reason')}",
                guidance=safe_guidance,
                no_leak_guarantee=True,
                canvas_annotation=canvas_annot,
            )

    @classmethod
    def evaluate_essay_solution(
        cls,
        question_id: str,
        steps: Optional[List[str]] = None,
        raw_text: Optional[str] = None,
        question_content: Optional[str] = None,
        subject: str = "TOAN",
        target_answer: Optional[str] = None,
    ) -> GradeEssaySolutionResponse:
        """
        Chấm toàn bộ lời giải tự luận gồm nhiều dòng viết tay.
        Duyệt từng bước, đánh dấu tích xanh hoặc gạch chân đỏ tương ứng.
        """
        step_lines: List[str] = []
        if steps:
            step_lines = [s.strip() for s in steps if s.strip()]
        elif raw_text:
            step_lines = [line.strip() for line in raw_text.splitlines() if line.strip()]

        if not step_lines:
            return GradeEssaySolutionResponse(
                question_id=question_id,
                total_steps=0,
                correct_steps=0,
                incorrect_steps=0,
                steps_evaluation=[],
                has_any_error=False,
                first_error_step=None,
                overall_feedback="Chưa có bước giải nào được nhập để chấm.",
                score=0.0,
            )

        # Tự động bóc tách Đề bài & Lời giải thông minh nếu dòng 1 là Đề và dòng 2+ là Giải
        effective_question = question_content
        if not effective_question and len(step_lines) >= 2:
            first_line = step_lines[0].lower().strip()
            second_line = step_lines[1].lower().strip()
            if re.match(r"^(?:=|-|\+|->|=>|buoc|bước|ta có)", second_line) and not re.match(r"^(?:=|-|\+|->|=>|buoc|bước)", first_line):
                effective_question = step_lines[0]
                step_lines = step_lines[1:]

        evaluations: List[GradeEssayStepResponse] = []
        prev_accumulated: List[str] = []
        first_err: Optional[int] = None

        for idx, line in enumerate(step_lines, start=1):
            step_res = cls.evaluate_essay_step(
                question_id=question_id,
                step_number=idx,
                written_text=line,
                previous_steps=prev_accumulated,
                question_content=effective_question,
                subject=subject,
                target_answer=target_answer,
            )
            evaluations.append(step_res)
            if not step_res.is_step_correct and first_err is None:
                first_err = idx
            prev_accumulated.append(line)

        correct_count = sum(1 for e in evaluations if e.is_step_correct)
        incorrect_count = len(evaluations) - correct_count
        has_error = incorrect_count > 0

        if not has_error:
            feedback = "Toàn bộ các bước giải đều hoàn hảo! Lập luận chặt chẽ và chính xác."
            score = 10.0
        else:
            feedback = f"Bài giải có {incorrect_count} bước cần lưu ý. Hãy xem gợi ý gạch chân đỏ tại dòng {first_err} để chỉnh sửa mà không cần xem đáp án cuối."
            score = max(0.0, round((correct_count / len(evaluations)) * 10.0, 1))

        return GradeEssaySolutionResponse(
            question_id=question_id,
            total_steps=len(evaluations),
            correct_steps=correct_count,
            incorrect_steps=incorrect_count,
            steps_evaluation=evaluations,
            has_any_error=has_error,
            first_error_step=first_err,
            overall_feedback=feedback,
            score=score,
        )

    @classmethod
    async def _gemini_verify_unparsed_steps(
        cls,
        effective_question: Optional[str],
        step_lines: List[str],
        unverified_indices: List[int],
        subject: str = "TOAN",
    ) -> Dict[int, Dict[str, str]]:
        """
        Dùng Gemini 2.5/3.5 Flash để kiểm chứng các bước lời giải tự luận dạng chữ / Lý / Hóa / Sinh / Anh
        chưa thể phân tích bằng bộ AST toán học thuần túy. Đảm bảo tuyệt đối không lộ đáp án cuối.
        """
        if not unverified_indices or "pytest" in sys.modules:
            return {}
        try:
            from app.ai.gemini_service import gemini_service
            if not gemini_service.ensure_configured():
                return {}
        except Exception:
            return {}

        prompt_obj = {
            "task": "Chấm tính đúng/sai cho từng bước giải của học sinh. TUYỆT ĐỐI KHÔNG tiết lộ đáp số hay kết quả đúng trong reason/guidance.",
            "subject": subject,
            "question": effective_question or "(Không có đề bài riêng, bước 1 là ngữ cảnh)",
            "all_steps": [{"step_number": i + 1, "text": s} for i, s in enumerate(step_lines)],
            "steps_to_check": [i + 1 for i in unverified_indices],
            "output_schema": {
                "errors": [
                    {
                        "step_number": 1,
                        "error_type": "FORMULA_ERROR | CALCULATION_ERROR | SIGN_ERROR | GRAMMAR_ERROR | CONCEPTUAL_ERROR",
                        "reason": "Giải thích ngắn gọn vì sao bước này sai (tiếng Việt, không nêu đáp số đúng)",
                        "guidance": "💡 Gợi ý: Hướng dẫn cách tự kiểm tra và sửa lại (tiếng Việt, không lộ đáp án)",
                    }
                ]
            },
        }
        prompt_text = (
            "Bạn là giáo viên chấm bài tự luận nghiêm ngặt. Hãy kiểm tra các bước trong `steps_to_check`.\n"
            "Nếu bước giải ĐÚNG, không đưa vào mảng `errors`. Nếu bước giải SAI (sai công thức, sai hóa trị/cân bằng phương trình, "
            "sai ngữ pháp, sai lập luận hoặc tính toán sai), hãy thêm vào mảng `errors`.\n"
            "Chỉ trả về JSON hợp lệ theo `output_schema`:\n"
            + json.dumps(prompt_obj, ensure_ascii=False)
        )

        raw_json = ""
        try:
            if getattr(gemini_service, "_client_type", None) == "httpx-v1beta":
                raw_json = await gemini_service.generate_text_with_pool(
                    prompt_text,
                    json_mode=True,
                    max_tokens=500,
                    timeout=6.5,
                )
            elif gemini_service._client_type == "google-genai" and gemini_service.client is not None:
                gen_cfg = None
                try:
                    from google.genai import types
                    cfg_kw: Dict[str, Any] = {
                        "response_mime_type": "application/json",
                        "temperature": 0.0,
                        "max_output_tokens": 500,
                    }
                    if hasattr(types, "ThinkingConfig"):
                        try:
                            cfg_kw["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
                        except Exception:
                            pass
                    gen_cfg = types.GenerateContentConfig(**cfg_kw)
                except Exception:
                    gen_cfg = None

                if hasattr(gemini_service.client, "aio") and hasattr(gemini_service.client.aio, "models"):
                    resp = await asyncio.wait_for(
                        gemini_service.client.aio.models.generate_content(
                            model=mod,
                            contents=prompt_text,
                            config=gen_cfg,
                        ),
                        timeout=5.5,
                    )
                else:
                    resp = await asyncio.wait_for(
                        asyncio.to_thread(
                            gemini_service.client.models.generate_content,
                            model=mod,
                            contents=prompt_text,
                            config=gen_cfg,
                        ),
                        timeout=5.5,
                    )
                raw_json = (resp.text or "").strip()
        except Exception as exc:
            logger.debug(f"Bỏ qua Gemini essay fallback (giữ kết quả deterministic): {exc}")
            return {}

        if not raw_json:
            return {}

        try:
            cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_json.strip(), flags=re.IGNORECASE)
            parsed = json.loads(cleaned)
            err_list = parsed.get("errors", []) if isinstance(parsed, dict) else []
            out: Dict[int, Dict[str, str]] = {}
            for item in err_list:
                if not isinstance(item, dict):
                    continue
                s_num = int(item.get("step_number", 0))
                reason = str(item.get("reason", "")).strip()
                guidance = str(item.get("guidance", "")).strip()
                if s_num >= 1 and reason:
                    if not guidance.startswith("💡"):
                        guidance = f"💡 Gợi ý: {guidance or 'Hãy kiểm tra lại công thức và phép biến đổi ở dòng này.'}"
                    out[s_num] = {
                        "error_type": str(item.get("error_type") or "CONCEPTUAL_ERROR"),
                        "reason": reason,
                        "guidance": guidance,
                    }
            return out
        except Exception:
            return {}

    @classmethod
    async def evaluate_essay_step_async(
        cls,
        question_id: str,
        step_number: int,
        written_text: str,
        previous_steps: Optional[List[str]] = None,
        question_content: Optional[str] = None,
        subject: str = "TOAN",
        target_answer: Optional[str] = None,
        line_bounding_box: Optional[Dict[str, Any]] = None,
    ) -> GradeEssayStepResponse:
        sync_res = cls.evaluate_essay_step(
            question_id=question_id,
            step_number=step_number,
            written_text=written_text,
            previous_steps=previous_steps,
            question_content=question_content,
            subject=subject,
            target_answer=target_answer,
            line_bounding_box=line_bounding_box,
        )
        if not sync_res.is_step_correct:
            return sync_res

        prev = previous_steps or []
        _, verified_math = cls._verify_math_step_equivalence(
            current_text=written_text,
            previous_steps=prev,
            question_content=question_content,
        )
        if verified_math:
            return sync_res

        all_lines = [*prev, written_text]
        ai_errs = await cls._gemini_verify_unparsed_steps(
            effective_question=question_content,
            step_lines=all_lines,
            unverified_indices=[len(all_lines) - 1],
            subject=subject,
        )
        err_info = ai_errs.get(len(all_lines))
        if not err_info:
            return sync_res

        safe_guidance = cls.sanitize_guidance_no_leak(err_info["guidance"], target_answer=target_answer)
        safe_reason = cls.sanitize_guidance_no_leak(err_info["reason"], target_answer=target_answer) or err_info["reason"]
        default_box = line_bounding_box or {
            "left": 50,
            "top": 50 + (step_number - 1) * 36,
            "width": max(200, len(written_text) * 12),
            "height": 28,
        }
        return GradeEssayStepResponse(
            step_number=step_number,
            written_text=written_text,
            is_step_correct=False,
            status="INCORRECT",
            icon="✕",
            badge_color="#dc2626",
            decoration_type="RED_UNDERLINE",
            has_math_error=True,
            error_type=err_info["error_type"],
            feedback=f"⚠️ Dòng {step_number} phát hiện lỗi: {safe_reason}",
            guidance=safe_guidance,
            no_leak_guarantee=True,
            canvas_annotation={
                "step_number": step_number,
                "type": "red_underline",
                "color": "#dc2626",
                "icon": "✕",
                "left": default_box.get("left", 50),
                "top": default_box.get("top", 50) + default_box.get("height", 24),
                "width": default_box.get("width", 300),
                "tooltip": f"⚠️ Lỗi dòng {step_number}: {safe_reason}",
                "guidance": safe_guidance,
            },
        )

    @classmethod
    async def evaluate_essay_solution_async(
        cls,
        question_id: str,
        steps: Optional[List[str]] = None,
        raw_text: Optional[str] = None,
        question_content: Optional[str] = None,
        subject: str = "TOAN",
        target_answer: Optional[str] = None,
    ) -> GradeEssaySolutionResponse:
        sync_sol = cls.evaluate_essay_solution(
            question_id=question_id,
            steps=steps,
            raw_text=raw_text,
            question_content=question_content,
            subject=subject,
            target_answer=target_answer,
        )
        if not sync_sol.steps_evaluation:
            return sync_sol

        effective_question = question_content
        step_lines = [ev.written_text for ev in sync_sol.steps_evaluation]
        raw_input_lines = (
            [s.strip() for s in steps if s.strip()]
            if steps
            else [line.strip() for line in (raw_text or "").splitlines() if line.strip()]
        )
        if not effective_question and len(raw_input_lines) == len(step_lines) + 1:
            effective_question = raw_input_lines[0]

        unverified_indices: List[int] = []
        prev_acc: List[str] = []
        for idx, ev in enumerate(sync_sol.steps_evaluation):
            if ev.is_step_correct:
                _, verified_math = cls._verify_math_step_equivalence(
                    current_text=ev.written_text,
                    previous_steps=prev_acc,
                    question_content=effective_question,
                )
                if not verified_math:
                    unverified_indices.append(idx)
            prev_acc.append(ev.written_text)

        if not unverified_indices:
            return sync_sol

        ai_errs = await cls._gemini_verify_unparsed_steps(
            effective_question=effective_question,
            step_lines=step_lines,
            unverified_indices=unverified_indices,
            subject=subject,
        )
        if not ai_errs:
            return sync_sol

        updated_evals: List[GradeEssayStepResponse] = []
        for idx, ev in enumerate(sync_sol.steps_evaluation, start=1):
            err_info = ai_errs.get(idx)
            if ev.is_step_correct and err_info:
                safe_guidance = cls.sanitize_guidance_no_leak(err_info["guidance"], target_answer=target_answer)
                safe_reason = cls.sanitize_guidance_no_leak(err_info["reason"], target_answer=target_answer) or err_info["reason"]
                updated_evals.append(
                    GradeEssayStepResponse(
                        step_number=idx,
                        written_text=ev.written_text,
                        is_step_correct=False,
                        status="INCORRECT",
                        icon="✕",
                        badge_color="#dc2626",
                        decoration_type="RED_UNDERLINE",
                        has_math_error=True,
                        error_type=err_info["error_type"],
                        feedback=f"⚠️ Dòng {idx} phát hiện lỗi: {safe_reason}",
                        guidance=safe_guidance,
                        no_leak_guarantee=True,
                        canvas_annotation={
                            "step_number": idx,
                            "type": "red_underline",
                            "color": "#dc2626",
                            "icon": "✕",
                            "left": 50,
                            "top": 50 + (idx - 1) * 36 + 28,
                            "width": max(200, len(ev.written_text) * 12),
                            "tooltip": f"⚠️ Lỗi dòng {idx}: {safe_reason}",
                            "guidance": safe_guidance,
                        },
                    )
                )
            else:
                updated_evals.append(ev)

        correct_count = sum(1 for e in updated_evals if e.is_step_correct)
        incorrect_count = len(updated_evals) - correct_count
        has_error = incorrect_count > 0
        first_err = next((e.step_number for e in updated_evals if not e.is_step_correct), None)
        if not has_error:
            feedback = "Toàn bộ các bước giải đều hoàn hảo! Lập luận chặt chẽ và chính xác."
            score = 10.0
        else:
            feedback = f"Bài giải có {incorrect_count} bước cần lưu ý. Hãy xem gợi ý gạch chân đỏ tại dòng {first_err} để chỉnh sửa mà không cần xem đáp án cuối."
            score = max(0.0, round((correct_count / len(updated_evals)) * 10.0, 1))

        return GradeEssaySolutionResponse(
            question_id=question_id,
            total_steps=len(updated_evals),
            correct_steps=correct_count,
            incorrect_steps=incorrect_count,
            steps_evaluation=updated_evals,
            has_any_error=has_error,
            first_error_step=first_err,
            overall_feedback=feedback,
            score=score,
        )


grading_service = GradingService()
