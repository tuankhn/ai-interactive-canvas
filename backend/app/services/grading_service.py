from typing import Any, Dict, List, Optional
import re
import uuid
from datetime import datetime
from app.schemas.quiz import (
    GradeMCQResponse,
    GradeEssayStepResponse,
    GradeEssaySolutionResponse,
)


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
    def analyze_distractor(
        cls,
        selected_label: str,
        correct_label: str,
        subject: str = "TOAN",
        question_content: Optional[str] = None,
        custom_distractor_map: Optional[Dict[str, str]] = None,
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
        - Tính sai số học (phép cộng/trừ/nhân/chia nhẩm sai)
        - Vi phạm điều kiện xác định
        Trả về dict {error_type, reason, guidance} hoặc None nếu bước biến đổi hợp lệ.
        """
        text = current_text.strip()
        text_clean = re.sub(r"\s+", " ", text.lower())

        # Hỗ trợ học sinh viết dòng bắt đầu bằng '=' liên kết với bước trước hoặc đề bài
        chained_text = text_clean
        if text_clean.startswith("=") and (previous_steps or question_content):
            anchor = (previous_steps[-1] if previous_steps else question_content or "").strip().lower()
            chained_text = f"{anchor} {text_clean}"

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


grading_service = GradingService()
