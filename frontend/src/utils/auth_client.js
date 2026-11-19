import { $, setStatus } from './context.js';

const TEACHER_SESSION_KEY = 'ai-canvas:teacher-session:v1';
const DEVICE_ID_KEY = 'ai-canvas:classroom-device-id:v1';

const getAuthEls = () => ({
  authBtn: $('teacherAuthBtn'),
  sessionPill: $('teacherSessionPill'),
  dialog: $('teacherLoginDialog'),
  requestForm: $('teacherOtpRequestForm'),
  verifyForm: $('teacherOtpVerifyForm'),
  loggedInView: $('teacherLoggedInView'),
  emailInput: $('teacherEmailInput'),
  phoneInput: $('teacherPhoneInput'),
  otpInput: $('teacherOtpInput'),
  passwordInput: $('teacherPasswordInput'),
  togglePwBtn: $('toggleTeacherPwBtn'),
  rememberCheckbox: $('remember14DaysCheckbox'),
  requestError: $('teacherRequestError'),
  verifyError: $('teacherVerifyError'),
  otpNotice: $('otpSentNotice'),
  sessionSummary: $('teacherSessionSummary'),
  cancelBtn: $('cancelTeacherLoginBtn'),
  backBtn: $('backToOtpRequestBtn'),
  closeSessionBtn: $('closeSessionViewBtn'),
  refreshSessionBtn: $('refreshTeacherSessionBtn'),
  logoutBtn: $('logoutTeacherBtn'),
  sendOtpBtn: $('sendTeacherOtpBtn'),
  verifyOtpBtn: $('verifyTeacherOtpBtn'),
});

function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? `smartboard-${crypto.randomUUID().slice(0, 8)}`
      : `smartboard-${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function readStoredTeacherSession() {
  try {
    const raw = localStorage.getItem(TEACHER_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveTeacherSession(tokenData) {
  const now = Date.now();
  const refreshExpiresMs = (tokenData.refresh_expires_in || 14 * 86400) * 1000;
  const session = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    user_id: tokenData.user_id,
    role: tokenData.role,
    full_name: tokenData.full_name,
    email: tokenData.email,
    phone_number: tokenData.phone_number,
    device_id: tokenData.device_id || getOrCreateDeviceId(),
    remember_days: tokenData.remember_days || 14,
    password_hash_scheme: tokenData.password_hash_scheme || 'bcrypt',
    expires_at: now + refreshExpiresMs,
  };
  localStorage.setItem(TEACHER_SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearStoredTeacherSession() {
  localStorage.removeItem(TEACHER_SESSION_KEY);
}

function renderAuthState(session) {
  const { authBtn, sessionPill } = getAuthEls();
  if (!authBtn) return;

  if (session && session.access_token && session.expires_at > Date.now()) {
    const daysLeft = Math.max(1, Math.ceil((session.expires_at - Date.now()) / 86400000));
    authBtn.textContent = session.email ? `GV: ${session.email.split('@')[0]}` : 'GV đã đăng nhập';
    authBtn.classList.add('is-authenticated');
    if (sessionPill) {
      sessionPill.textContent = `Phiên ${daysLeft} ngày`;
      sessionPill.hidden = false;
    }
  } else {
    authBtn.textContent = 'Đăng nhập GV';
    authBtn.classList.remove('is-authenticated');
    if (sessionPill) {
      sessionPill.hidden = true;
      sessionPill.textContent = '';
    }
  }
}

function showLoggedInDetails(session) {
  const els = getAuthEls();
  if (!els.loggedInView || !els.sessionSummary) return;
  els.requestForm.hidden = true;
  els.verifyForm.hidden = true;
  els.loggedInView.hidden = false;
  const expDate = new Date(session.expires_at).toLocaleString('vi-VN');
  const rows = [
    ['Giáo viên:', session.full_name || 'Thầy/Cô'],
    ['Email:', session.email || '--'],
    ['SĐT:', session.phone_number || '--'],
    ['Thiết bị phòng học:', session.device_id || '--'],
    [`Duy trì phiên (${session.remember_days || 14} ngày):`, `tới ${expDate}`],
    ['Chuẩn băm mật khẩu:', String(session.password_hash_scheme || 'bcrypt').toUpperCase()],
  ];
  els.sessionSummary.textContent = '';
  for (const [label, value] of rows) {
    const line = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `${label} `;
    line.append(strong, document.createTextNode(value));
    els.sessionSummary.append(line);
  }
}

function showOtpRequestStep() {
  const els = getAuthEls();
  els.requestForm.hidden = false;
  els.verifyForm.hidden = true;
  els.loggedInView.hidden = true;
  if (els.requestError) els.requestError.hidden = true;
  if (els.verifyError) els.verifyError.hidden = true;
}

// Đồng bộ trạng thái ARIA + fallback :user-invalid theo đúng chuẩn Modern Web Guidance
function initAccessibleFormValidation(dialog) {
  if (!dialog) return;
  const dirtyState = new WeakMap();
  const supportsUserInvalid = typeof CSS !== 'undefined' && CSS.supports?.('selector(:user-invalid)');

  const announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.className = 'sr-only';
  document.body.append(announcer);

  const linkError = (el, shown) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const syncAria = (el, announce = false) => {
    if (!el.matches?.('input, select, textarea')) return;
    const invalid = supportsUserInvalid
      ? el.matches(':user-invalid')
      : (dirtyState.get(el)?.interacted && !el.validity.valid);

    if (!supportsUserInvalid && dirtyState.get(el)?.interacted) {
      el.classList.toggle('user-invalid-fallback', !el.validity.valid);
      el.classList.toggle('user-valid-fallback', el.validity.valid);
    }
    el.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    linkError(el, Boolean(invalid));
    if (announce && invalid) {
      const errEl = el.dataset.error ? $(el.dataset.error) : null;
      if (errEl) announcer.textContent = errEl.textContent.trim();
    }
  };

  dialog.querySelectorAll('input').forEach((el) => el.setAttribute('aria-invalid', 'false'));
  dialog.addEventListener('blur', (e) => {
    if (e.target instanceof HTMLInputElement) {
      const prev = dirtyState.get(e.target) || {};
      dirtyState.set(e.target, { ...prev, interacted: true, blurred: true });
      syncAria(e.target, true);
    }
  }, true);
  dialog.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement) syncAria(e.target, false);
  });
  dialog.addEventListener('invalid', (e) => {
    if (e.target instanceof HTMLInputElement) {
      dirtyState.set(e.target, { interacted: true, blurred: true });
      syncAria(e.target, false);
    }
  }, true);
}

export async function refreshStoredTeacherSession() {
  const current = readStoredTeacherSession();
  if (!current?.refresh_token) return null;
  if (current.expires_at && current.expires_at <= Date.now()) {
    clearStoredTeacherSession();
    renderAuthState(null);
    return null;
  }

  try {
    const res = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: current.refresh_token,
        device_id: current.device_id || getOrCreateDeviceId(),
      }),
    });
    if (!res.ok) {
      if (res.status === 401) {
        clearStoredTeacherSession();
        renderAuthState(null);
      }
      return null;
    }
    const data = await res.json();
    const updated = saveTeacherSession(data);
    renderAuthState(updated);
    return updated;
  } catch {
    // Giữ nguyên phiên offline khi rớt mạng trên thiết bị phòng học
    renderAuthState(current);
    return current;
  }
}

export function setupTeacherAuth() {
  const els = getAuthEls();
  if (!els.authBtn || !els.dialog) return;

  initAccessibleFormValidation(els.dialog);

  let pendingCreds = null;

  els.dialog.addEventListener('close', () => {
    els.dialog.returnValue = '';
  });

  els.authBtn.addEventListener('click', () => {
    const active = readStoredTeacherSession();
    if (active && active.access_token && active.expires_at > Date.now()) {
      showLoggedInDetails(active);
    } else {
      showOtpRequestStep();
    }
    els.dialog.showModal();
  });

  els.cancelBtn?.addEventListener('click', () => els.dialog.close('cancel'));
  els.closeSessionBtn?.addEventListener('click', () => els.dialog.close('close'));
  els.backBtn?.addEventListener('click', () => showOtpRequestStep());

  els.togglePwBtn?.addEventListener('click', () => {
    if (!els.passwordInput) return;
    const nextType = els.passwordInput.type === 'password' ? 'text' : 'password';
    els.passwordInput.type = nextType;
    const pressed = nextType === 'text';
    els.togglePwBtn.setAttribute('aria-pressed', String(pressed));
    els.togglePwBtn.textContent = pressed ? 'Ẩn' : 'Hiện';
  });

  els.requestForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!els.requestForm.reportValidity()) return;

    const email = els.emailInput.value.trim();
    const phone = els.phoneInput.value.trim();
    els.requestError.hidden = true;
    els.sendOtpBtn.disabled = true;
    els.sendOtpBtn.textContent = 'Đang gửi OTP...';

    try {
      const res = await fetch('/api/v1/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone_number: phone, role: 'TEACHER' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);

      pendingCreds = { email, phone_number: data.phone_number || phone };
      els.requestForm.hidden = true;
      els.verifyForm.hidden = false;
      els.otpInput.value = '';
      els.verifyError.hidden = true;
      els.otpNotice.textContent = '';
      els.otpNotice.append(
        document.createTextNode('Đã gửi mã OTP 6 số tới email '),
        Object.assign(document.createElement('strong'), { textContent: email }),
        document.createTextNode('.'),
      );
      if (data.dev_otp_code) {
        els.otpNotice.append(
          document.createTextNode(' (Mã test nội bộ: '),
          Object.assign(document.createElement('strong'), { textContent: String(data.dev_otp_code) }),
          document.createTextNode(')'),
        );
      }
      els.otpInput.focus();
    } catch (err) {
      els.requestError.textContent = err.message || 'Không thể gửi mã OTP.';
      els.requestError.hidden = false;
    } finally {
      els.sendOtpBtn.disabled = false;
      els.sendOtpBtn.textContent = 'Gửi mã OTP';
    }
  });

  els.verifyForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!pendingCreds || !els.verifyForm.reportValidity()) return;

    els.verifyError.hidden = true;
    els.verifyOtpBtn.disabled = true;
    els.verifyOtpBtn.textContent = 'Đang xác thực...';

    try {
      const body = {
        email: pendingCreds.email,
        phone_number: pendingCreds.phone_number,
        otp_code: els.otpInput.value.trim(),
        remember_me: Boolean(els.rememberCheckbox?.checked),
        device_id: getOrCreateDeviceId(),
        device_name: navigator.platform || 'Bảng thông minh phòng học',
      };
      const pw = els.passwordInput?.value;
      if (pw && pw.length >= 6) body.password = pw;

      const res = await fetch('/api/v1/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);

      const saved = saveTeacherSession(data);
      renderAuthState(saved);
      els.dialog.close('signed-in');
      setStatus(`Đã đăng nhập giáo viên (${saved.email}) · Duy trì ${saved.remember_days} ngày`);
    } catch (err) {
      els.verifyError.textContent = err.message || 'Xác thực OTP thất bại.';
      els.verifyError.hidden = false;
    } finally {
      els.verifyOtpBtn.disabled = false;
      els.verifyOtpBtn.textContent = 'Xác thực & Đăng nhập';
    }
  });

  els.refreshSessionBtn?.addEventListener('click', async () => {
    const refreshed = await refreshStoredTeacherSession();
    if (refreshed) {
      showLoggedInDetails(refreshed);
      setStatus('Đã làm mới JWT Access Token thành công');
    }
  });

  els.logoutBtn?.addEventListener('click', async () => {
    const active = readStoredTeacherSession();
    if (active?.refresh_token) {
      fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: active.refresh_token }),
      }).catch(() => {});
    }
    clearStoredTeacherSession();
    renderAuthState(null);
    els.dialog.close('logged-out');
    setStatus('Đã đăng xuất giáo viên khỏi thiết bị phòng học');
  });

  const existing = readStoredTeacherSession();
  renderAuthState(existing);
  if (existing && typeof navigator !== 'undefined' && navigator.onLine !== false) {
    refreshStoredTeacherSession();
  }
}

// ==============================================================================
// TASK TF28515: API HELPER CHO CỔNG HỌC SINH / PHỤ HUYNH (SĐT & PHÂN QUYỀN LỚP)
// ==============================================================================
const PORTAL_SESSION_KEY = 'ai-canvas:portal-session:v1';

async function authJsonFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

export function readPortalSession() {
  try {
    const raw = localStorage.getItem(PORTAL_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getPortalAuthHeaders() {
  const session = readPortalSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export async function registerStudentOrParent({ fullName, phoneNumber, password, schoolLevel, className, studentCode, role }) {
  const data = await authJsonFetch('/api/v1/auth/student/register', {
    method: 'POST',
    body: JSON.stringify({
      full_name: fullName,
      phone_number: phoneNumber,
      password,
      school_level: schoolLevel,
      class_name: className,
      student_code: studentCode,
      role,
    }),
  });
  localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(data));
  return data;
}

export async function loginStudentOrParent({ phoneNumber, password, rememberMe = true }) {
  const data = await authJsonFetch('/api/v1/auth/student/login', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber, password, remember_me: rememberMe }),
  });
  localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(data));
  return data;
}

export function requestPasswordResetOtp(phoneNumber) {
  return authJsonFetch('/api/v1/auth/forgot-password/request-otp', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
}

export function resetPasswordWithOtp({ phoneNumber, otpCode, newPassword }) {
  return authJsonFetch('/api/v1/auth/forgot-password/reset', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber, otp_code: otpCode, new_password: newPassword }),
  });
}

export function clearPortalSession() {
  localStorage.removeItem(PORTAL_SESSION_KEY);
}

export function fetchStudentClassLessons({ className, subject, date, q, limit = 12, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (className) params.set('class_name', className);
  if (subject) params.set('subject', subject);
  if (date) params.set('date', date);
  if (q) params.set('q', q);
  if (limit != null) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return authJsonFetch(`/api/v1/auth/student/lessons${qs}`, {
    method: 'GET',
    headers: getPortalAuthHeaders(),
  });
}

