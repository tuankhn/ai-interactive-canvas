'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/utils';
import { Mail, Phone, KeyRound, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  const [step, setStep] = useState<'INPUT' | 'VERIFY'>('INPUT');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) return;

    try {
      setIsLoading(true);
      setMessage('');
      const res = await apiClient.requestOTP(phoneNumber, email);
      setStep('VERIFY');
      setMessage(res.message || 'Mã xác thực đã được gửi!');
      if (res.dev_otp_code) {
        setOtpCode(res.dev_otp_code);
      }
    } catch {
      setMessage('Không thể gửi mã OTP, vui lòng thử lại.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode) return;

    try {
      setIsLoading(true);
      setMessage('');
      const res = await apiClient.verifyOTP(phoneNumber, otpCode, email);
      if (res.access_token) {
        localStorage.setItem('canvas_access_token', res.access_token);
        localStorage.setItem('canvas_user_role', res.role);
        router.push('/board');
      }
    } catch {
      setMessage('Mã xác thực không chính xác.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-chalkboard-dark text-chalkboard-chalk flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-chalkboard-bg border border-chalkboard-border rounded-2xl p-8 shadow-2xl space-y-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Về trang chủ</span>
        </Link>

        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-chalkboard-chalk">
            {step === 'INPUT' ? 'Đăng Nhập Giáo Viên' : 'Xác Thực Mã OTP'}
          </h1>
          <p className="text-xs text-emerald-200/70">
            {step === 'INPUT'
              ? 'Nhập Email và Số điện thoại để nhận mã xác thực qua Email'
              : 'Nhập mã OTP gồm 6 chữ số vừa nhận được'}
          </p>
        </div>

        {message && (
          <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {step === 'INPUT' ? (
          <form onSubmit={handleRequestOTP} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-emerald-300 font-medium">Email Giáo Viên</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-emerald-400/60 absolute left-3.5 top-3.5" />
                <input
                  type="email"
                  required
                  placeholder="giaovien@truong.edu.vn"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 pl-10 pr-3 rounded-xl bg-chalkboard-light border border-chalkboard-border text-sm text-chalkboard-chalk placeholder-emerald-200/40 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-emerald-300 font-medium">Số Điện Thoại</label>
              <div className="relative">
                <Phone className="w-4 h-4 text-emerald-400/60 absolute left-3.5 top-3.5" />
                <input
                  type="tel"
                  required
                  placeholder="0912 345 678"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full h-11 pl-10 pr-3 rounded-xl bg-chalkboard-light border border-chalkboard-border text-sm text-chalkboard-chalk placeholder-emerald-200/40 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="smartboard-btn w-full !h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl flex items-center justify-center gap-2"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>Gửi Mã Xác Thực OTP</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOTP} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-emerald-300 font-medium">Mã OTP (6 chữ số)</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-emerald-400/60 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  maxLength={6}
                  required
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="w-full h-11 pl-10 pr-3 rounded-xl bg-chalkboard-light border border-chalkboard-border text-lg font-mono tracking-widest text-chalkboard-chalk text-center focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-xs text-emerald-200/80">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded accent-emerald-500"
              />
              <span>Duy trì trạng thái đăng nhập 2 tuần trên thiết bị này</span>
            </label>

            <button
              type="submit"
              disabled={isLoading}
              className="smartboard-btn w-full !h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl flex items-center justify-center gap-2"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>Xác Thực & Vào Bảng Giảng Dạy</span>
            </button>

            <button
              type="button"
              onClick={() => setStep('INPUT')}
              className="w-full text-center text-xs text-emerald-400 hover:underline pt-2"
            >
              Nhập lại thông tin
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
