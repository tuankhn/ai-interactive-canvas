import {
  clearPortalSession,
  fetchStudentClassLessons,
  getPortalAuthHeaders,
  loginStudentOrParent,
  readPortalSession,
  registerStudentOrParent,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
} from '../utils/auth_client.js';

const SUBJECT_LABELS = {
  TOAN: 'Toán học',
  VAT_LY: 'Vật lý',
  HOA_HOC: 'Hóa học',
  TIENG_ANH: 'Tiếng Anh',
  SINH_HOC: 'Sinh học',
  DIA_LY: 'Địa lý',
};

const PAGE_LIMIT = 12;

const portalState = {
  session: readPortalSession(),
  lessons: [],
  signedUrlTokens: new Map(),
  totalCount: 0,
  calendarCounts: {},
  offset: 0,
  viewMode: 'gallery',
  selectedDate: '',
  selectedSubject: '',
  searchQuery: '',
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(), // 0..11
  lightboxIndex: -1,
  zoomScale: 1,
};

const $ = (id) => document.getElementById(id);

function clearChildren(el) {
  while (el && el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function showBanner(msg, type = 'info') {
  const banner = $('portalBanner');
  if (!banner) return;
  banner.textContent = msg;
  banner.className = `status-banner is-${type}`;
  banner.hidden = false;
}

function hideBanner() {
  const banner = $('portalBanner');
  if (banner) banner.hidden = true;
}

function buildSnapshotImageUrl(snapshotId, format = 'webp', download = false) {
  const params = new URLSearchParams({ format });
  if (download) params.set('download', '1');
  const signed = portalState.signedUrlTokens.get(snapshotId);
  if (signed?.exp && signed?.sig) {
    params.set('exp', String(signed.exp));
    params.set('sig', String(signed.sig));
  } else if (portalState.session?.access_token) {
    params.set('token', portalState.session.access_token);
  }
  return `/api/v1/sessions/snapshots/${encodeURIComponent(snapshotId)}/image?${params.toString()}`;
}

function switchAuthTab(target) {
  const map = {
    login: { tab: $('tabAuthLogin'), panel: $('panelAuthLogin') },
    register: { tab: $('tabAuthRegister'), panel: $('panelAuthRegister') },
    forgot: { tab: $('tabAuthForgot'), panel: $('panelAuthForgot') },
  };
  Object.entries(map).forEach(([key, pair]) => {
    const active = key === target;
    pair.tab?.setAttribute('aria-selected', String(active));
    if (pair.panel) pair.panel.hidden = !active;
  });
}

function setViewMode(mode) {
  portalState.viewMode = mode;
  const isCalendar = mode === 'calendar';
  $('viewGalleryBtn')?.setAttribute('aria-pressed', String(!isCalendar));
  $('viewCalendarBtn')?.setAttribute('aria-pressed', String(isCalendar));

  const workspace = $('portalWorkspaceGrid');
  if (workspace) {
    workspace.classList.toggle('is-calendar-focus', isCalendar);
  }
}

function renderCalendar() {
  const grid = $('calendarDaysGrid');
  const titleEl = $('calendarMonthTitle');
  if (!grid || !titleEl) return;

  const year = portalState.calendarYear;
  const month = portalState.calendarMonth;
  titleEl.textContent = `Tháng ${String(month + 1).padStart(2, '0')} / ${year}`;

  clearChildren(grid);

  const firstDay = new Date(year, month, 1);
  // Quy đổi JS Sunday=0..Saturday=6 sang Monday=0..Sunday=6
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i += 1) {
    let cellYear = year;
    let cellMonth = month;
    let dayNum = i - startWeekday + 1;
    let outside = false;

    if (dayNum <= 0) {
      dayNum = prevMonthDays + dayNum;
      cellMonth -= 1;
      if (cellMonth < 0) {
        cellMonth = 11;
        cellYear -= 1;
      }
      outside = true;
    } else if (dayNum > daysInMonth) {
      dayNum -= daysInMonth;
      cellMonth += 1;
      if (cellMonth > 11) {
        cellMonth = 0;
        cellYear += 1;
      }
      outside = true;
    }

    const isoDate = `${cellYear}-${String(cellMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const lessonCount = Number(portalState.calendarCounts[isoDate] || 0);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-day-btn';
    if (outside) btn.classList.add('is-outside');
    if (lessonCount > 0) btn.classList.add('has-lessons');
    if (portalState.selectedDate === isoDate) btn.classList.add('is-selected');
    btn.setAttribute(
      'aria-label',
      lessonCount > 0
        ? `Ngày ${dayNum} tháng ${cellMonth + 1}: có ${lessonCount} bài học`
        : `Ngày ${dayNum} tháng ${cellMonth + 1}: chưa có bài học`
    );

    const numSpan = document.createElement('span');
    numSpan.textContent = String(dayNum);
    btn.appendChild(numSpan);

    if (lessonCount > 0) {
      const countPill = document.createElement('span');
      countPill.className = 'cal-dot-count';
      countPill.textContent = String(lessonCount);
      btn.appendChild(countPill);
    }

    btn.addEventListener('click', () => {
      portalState.selectedDate = portalState.selectedDate === isoDate ? '' : isoDate;
      portalState.offset = 0;
      const dateInput = $('filterDateInput');
      if (dateInput) dateInput.value = portalState.selectedDate;
      renderCalendar();
      void loadClassLessons();
    });

    grid.appendChild(btn);
  }
}

function updateLightboxImageZoom() {
  const img = $('lightboxImage');
  const zoomText = $('zoomPercentText');
  if (img) {
    img.style.transform = `scale(${portalState.zoomScale})`;
  }
  if (zoomText) {
    zoomText.textContent = `${Math.round(portalState.zoomScale * 100)}%`;
  }
}

function openLightboxAt(index) {
  const item = portalState.lessons[index];
  const dialog = $('snapshotLightboxDialog');
  if (!item || !dialog) return;

  portalState.lightboxIndex = index;
  portalState.zoomScale = 1;
  updateLightboxImageZoom();

  const tags = item.tags || {};
  const subjLabel = SUBJECT_LABELS[tags.subject] || tags.subject || 'Môn học';

  $('lightboxTitle').textContent = `${subjLabel} · Lớp ${tags.class_name || ''} · Tiết ${tags.period_number || 1}`;
  $('lightboxMetaInfo').textContent =
    `Giáo viên: ${tags.teacher_name || 'Giáo viên'} | Ngày: ${tags.date || ''} | Nội dung: ${item.recognized_latex || item.ocr_text_metadata || 'Bảng vẽ trực tiếp'}`;

  const img = $('lightboxImage');
  if (img) {
    img.src = buildSnapshotImageUrl(item.id, 'png', false);
    img.alt = `Ảnh bảng ${subjLabel} ngày ${tags.date || ''}`;
  }

  const webpLink = $('downloadWebpLink');
  const pngLink = $('downloadPngLink');
  if (webpLink) {
    webpLink.href = buildSnapshotImageUrl(item.id, 'webp', true);
    webpLink.download = `bai-hoc-${tags.class_name || 'lop'}-${tags.subject || 'mon'}-${tags.date || 'snapshot'}.webp`;
  }
  if (pngLink) {
    pngLink.href = buildSnapshotImageUrl(item.id, 'png', true);
    pngLink.download = `bai-hoc-${tags.class_name || 'lop'}-${tags.subject || 'mon'}-${tags.date || 'snapshot'}.png`;
  }

  if (!dialog.open) {
    dialog.showModal();
  }
}

function renderGallery() {
  const grid = $('lessonsGalleryGrid');
  const emptyState = $('lessonsEmptyState');
  const pagination = $('galleryPagination');
  const pageInfo = $('galleryPageInfo');
  if (!grid || !emptyState) return;

  clearChildren(grid);

  if (portalState.lessons.length === 0) {
    emptyState.hidden = false;
    if (pagination) pagination.hidden = true;
    return;
  }

  emptyState.hidden = true;

  portalState.lessons.forEach((item, index) => {
    const tags = item.tags || {};
    const subjLabel = SUBJECT_LABELS[tags.subject] || tags.subject || 'Khác';

    const card = document.createElement('article');
    card.className = 'lesson-card';

    const thumbBtn = document.createElement('button');
    thumbBtn.type = 'button';
    thumbBtn.className = 'lesson-thumb-btn';
    thumbBtn.setAttribute('aria-label', `Phóng to ảnh bài học ${subjLabel} ngày ${tags.date || ''}`);

    const img = document.createElement('img');
    img.className = 'lesson-thumb-img';
    img.src = buildSnapshotImageUrl(item.id, 'webp', false);
    img.alt = `Ảnh bảng ${subjLabel} lớp ${tags.class_name || ''} ngày ${tags.date || ''}`;
    img.width = 480;
    img.height = 270;
    img.decoding = 'async';
    // Tối ưu tốc độ tải trang đầu (< 1.5s) theo guide optimize-image-priority
    if (index < 2) {
      img.setAttribute('fetchpriority', 'high');
    } else {
      img.loading = 'lazy';
    }

    const hintSpan = document.createElement('span');
    hintSpan.className = 'lesson-zoom-hint';
    hintSpan.textContent = 'Phóng to';

    thumbBtn.append(img, hintSpan);
    thumbBtn.addEventListener('click', () => openLightboxAt(index));

    const body = document.createElement('div');
    body.className = 'lesson-card-body';

    const tagsRow = document.createElement('div');
    tagsRow.className = 'lesson-tags-row';

    const subjChip = document.createElement('span');
    subjChip.className = 'subject-chip';
    subjChip.textContent = subjLabel;

    const dateChip = document.createElement('span');
    dateChip.className = 'date-chip';
    dateChip.textContent = `${tags.date || ''} · Tiết ${tags.period_number || 1}`;

    tagsRow.append(subjChip, dateChip);

    const ocrText = document.createElement('p');
    ocrText.className = 'lesson-ocr-preview';
    ocrText.textContent = item.recognized_latex || item.ocr_text_metadata || 'Ảnh ghi bảng lớp học';

    const teacherMeta = document.createElement('p');
    teacherMeta.className = 'lesson-teacher-meta';
    teacherMeta.textContent = `GV: ${tags.teacher_name || 'Giáo viên'} · Lớp ${tags.class_name || ''}`;

    const actionsRow = document.createElement('div');
    actionsRow.className = 'lesson-card-actions';

    const zoomAction = document.createElement('button');
    zoomAction.type = 'button';
    zoomAction.className = 'card-action-btn is-primary';
    zoomAction.textContent = 'Xem chi tiết';
    zoomAction.addEventListener('click', () => openLightboxAt(index));

    const dlWebp = document.createElement('a');
    dlWebp.className = 'card-action-btn';
    dlWebp.href = buildSnapshotImageUrl(item.id, 'webp', true);
    dlWebp.download = `snapshot-${tags.subject || 'mon'}-${tags.date || 'bai'}.webp`;
    dlWebp.textContent = 'Tải WebP';

    const dlPng = document.createElement('a');
    dlPng.className = 'card-action-btn';
    dlPng.href = buildSnapshotImageUrl(item.id, 'png', true);
    dlPng.download = `snapshot-${tags.subject || 'mon'}-${tags.date || 'bai'}.png`;
    dlPng.textContent = 'Tải PNG';

    actionsRow.append(zoomAction, dlWebp, dlPng);
    body.append(tagsRow, ocrText, teacherMeta, actionsRow);
    card.append(thumbBtn, body);
    grid.appendChild(card);
  });

  if (pagination && pageInfo) {
    const totalPages = Math.max(1, Math.ceil(portalState.totalCount / PAGE_LIMIT));
    const currentPage = Math.floor(portalState.offset / PAGE_LIMIT) + 1;
    pagination.hidden = portalState.totalCount <= PAGE_LIMIT;
    pageInfo.textContent = `Trang ${currentPage} / ${totalPages}`;
    $('galleryPrevPageBtn').disabled = portalState.offset <= 0;
    $('galleryNextPageBtn').disabled = portalState.offset + PAGE_LIMIT >= portalState.totalCount;
  }
}

async function loadClassLessons() {
  if (!portalState.session?.access_token) return;
  const t0 = performance.now();

  try {
    const className = portalState.session.class_name || portalState.session.allowed_classes?.[0] || '10A1';
    const [lessonsData, scoreHist] = await Promise.all([
      fetchStudentClassLessons({
        className,
        subject: portalState.selectedSubject || undefined,
        date: portalState.selectedDate || undefined,
        q: portalState.searchQuery || undefined,
        limit: PAGE_LIMIT,
        offset: portalState.offset,
      }),
      fetch(`/api/v1/scores/history?class_name=${encodeURIComponent(className)}`, {
        headers: getPortalAuthHeaders(),
      })
        .then((r) => (r.ok ? r.json() : { count: 0 }))
        .catch(() => ({ count: 0 })),
    ]);

    portalState.lessons = lessonsData.items || [];
    for (const lesson of portalState.lessons) {
      if (lesson?.id && lesson.signed_exp && lesson.signed_sig) {
        portalState.signedUrlTokens.set(lesson.id, {
          exp: lesson.signed_exp,
          sig: lesson.signed_sig,
        });
      }
    }
    portalState.totalCount = Number(lessonsData.total_count ?? portalState.lessons.length);
    portalState.calendarCounts = lessonsData.calendar_counts || {};

    const elapsedMs = Math.max(1, Math.round(performance.now() - t0));
    $('statAllowedClass').textContent = (lessonsData.allowed_classes || [className]).join(', ');
    $('statTotalLessons').textContent = String(portalState.totalCount);
    $('statLoadTiming').textContent = `Tải trang đầu trong ${elapsedMs} ms (< 1500 ms)`;
    $('statClassBonusCount').textContent = `${scoreHist.count || 0} lượt`;

    renderCalendar();
    renderGallery();
  } catch (err) {
    showBanner(`Không thể tải danh sách bài học: ${err.message}`, 'error');
    if (String(err.message).includes('401') || String(err.message).includes('Token')) {
      clearPortalSession();
      portalState.session = null;
      renderAuthView();
    }
  }
}

function buildSampleCanvasDataUrl(titleText, formulaText, strokeColor = '#1e3a8a') {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, 924, 504);
  ctx.fillStyle = '#172554';
  ctx.font = 'bold 34px Arial, sans-serif';
  ctx.fillText(titleText, 48, 95);
  ctx.fillStyle = strokeColor;
  ctx.font = '28px Georgia, serif';
  ctx.fillText(formulaText, 48, 175);
  ctx.beginPath();
  ctx.moveTo(60, 320);
  ctx.quadraticCurveTo(320, 210, 580, 360);
  ctx.stroke();
  return canvas.toDataURL('image/png');
}

async function seedSampleSnapshotsForClass() {
  const className = portalState.session?.class_name || portalState.session?.allowed_classes?.[0] || '10A1';
  const samples = [
    {
      subject: 'TOAN',
      period_number: 1,
      teacher_name: 'Cô Nguyễn Thị Minh',
      recognized_latex: 'Hàm số bậc hai: y = x^2 - 4x + 3, Đỉnh I(2, -1)',
      color: '#1e3a8a',
    },
    {
      subject: 'VAT_LY',
      period_number: 2,
      teacher_name: 'Thầy Trần Văn Hùng',
      recognized_latex: 'Định luật II Newton: F = m * a (Đơn vị: Newton)',
      color: '#0f766e',
    },
    {
      subject: 'TIENG_ANH',
      period_number: 3,
      teacher_name: 'Cô Lê Thảo My',
      recognized_latex: 'Vocabulary: Photosynthesis - Quá trình quang hợp',
      color: '#9333ea',
    },
  ];

  showBanner(`Đang tạo 3 bài giảng mẫu cho lớp ${className}...`, 'info');
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...getPortalAuthHeaders(),
    };
    const payloadBody = JSON.stringify({
      session_id: `portal-demo-${className}-${i + 1}`,
      room_id: `room-${className.toLowerCase()}`,
      teacher_name: s.teacher_name,
      class_name: className,
      subject: s.subject,
      period_number: s.period_number,
      page_number: 1,
      trigger_type: 'MANUAL_SAVE',
      recognized_latex: s.recognized_latex,
      image_base64: buildSampleCanvasDataUrl(`Bài giảng mẫu ${s.subject} - Lớp ${className}`, s.recognized_latex, s.color),
    });
    let res = await fetch('/api/v1/demo/portal-sample-snapshot', {
      method: 'POST',
      headers: reqHeaders,
      body: payloadBody,
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.status === 404 || res.status === 405 || contentType.includes('text/html')) {
      res = await fetch('/api/v1/sessions/snapshots', {
        method: 'POST',
        headers: reqHeaders,
        body: payloadBody,
      });
    }
    if (res.status === 403) {
      showBanner('Tính năng tạo bài giảng mẫu đã tắt trên môi trường chính thức.', 'error');
      return;
    }
  }
  showBanner(`Đã tạo xong 3 ảnh bài học mẫu cho lớp ${className}.`, 'success');
  await loadClassLessons();
}

function renderAuthView() {
  const session = portalState.session;
  const loggedIn = Boolean(session && session.access_token);
  $('portalAuthSection').hidden = loggedIn;
  $('portalLessonsSection').hidden = !loggedIn;
  $('portalUserBadge').hidden = !loggedIn;
  $('portalLogoutBtn').hidden = !loggedIn;

  if (loggedIn) {
    const roleLabel = session.role === 'PARENT' ? 'Phụ huynh' : 'Học sinh';
    $('portalUserBadge').textContent = `${roleLabel}: ${session.full_name} · Lớp ${session.class_name || ''}`;
    $('statStudentMeta').textContent = `Tài khoản ${roleLabel} · Mã HS: ${session.student_code || '—'}`;
    void loadClassLessons();
  }
}

function bindEvents() {
  $('tabAuthLogin')?.addEventListener('click', () => switchAuthTab('login'));
  $('tabAuthRegister')?.addEventListener('click', () => switchAuthTab('register'));
  $('tabAuthForgot')?.addEventListener('click', () => switchAuthTab('forgot'));

  $('toggleLoginPwBtn')?.addEventListener('click', () => {
    const input = $('loginPasswordInput');
    const btn = $('toggleLoginPwBtn');
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(reveal));
    btn.textContent = reveal ? 'Ẩn' : 'Hiện';
  });

  // Auto-select PARENT when level == TIEU_HOC
  $('regLevelSelect')?.addEventListener('change', (e) => {
    if (e.target.value === 'TIEU_HOC') {
      $('regRoleSelect').value = 'PARENT';
    }
  });

  $('portalLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideBanner();
    try {
      const data = await loginStudentOrParent({
        phoneNumber: $('loginPhoneInput').value.trim(),
        password: $('loginPasswordInput').value,
      });
      portalState.session = data;
      showBanner('Đăng nhập Cổng ôn tập thành công.', 'success');
      renderAuthView();
    } catch (err) {
      showBanner(err.message, 'error');
    }
  });

  $('fillPortalDemoBtn')?.addEventListener('click', async () => {
    hideBanner();
    const demoPhone = '0905101010';
    const demoPass = 'HocSinh@2026';
    try {
      let data;
      try {
        data = await loginStudentOrParent({ phoneNumber: demoPhone, password: demoPass });
      } catch {
        data = await registerStudentOrParent({
          fullName: 'Nguyễn Minh Anh',
          phoneNumber: demoPhone,
          password: demoPass,
          schoolLevel: 'THPT',
          className: '10A1',
          studentCode: 'HS-10A1-DEMO',
          role: 'STUDENT',
        });
      }
      portalState.session = data;
      showBanner('Đã đăng nhập tài khoản học sinh mẫu lớp 10A1.', 'success');
      renderAuthView();
    } catch (err) {
      showBanner(err.message, 'error');
    }
  });

  $('portalRegisterForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideBanner();
    try {
      const data = await registerStudentOrParent({
        schoolLevel: $('regLevelSelect').value,
        role: $('regRoleSelect').value,
        fullName: $('regFullNameInput').value.trim(),
        studentCode: $('regStudentCodeInput').value.trim(),
        className: $('regClassInput').value.trim(),
        phoneNumber: $('regPhoneInput').value.trim(),
        password: $('regPasswordInput').value,
      });
      portalState.session = data;
      showBanner('Đăng ký thành công (ràng buộc 1 học sinh = 1 tài khoản).', 'success');
      renderAuthView();
    } catch (err) {
      showBanner(err.message, 'error');
    }
  });

  $('portalRequestOtpForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideBanner();
    try {
      const res = await requestPasswordResetOtp($('forgotPhoneInput').value.trim());
      const devHint = res.dev_otp_code ? ` (Mã OTP thử nghiệm: ${res.dev_otp_code})` : '';
      showBanner(`Đã gửi mã OTP 6 số khôi phục mật khẩu.${devHint}`, 'info');
    } catch (err) {
      showBanner(err.message, 'error');
    }
  });

  $('portalResetPwForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideBanner();
    try {
      await resetPasswordWithOtp({
        phoneNumber: $('forgotPhoneInput').value.trim(),
        otpCode: $('resetOtpInput').value.trim(),
        newPassword: $('resetNewPwInput').value,
      });
      showBanner('Đặt lại mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.', 'success');
      switchAuthTab('login');
    } catch (err) {
      showBanner(err.message, 'error');
    }
  });

  $('portalLogoutBtn')?.addEventListener('click', () => {
    clearPortalSession();
    portalState.session = null;
    portalState.lessons = [];
    showBanner('Đã đăng xuất khỏi Cổng ôn tập.', 'info');
    renderAuthView();
  });

  $('filterDateInput')?.addEventListener('change', (e) => {
    portalState.selectedDate = e.target.value;
    portalState.offset = 0;
    renderCalendar();
    void loadClassLessons();
  });

  $('filterSubjectSelect')?.addEventListener('change', (e) => {
    portalState.selectedSubject = e.target.value;
    portalState.offset = 0;
    void loadClassLessons();
  });

  $('filterQueryInput')?.addEventListener('input', (e) => {
    portalState.searchQuery = e.target.value;
    portalState.offset = 0;
    void loadClassLessons();
  });

  $('clearFiltersBtn')?.addEventListener('click', () => {
    portalState.selectedDate = '';
    portalState.selectedSubject = '';
    portalState.searchQuery = '';
    portalState.offset = 0;
    if ($('filterDateInput')) $('filterDateInput').value = '';
    if ($('filterSubjectSelect')) $('filterSubjectSelect').value = '';
    if ($('filterQueryInput')) $('filterQueryInput').value = '';
    renderCalendar();
    void loadClassLessons();
  });

  $('viewGalleryBtn')?.addEventListener('click', () => setViewMode('gallery'));
  $('viewCalendarBtn')?.addEventListener('click', () => setViewMode('calendar'));

  $('calPrevMonthBtn')?.addEventListener('click', () => {
    portalState.calendarMonth -= 1;
    if (portalState.calendarMonth < 0) {
      portalState.calendarMonth = 11;
      portalState.calendarYear -= 1;
    }
    renderCalendar();
  });

  $('calNextMonthBtn')?.addEventListener('click', () => {
    portalState.calendarMonth += 1;
    if (portalState.calendarMonth > 11) {
      portalState.calendarMonth = 0;
      portalState.calendarYear += 1;
    }
    renderCalendar();
  });

  $('calTodayBtn')?.addEventListener('click', () => {
    const now = new Date();
    portalState.calendarYear = now.getFullYear();
    portalState.calendarMonth = now.getMonth();
    portalState.selectedDate = '';
    if ($('filterDateInput')) $('filterDateInput').value = '';
    renderCalendar();
    void loadClassLessons();
  });

  $('galleryPrevPageBtn')?.addEventListener('click', () => {
    portalState.offset = Math.max(0, portalState.offset - PAGE_LIMIT);
    void loadClassLessons();
  });

  $('galleryNextPageBtn')?.addEventListener('click', () => {
    portalState.offset += PAGE_LIMIT;
    void loadClassLessons();
  });

  $('seedSampleLessonsBtn')?.addEventListener('click', () => void seedSampleSnapshotsForClass());
  $('emptyCreateSampleBtn')?.addEventListener('click', () => void seedSampleSnapshotsForClass());

  // Zoom controls trong Lightbox
  $('zoomInBtn')?.addEventListener('click', () => {
    portalState.zoomScale = Math.min(3, Number((portalState.zoomScale + 0.5).toFixed(1)));
    updateLightboxImageZoom();
  });
  $('zoomOutBtn')?.addEventListener('click', () => {
    portalState.zoomScale = Math.max(0.5, Number((portalState.zoomScale - 0.5).toFixed(1)));
    updateLightboxImageZoom();
  });
  $('zoomResetBtn')?.addEventListener('click', () => {
    portalState.zoomScale = 1;
    updateLightboxImageZoom();
  });
}

bindEvents();
renderAuthView();
