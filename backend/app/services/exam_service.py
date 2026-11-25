import io
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple
from app.core.database import in_memory_exam_answer_keys


class ExamService:
    """
    Dịch vụ bóc tách đề thi từ DOCX/PDF/Văn bản thô và quản lý chế độ hiển thị Học sinh / Giáo viên.
    Nhiệm vụ: Task TF28517 - Sprint 3 (Nguyễn Ngọc Gia Bảo 2 - N25DTCN121).
    """

    QUESTION_SPLIT_REGEX = re.compile(
        r"(?:^|\n)\s*(?:Câu|Bài|Question)\s*(\d+)[:.]\s*(.*?)(?=(?:\n\s*(?:Câu|Bài|Question)\s*\d+[:.]|$))",
        re.DOTALL | re.IGNORECASE,
    )

    OPTION_REGEX = re.compile(
        r"(?:\n|\s|^)([*•]?\s*\[?[xXvV]?\]?\s*([A-D|a-d])[\.\)]\s*(.*?))(?=(?:\n|\s)[*•]?\s*\[?[xXvV]?\]?\s*[A-D|a-d][\.\)]|$)",
        re.DOTALL,
    )

    ANSWER_KEY_BLOCK_REGEX = re.compile(
        r"(?:Đáp\s*án|Key|Answer)\s*:\s*([A-D])(?![A-Za-zÀ-ỹ])",
        re.IGNORECASE,
    )

    END_ANSWER_TABLE_REGEX = re.compile(
        r"(?:BẢNG\s*ĐÁP\s*ÁN|ĐÁP\s*ÁN\s*CHI\s*TIẾT|ANSWER\s*KEY).*?(\d+)\s*[:.\-]\s*([A-D])",
        re.DOTALL | re.IGNORECASE,
    )

    # -------------------------------------------------------------
    # 1. Bóc tách từ Plain Text (Văn bản thô hoặc viết đề trực tiếp)
    # -------------------------------------------------------------
    def parse_text(self, raw_text: str, title: str = "Đề bài tổng hợp") -> Dict[str, Any]:
        """
        Bóc tách chuỗi văn bản đề thi thành danh sách các câu hỏi có cấu trúc.
        """
        if not raw_text or not raw_text.strip():
            return {
                "title": title,
                "total_questions": 0,
                "questions": [],
                "source_type": "TEXT",
            }

        cleaned_text = raw_text.replace("\r\n", "\n").replace("\r", "\n")

        # Tìm bảng đáp án ở cuối đề nếu có (chỉ quét sau tiêu đề BẢNG ĐÁP ÁN / ĐÁP ÁN CHI TIẾT / ANSWER KEY để không bắt nhầm số trong đề)
        table_keys: Dict[int, str] = {}
        ans_table_header = re.search(
            r"(?:^|\n)\s*(?:BẢNG\s*ĐÁP\s*ÁN|ĐÁP\s*ÁN\s*CHI\s*TIẾT|HƯỚNG\s*DẪN\s*CHẤM|ANSWER\s*KEY)\b[:\s]*(.*)$",
            cleaned_text,
            re.DOTALL | re.IGNORECASE,
        )
        if ans_table_header:
            answer_section_text = ans_table_header.group(1)
            cleaned_text = cleaned_text[:ans_table_header.start()].rstrip()
            for match in re.finditer(r"(?:^|\s|,|;)(\d{1,3})\s*[\.\-:]\s*([A-D])(?=\s|$|,|;)", answer_section_text, re.IGNORECASE):
                q_num = int(match.group(1))
                ans = match.group(2).upper()
                table_keys[q_num] = ans

        matches = list(self.QUESTION_SPLIT_REGEX.finditer(cleaned_text))
        questions: List[Dict[str, Any]] = []

        if matches:
            for idx, match in enumerate(matches, start=1):
                raw_q_num = int(match.group(1)) if match.group(1) else idx
                q_body = match.group(2).strip()
                parsed_q = self._parse_single_question_body(
                    q_num=raw_q_num,
                    body=q_body,
                    external_key=table_keys.get(raw_q_num),
                )
                questions.append(parsed_q)
        else:
            # Trường hợp giáo viên nhập 1 câu hỏi duy nhất không có từ khóa "Câu X"
            parsed_q = self._parse_single_question_body(
                q_num=1,
                body=cleaned_text.strip(),
                external_key=table_keys.get(1),
            )
            questions.append(parsed_q)

        return {
            "title": title,
            "total_questions": len(questions),
            "questions": questions,
            "source_type": "TEXT",
        }

    # -------------------------------------------------------------
    # 2. Bóc tách từ file DOCX (.docx)
    # -------------------------------------------------------------
    def parse_docx(self, file_bytes: bytes, filename: str = "de_thi.docx") -> Dict[str, Any]:
        """
        Đọc và phân tích cấu trúc đề thi từ file DOCX.
        Hỗ trợ nhận diện đáp án đúng bằng định dạng in đậm (bold), gạch chân (underline) của Word run.
        """
        try:
            import docx
            doc = docx.Document(io.BytesIO(file_bytes))
        except Exception as e:
            # Fallback nếu file lỗi hoặc dùng định dạng text
            return self.parse_text(file_bytes.decode("utf-8", errors="ignore"), title=filename)

        full_paragraphs = []
        colored_by_q: Dict[str, set] = {}
        underlined_by_q: Dict[str, set] = {}
        bold_by_q: Dict[str, set] = {}

        current_q_key = "1"
        for p in doc.paragraphs:
            text = p.text.strip()
            if not text:
                continue

            # Kiểm tra xem đoạn này có mở đầu câu hỏi không
            q_match = re.match(r"^(?:Câu|Bài|Question)\s*(\d+)[:.]", text, re.IGNORECASE)
            if q_match:
                current_q_key = q_match.group(1)

            # Quét các run trong paragraph: chỉ coi in đậm/gạch chân/tô màu là đáp án đúng nếu DUY NHẤT 1 phương án trong câu có định dạng đó
            # (Tránh lỗi phổ biến khi đề Word in đậm cả 4 chữ cái A., B., C., D. làm hệ thống tưởng nhầm mọi câu đều đáp án A!)
            for run in p.runs:
                if not run.text:
                    continue
                run_txt = run.text.strip()
                opt_matches = re.findall(r"(?:^|\s|\n)([A-D])[\.\)]", " " + run_txt)
                if not opt_matches:
                    continue

                has_color = False
                try:
                    if run.font and run.font.highlight_color is not None:
                        has_color = True
                    elif run.font and run.font.color and run.font.color.rgb is not None:
                        rgb_hex = str(run.font.color.rgb).upper()
                        if rgb_hex not in ("000000", "222222", "333333", "111111"):
                            has_color = True
                except Exception:
                    has_color = False

                for lbl_raw in opt_matches:
                    lbl = lbl_raw.upper()
                    if has_color:
                        colored_by_q.setdefault(current_q_key, set()).add(lbl)
                    if run.underline:
                        underlined_by_q.setdefault(current_q_key, set()).add(lbl)
                    if run.bold:
                        bold_by_q.setdefault(current_q_key, set()).add(lbl)

            full_paragraphs.append(text)

        bold_options_detected: Dict[str, str] = {}
        all_q_keys = set(colored_by_q) | set(underlined_by_q) | set(bold_by_q)
        for qk in all_q_keys:
            if len(colored_by_q.get(qk, set())) == 1:
                bold_options_detected[qk] = next(iter(colored_by_q[qk]))
            elif len(underlined_by_q.get(qk, set())) == 1:
                bold_options_detected[qk] = next(iter(underlined_by_q[qk]))
            elif len(bold_by_q.get(qk, set())) == 1:
                bold_options_detected[qk] = next(iter(bold_by_q[qk]))

        raw_text = "\n".join(full_paragraphs)
        result = self.parse_text(raw_text, title=filename)
        result["source_type"] = "DOCX"

        # Bổ sung đáp án đúng nhận diện được từ định dạng bold/underline vào câu hỏi
        for q in result["questions"]:
            q_num_str = str(q.get("number", ""))
            if q_num_str in bold_options_detected and not q.get("correct_option"):
                detected_key = bold_options_detected[q_num_str]
                q["correct_option"] = detected_key
                for opt in q.get("options", []):
                    if opt["label"] == detected_key:
                        opt["is_correct"] = True

        return result

    # -------------------------------------------------------------
    # 3. Bóc tách từ file PDF (.pdf)
    # -------------------------------------------------------------
    def parse_pdf(self, file_bytes: bytes, filename: str = "de_thi.pdf") -> Dict[str, Any]:
        """
        Trích xuất văn bản từ file PDF và bóc tách câu hỏi.
        """
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            pages_text = []
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    pages_text.append(extracted)
            raw_text = "\n".join(pages_text)
        except Exception:
            raw_text = file_bytes.decode("utf-8", errors="ignore")

        result = self.parse_text(raw_text, title=filename)
        result["source_type"] = "PDF"
        return result

    async def enrich_missing_answers(
        self,
        exam_data: Dict[str, Any],
        subject: str = "TOAN",
    ) -> Dict[str, Any]:
        """
        Tự động giải và bổ sung đáp án đúng + lời giải cho các câu trắc nghiệm chưa có sẵn đáp án trong tệp đề tải lên:
        - Bước 1: Bộ giải toán tất định tức thời (< 1ms) cho cấu tạo số, phép tính, phương trình tìm x/?, min/max.
        - Bước 2: Gemini AI giải hàng loạt cho các câu hỏi đọc hiểu, lý thuyết hoặc liên môn còn lại.
        """
        from app.services.grading_service import grading_service

        unresolved_for_ai: List[Dict[str, Any]] = []
        for q in exam_data.get("questions", []):
            opts = q.get("options") or []
            if len(opts) < 2 or q.get("correct_option"):
                continue

            det = grading_service.infer_mcq_correct_option_deterministic(q.get("content"), opts)
            if det:
                corr_lbl, det_exp = det
                q["correct_option"] = corr_lbl
                if not q.get("explanation"):
                    q["explanation"] = det_exp
                for opt in opts:
                    opt["is_correct"] = (opt.get("label") == corr_lbl)
            else:
                unresolved_for_ai.append(q)

        if unresolved_for_ai:
            ai_resolved = await grading_service.solve_mcqs_batch_with_ai(unresolved_for_ai, subject=subject)
            for q in unresolved_for_ai:
                hit = ai_resolved.get(str(q.get("id", "")))
                if hit and hit.get("correct_option"):
                    corr_lbl = hit["correct_option"]
                    q["correct_option"] = corr_lbl
                    if not q.get("explanation") and hit.get("explanation"):
                        q["explanation"] = hit["explanation"]
                    for opt in q.get("options", []):
                        opt["is_correct"] = (opt.get("label") == corr_lbl)

        return exam_data

    # -------------------------------------------------------------
    # 4. Tự động ẩn đáp án đúng cho Học sinh (Student Security Mode)
    # -------------------------------------------------------------
    def filter_by_mode(self, exam_data: Dict[str, Any], mode: str = "STUDENT") -> Dict[str, Any]:
        """
        Bảo mật đề thi:
        - Nếu mode == 'STUDENT': Tự động ẩn HOÀN TOÀN đáp án đúng (is_correct=False, correct_option=None, explanation=None).
        - Nếu mode == 'TEACHER': Giữ nguyên toàn bộ đáp án đúng, phân tích lỗi sai và lời giải chi tiết.
        """
        from app.services.grading_service import grading_service

        clean_mode = (mode or "STUDENT").strip().upper()
        is_student = clean_mode == "STUDENT"

        filtered_questions = []
        for q in exam_data.get("questions", []):
            q_copy = dict(q)
            q_id = q.get("id")
            opts = q.get("options") or []
            corr_opt = q.get("correct_option")
            exp_txt = q.get("explanation")

            # Nếu vẫn chưa có đáp án đúng, thử suy luận tất định ngay tại bước lọc
            if not corr_opt and len(opts) >= 2:
                det = grading_service.infer_mcq_correct_option_deterministic(q.get("content"), opts)
                if det:
                    corr_opt, det_exp = det
                    q_copy["correct_option"] = corr_opt
                    if not exp_txt:
                        exp_txt = det_exp
                        q_copy["explanation"] = exp_txt

            if q_id:
                in_memory_exam_answer_keys[q_id] = {
                    "correct_option": corr_opt,
                    "explanation": exp_txt,
                    "content": q.get("content"),
                    "options": [{"label": o.get("label"), "content": o.get("content")} for o in opts],
                }
            if is_student:
                q_copy["correct_option"] = None
                q_copy["explanation"] = None
                filtered_options = []
                for opt in opts:
                    opt_copy = dict(opt)
                    opt_copy["is_correct"] = False
                    opt_copy["wrong_explanation"] = None
                    filtered_options.append(opt_copy)
                q_copy["options"] = filtered_options
            else:
                # Chế độ giáo viên giữ nguyên (và bật cờ is_correct nếu vừa giải được corr_opt)
                filtered_options = []
                for opt in opts:
                    opt_copy = dict(opt)
                    if corr_opt and opt_copy.get("label") == corr_opt:
                        opt_copy["is_correct"] = True
                    filtered_options.append(opt_copy)
                q_copy["options"] = filtered_options

            filtered_questions.append(q_copy)

        return {
            "title": exam_data.get("title", "Đề bài"),
            "mode": clean_mode,
            "total_questions": len(filtered_questions),
            "questions": filtered_questions,
            "source_type": exam_data.get("source_type", "TEXT"),
            "hidden_answers": is_student,
        }

    # -------------------------------------------------------------
    # 5. Dàn câu hỏi lên mặt bảng vẽ (Fabric.js Layout Generator)
    # -------------------------------------------------------------
    def generate_canvas_layout(
        self,
        questions: List[Dict[str, Any]],
        mode: str = "STUDENT",
        questions_per_page: int = 2,
    ) -> Dict[str, Any]:
        """
        Sinh cấu trúc các đối tượng Fabric.js (Textbox, Rect, Group) để frontend dàn trực tiếp lên mặt bảng vẽ.
        Hỗ trợ tự động phân trang (mỗi trang chứa questions_per_page câu hỏi).
        """
        is_student = (mode or "STUDENT").strip().upper() == "STUDENT"
        pages: List[Dict[str, Any]] = []

        # Chia câu hỏi theo từng trang bảng vẽ
        chunks = [
            questions[i:i + questions_per_page]
            for i in range(0, len(questions), questions_per_page)
        ] if questions else [[]]

        for page_idx, chunk in enumerate(chunks):
            page_objects: List[Dict[str, Any]] = []
            current_top = 40

            # Header trang đề thi
            header_text = f"ĐỀ THI TRÊN BẢNG - TRANG {page_idx + 1}/{len(chunks)}"
            badge_text = "Chế độ: Học sinh (Đã ẩn đáp án)" if is_student else "Chế độ: Giáo viên (Hiện đáp án)"
            
            page_objects.append({
                "type": "textbox",
                "text": f"{header_text}  [{badge_text}]",
                "left": 40,
                "top": current_top,
                "fontSize": 15,
                "fontWeight": "bold",
                "fill": "#0284c7" if is_student else "#16a34a",
                "width": 900,
                "selectable": False,
            })
            current_top += 45

            for q in chunk:
                q_num = q.get("number", 1)
                content = q.get("content", "")
                options = q.get("options", [])
                correct_opt = q.get("correct_option")
                explanation = q.get("explanation")

                # Khối đề bài câu hỏi
                q_title = f"Câu {q_num}: {content}"
                page_objects.append({
                    "type": "textbox",
                    "text": q_title,
                    "left": 40,
                    "top": current_top,
                    "fontSize": 18,
                    "fontWeight": "600",
                    "fill": "#172554",
                    "width": 880,
                    "lineHeight": 1.25,
                    "selectable": True,
                    "meta": {
                        "question_id": q.get("id"),
                        "question_number": q_num,
                        "type": "question_title",
                    },
                })
                current_top += 45 + (len(content) // 60) * 22

                # Các phương án lựa chọn A, B, C, D
                if options:
                    opt_top = current_top
                    for opt in options:
                        label = opt.get("label", "A")
                        opt_text = opt.get("content", "")
                        is_corr = opt.get("is_correct", False)

                        # Nếu là Giáo viên, hiển thị rõ đáp án đúng với dấu tích xanh
                        if not is_student and (is_corr or label == correct_opt):
                            display_opt = f"{label}. {opt_text}  ✓ (Đáp án đúng)"
                            color = "#15803d"
                            weight = "bold"
                        else:
                            display_opt = f"{label}. {opt_text}"
                            color = "#334155"
                            weight = "normal"

                        page_objects.append({
                            "type": "textbox",
                            "text": display_opt,
                            "left": 65,
                            "top": opt_top,
                            "fontSize": 16,
                            "fontWeight": weight,
                            "fill": color,
                            "width": 850,
                            "selectable": True,
                            "meta": {
                                "question_id": q.get("id"),
                                "label": label,
                                "type": "answer_option",
                            },
                        })
                        opt_top += 32
                    current_top = opt_top + 15
                else:
                    # Câu hỏi tự luận: chèn khoảng trống viết bài
                    page_objects.append({
                        "type": "textbox",
                        "text": "[Khu vực học sinh làm bài giải tự luận bên dưới...]",
                        "left": 65,
                        "top": current_top,
                        "fontSize": 14,
                        "fontStyle": "italic",
                        "fill": "#94a3b8",
                        "width": 800,
                        "selectable": False,
                    })
                    current_top += 70

                # Lời giải chi tiết (chỉ hiển thị cho Giáo viên)
                if not is_student and explanation:
                    page_objects.append({
                        "type": "textbox",
                        "text": f"💡 Lời giải chi tiết: {explanation}",
                        "left": 65,
                        "top": current_top,
                        "fontSize": 14,
                        "fontStyle": "italic",
                        "fill": "#0369a1",
                        "width": 850,
                        "selectable": True,
                    })
                    current_top += 35

                current_top += 25  # Khoảng cách giữa các câu hỏi

            pages.append({
                "page_index": page_idx,
                "objects": page_objects,
                "background": "#ffffff",
            })

        return {
            "mode": "STUDENT" if is_student else "TEACHER",
            "total_pages": len(pages),
            "pages": pages,
        }

    # -------------------------------------------------------------
    # 6. Mẫu đề thi thử nghiệm (Sample Exams)
    # -------------------------------------------------------------
    def get_sample_exam(self, subject: str = "TOAN") -> str:
        """
        Cung cấp nội dung đề mẫu cho Giáo viên thử nghiệm nhanh.
        """
        samples = {
            "TOAN": (
                "Câu 1: Giá trị của lim(1/n) khi n dần tới vô cùng là bao nhiêu?\n"
                "A. 1\n"
                "*B. 0\n"
                "C. Vô cùng\n"
                "D. Không tồn tại\n"
                "Lời giải: Theo định nghĩa giới hạn cơ bản của dãy số, lim(1/n) = 0 khi n -> vô cùng.\n\n"
                "Câu 2: Đạo hàm của hàm số y = x^2 + 3x là:\n"
                "*A. y' = 2x + 3\n"
                "B. y' = x + 3\n"
                "C. y' = 2x\n"
                "D. y' = 3x^2\n"
                "Đáp án: A\n"
                "Hướng dẫn giải: Áp dụng công thức (x^n)' = n*x^(n-1), ta có (x^2)' = 2x và (3x)' = 3.\n\n"
                "Câu 3: Giải phương trình 2x - 4 = 0.\n"
                "Đáp án: x = 2.\n"
            ),
            "VAT_LY": (
                "Câu 1: Gia tốc trọng trường g tại mặt đất xấp xỉ bằng bao nhiêu?\n"
                "A. 8.9 m/s^2\n"
                "*B. 9.8 m/s^2\n"
                "C. 12 m/s^2\n"
                "D. 1.6 m/s^2\n"
                "Đáp án: B\n"
                "Lời giải: Gia tốc rơi tự do tiêu chuẩn gần mặt đất xấp xỉ g = 9.8 m/s^2.\n\n"
                "Câu 2: Công thức tính động năng của một vật khối lượng m vận tốc v là:\n"
                "*A. Wd = 1/2 * m * v^2\n"
                "B. Wd = m * v\n"
                "C. Wd = 2 * m * v^2\n"
                "D. Wd = m * g * h\n"
                "Đáp án: A\n"
                "Lời giải: Động năng của vật chuyển động bằng một nửa tích khối lượng và bình phương vận tốc.\n\n"
                "Câu 3: Theo định luật II Newton, vật m = 2 kg chịu hợp lực F = 10 N thu gia tốc bằng:\n"
                "A. 20 m/s^2\n"
                "B. 0.2 m/s^2\n"
                "*C. 5 m/s^2\n"
                "D. 8 m/s^2\n"
                "Đáp án: C\n"
            ),
            "HOA_HOC": (
                "Câu 1: Phân tử khí Metan (CH4) có dạng hình học không gian nào sau đây?\n"
                "A. Đường thẳng\n"
                "B. Gấp khúc chữ V\n"
                "*C. Tứ diện đều\n"
                "D. Tam giác phẳng\n"
                "Đáp án: C\n"
                "Lời giải: Nguyên tử C lai hóa sp3 liên kết với 4 nguyên tử H tạo góc 109.5 độ dạng tứ diện đều.\n\n"
                "Câu 2: Đốt cháy hoàn toàn 1 mol CH4 cần tối thiểu bao nhiêu mol khí O2 (CH4 + 2O2 -> CO2 + 2H2O)?\n"
                "A. 1 mol\n"
                "*B. 2 mol\n"
                "C. 3 mol\n"
                "D. 4 mol\n"
                "Đáp án: B\n"
                "Lời giải: Theo phương trình cân bằng CH4 + 2O2 -> CO2 + 2H2O, tỉ lệ mol CH4 : O2 là 1 : 2.\n\n"
                "Câu 3: Dung dịch có giá trị pH = 2 mang môi trường gì?\n"
                "*A. Môi trường axit mạnh\n"
                "B. Môi trường trung tính\n"
                "C. Môi trường kiềm yếu\n"
                "D. Môi trường kiềm mạnh\n"
                "Đáp án: A\n\n"
                "Câu 4: Cho 5.6 gam sắt (Fe = 56) tác dụng hết với dung dịch HCl dư. Tính số mol khí H2 thu được.\n"
                "Đáp án: n_H2 = 0.1 mol.\n"
            ),
            "TIENG_ANH": (
                "Question 1: Choose the word whose underlined part is pronounced differently:\n"
                "A. cat\n"
                "B. hat\n"
                "*C. car\n"
                "D. fat\n"
                "Answer: C\n"
                "Explanation: 'car' has the /ɑː/ vowel sound while 'cat', 'hat', and 'fat' have /æ/.\n\n"
                "Question 2: She _____ to school by bus every morning.\n"
                "*A. goes\n"
                "B. go\n"
                "C. going\n"
                "D. went\n"
                "Answer: A\n\n"
                "Question 3: Plants use sunlight, water, and CO2 to produce oxygen through _____.\n"
                "A. evaporation\n"
                "*B. photosynthesis\n"
                "C. gravity\n"
                "D. distillation\n"
                "Answer: B\n"
            )
        }
        aliases = {
            "MATH": "TOAN",
            "PHYS": "VAT_LY",
            "PHYSICS": "VAT_LY",
            "CHEM": "HOA_HOC",
            "CHEMISTRY": "HOA_HOC",
            "HOA": "HOA_HOC",
            "LY": "VAT_LY",
            "ENG": "TIENG_ANH",
            "ENGLISH": "TIENG_ANH",
            "ANH": "TIENG_ANH",
        }
        norm_key = aliases.get((subject or "TOAN").strip().upper(), (subject or "TOAN").strip().upper())
        return samples.get(norm_key, samples["TOAN"])

    # -------------------------------------------------------------
    # Helper nội bộ bóc tách 1 câu hỏi
    # -------------------------------------------------------------
    def _parse_single_question_body(
        self,
        q_num: int,
        body: str,
        external_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Bóc tách thân câu hỏi thành: nội dung câu hỏi, danh sách lựa chọn A/B/C/D, đáp án đúng và lời giải.
        """
        detected_correct: Optional[str] = external_key.upper() if external_key else None
        explanation: Optional[str] = None

        # Kiểm tra đáp án ghi chú cuối câu (VD: "Đáp án: A", "Key: B") — không ghi đè bảng đáp án cuối đề (H13)
        ans_match = self.ANSWER_KEY_BLOCK_REGEX.search(body)
        if ans_match and not detected_correct:
            detected_correct = ans_match.group(1).upper()

        # Kiểm tra phần lời giải
        exp_match = re.search(r"(?:Lời\s*giải|Hướng\s*dẫn\s*giải|Explanation)[:\s]*(.*?)$", body, re.DOTALL | re.IGNORECASE)
        if exp_match:
            explanation = exp_match.group(1).strip()
            # Cắt bỏ phần lời giải khỏi nội dung chính để tránh lẫn vào phương án
            body = body[:exp_match.start()].strip()

        # Tìm các phương án A, B, C, D
        raw_options = []
        first_opt_idx = len(body)

        # Quét vị trí xuất hiện của các phương án
        opt_matches = list(re.finditer(
            r"(?:^|\n|\s)([*•]?\s*\[?[xXvV]?\]?\s*([A-D|a-d])[\.\)])\s*(.*?)(?=(?:(?:\n|\s)[*•]?\s*\[?[xXvV]?\]?\s*[A-D|a-d][\.\)])|$)",
            body,
            re.DOTALL
        ))

        if opt_matches:
            first_opt_idx = opt_matches[0].start()
            for m in opt_matches:
                full_prefix = m.group(1)
                lbl = m.group(2).upper()
                opt_content = m.group(3).strip()

                # Cắt bỏ dòng "Đáp án:" nếu vô tình lọt vào cuối option
                opt_content = re.sub(r"\n\s*(?:Đáp\s*án|Key|Answer).*?$", "", opt_content, flags=re.IGNORECASE).strip()

                # Nhận diện đánh dấu đúng qua ký hiệu '*', '[x]', '[v]'
                has_mark = ("*" in full_prefix) or ("[x]" in full_prefix.lower()) or ("[v]" in full_prefix.lower())
                if has_mark and not detected_correct:
                    detected_correct = lbl

                raw_options.append({
                    "label": lbl,
                    "content": opt_content,
                    "is_correct": False,
                    "wrong_explanation": None,
                })

        question_content = body[:first_opt_idx].strip()
        question_content = re.sub(r"\n\s*(?:Đáp\s*án|Key|Answer).*?$", "", question_content, flags=re.IGNORECASE).strip()

        # Nếu tìm được đáp án đúng, gắn is_correct = True cho phương án đó
        if detected_correct and raw_options:
            for opt in raw_options:
                if opt["label"] == detected_correct:
                    opt["is_correct"] = True

        q_type = "MCQ" if len(raw_options) >= 2 else "ESSAY"

        return {
            "id": str(uuid.uuid4()),
            "number": q_num,
            "content": question_content,
            "question_type": q_type,
            "correct_option": detected_correct,
            "explanation": explanation,
            "options": raw_options,
        }


exam_service = ExamService()
