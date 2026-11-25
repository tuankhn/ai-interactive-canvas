import io
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.exam_service import ExamService, exam_service

client = TestClient(app)


def test_parse_text_mcq_and_answer_block():
    """Kiểm tra bóc tách văn bản thô dạng trắc nghiệm có dòng Đáp án và Lời giải."""
    raw_exam = """
    Câu 1: Nguyên hàm của f(x) = 2x là gì?
    A. x^2 + C
    B. 2x^2 + C
    C. x + C
    D. 2 + C
    Đáp án: A
    Lời giải: Ta có nguyên hàm của 2x dx = 2 * (x^2 / 2) + C = x^2 + C.

    Câu 2: Số nguyên tố chẵn duy nhất là số nào?
    A. 0
    *B. 2
    C. 4
    D. 6
    """
    result = exam_service.parse_text(raw_exam, title="Đề kiểm tra 15 phút")
    assert result["total_questions"] == 2
    assert result["title"] == "Đề kiểm tra 15 phút"

    q1 = result["questions"][0]
    assert q1["number"] == 1
    assert "Nguyên hàm của f(x) = 2x" in q1["content"]
    assert q1["correct_option"] == "A"
    assert q1["question_type"] == "MCQ"
    assert len(q1["options"]) == 4
    assert q1["options"][0]["is_correct"] is True
    assert q1["options"][1]["is_correct"] is False
    assert "x^2 + C" in q1["explanation"]

    q2 = result["questions"][1]
    assert q2["number"] == 2
    assert q2["correct_option"] == "B"
    assert q2["options"][1]["is_correct"] is True


def test_parse_text_essay_question():
    """Kiểm tra bóc tách câu hỏi tự luận không có phương án A, B, C, D."""
    raw_exam = """
    Câu 1: Chứng minh rằng căn bậc hai của 2 là số vô tỉ.
    Lời giải: Giả sử căn 2 là số hữu tỉ p/q tối giản...
    """
    result = exam_service.parse_text(raw_exam)
    assert result["total_questions"] == 1
    q = result["questions"][0]
    assert q["question_type"] == "ESSAY"
    assert len(q["options"]) == 0
    assert "căn bậc hai của 2" in q["content"]
    assert "Giả sử căn 2 là số hữu tỉ" in q["explanation"]


def test_parse_text_with_end_answer_table():
    """Kiểm tra nhận diện đáp án từ bảng đáp án ở cuối đề thi."""
    raw_exam = """
    Câu 1: Mặt trời mọc ở hướng nào?
    A. Đông
    B. Tây
    C. Nam
    D. Bắc

    Câu 2: Thủ đô của Việt Nam là gì?
    A. TP Hồ Chí Minh
    B. Đà Nẵng
    C. Hà Nội
    D. Cần Thơ

    BẢNG ĐÁP ÁN:
    1-A, 2-C
    """
    result = exam_service.parse_text(raw_exam)
    assert result["total_questions"] == 2
    assert result["questions"][0]["correct_option"] == "A"
    assert result["questions"][1]["correct_option"] == "C"


def test_parse_docx_with_bold_answer():
    """Kiểm tra đọc file DOCX và tự động nhận diện đáp án đúng qua chữ in đậm (bold)."""
    import docx

    doc = docx.Document()
    doc.add_paragraph("Câu 1: Đơn vị của lực trong hệ SI là gì?")
    
    # Đoạn văn bản chứa phương án với phương án A được in đậm (đáp án đúng)
    p_opt = doc.add_paragraph()
    r_a = p_opt.add_run("A. Newton\n")
    r_a.bold = True
    r_b = p_opt.add_run("B. Joule\n")
    r_c = p_opt.add_run("C. Watt\n")
    r_d = p_opt.add_run("D. Pascal\n")

    docx_stream = io.BytesIO()
    doc.save(docx_stream)
    docx_bytes = docx_stream.getvalue()

    parsed = exam_service.parse_docx(docx_bytes, filename="vat_ly_10.docx")
    assert parsed["source_type"] == "DOCX"
    assert parsed["total_questions"] == 1
    q = parsed["questions"][0]
    assert q["correct_option"] == "A"
    assert q["options"][0]["is_correct"] is True


def test_filter_mode_student_security():
    """
    Kiểm tra tính năng bảo mật: Chế độ Học sinh (STUDENT) PHẢI ẩn hoàn toàn
    đáp án đúng, không để lộ qua payload mạng.
    """
    raw_exam = """
    Câu 1: Số Pi xấp xỉ bằng bao nhiêu?
    A. 3.12
    *B. 3.14
    C. 3.16
    D. 3.18
    Lời giải: Pi = 3.14159...
    """
    raw_parsed = exam_service.parse_text(raw_exam)
    
    # 1. Chế độ Học sinh (STUDENT)
    student_view = exam_service.filter_by_mode(raw_parsed, mode="STUDENT")
    assert student_view["mode"] == "STUDENT"
    assert student_view["hidden_answers"] is True
    q_stu = student_view["questions"][0]
    assert q_stu["correct_option"] is None
    assert q_stu["explanation"] is None
    for opt in q_stu["options"]:
        assert opt["is_correct"] is False
        assert opt["wrong_explanation"] is None

    # 2. Chế độ Giáo viên (TEACHER)
    teacher_view = exam_service.filter_by_mode(raw_parsed, mode="TEACHER")
    assert teacher_view["mode"] == "TEACHER"
    assert teacher_view["hidden_answers"] is False
    q_tea = teacher_view["questions"][0]
    assert q_tea["correct_option"] == "B"
    assert "Pi = 3.14159" in q_tea["explanation"]
    assert q_tea["options"][1]["is_correct"] is True


def test_generate_canvas_layout():
    """Kiểm tra sinh cấu trúc Fabric.js canvas objects và tự động phân trang."""
    questions = [
        {
            "id": "q1",
            "number": 1,
            "content": "Câu hỏi số một?",
            "question_type": "MCQ",
            "correct_option": "A",
            "explanation": "Giải thích câu 1",
            "options": [
                {"label": "A", "content": "Đáp án 1A", "is_correct": True},
                {"label": "B", "content": "Đáp án 1B", "is_correct": False},
            ],
        },
        {
            "id": "q2",
            "number": 2,
            "content": "Câu hỏi số hai?",
            "question_type": "MCQ",
            "correct_option": "B",
            "explanation": "Giải thích câu 2",
            "options": [
                {"label": "A", "content": "Đáp án 2A", "is_correct": False},
                {"label": "B", "content": "Đáp án 2B", "is_correct": True},
            ],
        },
        {
            "id": "q3",
            "number": 3,
            "content": "Câu hỏi số ba tự luận?",
            "question_type": "ESSAY",
            "correct_option": None,
            "explanation": "Giải thích câu 3",
            "options": [],
        },
    ]

    # Phân trang: 2 câu/trang => 3 câu sẽ có 2 trang
    layout = exam_service.generate_canvas_layout(questions, mode="STUDENT", questions_per_page=2)
    assert layout["total_pages"] == 2
    assert len(layout["pages"]) == 2
    assert layout["mode"] == "STUDENT"

    # Trang 1 chứa 2 câu đầu
    p1_objects = layout["pages"][0]["objects"]
    assert any("Câu 1" in obj.get("text", "") for obj in p1_objects)
    assert any("Câu 2" in obj.get("text", "") for obj in p1_objects)

    # Trong chế độ Học sinh, không được có chữ "Đáp án đúng"
    for obj in p1_objects:
        assert "(Đáp án đúng)" not in obj.get("text", "")

    # Trang 2 chứa câu 3
    p2_objects = layout["pages"][1]["objects"]
    assert any("Câu 3" in obj.get("text", "") for obj in p2_objects)


def test_api_parse_text_endpoint():
    """Kiểm tra endpoint POST /api/v1/exam/parse-text."""
    payload = {
        "raw_text": "Câu 1: 1 + 1 bằng mấy?\n*A. 2\nB. 3\nC. 4\nD. 5",
        "title": "Kiểm tra nhanh",
        "mode": "STUDENT",
    }
    response = client.post("/api/v1/exam/parse-text", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Kiểm tra nhanh"
    assert data["total_questions"] == 1
    assert data["hidden_answers"] is True
    assert data["questions"][0]["correct_option"] is None


def test_api_parse_text_empty_error():
    """Kiểm tra validation khi gửi văn bản rỗng."""
    response = client.post("/api/v1/exam/parse-text", json={"raw_text": ""})
    assert response.status_code == 400


def test_api_upload_file_docx():
    """Kiểm tra endpoint upload file DOCX trực tiếp."""
    import docx

    doc = docx.Document()
    doc.add_paragraph("Câu 1: Thủ đô nước Pháp là thành phố nào?")
    doc.add_paragraph("A. London\n*B. Paris\nC. Berlin\nD. Rome\nĐáp án: B")

    bio = io.BytesIO()
    doc.save(bio)
    bio.seek(0)

    files = {"file": ("test_exam.docx", bio.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    response = client.post("/api/v1/exam/upload?mode=TEACHER", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["source_type"] == "DOCX"
    assert data["total_questions"] == 1
    assert data["questions"][0]["correct_option"] == "B"
    assert data["hidden_answers"] is False


def test_api_upload_invalid_file_extension():
    """Kiểm tra từ chối các định dạng tệp không hợp lệ."""
    files = {"file": ("danger.exe", b"malicious binary", "application/octet-stream")}
    response = client.post("/api/v1/exam/upload", files=files)
    assert response.status_code == 400
    assert "không được hỗ trợ" in response.json()["detail"]


def test_api_layout_canvas_endpoint():
    """Kiểm tra endpoint POST /api/v1/exam/layout-canvas."""
    payload = {
        "questions": [
            {
                "id": "1",
                "number": 1,
                "content": "Một cộng một bằng mấy?",
                "options": [
                    {"label": "A", "content": "Hai", "is_correct": True},
                    {"label": "B", "content": "Ba", "is_correct": False},
                ],
            }
        ],
        "mode": "STUDENT",
        "questions_per_page": 2,
    }
    response = client.post("/api/v1/exam/layout-canvas", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["total_pages"] == 1
    assert len(data["pages"][0]["objects"]) > 0


def test_api_sample_exam_endpoint():
    """Kiểm tra endpoint GET /api/v1/exam/sample."""
    response = client.get("/api/v1/exam/sample?subject=TOAN&mode=STUDENT")
    assert response.status_code == 200
    data = response.json()
    assert data["total_questions"] >= 2
    assert data["hidden_answers"] is True


def test_frontend_exam_upload_ui_served():
    """Kiểm tra giao diện index.html được backend phục vụ có chứa nút tải đề thi và examModal."""
    response = client.get("/")
    assert response.status_code == 200
    html_text = response.text
    assert "examUploadBtn" in html_text
    assert "examModal" in html_text
    assert "Chế độ: Học sinh (Tự động ẩn đáp án đúng)" or "mode-student" in html_text
    assert "examDirectTextInput" in html_text
    assert "layoutToBoardBtn" in html_text


def test_unkeyed_math_exam_auto_solves_and_docx_all_bold_labels_not_forced_to_a():
    """
    Kiểm tra thực tế lỗi báo cáo:
    1) File DOCX in đậm cả 4 nhãn A., B., C., D. KHÔNG được gán bừa đáp án A cho mọi câu.
    2) Đề Toán không đính kèm bảng đáp án vẫn giải đúng:
       - Câu 1: Số gồm 5 nghìn, 3 trăm và 8 đơn vị -> C (5308)
       - Câu 2: Kết quả phép chia 848 : 4 -> A (212)
       - Câu 3: Tìm số chưa biết ? × 6 = 432 -> B (72)
    """
    import docx

    doc = docx.Document()
    doc.add_paragraph("Câu 1: Số gồm 5 nghìn, 3 trăm và 8 đơn vị được viết là:")
    for lbl, val in [("A.", " 538"), ("B.", " 5380"), ("C.", " 5308"), ("D.", " 5038")]:
        p = doc.add_paragraph()
        r_lbl = p.add_run(lbl)
        r_lbl.bold = True  # Cả 4 nhãn A., B., C., D. đều in đậm định dạng
        p.add_run(val)

    doc.add_paragraph("Câu 2: Kết quả của phép chia 848 : 4 là:")
    for lbl, val in [("A.", " 212"), ("B.", " 221"), ("C.", " 202"), ("D.", " 214")]:
        p = doc.add_paragraph()
        r_lbl = p.add_run(lbl)
        r_lbl.bold = True
        p.add_run(val)

    doc.add_paragraph("Câu 3: Tìm số chưa biết, biết: ? × 6 = 432")
    for lbl, val in [("A.", " 70"), ("B.", " 72"), ("C.", " 62"), ("D.", " 82")]:
        p = doc.add_paragraph()
        r_lbl = p.add_run(lbl)
        r_lbl.bold = True
        p.add_run(val)

    bio = io.BytesIO()
    doc.save(bio)
    bio.seek(0)

    files = {
        "file": (
            "de_toan_lop_3.docx",
            bio.getvalue(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    res_up = client.post("/api/v1/exam/upload?mode=STUDENT", files=files)
    assert res_up.status_code == 200
    questions = res_up.json()["questions"]
    assert len(questions) == 3

    # Khoanh C ở Câu 1 (5308) -> PHẢI ĐÚNG (✓ C)
    g1 = client.post(
        "/api/v1/exam/grade-mcq",
        json={
            "question_id": questions[0]["id"],
            "selected_label": "C",
            "question_content": questions[0]["content"],
            "options": questions[0]["options"],
        },
    ).json()
    assert g1["is_correct"] is True
    assert g1["correct_label"] == "C"

    # Khoanh A ở Câu 2 (212) -> PHẢI ĐÚNG (✓ A)
    g2 = client.post(
        "/api/v1/exam/grade-mcq",
        json={
            "question_id": questions[1]["id"],
            "selected_label": "A",
            "question_content": questions[1]["content"],
            "options": questions[1]["options"],
        },
    ).json()
    assert g2["is_correct"] is True
    assert g2["correct_label"] == "A"

    # Khoanh C (62) ở Câu 3 (? × 6 = 432) -> SAI, và đáp án đúng phải là B (72) chứ KHÔNG phải A!
    g3 = client.post(
        "/api/v1/exam/grade-mcq",
        json={
            "question_id": questions[2]["id"],
            "selected_label": "C",
            "question_content": questions[2]["content"],
            "options": questions[2]["options"],
        },
    ).json()
    assert g3["is_correct"] is False
    assert g3["correct_label"] == "B"

    # Kiểm tra chấm trực tiếp từ đề đã lưu sẵn trên bảng (question_id mới/không nằm trong RAM server):
    # Câu 4: 120 + 80 × 3 = 360 -> Khoanh A (600) phải SAI, đáp án đúng C (360)
    g4 = client.post(
        "/api/v1/exam/grade-mcq",
        json={
            "question_id": "restored_localstorage_q4",
            "selected_label": "A",
            "question_content": "Giá trị của biểu thức 120 + 80 × 3 là:",
            "options": [
                {"label": "A", "content": "600"},
                {"label": "B", "content": "200"},
                {"label": "C", "content": "360"},
                {"label": "D", "content": "280"},
            ],
        },
    ).json()
    assert g4["is_correct"] is False
    assert g4["correct_label"] == "C"

    # Câu 5: Số 19 được viết bằng chữ số La Mã -> Khoanh A (XVIII) phải SAI, đáp án đúng D (XIX)
    g5 = client.post(
        "/api/v1/exam/grade-mcq",
        json={
            "question_id": "restored_localstorage_q5",
            "selected_label": "A",
            "question_content": "Số 19 được viết bằng chữ số La Mã là:",
            "options": [
                {"label": "A", "content": "XVIII"},
                {"label": "B", "content": "XXI"},
                {"label": "C", "content": "IXX"},
                {"label": "D", "content": "XIX"},
            ],
        },
    ).json()
    assert g5["is_correct"] is False
    assert g5["correct_label"] == "D"


def test_parse_docx_with_option_tables_superscripts_and_horizontal_answer_table():
    """
    Kiểm thử Bất cập #1 (bug3):
    - Đọc file .docx có bảng phương án 2x2 (a., b., c., d.), số mũ superscript (²)
      và BẢNG ĐÁP ÁN ngang 2 dòng (Câu | 1 | 2 / Đáp án | c | a).
    """
    import docx

    doc = docx.Document()
    # Bảng banner đầu đề (phải được bỏ qua, không làm mất câu hỏi)
    banner = doc.add_table(rows=1, cols=1)
    banner.cell(0, 0).text = "ĐỀ TRẮC NGHIỆM: HẰNG ĐẲNG THỨC BẬC 2"
    doc.add_paragraph("Họ và tên: ........................... Lớp: 8A")

    # Câu 1 dùng superscript '2' -> '²' và bảng 2x2 phương án a, b, c, d
    p1 = doc.add_paragraph()
    p1.add_run("Câu 1: Khai triển hằng đẳng thức (x + 3)")
    r_sup1 = p1.add_run("2")
    r_sup1.font.superscript = True
    p1.add_run(" ta được:")

    t1 = doc.add_table(rows=2, cols=2)
    c00 = t1.cell(0, 0).paragraphs[0]
    c00.add_run("a. x")
    c00_s = c00.add_run("2")
    c00_s.font.superscript = True
    c00.add_run(" + 9")

    c01 = t1.cell(0, 1).paragraphs[0]
    c01.add_run("b. x")
    c01_s = c01.add_run("2")
    c01_s.font.superscript = True
    c01.add_run(" + 3x + 9")

    c10 = t1.cell(1, 0).paragraphs[0]
    c10.add_run("c. x")
    c10_s = c10.add_run("2")
    c10_s.font.superscript = True
    c10.add_run(" + 6x + 9")

    c11 = t1.cell(1, 1).paragraphs[0]
    c11.add_run("d. x")
    c11_s = c11.add_run("2")
    c11_s.font.superscript = True
    c11.add_run(" - 6x + 9")

    # Câu 2 dùng superscript '101²'
    p2 = doc.add_paragraph()
    p2.add_run("Câu 2: Tính nhanh 101")
    r_sup2 = p2.add_run("2")
    r_sup2.font.superscript = True
    p2.add_run(" bằng:")

    t2 = doc.add_table(rows=1, cols=4)
    t2.cell(0, 0).text = "a. 10201"
    t2.cell(0, 1).text = "b. 10101"
    t2.cell(0, 2).text = "c. 10021"
    t2.cell(0, 3).text = "d. 12001"

    doc.add_paragraph("BẢNG ĐÁP ÁN")
    ans_tbl = doc.add_table(rows=2, cols=3)
    ans_tbl.cell(0, 0).text = "Câu"
    ans_tbl.cell(0, 1).text = "1"
    ans_tbl.cell(0, 2).text = "2"
    ans_tbl.cell(1, 0).text = "Đáp án"
    ans_tbl.cell(1, 1).text = "c"
    ans_tbl.cell(1, 2).text = "a"

    bio = io.BytesIO()
    doc.save(bio)
    parsed = exam_service.parse_docx(bio.getvalue(), filename="De_Trac_Nghiem_Hang_Dang_Thuc_Bac_2.docx")

    assert parsed["total_questions"] == 2
    q1, q2 = parsed["questions"][0], parsed["questions"][1]
    assert q1["question_type"] == "MCQ"
    assert "(x + 3)²" in q1["content"]
    assert len(q1["options"]) == 4
    assert q1["options"][2]["content"] == "x² + 6x + 9"
    assert q1["correct_option"] == "C"

    assert q2["question_type"] == "MCQ"
    assert "101²" in q2["content"]
    assert len(q2["options"]) == 4
    assert q2["correct_option"] == "A"


def test_already_cropped_fast_path_and_recognition_cache():
    """Kiểm thử Bất cập #4 (bug3): already_cropped=True bỏ qua crop lặp và cache SHA-256 phản hồi tức thì."""
    import base64
    from PIL import Image
    from app.services.image_preprocess import preprocess_canvas_image
    from app.services.ai_recognition import _RECOGNITION_CACHE, clear_recognition_cache

    img = Image.new("RGB", (180, 64), (255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=82)
    b64_webp = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

    pre = preprocess_canvas_image(b64_webp, already_cropped=True)
    assert pre["original_size"] == [180, 64]
    assert pre["cropped_size"] == [180, 64]
    assert pre["bounding_box"] == {"x": 0, "y": 0, "width": 180, "height": 64}

    clear_recognition_cache()
    r1 = client.post(
        "/api/v1/recognize",
        json={"image_base64": b64_webp, "subject": "TOAN", "already_cropped": True, "fast_mode": True},
    )
    assert r1.status_code == 200
    assert len(_RECOGNITION_CACHE) >= 1

    r2 = client.post(
        "/api/v1/recognize",
        json={"image_base64": b64_webp, "subject": "TOAN", "already_cropped": True, "fast_mode": True},
    )
    assert r2.status_code == 200
    assert r2.json()["recognized_text"] == r1.json()["recognized_text"]
