import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Interactive Canvas — Bảng Vẽ Thông Minh",
  description: "Bảng vẽ tương tác thông minh hỗ trợ giảng dạy và ôn tập đa môn học tích hợp AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased w-screen h-screen overflow-hidden">
        {children}
      </body>
    </html>
  );
}
