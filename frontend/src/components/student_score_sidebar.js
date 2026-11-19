import { $, fabricCanvas, state, setStatus } from '../utils/context.js';
import { readStoredTeacherSession } from '../utils/auth_client.js';

const SCORES_API_BASE = '/api/v1/scores';

/**
 * Lọc danh sách học sinh theo tên hoặc mã học sinh (không phân biệt hoa/thường).
 */
export function filterStudentsByQuery(students, query) {
  if (!Array.isArray(students)) return [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return students;
  return students.filter((item) => {
    const name = String(item.full_name || '').toLowerCase();
    const code = String(item.student_code || '').toLowerCase();
    return name.includes(q) || code.includes(q);
  });
}

function clearChildren(el) {
  while (el && el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

export function setupStudentScoreSidebar() {
  const sidebar = document.querySelector('aside.students');
  const studentListEl = $('studentList');
  if (!sidebar || !studentListEl) return;

  const sidebarClassNameEl = $('sidebarClassName');
  const searchInput = $('studentSearchInput');
  const reasonInput = $('bonusScoreReasonInput');
  const attachSnapshotCheckbox = $('attachSnapshotOnScore');
  const scoreStepButtons = Array.from(document.querySelectorAll('.score-step-btn'));
  const scoreStatusEl = $('studentScoreStatus');
  const historyListEl = $('scoreHistoryList');
  const addStudentForm = $('addStudentRosterForm');
  const newStudentNameInput = $('newStudentNameInput');
  const newStudentCodeInput = $('newStudentCodeInput');

  const sidebarState = {
    className: ($('className')?.textContent || '10A1').trim() || '10A1',
    selectedStep: 1,
    students: [],
    history: [],
    awardingStudentId: null,
  };

  if (sidebarClassNameEl) {
    sidebarClassNameEl.textContent = sidebarState.className;
  }

  function showScoreStatus(message, variant = 'info') {
    if (!scoreStatusEl) return;
    scoreStatusEl.textContent = message;
    scoreStatusEl.dataset.variant = variant;
  }

  function updateStepButtons() {
    scoreStepButtons.forEach((btn) => {
      const step = Number(btn.dataset.step || 1);
      const active = step === sidebarState.selectedStep;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    renderStudentsList();
  }

  function captureBoardImageBase64() {
    if (!attachSnapshotCheckbox || !attachSnapshotCheckbox.checked) return null;
    try {
      if (typeof fabricCanvas.toDataURL === 'function') {
        return fabricCanvas.toDataURL({ format: 'png', multiplier: 1.5 });
      }
    } catch {
      return null;
    }
    return null;
  }

  function renderStudentsList(justAwardedId = null) {
    clearChildren(studentListEl);
    const filtered = filterStudentsByQuery(sidebarState.students, searchInput?.value || '');

    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'student-note';
      empty.textContent = 'Không tìm thấy học sinh phù hợp.';
      studentListEl.appendChild(empty);
      return;
    }

    filtered.forEach((student) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'student-item student-item-btn';
      if (justAwardedId && student.student_id === justAwardedId) {
        btn.classList.add('is-just-awarded');
      }
      btn.disabled = state.ended || sidebarState.awardingStudentId === student.student_id;
      btn.setAttribute(
        'aria-label',
        `Cộng +${sidebarState.selectedStep} điểm cho ${student.full_name}, hiện có ${student.total_points} điểm`
      );

      const metaWrap = document.createElement('span');
      metaWrap.className = 'student-meta-col';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'student-name';
      nameSpan.textContent = student.full_name;

      const subSpan = document.createElement('span');
      subSpan.className = 'student-subline';
      subSpan.textContent = `${student.student_code || 'HS'} · 🏆 ${student.total_points} đ`;

      metaWrap.append(nameSpan, subSpan);

      const plusBadge = document.createElement('b');
      plusBadge.className = 'student-plus-pill';
      plusBadge.textContent = `+${sidebarState.selectedStep}`;

      btn.append(metaWrap, plusBadge);
      btn.addEventListener('click', () => {
        void handleAwardBonus(student);
      });
      studentListEl.appendChild(btn);
    });
  }

  function renderHistoryList() {
    if (!historyListEl) return;
    clearChildren(historyListEl);
    const recent = sidebarState.history.slice(0, 8);
    if (recent.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'score-history-empty';
      empty.textContent = 'Chưa có lượt cộng điểm nào trong lớp.';
      historyListEl.appendChild(empty);
      return;
    }

    recent.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'score-history-item';

      const topRow = document.createElement('div');
      topRow.className = 'score-history-top';

      const who = document.createElement('strong');
      who.textContent = item.student_name;

      const delta = document.createElement('span');
      delta.className = 'score-history-delta';
      delta.textContent = `+${item.points_added}`;

      topRow.append(who, delta);

      const detail = document.createElement('div');
      detail.className = 'score-history-meta';
      const timeStr = item.created_at ? new Date(item.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
      const snapLabel = item.snapshot_id ? ' · 📸 Snapshot' : '';
      detail.textContent = `${item.reason || 'Thưởng'} (${timeStr}${snapLabel})`;

      li.append(topRow, detail);
      historyListEl.appendChild(li);
    });
  }

  async function refreshRosterAndHistory(justAwardedId = null) {
    try {
      const clsParam = encodeURIComponent(sidebarState.className);
      const [stuRes, histRes] = await Promise.all([
        fetch(`${SCORES_API_BASE}/students?class_name=${clsParam}`),
        fetch(`${SCORES_API_BASE}/history?class_name=${clsParam}`),
      ]);
      if (stuRes.ok) {
        const stuData = await stuRes.json();
        sidebarState.students = stuData.items || [];
      }
      if (histRes.ok) {
        const histData = await histRes.json();
        sidebarState.history = histData.items || [];
      }
      renderStudentsList(justAwardedId);
      renderHistoryList();
    } catch {
      showScoreStatus('Không kết nối được API điểm thưởng; kiểm tra backend.', 'error');
    }
  }

  async function handleAwardBonus(student) {
    if (state.ended || sidebarState.awardingStudentId) return;
    sidebarState.awardingStudentId = student.student_id;
    renderStudentsList();

    const teacherSess = readStoredTeacherSession();
    const teacherName = teacherSess?.full_name || teacherSess?.email || 'Giáo viên';
    const imageBase64 = captureBoardImageBase64();
    const reason = (reasonInput?.value || '').trim() || 'Làm bài tốt trên bảng';
    const pts = sidebarState.selectedStep;

    showScoreStatus(`Đang cộng +${pts} điểm cho ${student.full_name}...`, 'info');
    try {
      const res = await fetch(`${SCORES_API_BASE}/award`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_name: sidebarState.className,
          session_id: $('sessionId')?.textContent?.trim() || 'session-10a1',
          room_id: $('roomId')?.textContent?.trim() || 'room-10a1',
          student_id: student.student_id,
          student_name: student.full_name,
          teacher_name: teacherName,
          subject: $('subjectSelect')?.value || 'TOAN',
          page_number: (state.pageIndex || 0) + 1,
          points_added: pts,
          reason,
          image_base64: imageBase64,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Lỗi HTTP ${res.status}`);
      }
      const data = await res.json();
      const snapNote = data.snapshot_saved ? ' (đã lưu kèm ảnh bài làm)' : '';
      const msg = `✓ Đã cộng +${pts} điểm cho ${student.full_name} → Tổng ${data.total_points} đ${snapNote}`;
      showScoreStatus(msg, 'success');
      setStatus(msg);
      await refreshRosterAndHistory(student.student_id);
    } catch (err) {
      showScoreStatus(`Không cộng được điểm: ${err.message}`, 'error');
    } finally {
      sidebarState.awardingStudentId = null;
      renderStudentsList();
    }
  }

  scoreStepButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      sidebarState.selectedStep = Number(btn.dataset.step || 1);
      updateStepButtons();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => renderStudentsList());
  }

  if (addStudentForm) {
    addStudentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fullName = (newStudentNameInput?.value || '').trim();
      const studentCode = (newStudentCodeInput?.value || '').trim();
      if (fullName.length < 2) {
        showScoreStatus('Vui lòng nhập họ tên học sinh (tối thiểu 2 ký tự).', 'error');
        return;
      }
      try {
        const res = await fetch(`${SCORES_API_BASE}/students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            class_name: sidebarState.className,
            full_name: fullName,
            student_code: studentCode || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || 'Không thêm được học sinh');
        }
        addStudentForm.reset();
        showScoreStatus(`Đã thêm ${fullName} vào lớp ${sidebarState.className}.`, 'success');
        await refreshRosterAndHistory();
      } catch (err) {
        showScoreStatus(err.message, 'error');
      }
    });
  }

  updateStepButtons();
  void refreshRosterAndHistory();
}
