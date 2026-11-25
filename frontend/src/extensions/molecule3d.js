/**
 * Phần bổ sung riêng: xem phân tử 3D bằng 3Dmol.js.
 * KHÔNG thay đổi các file của bảng vẽ hiện có.
 * Khi công cụ Chữ / Chuyển chữ chèn H2O, CH4, C6H6 lên bảng,
 * mô hình tương ứng được mở tự động.
 */
import { $, toolbar, fabricCanvas, state } from '../utils/context.js';
import { makePanelDraggable } from '../utils/floating_drag.js';

// Chỉ đăng ký sau khi bảng vẽ đã hoàn tất khởi tạo.
await import('../../app.js');

const LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.4.2/3Dmol-min.js';
const MOLECULES = {
  H2O: {
    label: 'Nước (H₂O)', geometry: 'Dạng gấp khúc', angle: 'H–O–H ≈ 104,5°',
    atoms: [
      ['O', 0, 0, 0],
      ['H', 0.9572, 0, 0],
      ['H', -0.2399, 0.9266, 0]
    ],
    bonds: [[1, 2, 1], [1, 3, 1]]
  },
  CH4: {
    label: 'Metan (CH₄)', geometry: 'Tứ diện', angle: 'H–C–H ≈ 109,5°',
    atoms: [
      ['C', 0, 0, 0],
      ['H', 0.6287, 0.6287, 0.6287],
      ['H', -0.6287, -0.6287, 0.6287],
      ['H', -0.6287, 0.6287, -0.6287],
      ['H', 0.6287, -0.6287, -0.6287]
    ],
    bonds: [[1, 2, 1], [1, 3, 1], [1, 4, 1], [1, 5, 1]]
  },
  C6H6: {
    label: 'Benzen (C₆H₆)', geometry: 'Vòng lục giác phẳng', angle: 'C–C–C ≈ 120°',
    atoms: Array.from({ length: 6 }, (_, i) => {
      const t = i * Math.PI / 3;
      return ['C', 1.397 * Math.cos(t), 1.397 * Math.sin(t), 0];
    }).concat(Array.from({ length: 6 }, (_, i) => {
      const t = i * Math.PI / 3;
      return ['H', 2.487 * Math.cos(t), 2.487 * Math.sin(t), 0];
    })),
    bonds: Array.from({ length: 6 }, (_, i) => [i + 1, (i + 1) % 6 + 1, i % 2 === 0 ? 2 : 1])
      .concat(Array.from({ length: 6 }, (_, i) => [i + 1, i + 7, 1]))
  }
};

// Chuẩn hóa chỉ số Unicode (H₂O, CH₄, C₆H₆) và chữ thường do OCR sinh ra.
function findFormula(text) {
  const normalized = String(text || '')
    .replace(/[₀-₉]/g, (digit) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(digit)))
    .toUpperCase();
  const match = normalized.match(/(?:^|[^A-Z0-9])(H\s*2\s*O|C\s*H\s*4|C\s*6\s*H\s*6)(?=$|[^A-Z0-9])/);
  return match ? match[1].replace(/\s+/g, '') : null;
}

// 3Dmol.js đọc định dạng MDL SDF, không cần API/server để tải cấu trúc.
function makeSdf(molecule) {
  const coords = (number) => number.toFixed(4).padStart(10, ' ');
  const atoms = molecule.atoms.map(([el, x, y, z]) =>
    `${coords(x)}${coords(y)}${coords(z)} ${el.padEnd(3, ' ')} 0  0  0  0  0  0  0  0  0  0  0  0`
  );
  const bonds = molecule.bonds.map(([from, to, order]) =>
    `${String(from).padStart(3, ' ')}${String(to).padStart(3, ' ')}${String(order).padStart(3, ' ')}  0  0  0  0`
  );
  const counts = `${String(atoms.length).padStart(3, ' ')}${String(bonds.length).padStart(3, ' ')}  0  0  0  0            999 V2000`;
  return ['Molecule 3D', '  3Dmol', '', counts, ...atoms, ...bonds, 'M  END', '$$$$'].join('\n');
}

let libPromise = null;
function ensureLibrary() {
  if (window.$3Dmol) return Promise.resolve(window.$3Dmol);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = LIB_URL;
      script.async = true;
      script.onload = () => window.$3Dmol ? resolve(window.$3Dmol) : reject(new Error('3Dmol.js chưa sẵn sàng.'));
      script.onerror = () => reject(new Error('Không thể tải 3Dmol.js. Vui lòng kiểm tra Internet.'));
      document.head.append(script);
    }).catch((error) => {
      libPromise = null;
      throw error;
    });
  }
  return libPromise;
}

// Nút mở 3D nhỏ gọn, bố trí cùng các nút công cụ hiện có.
const button = document.createElement('button');
button.type = 'button';
button.id = 'molecule3dTool';
button.className = 'tool-button more-menu-item';
button.title = 'Dựng mô hình phân tử 3D (H2O, CH4, C6H6)';
button.dataset.guide = 'Mô hình Phân tử 3D — Nhập công thức hoá học (H2O, CH4, C6H6) và kéo chuột xoay 360° trực quan.';
button.textContent = 'Phân tử 3D';
(document.getElementById('handwritingTool') || toolbar.lastElementChild).insertAdjacentElement('afterend', button);

const panel = document.createElement('section');
panel.className = 'mol3d-panel';
panel.id = 'molecule3dPanel';
panel.hidden = true;
panel.setAttribute('role', 'dialog');
panel.setAttribute('aria-label', 'Mô hình phân tử 3D');
panel.innerHTML = `
  <div class="mol3d-heading">
    <strong>Mô hình phân tử 3D</strong>
    <button type="button" id="mol3dClose" aria-label="Đóng mô hình">×</button>
  </div>
  <form id="mol3dForm" class="mol3d-form">
    <label for="mol3dInput">Công thức</label>
    <input id="mol3dInput" value="H2O" maxlength="20" autocomplete="off" spellcheck="false" />
    <button type="submit">Dựng 3D</button>
  </form>
  <div class="mol3d-examples" aria-label="Phân tử mẫu">
    <button type="button" data-molecule="H2O">H₂O</button>
    <button type="button" data-molecule="CH4">CH₄</button>
    <button type="button" data-molecule="C6H6">C₆H₆</button>
  </div>
  <div id="mol3dViewer" class="mol3d-viewer" aria-label="Mô hình quả cầu và que nối có thể xoay"></div>
  <p id="mol3dInformation" class="mol3d-information"></p>
  <p id="mol3dStatus" class="mol3d-status" role="status" aria-live="polite"></p>
  <p class="mol3d-help">Kéo chuột để xoay · Lăn chuột để phóng to/thu nhỏ</p>
`;
document.body.append(panel);
makePanelDraggable(panel, panel.querySelector('.mol3d-heading'));

const input = $('mol3dInput');
const status = $('mol3dStatus');
const information = $('mol3dInformation');
const viewerContainer = $('mol3dViewer');
let viewer = null;
let renderCount = 0;

async function showFormula(formula) {
  const key = findFormula(formula);
  input.value = formula;
  panel.hidden = false;
  if (!key || !MOLECULES[key]) {
    status.textContent = 'Hiện hỗ trợ H2O, CH4 và C6H6.';
    return;
  }
  const request = ++renderCount;
  status.textContent = 'Đang dựng mô hình...';
  information.textContent = `${MOLECULES[key].label} · ${MOLECULES[key].geometry} · Góc liên kết ${MOLECULES[key].angle}`;
  try {
    const threeDmol = await ensureLibrary();
    if (request !== renderCount || panel.hidden) return;
    if (!viewer) viewer = threeDmol.createViewer(viewerContainer, { backgroundColor: 0xf8fafc });
    viewer.removeAllModels();
    viewer.addModel(makeSdf(MOLECULES[key]), 'sdf');
    viewer.setStyle({}, { stick: { radius: 0.15 }, sphere: { scale: 0.32 } });
    viewer.resize();
    viewer.zoomTo();
    viewer.render();
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message || 'Không dựng được mô hình 3D.';
    console.error('Molecule 3D:', error);
  }
}

function boardFormula() {
  const objects = fabricCanvas.getObjects();
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const formula = findFormula(objects[i].text);
    if (formula) return formula;
  }
  return null;
}

button.addEventListener('click', () => {
  if (panel.hidden) {
    void showFormula(boardFormula() || findFormula(input.value) || 'H2O');
  } else {
    panel.hidden = true;
  }
});

$('mol3dClose').addEventListener('click', () => { panel.hidden = true; });
$('mol3dForm').addEventListener('submit', (event) => {
  event.preventDefault();
  void showFormula(input.value);
});
panel.querySelectorAll('[data-molecule]').forEach((sample) => {
  sample.addEventListener('click', () => void showFormula(sample.dataset.molecule));
});

// Khi một công thức mới xuất hiện từ công cụ Chữ hoặc Chuyển chữ,
// tự dựng mô hình. Nét bút vẽ tay cần chuyển thành chữ bằng OCR có sẵn trước.
fabricCanvas.on('object:added', ({ target }) => {
  if (state.ended || state.pageBusy || typeof target?.text !== 'string') return;
  const formula = findFormula(target.text);
  if (formula) void showFormula(formula);
});
