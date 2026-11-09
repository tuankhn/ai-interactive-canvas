import { AIRecognitionResult, BoardSnapshotItem, SubjectType } from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export const apiClient = {
  // 1. Nhận diện nét vẽ AI
  async recognizeCanvas(
    imageBase64: string,
    subject: SubjectType = 'MATH',
    gradeLevel?: string
  ): Promise<AIRecognitionResult> {
    const res = await fetch(`${API_BASE_URL}/canvas/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        subject,
        grade_level: gradeLevel,
      }),
    });
    if (!res.ok) throw new Error('Không thể nhận diện nét vẽ từ AI');
    return res.json();
  },

  // 2. Lưu ảnh Snapshot bảng
  async saveSnapshot(
    sessionId: string,
    pageNumber: number,
    imageBase64: string,
    aiTranscription?: string
  ): Promise<BoardSnapshotItem> {
    const res = await fetch(`${API_BASE_URL}/snapshots/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        page_number: pageNumber,
        image_base64: imageBase64,
        ai_transcription: aiTranscription,
      }),
    });
    if (!res.ok) throw new Error('Không thể lưu ảnh bảng');
    return res.json();
  },

  // 3. Xem lại bài giảng (Học sinh / Phụ huynh)
  async reviewLecture(date: string, subject: string) {
    const res = await fetch(`${API_BASE_URL}/snapshots/review?date=${date}&subject=${encodeURIComponent(subject)}`);
    if (!res.ok) throw new Error('Không thể lấy lịch sử bài giảng');
    return res.json();
  },

  // 4. Xác thực OTP
  async requestOTP(phoneNumber: string, email?: string) {
    const res = await fetch(`${API_BASE_URL}/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: phoneNumber, email }),
    });
    return res.json();
  },

  async verifyOTP(phoneNumber: string, otpCode: string, email?: string) {
    const res = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: phoneNumber, otp_code: otpCode, email }),
    });
    return res.json();
  },

  // 5. Chấm bài trắc nghiệm
  async gradeMCQ(questionId: string, selectedLabel: string, sessionId: string) {
    const res = await fetch(`${API_BASE_URL}/quiz/grade-mcq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question_id: questionId,
        selected_label: selectedLabel,
        session_id: sessionId,
      }),
    });
    return res.json();
  },
};
