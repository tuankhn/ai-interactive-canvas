/**
 * Three.js: hình chóp, lăng trụ, mặt cầu, hình nón và mặt cắt ngang.
 * Tích hợp trực tiếp vào menu Hình của index.html, giữ nguyên các công cụ 2D.
 */
import { parseGeometryProblem } from './geometry_3d_parser.js';
import { $, fabricCanvas, state } from '../utils/context.js';
import { makePanelDraggable } from '../utils/floating_drag.js';
import { closePanels } from './toolbar.js';

// Chờ bảng vẽ gốc hoàn tất khởi tạo, tương tự extension phân tử có sẵn.
await import('../../app.js');

// Sử dụng nút có sẵn trong popup Hình, không thêm nút riêng ở thanh công cụ.
const toolButton = $('geometry3dTool');
if (toolButton && !document.getElementById('geom3dPanel')) {

  const panel = document.createElement('section');
  panel.id = 'geom3dPanel';
  panel.className = 'geom3d-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Hình học không gian 3D');
  panel.innerHTML = `
    <div class="geom3d-titlebar">
      <strong>Hình học không gian 3D</strong>
      <button type="button" id="geom3dClose" aria-label="Đóng hình học 3D">✕</button>
    </div>
    <form id="geom3dForm">
      <label for="geom3dProblem">Nhập đề bài hình học không gian</label>
      <textarea id="geom3dProblem" spellcheck="false" placeholder="Ví dụ: Hình chóp tứ giác đều có cạnh đáy 4 và chiều cao 6.">Hình chóp tứ giác đều có cạnh đáy 4 và chiều cao 6.</textarea>
      <div class="geom3d-buttons">
        <button type="submit" class="geom3d-primary">Dựng mô hình</button>
        <button type="button" id="geom3dResetView">Đặt lại góc nhìn</button>
      </div>
    </form>
    <div class="geom3d-samples" role="group" aria-label="Đề bài mẫu">
      <button type="button" data-geom3d-sample="pyramid">Hình chóp</button>
      <button type="button" data-geom3d-sample="prism">Lăng trụ</button>
      <button type="button" data-geom3d-sample="sphere">Mặt cầu</button>
      <button type="button" data-geom3d-sample="cone">Hình nón</button>
    </div>
    <div id="geom3dViewport" class="geom3d-canvas" aria-label="Mô hình 3D kéo để xoay 360 độ, cuộn hoặc chụm hai ngón để thu phóng"></div>
    <p class="geom3d-viewport-note">Kéo chuột / bút / một ngón để xoay 360° · Cuộn chuột hoặc chụm hai ngón để phóng to, thu nhỏ.</p>
    <div class="geom3d-section-controls">
      <label><input id="geom3dSliceEnabled" type="checkbox"> Hiện thiết diện ngang</label>
      <label for="geom3dSliceRange">Vị trí cắt:</label>
      <input id="geom3dSliceRange" type="range" min="5" max="95" value="50" step="1" disabled>
      <output id="geom3dSliceValue" for="geom3dSliceRange">50%</output>
    </div>
    <p id="geom3dDetails" class="geom3d-status" role="status" aria-live="polite"></p>
    <p id="geom3dMessage" class="geom3d-status" role="status" aria-live="polite"></p>
  `;
  document.body.append(panel);
  makePanelDraggable(panel, panel.querySelector('.geom3d-titlebar'));

  const problemInput = $('geom3dProblem');
  const viewport = $('geom3dViewport');
  const info = $('geom3dDetails');
  const message = $('geom3dMessage');
  const sliceToggle = $('geom3dSliceEnabled');
  const sliceRange = $('geom3dSliceRange');
  const sliceValue = $('geom3dSliceValue');
  const examples = {
    pyramid: 'Hình chóp tứ giác đều có cạnh đáy 4 và chiều cao 6.',
    prism: 'Lăng trụ tam giác đều có cạnh đáy 3 và chiều cao 5.',
    sphere: 'Mặt cầu bán kính 3.',
    cone: 'Hình nón có bán kính đáy 3 và chiều cao 5.'
  };

  let THREE = null;
  let threePromise = null;
  let scene = null;
  let camera = null;
  let renderer = null;
  let root = null;
  let guide = null;
  let solid = null;
  let current = null;
  let outlineMaterials = [];
  let cap = null;
  let capOutline = null;
  let clippingPlane = null;
  let resizeObserver = null;
  const orbit = { theta: 0.72, phi: 1.1, distance: 14, targetY: 2.5 };
  const pointers = new Map();
  let previousPinchDistance = null;

  function setMessage(text, error = false) {
    message.textContent = text;
    message.dataset.error = String(error);
  }

  function ensureThree() {
    if (!threePromise) {
      threePromise = import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js')
        .then((mod) => { THREE = mod; return mod; })
        .catch((err) => { threePromise = null; throw err; });
    }
    return threePromise;
  }

  function disposeObject(object) {
    if (!object) return;
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose());
      }
    });
  }

  function createScene() {
    if (renderer) return;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f9fd);
    camera = new THREE.PerspectiveCamera(44, 1, 0.1, 500);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.touchAction = 'none';
    viewport.append(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 1.55));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(7, 12, 8);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xc7d2fe, 0.8);
    fillLight.position.set(-7, 4, -7);
    scene.add(fillLight);
    root = new THREE.Group();
    scene.add(root);
    clippingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    initOrbitEvents();
    resizeObserver = new ResizeObserver(() => resizeRenderer());
    resizeObserver.observe(viewport);
  }

  function cameraUpdate() {
    if (!camera) return;
    const sin = Math.sin(orbit.phi);
    camera.position.set(
      orbit.distance * sin * Math.sin(orbit.theta),
      orbit.targetY + orbit.distance * Math.cos(orbit.phi),
      orbit.distance * sin * Math.cos(orbit.theta)
    );
    camera.lookAt(0, orbit.targetY, 0);
    render();
  }

  function render() {
    if (renderer && !panel.hidden) renderer.render(scene, camera);
  }

  function resizeRenderer() {
    if (!renderer) return;
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  }

  function zoomBy(scale) {
    orbit.distance = Math.max(1.2, Math.min(160, orbit.distance * scale));
    cameraUpdate();
  }

  function initOrbitEvents() {
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      previousPinchDistance = null;
    });
    canvas.addEventListener('pointermove', (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        orbit.theta -= dx * 0.01;
        orbit.phi = Math.min(Math.PI - 0.06, Math.max(0.06, orbit.phi - dy * 0.01));
        cameraUpdate();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (previousPinchDistance && distance > 5) zoomBy(previousPinchDistance / distance);
        previousPinchDistance = distance;
      }
    });
    const release = (event) => {
      pointers.delete(event.pointerId);
      previousPinchDistance = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', (event) => {
      pointers.delete(event.pointerId);
      previousPinchDistance = null;
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      zoomBy(Math.exp(event.deltaY * 0.001));
    }, { passive: false });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  function sectionY() {
    const fraction = Number(sliceRange.value) / 100;
    return current.type === 'sphere'
      ? -current.radius + fraction * current.radius * 2
      : fraction * current.height;
  }

  function lineFromPoints(points, color = 0x1e3a8a, isLoop = false) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color });
    outlineMaterials.push(material);
    const line = isLoop ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
    root.add(line);
    return line;
  }

  function ring(radius, y, sides, color) {
    const pts = [];
    for (let i = 0; i < sides; i += 1) {
      const theta = i * Math.PI * 2 / sides;
      pts.push(new THREE.Vector3(radius * Math.sin(theta), y, radius * Math.cos(theta)));
    }
    return lineFromPoints(pts, color, true);
  }

  function drawOutlines(model) {
    const { type, radius, height, sides } = model;
    const segments = type === 'cone' ? 80 : sides;
    if (type === 'sphere') {
      const count = 80;
      for (const axis of ['xz', 'xy', 'yz']) {
        const points = [];
        for (let i = 0; i < count; i += 1) {
          const t = i * 2 * Math.PI / count;
          const a = radius * Math.cos(t);
          const b = radius * Math.sin(t);
          points.push(axis === 'xz' ? new THREE.Vector3(a, 0, b)
            : axis === 'xy' ? new THREE.Vector3(a, b, 0)
              : new THREE.Vector3(0, a, b));
        }
        lineFromPoints(points, 0x51709b, true);
      }
      return;
    }
    ring(radius, 0, segments, 0x233c79);
    if (type === 'prism') ring(radius, height, sides, 0x233c79);
    for (let i = 0; i < (type === 'cone' ? 8 : sides); i += 1) {
      if (type === 'cone') continue; // Hình nón tròn xoay không cần vẽ đường sinh phụ.
      const theta = i * Math.PI * 2 / sides;
      const x = radius * Math.sin(theta);
      const z = radius * Math.cos(theta);
      lineFromPoints([
        new THREE.Vector3(x, 0, z),
        type === 'pyramid' ? new THREE.Vector3(0, height, 0) : new THREE.Vector3(x, height, z)
      ], 0x233c79);
    }
    if (type === 'cone') {
      lineFromPoints([new THREE.Vector3(-radius, 0, 0), new THREE.Vector3(0, height, 0)], 0x233c79);
      lineFromPoints([new THREE.Vector3(radius, 0, 0), new THREE.Vector3(0, height, 0)], 0x233c79);
    }
  }

  function createSolid(model) {
    const { type, radius, height, sides } = model;
    let geometry;
    if (type === 'sphere') {
      geometry = new THREE.SphereGeometry(radius, 64, 40);
    } else {
      const segments = (type === 'prism' || type === 'pyramid') ? sides : 80;
      geometry = new THREE.CylinderGeometry(
        type === 'pyramid' || type === 'cone' ? 0 : radius,
        radius,
        height,
        segments,
        1,
        false
      );
      geometry.translate(0, height / 2, 0);
    }
    const material = new THREE.MeshPhongMaterial({
      color: type === 'sphere' ? 0x82c4f8 : type === 'cone' ? 0x8dcbb7 : 0x9daeff,
      transparent: true,
      opacity: 0.79,
      shininess: 80,
      side: THREE.DoubleSide,
      flatShading: type === 'pyramid' || type === 'prism'
    });
    solid = new THREE.Mesh(geometry, material);
    root.add(solid);
    drawOutlines(model);
  }

  function disposeCap() {
    for (const child of [cap, capOutline]) {
      if (child) {
        root.remove(child);
        disposeObject(child);
      }
    }
    cap = null;
    capOutline = null;
  }

  function sectionPoints(model, y) {
    let { radius, sides } = model;
    let count = sides;
    if (model.type === 'cone') {
      radius *= Math.max(0, 1 - y / model.height);
      count = 80;
    } else if (model.type === 'pyramid') {
      radius *= Math.max(0, 1 - y / model.height);
    } else if (model.type === 'sphere') {
      radius = Math.sqrt(Math.max(0, model.radius ** 2 - y ** 2));
      count = 80;
    }
    const vertices = [];
    for (let i = 0; i < count; i += 1) {
      const t = i * 2 * Math.PI / count;
      vertices.push(new THREE.Vector3(radius * Math.sin(t), y + 0.01, radius * Math.cos(t)));
    }
    return vertices;
  }

  function updateSection() {
    if (!current || !solid) return;
    const enabled = sliceToggle.checked;
    sliceRange.disabled = !enabled;
    sliceValue.textContent = `${sliceRange.value}%`;
    disposeCap();
    const y = sectionY();
    clippingPlane.constant = -y;
    const clips = enabled ? [clippingPlane] : [];
    solid.material.clippingPlanes = clips;
    solid.material.needsUpdate = true;
    for (const material of outlineMaterials) {
      material.clippingPlanes = clips;
      material.needsUpdate = true;
    }
    if (enabled) {
      const points = sectionPoints(current, y);
      const vertices = [];
      for (let i = 0; i < points.length; i += 1) {
        const next = points[(i + 1) % points.length];
        vertices.push(0, y + 0.01, 0, points[i].x, points[i].y, points[i].z, next.x, next.y, next.z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      cap = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: 0xfacc15, transparent: true, opacity: 0.65,
        side: THREE.DoubleSide, depthTest: false, depthWrite: false
      }));
      cap.renderOrder = 10;
      root.add(cap);
      capOutline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0xb45309, depthTest: false })
      );
      capOutline.renderOrder = 11;
      root.add(capOutline);
    }
    render();
  }

  function resetView() {
    if (!current) return;
    orbit.theta = 0.72;
    orbit.phi = 1.1;
    orbit.targetY = current.type === 'sphere' ? 0 : current.height / 2;
    orbit.distance = Math.max(6, Math.max(current.radius * 2, current.height) * 2.5);
    cameraUpdate();
  }

  function buildModel(model) {
    // Xóa mô hình cũ; không động đến các đối tượng trên Fabric Canvas.
    while (root.children.length) {
      const child = root.children[0];
      root.remove(child);
      disposeObject(child);
    }
    cap = null;
    capOutline = null;
    solid = null;
    outlineMaterials = [];
    current = model;
    createSolid(model);
    guide = new THREE.GridHelper(Math.max(10, model.radius * 4), 10, 0xc1cbdc, 0xe2e8f0);
    guide.position.y = model.type === 'sphere' ? -model.radius - 0.05 : -0.05;
    root.add(guide);
    resetView();
    updateSection();
    const sizes = model.type === 'sphere'
      ? `bán kính ${model.radius.toFixed(2)}`
      : `bán kính ngoại tiếp đáy ${model.radius.toFixed(2)}, chiều cao ${model.height.toFixed(2)}`;
    info.textContent = `${model.label} · ${sizes}.`;
    setMessage(model.isDefaultRadius || model.isDefaultHeight
      ? 'Một số kích thước không nêu trong đề đã được dùng giá trị mẫu.'
      : 'Đã dựng từ thông số đề bài. Có thể bật thiết diện để xem mặt cắt.');
  }

  let requestCounter = 0;
  async function buildFromText(text) {
    problemInput.value = text;
    panel.hidden = false;
    toolButton.setAttribute('aria-expanded', 'true');
    const model = parseGeometryProblem(text);
    if (!model) {
      setMessage('Chưa nhận ra loại hình. Hãy nhập hình chóp, lăng trụ, mặt cầu hoặc hình nón.', true);
      return;
    }
    const request = ++requestCounter;
    setMessage('Đang khởi tạo Three.js...');
    try {
      await ensureThree();
      if (request !== requestCounter || panel.hidden) return;
      createScene();
      resizeRenderer();
      buildModel(model);
    } catch (err) {
      setMessage('Không tải được Three.js hoặc WebGL: kiểm tra kết nối Internet và trình duyệt có hỗ trợ WebGL.', true);
      console.error('[Geometry 3D]', err);
    }
  }

  function closePanel() {
    panel.hidden = true;
    toolButton.setAttribute('aria-expanded', 'false');
    requestCounter += 1;
  }

  toolButton.addEventListener('click', () => {
    if (state.ended) return;
    closePanels(); // Đóng menu Hình sau khi chọn Hình học 3D.
    if (panel.hidden) {
      if (current && renderer) {
        panel.hidden = false;
        toolButton.setAttribute('aria-expanded', 'true');
        resizeRenderer();
      } else {
        void buildFromText(problemInput.value);
      }
    } else closePanel();
  });
  $('geom3dClose').addEventListener('click', closePanel);
  $('geom3dForm').addEventListener('submit', (event) => {
    event.preventDefault();
    void buildFromText(problemInput.value);
  });
  panel.querySelectorAll('[data-geom3d-sample]').forEach((button) => {
    button.addEventListener('click', () => void buildFromText(examples[button.dataset.geom3dSample]));
  });
  $('geom3dResetView').addEventListener('click', resetView);
  sliceToggle.addEventListener('change', updateSection);
  sliceRange.addEventListener('input', updateSection);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closePanel();
  });
  $('endSession')?.addEventListener('click', () => {
    if (state.ended) {
      closePanel();
      toolButton.disabled = true;
    }
  });

  // Tự động dựng nếu công cụ Chữ / Chuyển chữ sinh Fabric Text từ đề bài.
  // Nét viết tay thô cần được chuyển chữ bằng chức năng hiện có trước.
  fabricCanvas.on('object:added', ({ target }) => {
    if (state.pageBusy || state.ended || typeof target?.text !== 'string') return;
    if (!parseGeometryProblem(target.text)) return;
    void buildFromText(target.text);
  });
}
