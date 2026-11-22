/**
 * Module Đo kiểm hiệu năng, độ trễ nét vẽ và kiểm thử cô lập dữ liệu nhiều lớp (Task TF28522)
 * Hỗ trợ:
 * 1. Đo FPS live và độ trễ nét vẽ (< 16ms).
 * 2. Gọi API Backend chạy toàn diện 4 hạng mục kiểm thử.
 * 3. Hiển thị báo cáo trực quan cho giáo viên / quản trị viên.
 */

export class PerformanceBenchmarkManager {
  constructor() {
    this.apiBase = '/api/v1/benchmark';
    this.dialog = document.getElementById('benchmarkDialog');
    this.openBtn = document.getElementById('benchmarkBtn');
    this.closeBtn = document.getElementById('closeBenchmarkBtn');
    this.runBtn = document.getElementById('runBenchmarkAuditBtn');
    this.resultsContainer = document.getElementById('benchmarkResultsContainer');
    this.loadingIndicator = document.getElementById('benchmarkLoadingIndicator');
    this.fpsCounterEl = document.getElementById('benchmarkFpsValue');

    this.isTrackingFps = false;
    this.rafId = null;
    this.frameCount = 0;
    this.lastFpsTimestamp = performance.now();
    this.currentFps = 60;

    this.init();
  }

  init() {
    if (this.openBtn) {
      this.openBtn.addEventListener('click', () => this.openDialog());
    }
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.closeDialog());
    }
    if (this.runBtn) {
      this.runBtn.addEventListener('click', () => this.triggerAudit());
    }
    this.startFpsTracking();
  }

  startFpsTracking() {
    this.isTrackingFps = true;
    const trackFrame = (now) => {
      this.frameCount++;
      const delta = now - this.lastFpsTimestamp;
      if (delta >= 500) {
        this.currentFps = Math.round((this.frameCount * 1000) / delta);
        this.frameCount = 0;
        this.lastFpsTimestamp = now;
        if (this.fpsCounterEl) {
          this.fpsCounterEl.textContent = `${this.currentFps} FPS`;
          this.fpsCounterEl.className = this.currentFps >= 58 ? 'fps-good' : (this.currentFps >= 45 ? 'fps-warning' : 'fps-danger');
        }
      }
      if (this.isTrackingFps) {
        this.rafId = requestAnimationFrame(trackFrame);
      }
    };
    this.rafId = requestAnimationFrame(trackFrame);
  }

  openDialog() {
    if (!this.dialog) return;
    if (typeof this.dialog.showModal === 'function') {
      this.dialog.showModal();
    } else {
      this.dialog.removeAttribute('hidden');
    }
    // Tự động chạy lần đầu nếu chưa có kết quả
    if (!this.resultsContainer || this.resultsContainer.children.length === 0) {
      this.triggerAudit();
    }
  }

  closeDialog() {
    if (!this.dialog) return;
    if (typeof this.dialog.close === 'function') {
      this.dialog.close();
    } else {
      this.dialog.setAttribute('hidden', '');
    }
  }

  async triggerAudit() {
    if (this.runBtn) this.runBtn.disabled = true;
    if (this.loadingIndicator) this.loadingIndicator.removeAttribute('hidden');
    if (this.resultsContainer) this.resultsContainer.innerHTML = '';

    try {
      const response = await fetch(`${this.apiBase}/run-full-audit?simulated_strokes_count=100&degraded_latency_ms=1800`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Lỗi máy chủ: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.renderResults(data);
    } catch (err) {
      if (this.resultsContainer) {
        this.resultsContainer.innerHTML = `
          <div class="benchmark-error">
            <strong>❌ Không thể thực hiện đo kiểm:</strong> ${err.message}
          </div>
        `;
      }
    } finally {
      if (this.runBtn) this.runBtn.disabled = false;
      if (this.loadingIndicator) this.loadingIndicator.setAttribute('hidden', '');
    }
  }

  renderResults(data) {
    if (!this.resultsContainer) return;
    const stroke = data.stroke_latency || {};
    const aiNorm = data.ai_response_normal || {};
    const aiDeg = data.ai_response_degraded || {};
    const formula = data.formula_accuracy || {};
    const iso = data.multi_room_isolation || {};

    const overallBadgeClass = data.all_criteria_met ? 'badge-passed' : 'badge-failed';
    const overallText = data.all_criteria_met ? 'PASSED - TẤT CẢ TIÊU CHÍ ĐẠT' : 'FAILED - CẦN TỐI ƯU';

    this.resultsContainer.innerHTML = `
      <div class="benchmark-header-summary">
        <div class="summary-status-pill ${overallBadgeClass}">${overallText}</div>
        <span class="summary-timestamp">Thời điểm đo: ${new Date(data.timestamp).toLocaleTimeString('vi-VN')}</span>
      </div>

      <div class="benchmark-cards-grid">
        <!-- 1. Độ trễ nét vẽ cảm ứng -->
        <div class="benchmark-card ${stroke.passed ? 'card-success' : 'card-danger'}">
          <div class="card-icon">✍️</div>
          <div class="card-content">
            <h4>Độ trễ nét bút cảm ứng</h4>
            <div class="metric-highlight">${stroke.avg_ms ?? 0} ms <small>(Max: ${stroke.max_ms ?? 0} ms)</small></div>
            <p>Mục tiêu: &lt; 16.0 ms | Chuẩn: ${stroke.fps_equivalent ?? 60} FPS</p>
            <span class="status-badge ${stroke.passed ? 'badge-passed' : 'badge-failed'}">
              ${stroke.passed ? '✅ Đạt chuẩn 60FPS' : '❌ Vượt ngưỡng'}
            </span>
          </div>
        </div>

        <!-- 2. AI Mạng bình thường -->
        <div class="benchmark-card ${aiNorm.passed ? 'card-success' : 'card-danger'}">
          <div class="card-icon">⚡</div>
          <div class="card-content">
            <h4>AI Mạng bình thường</h4>
            <div class="metric-highlight">${aiNorm.response_time_ms ?? 0} ms</div>
            <p>Mục tiêu: &le; 2.0s (2000 ms) | Bộ nhận diện: ${aiNorm.provider_used ?? 'auto'}</p>
            <span class="status-badge ${aiNorm.passed ? 'badge-passed' : 'badge-failed'}">
              ${aiNorm.passed ? '✅ Phản hồi tức thì (&le; 2s)' : '❌ Quá hạn'}
            </span>
          </div>
        </div>

        <!-- 3. AI Mạng yếu / 3G -->
        <div class="benchmark-card ${aiDeg.passed ? 'card-success' : 'card-danger'}">
          <div class="card-icon">📶</div>
          <div class="card-content">
            <h4>AI Mạng yếu (Simulated 3G)</h4>
            <div class="metric-highlight">${aiDeg.total_response_time_ms ?? 0} ms</div>
            <p>Mục tiêu: &le; 5.0s (5000 ms) | Trễ jitter: ${aiDeg.simulated_network_delay_ms ?? 1800} ms</p>
            <span class="status-badge ${aiDeg.passed ? 'badge-passed' : 'badge-failed'}">
              ${aiDeg.passed ? '✅ Chống chịu mạng tốt (&le; 5s)' : '❌ Quá hạn'}
            </span>
          </div>
        </div>

        <!-- 4. Độ chính xác công thức SGK -->
        <div class="benchmark-card ${formula.passed ? 'card-success' : 'card-danger'}">
          <div class="card-icon">📐</div>
          <div class="card-content">
            <h4>Nhận diện công thức SGK</h4>
            <div class="metric-highlight">${formula.accuracy_percent ?? 0}% <small>(${formula.correct_recognitions ?? 0}/${formula.dataset_size ?? 0})</small></div>
            <p>Mục tiêu: &ge; 90.0% (Tập 30+ công thức Toán, Lý, Hóa)</p>
            <span class="status-badge ${formula.passed ? 'badge-passed' : 'badge-failed'}">
              ${formula.passed ? '✅ Độ chính xác cao (&ge; 90%)' : '❌ Dưới ngưỡng'}
            </span>
          </div>
        </div>
      </div>

      <!-- 5. Ma trận cô lập đa phòng học -->
      <div class="benchmark-isolation-box ${iso.passed ? 'card-success' : 'card-danger'}">
        <div class="isolation-title">
          <span>🔒 Kiểm thử cô lập dữ liệu 2 phòng học chạy song song:</span>
          <strong class="${iso.passed ? 'text-success' : 'text-danger'}">
            ${iso.passed ? 'ZERO CROSS-LEAKAGE (0% RÒ RỈ DỮ LIỆU)' : 'PHÁT HIỆN RÒ RỈ CHÉO'}
          </strong>
        </div>
        <div class="isolation-checks-grid">
          <div class="check-item ${iso.dimensions?.pages_isolation?.passed ? 'ok' : 'fail'}">
            <span class="check-mark">✔</span> Trang vẽ (Pages): Phòng A (${iso.dimensions?.pages_isolation?.room_a_pages || 2} trang) | Phòng B (${iso.dimensions?.pages_isolation?.room_b_pages || 1} trang)
          </div>
          <div class="check-item ${iso.dimensions?.snapshots_isolation?.passed ? 'ok' : 'fail'}">
            <span class="check-mark">✔</span> Ảnh bảng (Snapshots): Phân tách tuyệt đối theo room_id
          </div>
          <div class="check-item ${iso.dimensions?.scores_isolation?.passed ? 'ok' : 'fail'}">
            <span class="check-mark">✔</span> Điểm thưởng (Scores): Sổ điểm 2 lớp độc lập
          </div>
          <div class="check-item ${iso.dimensions?.circle_submissions_isolation?.passed ? 'ok' : 'fail'}">
            <span class="check-mark">✔</span> Bài trắc nghiệm (Circles): Không lẫn lượt làm bài
          </div>
          <div class="check-item ${iso.dimensions?.websocket_channel_isolation?.passed ? 'ok' : 'fail'}">
            <span class="check-mark">✔</span> Kênh WebSocket (Realtime): Tách biệt theo room_id:session_id
          </div>
        </div>
      </div>
    `;
  }
}

// Tự động khởi tạo khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  window.performanceBenchmarkManager = new PerformanceBenchmarkManager();
});
