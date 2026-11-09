import Link from "next/link";
import { Presentation, BookOpen, LogIn, Sparkles, CheckCircle2 } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-chalkboard-dark text-chalkboard-chalk flex flex-col justify-center items-center p-6">
      <div className="max-w-4xl w-full text-center space-y-8">
        
        {/* Header */}
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-chalkboard-light border border-chalkboard-border text-emerald-300 text-sm font-medium">
            <Sparkles className="w-4 h-4" />
            <span>AI Interactive Smartboard • EdTech Solution</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-chalkboard-chalk">
            Bảng Vẽ Thông Minh <br />
            <span className="text-emerald-400">Trợ Lý Giảng Dạy AI</span>
          </h1>
          <p className="text-lg text-emerald-200/80 max-w-2xl mx-auto">
            Nhận diện chữ viết tay, công thức Toán - Lý - Hóa, tự động dựng đồ thị 2D/3D, 
            chấm bài tương tác thời gian thực và lưu trữ bài giảng tránh mất kiến thức.
          </p>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 text-left">
          
          {/* Card 1: Bảng vẽ giảng dạy */}
          <Link
            href="/board"
            className="group block p-8 rounded-2xl bg-chalkboard-bg border border-chalkboard-border hover:border-emerald-500 hover:shadow-2xl hover:shadow-emerald-900/30 transition-all duration-200"
          >
            <div className="w-14 h-14 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Presentation className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-semibold text-chalkboard-chalk mb-2 flex items-center justify-between">
              Bảng Vẽ Giảng Dạy
              <span className="text-sm font-normal text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">
                Mở Bảng →
              </span>
            </h2>
            <p className="text-sm text-emerald-200/70 mb-4">
              Dành cho Giáo viên & Bảng thông minh tại lớp học. Viết vẽ bằng bút cảm ứng, tự động dựng đồ thị và chấm bài trực tiếp.
            </p>
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Chế độ ngoại tuyến tự động khi mất mạng</span>
            </div>
          </Link>

          {/* Card 2: Cổng ôn tập học sinh */}
          <Link
            href="/review"
            className="group block p-8 rounded-2xl bg-chalkboard-bg border border-chalkboard-border hover:border-teal-500 hover:shadow-2xl hover:shadow-teal-900/30 transition-all duration-200"
          >
            <div className="w-14 h-14 rounded-xl bg-teal-600/20 text-teal-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <BookOpen className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-semibold text-chalkboard-chalk mb-2 flex items-center justify-between">
              Cổng Ôn Tập Bài Giảng
              <span className="text-sm font-normal text-teal-400 opacity-0 group-hover:opacity-100 transition-opacity">
                Xem Ngay →
              </span>
            </h2>
            <p className="text-sm text-emerald-200/70 mb-4">
              Dành cho Học sinh & Phụ huynh. Xem lại toàn bộ ảnh chụp bảng theo ngày và môn học, tải ảnh gốc để ôn thi tại nhà.
            </p>
            <div className="flex items-center gap-2 text-xs text-teal-300">
              <CheckCircle2 className="w-4 h-4 text-teal-400" />
              <span>Lưu trữ 6 tháng an toàn không lo mất bài</span>
            </div>
          </Link>

        </div>

        {/* Footer Navigation */}
        <div className="pt-6 flex justify-center items-center gap-6 text-sm text-emerald-200/60">
          <Link href="/login" className="flex items-center gap-1.5 hover:text-emerald-300 transition-colors">
            <LogIn className="w-4 h-4" />
            <span>Đăng nhập Giáo viên (OTP Email)</span>
          </Link>
          <span>•</span>
          <span>Dự án thực tập Rikkei Academy</span>
        </div>

      </div>
    </main>
  );
}
