import { stage } from './context.js';

function relRect(el, stageRect) {
  if (!el || el.hidden) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return {
    left: r.left - stageRect.left,
    top: r.top - stageRect.top,
    right: r.right - stageRect.left,
    bottom: r.bottom - stageRect.top,
  };
}

/**
 * Vùng nhìn thấy an toàn trên mặt bảng (toạ độ màn hình so với #canvasStage):
 * né thanh trên cùng, thanh công cụ (mọi vị trí dock), cụm Zoom / Trang / Trạng thái phía dưới
 * để nút xoay, thanh tác vụ nhanh và đối tượng mới đặt không bị chìm sau các thanh này.
 */
export function getSafeAreaScreen(margin = 10) {
  const sw = stage?.clientWidth || window.innerWidth || 1024;
  const sh = stage?.clientHeight || window.innerHeight || 720;
  const stageRect = stage?.getBoundingClientRect?.() || { left: 0, top: 0 };
  const area = { left: 8, top: 8, right: sw - 8, bottom: sh - 8 };

  const topbar = relRect(document.querySelector('.topbar'), stageRect);
  if (topbar && topbar.top < sh / 2) {
    area.top = Math.max(area.top, topbar.bottom + margin);
  }

  const toolbar = relRect(document.getElementById('toolbar'), stageRect);
  if (toolbar) {
    const tw = toolbar.right - toolbar.left;
    const th = toolbar.bottom - toolbar.top;
    if (tw >= th * 1.4) {
      if ((toolbar.top + toolbar.bottom) / 2 < sh / 2) {
        area.top = Math.max(area.top, toolbar.bottom + margin);
      } else {
        area.bottom = Math.min(area.bottom, toolbar.top - margin);
      }
    } else if ((toolbar.left + toolbar.right) / 2 < sw / 2) {
      area.left = Math.max(area.left, toolbar.right + margin);
    } else {
      area.right = Math.min(area.right, toolbar.left - margin);
    }
  }

  ['.pagination', '.zoom-controls', '.status-cluster'].forEach((sel) => {
    const r = relRect(document.querySelector(sel), stageRect);
    if (r && r.top > sh / 2) {
      area.bottom = Math.min(area.bottom, r.top - margin);
    }
  });

  if (area.bottom - area.top < 120) {
    area.top = 8;
    area.bottom = sh - 8;
  }
  if (area.right - area.left < 120) {
    area.left = 8;
    area.right = sw - 8;
  }
  return area;
}

/** Các hộp nổi tạm thời (bảng tuỳ chỉnh nét, nút chấm màu) mà thanh tác vụ không được nằm đè lên. */
export function getBlockingPanelRects(margin = 6) {
  const stageRect = stage?.getBoundingClientRect?.() || { left: 0, top: 0 };
  const out = [];
  ['contextPropertyPanel', 'reopenInspectorBtn'].forEach((id) => {
    const r = relRect(document.getElementById(id), stageRect);
    if (r) {
      out.push({
        left: r.left - margin,
        top: r.top - margin,
        right: r.right + margin,
        bottom: r.bottom + margin,
      });
    }
  });
  return out;
}

export function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function clampRange(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}
