import io
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple


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
        r"(?:Đáp\s*án|Key|Answer|Lời\s*giải|Hướng\s*dẫn\s*giải)[:\s]*([A-D])",
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

        # Tìm bảng đáp án ở cuối đề nếu có (ví dụ: 1.A 2.B 3.C ...)
        table_keys: Dict[int, str] = {}
        for match in re.finditer(r"(?:^|\s)(\d{1,3})\s*[\.\-:]\s*([A-D])(?:\s|$|,|;)", cleaned_text, re.IGNORECASE):
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
        bold_options_detected: Dict[str, str] = {}  # { "Câu 1": "A" }

        current_q_key = "1"
        for p in doc.paragraphs:
            text = p.text.strip()
            if not text:
                continue

            # Kiểm tra xem đoạn này có mở đầu câu hỏi không
            q_match = re.match(r"^(?:Câu|Bài|Question)\s*(\d+)[:.]", text, re.IGNORECASE)
            if q_match:
                current_q_key = q_match.group(1)

            # Quét các run trong paragraph để tìm run in đậm hoặc gạch chân (thường là đáp án đúng của GV)
            for run in p.runs:
                if (run.bold or run.underline) and run.text:
                    run_txt = run.text.strip()
                    opt_match = re.search(r"\b([A-D])[\.\)]", run_txt)
                    if opt_match and current_q_key not in bold_options_detected:
                        bold_options_detected[current_q_key] = opt_match.group(1).upper()

            full_paragraphs.append(text)

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

    # -------------------------------------------------------------
    # 4. Tự động ẩn đáp án đúng cho Học sinh (Student Security Mode)
    # -------------------------------------------------------------
    def filter_by_mode(self, exam_data: Dict[str, Any], mode: str = "STUDENT") -> Dict[str, Any]:
        """
        Bảo mật đề thi:
        - Nếu mode == 'STUDENT': Tự động ẩn HOÀN TOÀN đáp án đúng (is_correct=False, correct_option=None, explanation=None).
        - Nếu mode == 'TEACHER': Giữ nguyên toàn bộ đáp án đúng, phân tích lỗi sai và lời giải chi tiết.
        """
        clean_mode = (mode or "STUDENT").strip().upper()
        is_student = clean_mode == "STUDENT"

        filtered_questions = []
        for q in exam_data.get("questions", []):
            q_copy = dict(q)
            if is_student:
                q_copy["correct_option"] = None
                q_copy["explanation"] = None
                filtered_options = []
                for opt in q.get("options", []):
                    opt_copy = dict(opt)
                    opt_copy["is_correct"] = False
                    opt_copy["wrong_explanation"] = None
                    filtered_options.append(opt_copy)
                q_copy["options"] = filtered_options
            else:
                # Chế độ giáo viên giữ nguyên
                filtered_options = [dict(opt) for opt in q.get("options", [])]
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
                "Đáp án: B\n\n"
                "Câu 2: Công thức tính động năng của một vật khối lượng m vận tốc v là:\n"
                "*A. Wd = 1/2 * m * v^2\n"
                "B. Wd = m * v\n"
                "C. Wd = 2 * m * v^2\n"
                "D. Wd = m * g * h\n"
                "Đáp án: A\n"
            ),
            "TIENG_ANH": (
                "Question 1: Choose the word whose underlined part is pronounced differently:\n"
                "A. cat\n"
                "B. hat\n"
                "*C. car\n"
                "D. fat\n"
                "Answer: C\n\n"
                "Question 2: She _____ to school by bus every morning.\n"
                "*A. goes\n"
                "B. go\n"
                "C. going\n"
                "D. went\n"
                "Answer: A\n"
            )
        }
        return samples.get(subject.upper(), samples["TOAN"])

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

        # Kiểm tra đáp án ghi chú cuối câu (VD: "Đáp án: A", "Key: B")
        ans_match = self.ANSWER_KEY_BLOCK_REGEX.search(body)
        if ans_match:
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
