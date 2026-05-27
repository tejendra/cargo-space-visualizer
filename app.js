import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6,
  0x1abc9c, 0xe67e22, 0x34495e, 0x16a085, 0xc0392b,
];

const STORAGE_KEY = 'cargo-space-visualizer';
const LAYOUT_VERSION = 1;

const state = {
  container: { length: 20, width: 8, height: 8 },
  library: [],
  placed: [],
  previewOrientation: 0,
  dragging: null,
  selectedId: null,
  selectedLibraryId: null,
  moving: null,
  nextColor: 0,
};

const canvas = document.getElementById('canvas');
const dropHint = document.getElementById('drop-hint');
const libraryEl = document.getElementById('item-library');
const selectedSection = document.getElementById('selected-section');
const selectedNameEl = document.getElementById('selected-name');
const librarySelectedSection = document.getElementById('library-selected-section');
const librarySelectedNameEl = document.getElementById('library-selected-name');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a2a);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

let containerGroup = new THREE.Group();
scene.add(containerGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function nearlyEqual(a, b) {
  return Math.abs(a - b) < 0.001;
}

function getOrientations(baseLength, baseWidth, baseHeight) {
  const dims = [baseLength, baseWidth, baseHeight];
  const assignments = [
    [0, 2, 1], // length, height, width — default upright
    [0, 1, 2],
    [2, 0, 1],
    [2, 1, 0],
    [1, 0, 2],
    [1, 2, 0],
  ];
  const orientations = [];
  const seen = new Set();

  for (const [xIndex, yIndex, zIndex] of assignments) {
    const orientation = {
      length: dims[xIndex],
      height: dims[yIndex],
      width: dims[zIndex],
    };
    const key = `${orientation.length}|${orientation.height}|${orientation.width}`;
    if (seen.has(key)) continue;
    seen.add(key);
    orientations.push(orientation);
  }

  return orientations;
}

function rotateDims(length, height, width, axis) {
  if (axis === 'x') return { length, height: width, width: height };
  if (axis === 'y') return { length: width, height, width: length };
  return { length: height, height: length, width };
}

function findOrientationIndex(baseLength, baseWidth, baseHeight, length, height, width) {
  const orientations = getOrientations(baseLength, baseWidth, baseHeight);
  const index = orientations.findIndex((orientation) =>
    nearlyEqual(orientation.length, length) &&
    nearlyEqual(orientation.height, height) &&
    nearlyEqual(orientation.width, width)
  );
  return index >= 0 ? index : 0;
}

function getOrientationDims(baseLength, baseWidth, baseHeight, orientationIndex) {
  const orientations = getOrientations(baseLength, baseWidth, baseHeight);
  const index = ((orientationIndex % orientations.length) + orientations.length) % orientations.length;
  return { ...orientations[index], orientationIndex: index, orientationCount: orientations.length };
}

function migrateRotationToOrientation(baseLength, baseWidth, baseHeight, rotationSteps) {
  const orientations = getOrientations(baseLength, baseWidth, baseHeight);
  let dims = orientations[0];
  for (let i = 0; i < (rotationSteps ?? 0) % 4; i++) {
    dims = rotateDims(dims.length, dims.height, dims.width, 'y');
  }
  return findOrientationIndex(baseLength, baseWidth, baseHeight, dims.length, dims.height, dims.width);
}

function rotateOrientationIndex(baseLength, baseWidth, baseHeight, orientationIndex, axis) {
  const current = getOrientationDims(baseLength, baseWidth, baseHeight, orientationIndex);
  const rotated = rotateDims(current.length, current.height, current.width, axis);
  return findOrientationIndex(
    baseLength,
    baseWidth,
    baseHeight,
    rotated.length,
    rotated.height,
    rotated.width
  );
}

function boxesOverlap(a, b) {
  return (
    a.minX < b.maxX && a.maxX > b.minX &&
    a.minY < b.maxY && a.maxY > b.minY &&
    a.minZ < b.maxZ && a.maxZ > b.minZ
  );
}

function itemBounds(item) {
  return {
    minX: item.x,
    maxX: item.x + item.length,
    minY: item.y,
    maxY: item.y + item.height,
    minZ: item.z,
    maxZ: item.z + item.width,
  };
}

function boundsAt(item, x, y, z) {
  return {
    minX: x,
    maxX: x + item.length,
    minY: y,
    maxY: y + item.height,
    minZ: z,
    maxZ: z + item.width,
  };
}

function fitsInContainer(bounds, container) {
  return (
    bounds.minX >= 0 &&
    bounds.maxX <= container.length &&
    bounds.minY >= 0 &&
    bounds.maxY <= container.height &&
    bounds.minZ >= 0 &&
    bounds.maxZ <= container.width
  );
}

function findDropPosition(item, targetCenterX, targetCenterZ, placed, container) {
  const x = targetCenterX - item.length / 2;
  const z = targetCenterZ - item.width / 2;
  const candidates = [0];

  for (const other of placed) {
    candidates.push(other.y + other.height);
  }

  candidates.sort((a, b) => a - b);

  for (const startY of candidates) {
    let y = startY;
    let changed = true;

    while (changed) {
      changed = false;
      const bounds = boundsAt(item, x, y, z);

      if (!fitsInContainer(bounds, container)) {
        return null;
      }

      for (const other of placed) {
        if (boxesOverlap(bounds, itemBounds(other))) {
          y = other.y + other.height;
          changed = true;
          break;
        }
      }
    }

    const finalBounds = boundsAt(item, x, y, z);
    if (!fitsInContainer(finalBounds, container)) {
      continue;
    }

    let supported = y === 0;
    if (!supported) {
      for (const other of placed) {
        const otherTop = other.y + other.height;
        if (Math.abs(otherTop - y) > 0.001) continue;
        const overlapX = Math.min(finalBounds.maxX, other.x + other.length) - Math.max(finalBounds.minX, other.x);
        const overlapZ = Math.min(finalBounds.maxZ, other.z + other.width) - Math.max(finalBounds.minZ, other.z);
        if (overlapX > 0.01 && overlapZ > 0.01) {
          supported = true;
          break;
        }
      }
    }

    if (supported) {
      return { x, y, z };
    }
  }

  return null;
}

function fmtDim(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function createTextSprite(text, color = '#ffffff') {
  const padding = 10;
  const fontSize = 32;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const textWidth = ctx.measureText(text).width;
  canvas.width = textWidth + padding * 2;
  canvas.height = fontSize + padding * 2;

  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  );
  sprite.renderOrder = 1;
  return { sprite, canvas };
}

function addAxisLine(group, start, end, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...start),
    new THREE.Vector3(...end),
  ]);
  group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })));
}

function addDimensionLabel(group, text, x, y, z, size, color) {
  const { sprite, canvas } = createTextSprite(text, color);
  sprite.position.set(x, y, z);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(size * aspect, size, 1);
  group.add(sprite);
}

function addContainerDimensions(container) {
  const { length: L, width: W, height: H } = container;
  const offset = Math.max(L, W, H) * 0.08;
  const labelSize = Math.max(L, W, H) * 0.07;

  const lengthColor = '#ff6b6b';
  const widthColor = '#51cf66';
  const heightColor = '#74c0fc';

  // Axis guides from the front-left corner (origin).
  addAxisLine(containerGroup, [0, 0, 0], [L, 0, 0], 0xff6b6b);
  addAxisLine(containerGroup, [0, 0, 0], [0, 0, W], 0x51cf66);
  addAxisLine(containerGroup, [0, 0, 0], [0, H, 0], 0x74c0fc);

  // Length (X) — along front and back bottom edges.
  addDimensionLabel(containerGroup, `Length ${fmtDim(L)}`, L / 2, -offset, -offset, labelSize, lengthColor);
  addDimensionLabel(containerGroup, `Length ${fmtDim(L)}`, L / 2, -offset, W + offset, labelSize, lengthColor);

  // Width (Z) — along left and right bottom edges.
  addDimensionLabel(containerGroup, `Width ${fmtDim(W)}`, -offset, -offset, W / 2, labelSize, widthColor);
  addDimensionLabel(containerGroup, `Width ${fmtDim(W)}`, L + offset, -offset, W / 2, labelSize, widthColor);

  // Height (Y) — along front-left and back-right vertical edges.
  addDimensionLabel(containerGroup, `Height ${fmtDim(H)}`, -offset, H / 2, -offset, labelSize, heightColor);
  addDimensionLabel(containerGroup, `Height ${fmtDim(H)}`, L + offset, H / 2, W + offset, labelSize, heightColor);

  const labelSizeSmall = labelSize * 0.85;
  addDimensionLabel(containerGroup, 'Front', L / 2, -offset * 0.5, -offset * 0.5, labelSizeSmall, '#cccccc');
  addDimensionLabel(containerGroup, 'Back', L / 2, H / 2, W - offset * 0.3, labelSizeSmall, '#9ec5e8');
}

function buildContainerMesh(container) {
  containerGroup.clear();

  const geometry = new THREE.BoxGeometry(container.length, container.height, container.width);
  const edges = new THREE.EdgesGeometry(geometry);
  const wireframe = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x888888 })
  );
  wireframe.position.set(container.length / 2, container.height / 2, container.width / 2);
  containerGroup.add(wireframe);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(container.length, container.width),
    new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(container.length / 2, 0.001, container.width / 2);
  containerGroup.add(floor);

  const backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(container.length, container.height),
    new THREE.MeshStandardMaterial({
      color: 0x3d5a80,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
    })
  );
  backWall.position.set(container.length / 2, container.height / 2, container.width - 0.002);
  backWall.rotation.y = Math.PI;
  containerGroup.add(backWall);

  addContainerDimensions(container);
}

function normalizePlacedItem(item) {
  if (item.baseLength == null) {
    item.baseLength = item.length;
    item.baseWidth = item.width;
    item.baseHeight = item.height;
  }
  if (item.orientation == null) {
    item.orientation = migrateRotationToOrientation(
      item.baseLength,
      item.baseWidth,
      item.baseHeight,
      item.rotation
    );
    delete item.rotation;
  }
  applyItemDims(item);
  return item;
}

function normalizeLibraryEntry(entry) {
  if (entry.orientation == null) {
    entry.orientation = migrateRotationToOrientation(
      entry.length,
      entry.width,
      entry.height,
      entry.rotation
    );
    delete entry.rotation;
  }
  return entry;
}

function getStatePayload() {
  return {
    version: LAYOUT_VERSION,
    app: 'cargo-space-visualizer',
    exportedAt: new Date().toISOString(),
    container: state.container,
    library: state.library,
    placed: state.placed,
    nextColor: state.nextColor,
    selectedId: state.selectedId,
    selectedLibraryId: state.selectedLibraryId,
  };
}

function refreshFromState() {
  syncContainerForm();
  buildContainerMesh(state.container);
  rebuildPlacedMeshes();
  renderLibrary();
  updateLibrarySelectionUI();
  updateSelectionUI();
  updatePreviewOrientationUI();
  updateCamera(state.container);
}

function applyState(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid layout data');
  }

  state.container = data.container ?? { length: 20, width: 8, height: 8 };
  state.library = Array.isArray(data.library) ? data.library.map(normalizeLibraryEntry) : [];
  state.placed = Array.isArray(data.placed) ? data.placed.map(normalizePlacedItem) : [];
  state.nextColor = typeof data.nextColor === 'number' ? data.nextColor : 0;
  state.previewOrientation = 0;
  state.selectedId = data.selectedId && state.placed.some((item) => item.id === data.selectedId)
    ? data.selectedId
    : null;
  state.selectedLibraryId = data.selectedLibraryId && state.library.some((entry) => entry.id === data.selectedLibraryId)
    ? data.selectedLibraryId
    : null;
  state.dragging = null;
  state.moving = null;

  refreshFromState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getStatePayload()));
  } catch (err) {
    console.warn('Failed to save layout', err);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    applyState(JSON.parse(raw));
  } catch (err) {
    console.warn('Failed to load saved layout', err);
  }
}

function exportLayout() {
  const payload = getStatePayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cargo-layout-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importLayoutFromFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      applyState(data);
      saveState();
    } catch (err) {
      console.warn(err);
      alert('Could not import layout. Choose a valid cargo layout JSON file.');
    }
  };
  reader.readAsText(file);
}

function syncContainerForm() {
  document.getElementById('container-length').value = state.container.length;
  document.getElementById('container-width').value = state.container.width;
  document.getElementById('container-height').value = state.container.height;
}

function getPlacedItem(id) {
  return state.placed.find((item) => item.id === id);
}

function applyItemDims(item) {
  const dims = getOrientationDims(item.baseLength, item.baseWidth, item.baseHeight, item.orientation ?? 0);
  item.orientation = dims.orientationIndex;
  item.length = dims.length;
  item.width = dims.width;
  item.height = dims.height;
}

function getPreviewDims() {
  const baseLength = parseFloat(document.getElementById('item-length').value) || 1;
  const baseWidth = parseFloat(document.getElementById('item-width').value) || 1;
  const baseHeight = parseFloat(document.getElementById('item-height').value) || 1;
  return getOrientationDims(baseLength, baseWidth, baseHeight, state.previewOrientation);
}

function updatePreviewOrientationUI() {
  const previewEl = document.getElementById('preview-orientation');
  if (!previewEl) return;
  const dims = getPreviewDims();
  previewEl.textContent = `Current side: ${fmtDim(dims.length)} × ${fmtDim(dims.width)} × ${fmtDim(dims.height)}`;
}

function createItemMesh(item, selected = false) {
  const valid = isItemValid(item);
  const geometry = new THREE.BoxGeometry(item.length, item.height, item.width);
  const material = new THREE.MeshStandardMaterial({
    color: item.color,
    emissive: !valid ? 0xff5533 : (selected ? item.color : 0x000000),
    emissiveIntensity: !valid ? 0.45 : (selected ? 0.35 : 0),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(item.x + item.length / 2, item.y + item.height / 2, item.z + item.width / 2);
  mesh.userData.placedId = item.id;
  return mesh;
}

function rebuildPlacedMeshes() {
  const toRemove = containerGroup.children.filter((c) => c.userData.placedId);
  toRemove.forEach((c) => containerGroup.remove(c));

  for (const item of state.placed) {
    containerGroup.add(createItemMesh(item, item.id === state.selectedId));
  }
}

function updateSelectionUI() {
  const item = getPlacedItem(state.selectedId);
  if (!item) {
    state.selectedId = null;
    selectedSection.classList.add('hidden');
    return;
  }

  selectedSection.classList.remove('hidden');
  const valid = isItemValid(item);
  const sizeLabel = `${fmtDim(item.length)} × ${fmtDim(item.width)} × ${fmtDim(item.height)}`;
  selectedNameEl.textContent = valid
    ? `${item.name} (${sizeLabel})`
    : `${item.name} (${sizeLabel}) — use arrow keys to move into place`;
}

function selectItem(id) {
  state.selectedId = id;
  rebuildPlacedMeshes();
  updateSelectionUI();
  saveState();
}

function clearSelection() {
  state.selectedId = null;
  rebuildPlacedMeshes();
  updateSelectionUI();
  saveState();
}

function isItemValid(item) {
  const bounds = itemBounds(item);
  if (!fitsInContainer(bounds, state.container)) return false;

  for (const other of state.placed) {
    if (other.id === item.id) continue;
    if (boxesOverlap(bounds, itemBounds(other))) return false;
  }

  if (item.y === 0) return true;

  const supportTop = item.y;
  for (const other of state.placed) {
    if (other.id === item.id) continue;
    const otherTop = other.y + other.height;
    if (Math.abs(otherTop - supportTop) > 0.001) continue;
    const overlapX = Math.min(bounds.maxX, other.x + other.length) - Math.max(bounds.minX, other.x);
    const overlapZ = Math.min(bounds.maxZ, other.z + other.width) - Math.max(bounds.minZ, other.z);
    if (overlapX > 0.01 && overlapZ > 0.01) return true;
  }

  return false;
}

function settleItemAtXZ(item, excludeId) {
  const centerX = item.x + item.length / 2;
  const centerZ = item.z + item.width / 2;
  const pos = findDropPosition(item, centerX, centerZ, othersExcept(excludeId), state.container);
  if (pos) {
    item.x = pos.x;
    item.y = pos.y;
    item.z = pos.z;
    return true;
  }

  item.y = 0;
  return false;
}

function setItemAtCenter(item, targetCenterX, targetCenterZ) {
  item.x = targetCenterX - item.length / 2;
  item.z = targetCenterZ - item.width / 2;
  item.y = 0;
}

function moveItemLoose(itemId, targetCenterX, targetCenterZ) {
  const item = getPlacedItem(itemId);
  if (!item) return false;

  setItemAtCenter(item, targetCenterX, targetCenterZ);
  settleItemAtXZ(item, itemId);
  return true;
}

const MOVE_STEP = 0.25;
const FINE_MOVE_STEP = 0.05;

function othersExcept(id) {
  return state.placed.filter((item) => item.id !== id);
}

function nudgeSelectedItem(deltaX, deltaZ) {
  if (!state.selectedId) return false;

  const item = getPlacedItem(state.selectedId);
  if (!item) return false;

  item.x += deltaX;
  item.z += deltaZ;
  settleItemAtXZ(item, state.selectedId);
  rebuildPlacedMeshes();
  updateSelectionUI();
  saveState();
  return true;
}

function rotatePlacedItem(itemId, axis) {
  const item = getPlacedItem(itemId);
  if (!item) return false;

  const centerX = item.x + item.length / 2;
  const centerZ = item.z + item.width / 2;

  item.orientation = rotateOrientationIndex(
    item.baseLength,
    item.baseWidth,
    item.baseHeight,
    item.orientation ?? 0,
    axis
  );
  applyItemDims(item);
  setItemAtCenter(item, centerX, centerZ);
  settleItemAtXZ(item, itemId);

  rebuildPlacedMeshes();
  updateSelectionUI();
  saveState();
  return true;
}

function removePlacedItem(itemId) {
  state.placed = state.placed.filter((item) => item.id !== itemId);
  if (state.selectedId === itemId) {
    clearSelection();
  } else {
    rebuildPlacedMeshes();
  }
  renderLibrary();
  saveState();
}

function describeOrientation(item) {
  const upright =
    nearlyEqual(item.length, item.baseLength) &&
    nearlyEqual(item.height, item.baseHeight) &&
    nearlyEqual(item.width, item.baseWidth);

  if (upright) return 'Upright (default orientation)';

  const verticalIsHeight = nearlyEqual(item.height, item.baseHeight);
  const verticalIsLength = nearlyEqual(item.height, item.baseLength);
  const verticalIsWidth = nearlyEqual(item.height, item.baseWidth);
  const turnedOnFloor =
    nearlyEqual(item.length, item.baseWidth) &&
    nearlyEqual(item.width, item.baseLength) &&
    verticalIsHeight;

  if (turnedOnFloor) return 'Rotated 90° on floor (still upright)';
  if (verticalIsLength) return 'On its side — original length is vertical';
  if (verticalIsWidth) return 'On its side — original width/depth is vertical';
  if (verticalIsHeight) return 'Rotated on floor — footprint changed';

  return `Rotated — ${fmtDim(item.length)} L × ${fmtDim(item.width)} W × ${fmtDim(item.height)} H in container`;
}

function describeLocation(item, container) {
  const centerX = item.x + item.length / 2;
  const centerZ = item.z + item.width / 2;

  // Left/right from the front door (z = 0), not from the back wall.
  const xPos = centerX < container.length / 3
    ? 'right'
    : centerX > (container.length * 2) / 3
      ? 'left'
      : 'center';
  const zPos = centerZ > (container.width * 2) / 3
    ? 'back'
    : centerZ < container.width / 3
      ? 'front (near door)'
      : 'middle';
  const yPos = item.y <= 0.001 ? 'floor level' : `${fmtDim(item.y)} above floor`;

  return `${zPos}, ${xPos}, ${yPos}`;
}

function getSupportingItems(item, allItems) {
  if (item.y <= 0.001) return [];

  const bounds = itemBounds(item);
  const supporters = [];

  for (const other of allItems) {
    if (other.id === item.id) continue;

    const otherTop = other.y + other.height;
    if (Math.abs(otherTop - item.y) > 0.001) continue;

    const overlapX = Math.min(bounds.maxX, other.x + other.length) - Math.max(bounds.minX, other.x);
    const overlapZ = Math.min(bounds.maxZ, other.z + other.width) - Math.max(bounds.minZ, other.z);
    if (overlapX > 0.01 && overlapZ > 0.01) {
      supporters.push(other);
    }
  }

  return supporters;
}

function computeLoadingOrder(items) {
  return [...items].sort((a, b) => {
    if (!nearlyEqual(a.y, b.y)) return a.y - b.y;

    const aBack = a.z + a.width / 2;
    const bBack = b.z + b.width / 2;
    if (!nearlyEqual(aBack, bBack)) return bBack - aBack;

    // Left-to-right when facing the front door (left = higher x).
    return b.x - a.x;
  });
}

function generateLoadingPlan() {
  const { container, placed } = state;
  if (placed.length === 0) {
    return 'No items in the container.';
  }

  const ordered = computeLoadingOrder(placed);
  const loadNumberById = new Map(ordered.map((item, index) => [item.id, index + 1]));
  const lines = [
    'CARGO LOADING PLAN',
    '='.repeat(48),
    `Container: ${fmtDim(container.length)} L × ${fmtDim(container.width)} W × ${fmtDim(container.height)} H`,
    'Front (door): z = 0    |    Back wall: z = width',
    'Load order: bottom layer first, then back-to-front, then left-to-right (facing the front door).',
    '',
  ];

  ordered.forEach((item, index) => {
    const loadNumber = index + 1;
    const supporters = getSupportingItems(item, placed);

    lines.push(`${loadNumber}. ${item.name}`);
    lines.push(`   In container: ${fmtDim(item.length)} L × ${fmtDim(item.width)} W × ${fmtDim(item.height)} H`);
    lines.push(`   Original size: ${fmtDim(item.baseLength)} × ${fmtDim(item.baseWidth)} × ${fmtDim(item.baseHeight)}`);
    lines.push(`   Orientation: ${describeOrientation(item)}`);
    lines.push(`   Location: ${describeLocation(item, container)}`);

    if (item.y <= 0.001) {
      lines.push('   Stacking: on container floor');
    } else if (supporters.length === 0) {
      lines.push('   Stacking: elevated (no item directly below)');
    } else {
      const refs = supporters
        .map((supporter) => `#${loadNumberById.get(supporter.id)} ${supporter.name}`)
        .join(', ');
      lines.push(`   Stacking: on top of ${refs}`);
    }

    if (!isItemValid(item)) {
      lines.push('   Note: item overlaps or extends outside the container in the plan');
    }

    lines.push('');
  });

  return lines.join('\n');
}

function showLoadingPlanExport() {
  const plan = generateLoadingPlan();
  document.getElementById('loading-plan-text').value = plan;
  document.getElementById('loading-plan-modal').classList.remove('hidden');
}

function hideLoadingPlanExport() {
  document.getElementById('loading-plan-modal').classList.add('hidden');
}

function downloadLoadingPlan() {
  const plan = document.getElementById('loading-plan-text').value;
  const blob = new Blob([plan], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'loading-plan.txt';
  link.click();
  URL.revokeObjectURL(url);
}

function updateCamera(container) {
  const cx = container.length / 2;
  const cy = container.height / 2;
  const cz = container.width / 2;
  const size = Math.max(container.length, container.width, container.height);

  // Front door is at z = 0 — pulled back and raised to show the full front and top.
  camera.position.set(cx, cy + size * 0.95, -size * 2.05);
  controls.target.set(cx, cy * 0.2, cz * 0.25);
  controls.update();
}

function resize() {
  const { clientWidth, clientHeight } = canvas.parentElement;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight, false);
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function pointerToFloor(event) {
  updatePointer(event);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(floorPlane, hit)) {
    return { x: hit.x, z: hit.z };
  }
  return null;
}

function raycastPlacedItem(event) {
  updatePointer(event);
  const meshes = containerGroup.children.filter((child) => child.userData.placedId);
  const hits = raycaster.intersectObjects(meshes);
  return hits.length > 0 ? hits[0].object.userData.placedId : null;
}

function getLibraryEntry(id) {
  return state.library.find((entry) => entry.id === id);
}

function updateDropHintForDragging() {
  if (!state.dragging) return;
  const dims = getOrientationDims(
    state.dragging.length,
    state.dragging.width,
    state.dragging.height,
    state.dragging.orientation ?? 0
  );
  dropHint.textContent = `Release to place · ${fmtDim(dims.length)} × ${fmtDim(dims.width)} × ${fmtDim(dims.height)} · X/Y/Z rotate · arrow keys to position`;
  dropHint.classList.remove('hidden');
}

function updateLibrarySelectionUI() {
  const entry = getLibraryEntry(state.selectedLibraryId);
  if (!entry) {
    state.selectedLibraryId = null;
    librarySelectedSection.classList.add('hidden');
    return;
  }

  const dims = getOrientationDims(entry.length, entry.width, entry.height, entry.orientation ?? 0);
  librarySelectedSection.classList.remove('hidden');
  librarySelectedNameEl.textContent = `${entry.name} (${fmtDim(dims.length)} × ${fmtDim(dims.width)} × ${fmtDim(dims.height)})`;
}

function selectLibraryItem(id, { refreshList = true } = {}) {
  state.selectedLibraryId = id;
  if (refreshList && !state.dragging) {
    renderLibrary();
  }
  updateLibrarySelectionUI();
  saveState();
}

function clearLibrarySelection() {
  state.selectedLibraryId = null;
  renderLibrary();
  updateLibrarySelectionUI();
  saveState();
}

function rotateLibraryEntry(entryId, axis) {
  const entry = getLibraryEntry(entryId);
  if (!entry) return;

  entry.orientation = rotateOrientationIndex(
    entry.length,
    entry.width,
    entry.height,
    entry.orientation ?? 0,
    axis
  );

  if (state.dragging?.id === entryId) {
    state.dragging = { ...entry };
    updateDropHintForDragging();
  }

  if (!state.dragging) {
    renderLibrary();
  }
  updateLibrarySelectionUI();
  saveState();
}

function removeLibraryItem(id) {
  state.library = state.library.filter((entry) => entry.id !== id);
  if (state.selectedLibraryId === id) {
    state.selectedLibraryId = null;
  }
  renderLibrary();
  updateLibrarySelectionUI();
  saveState();
}

function getLibraryPlacementCount(libraryId) {
  return state.placed.filter((item) => item.libraryId === libraryId).length;
}

function renderLibrary() {
  libraryEl.innerHTML = '';

  for (const entry of state.library) {
    const dims = getOrientationDims(entry.length, entry.width, entry.height, entry.orientation ?? 0);
    const placedCount = getLibraryPlacementCount(entry.id);
    const li = document.createElement('li');
    li.className = 'library-item';
    if (entry.id === state.selectedLibraryId) {
      li.classList.add('selected');
    }
    if (placedCount > 0) {
      li.classList.add('in-container');
    }
    li.draggable = true;
    li.dataset.id = entry.id;
    li.innerHTML = `
      <span class="swatch" style="background:#${entry.color.toString(16).padStart(6, '0')}"></span>
      <span class="info">
        <strong>${entry.name}</strong>
        <span class="dims">${dims.length} × ${dims.width} × ${dims.height}</span>
      </span>
      ${placedCount > 0 ? `<span class="placed-badge">${placedCount} in container</span>` : ''}
    `;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'library-delete secondary';
    deleteBtn.title = 'Remove from library';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeLibraryItem(entry.id);
    });

    li.addEventListener('click', (e) => {
      if (e.target.closest('.library-delete')) return;
      selectLibraryItem(entry.id);
    });

    li.addEventListener('dragstart', (e) => {
      state.selectedLibraryId = entry.id;
      state.dragging = { ...entry };
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', entry.id);
      updateDropHintForDragging();
      updateLibrarySelectionUI();
    });

    li.addEventListener('dragend', () => {
      state.dragging = null;
      dropHint.classList.add('hidden');
      dropHint.textContent = 'Release to place item';
      renderLibrary();
      updateLibrarySelectionUI();
    });

    li.appendChild(deleteBtn);
    libraryEl.appendChild(li);
  }
}

function addLibraryItem(name, length, width, height) {
  const entry = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Item',
    length,
    width,
    height,
    orientation: state.previewOrientation,
    color: COLORS[state.nextColor % COLORS.length],
  };
  state.nextColor += 1;
  state.library.push(entry);
  state.previewOrientation = 0;
  state.selectedLibraryId = entry.id;
  renderLibrary();
  updateLibrarySelectionUI();
  updatePreviewOrientationUI();
  saveState();
}

function placeItemLoose(entry, targetCenterX, targetCenterZ) {
  const item = {
    id: crypto.randomUUID(),
    name: entry.name,
    baseLength: entry.length,
    baseWidth: entry.width,
    baseHeight: entry.height,
    orientation: entry.orientation ?? 0,
    color: entry.color,
    libraryId: entry.id,
    x: 0,
    y: 0,
    z: 0,
    length: 0,
    width: 0,
    height: 0,
  };
  applyItemDims(item);
  setItemAtCenter(item, targetCenterX, targetCenterZ);
  settleItemAtXZ(item, item.id);

  state.placed.push(item);
  renderLibrary();
  selectItem(item.id);
  return item;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;

  const hitId = raycastPlacedItem(e);
  if (hitId) {
    const item = getPlacedItem(hitId);
    const floor = pointerToFloor(e);
    if (!item || !floor) return;

    selectItem(hitId);
    state.moving = {
      id: hitId,
      start: { x: item.x, y: item.y, z: item.z },
      offsetX: (item.x + item.length / 2) - floor.x,
      offsetZ: (item.z + item.width / 2) - floor.z,
      dragging: false,
      startX: e.clientX,
      startY: e.clientY,
    };
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  clearSelection();
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.moving) return;

  if (!state.moving.dragging) {
    const dx = e.clientX - state.moving.startX;
    const dy = e.clientY - state.moving.startY;
    if (dx * dx + dy * dy < 9) return;
    state.moving.dragging = true;
    controls.enabled = false;
  }

  const floor = pointerToFloor(e);
  if (!floor) return;

  moveItemLoose(
    state.moving.id,
    floor.x + state.moving.offsetX,
    floor.z + state.moving.offsetZ
  );
  rebuildPlacedMeshes();
});

canvas.addEventListener('pointerup', (e) => {
  if (!state.moving) return;

  if (!state.moving.dragging) {
    state.moving = null;
    canvas.releasePointerCapture(e.pointerId);
    return;
  }

  const floor = pointerToFloor(e);
  if (floor) {
    moveItemLoose(
      state.moving.id,
      floor.x + state.moving.offsetX,
      floor.z + state.moving.offsetZ
    );
    rebuildPlacedMeshes();
    updateSelectionUI();
    saveState();
  }

  state.moving = null;
  controls.enabled = true;
  canvas.releasePointerCapture(e.pointerId);
});

canvas.addEventListener('pointercancel', () => {
  if (!state.moving) return;

  if (state.moving.dragging) {
    rebuildPlacedMeshes();
    updateSelectionUI();
  }

  state.moving = null;
  controls.enabled = true;
});

canvas.addEventListener('dragenter', (e) => {
  e.preventDefault();
});

canvas.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  dropHint.classList.add('hidden');
  dropHint.textContent = 'Release to place item · use arrow keys to position';

  const entry = state.dragging ?? getLibraryEntry(e.dataTransfer.getData('text/plain'));
  if (!entry) return;

  const floor = pointerToFloor(e);
  if (!floor) return;

  placeItemLoose(entry, floor.x, floor.z);
  state.dragging = null;
});

function rotatePreviewOrientation(axis) {
  const baseLength = parseFloat(document.getElementById('item-length').value) || 1;
  const baseWidth = parseFloat(document.getElementById('item-width').value) || 1;
  const baseHeight = parseFloat(document.getElementById('item-height').value) || 1;
  state.previewOrientation = rotateOrientationIndex(
    baseLength,
    baseWidth,
    baseHeight,
    state.previewOrientation,
    axis
  );
  updatePreviewOrientationUI();
}

document.getElementById('apply-container').addEventListener('click', () => {
  state.container = {
    length: parseFloat(document.getElementById('container-length').value) || 20,
    width: parseFloat(document.getElementById('container-width').value) || 8,
    height: parseFloat(document.getElementById('container-height').value) || 8,
  };
  state.placed = [];
  clearSelection();
  buildContainerMesh(state.container);
  rebuildPlacedMeshes();
  renderLibrary();
  updateCamera(state.container);
  saveState();
});

document.getElementById('rotate-x').addEventListener('click', () => rotatePreviewOrientation('x'));
document.getElementById('rotate-y').addEventListener('click', () => rotatePreviewOrientation('y'));
document.getElementById('rotate-z').addEventListener('click', () => rotatePreviewOrientation('z'));

['item-length', 'item-width', 'item-height'].forEach((id) => {
  document.getElementById(id).addEventListener('input', () => {
    state.previewOrientation = 0;
    updatePreviewOrientationUI();
  });
});

document.getElementById('add-item').addEventListener('click', () => {
  addLibraryItem(
    document.getElementById('item-name').value,
    parseFloat(document.getElementById('item-length').value) || 1,
    parseFloat(document.getElementById('item-width').value) || 1,
    parseFloat(document.getElementById('item-height').value) || 1
  );
});

document.getElementById('clear-placed').addEventListener('click', () => {
  state.placed = [];
  clearSelection();
  renderLibrary();
  saveState();
});

document.getElementById('export-layout').addEventListener('click', exportLayout);

document.getElementById('import-layout').addEventListener('click', () => {
  document.getElementById('import-layout-file').click();
});

document.getElementById('import-layout-file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (state.placed.length > 0 || state.library.length > 0) {
    if (!confirm('Import layout? This replaces your current container, library, and placed items.')) {
      e.target.value = '';
      return;
    }
  }

  importLayoutFromFile(file);
  e.target.value = '';
});

document.getElementById('export-plan').addEventListener('click', showLoadingPlanExport);
document.getElementById('close-plan-modal').addEventListener('click', hideLoadingPlanExport);
document.getElementById('download-plan').addEventListener('click', downloadLoadingPlan);
document.getElementById('copy-plan').addEventListener('click', async () => {
  const text = document.getElementById('loading-plan-text').value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    document.getElementById('loading-plan-text').select();
    document.execCommand('copy');
  }
});

document.getElementById('reset-all').addEventListener('click', () => {
  if (!confirm('Clear the container, item library, and saved layout?')) return;

  localStorage.removeItem(STORAGE_KEY);
  state.container = { length: 20, width: 8, height: 8 };
  state.library = [];
  state.placed = [];
  state.previewOrientation = 0;
  state.selectedLibraryId = null;
  state.selectedId = null;
  state.nextColor = 0;
  syncContainerForm();
  buildContainerMesh(state.container);
  rebuildPlacedMeshes();
  renderLibrary();
  updateLibrarySelectionUI();
  updateSelectionUI();
  updateCamera(state.container);
});

document.getElementById('rotate-library-x').addEventListener('click', () => {
  if (!state.selectedLibraryId) return;
  rotateLibraryEntry(state.selectedLibraryId, 'x');
});

document.getElementById('rotate-library-y').addEventListener('click', () => {
  if (!state.selectedLibraryId) return;
  rotateLibraryEntry(state.selectedLibraryId, 'y');
});

document.getElementById('rotate-library-z').addEventListener('click', () => {
  if (!state.selectedLibraryId) return;
  rotateLibraryEntry(state.selectedLibraryId, 'z');
});

document.getElementById('rotate-placed-x').addEventListener('click', () => {
  if (!state.selectedId) return;
  rotatePlacedItem(state.selectedId, 'x');
});

document.getElementById('rotate-placed-y').addEventListener('click', () => {
  if (!state.selectedId) return;
  rotatePlacedItem(state.selectedId, 'y');
});

document.getElementById('rotate-placed-z').addEventListener('click', () => {
  if (!state.selectedId) return;
  rotatePlacedItem(state.selectedId, 'z');
});

document.getElementById('remove-placed').addEventListener('click', () => {
  if (!state.selectedId) return;
  removePlacedItem(state.selectedId);
});

window.addEventListener('keydown', (e) => {
  if (document.activeElement?.matches('input, textarea')) return;

  const rotateAxis = { x: 'x', y: 'y', z: 'z' }[e.key.toLowerCase()];
  if (rotateAxis && state.dragging) {
    e.preventDefault();
    rotateLibraryEntry(state.dragging.id, rotateAxis);
    return;
  }

  if (rotateAxis && state.selectedLibraryId && !state.selectedId) {
    e.preventDefault();
    rotateLibraryEntry(state.selectedLibraryId, rotateAxis);
    return;
  }

  if (!state.selectedId) return;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

  e.preventDefault();
  const step = e.shiftKey ? FINE_MOVE_STEP : MOVE_STEP;

  const deltas = {
    ArrowLeft: { x: -step, z: 0 },
    ArrowRight: { x: step, z: 0 },
    ArrowUp: { x: 0, z: -step },
    ArrowDown: { x: 0, z: step },
  };

  nudgeSelectedItem(deltas[e.key].x, deltas[e.key].z);
});

window.addEventListener('resize', resize);

loadState();
if (state.placed.length === 0 && state.library.length === 0) {
  refreshFromState();
}
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
