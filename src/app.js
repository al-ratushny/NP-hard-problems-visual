const state = {
  tasks: [],
  reductions: [],
  taskById: new Map(),
  reductionById: new Map(),
  outgoing: new Map(),
  adjacency: new Map(),
  visibleTaskIds: new Set(),
  selectedTaskId: null,
  selectedReductionId: null,
  pathReductionIds: new Set(),
  nodeOffsets: new Map(),
  nodeDrag: {
    active: false,
    taskId: null,
    startClientX: 0,
    startClientY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    moved: false,
    rafPending: false,
  },
  viewport: {
    scale: 1,
    tx: 0,
    ty: 0,
    dragging: false,
    lastClientX: 0,
    lastClientY: 0,
    moved: false,
  },
  query: "",
  sourceId: "",
  targetId: "",
};

const colorByClass = {
  P: "#3aa7e8",
  NP: "#3aa7e8",
  "NP-complete": "#3aa7e8",
  "NP-hard": "#3aa7e8",
};

const VIEW_W = 1200;
const VIEW_H = 760;
const NODE_W = 182;
const NODE_H = 56;
const NODE_ROW_GAP = 30;
const LAYER_GAP = 82;
const NODE_LINE_HEIGHT = 13;
const TASK_YEAR = {
  circuit_sat: 1971,
  sat: 1971,
  "3sat": 1972,
  clique: 1972,
  independent_set: 1972,
  vertex_cover: 1972,
  hamiltonian_cycle: 1972,
  hamiltonian_path: 1972,
  tsp_decision: 1972,
  subset_sum: 1972,
  set_cover: 1972,
  exact_cover: 1972,
  k_colorability: 1972,
  directed_hamiltonian_cycle: 1972,
  directed_hamiltonian_path: 1972,
  partition: 1973,
  knapsack_decision: 1974,
  feedback_vertex_set: 1972,
  feedback_arc_set: 1972,
  x3c: 1979,
  "3dm": 1972,
  dominating_set: 1979,
  max_cut_decision: 1972,
  set_packing: 1972,
  hitting_set: 1972,
  three_partition: 1975,
  bin_packing_decision: 1978,
  longest_path_decision: 1977,
  clique_cover: 1979,
  connected_dominating_set: 1979,
  steiner_tree_decision: 1972,
  ilp_feasibility_01: 1972,
  nae_3sat: 1978,
  planar_3sat: 1982,
  one_in_three_sat: 1978,
  edge_coloring_decision: 1979,
  graph_bandwidth: 1976,
  minimum_fill_in: 1976,
  balanced_biclique: 1979,
  partition_into_triangles: 1979,
};

const svg = document.getElementById("graphSvg");
const detailsPanel = document.getElementById("detailsPanel");
const searchInput = document.getElementById("searchInput");
const sourceSelect = document.getElementById("sourceSelect");
const targetSelect = document.getElementById("targetSelect");
const findPathBtn = document.getElementById("findPathBtn");
const clearPathBtn = document.getElementById("clearPathBtn");
const pathResult = document.getElementById("pathResult");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const resetViewBtn = document.getElementById("resetViewBtn");
const VIEWPORT_GROUP_ID = "viewport-root";

function qsHash() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

function setHash() {
  const p = new URLSearchParams();
  if (state.query) p.set("q", state.query);
  if (state.selectedTaskId) p.set("node", state.selectedTaskId);
  if (state.selectedReductionId) p.set("edge", state.selectedReductionId);
  if (state.sourceId) p.set("src", state.sourceId);
  if (state.targetId) p.set("dst", state.targetId);
  if (state.viewport.scale !== 1) p.set("zs", String(state.viewport.scale));
  if (state.viewport.tx !== 0) p.set("zx", String(state.viewport.tx));
  if (state.viewport.ty !== 0) p.set("zy", String(state.viewport.ty));
  window.location.hash = p.toString();
}

function loadHash() {
  const p = qsHash();
  state.query = p.get("q") || "";
  state.selectedTaskId = p.get("node") || null;
  state.selectedReductionId = p.get("edge") || null;
  state.sourceId = p.get("src") || "";
  state.targetId = p.get("dst") || "";
  state.viewport.scale = Number.parseFloat(p.get("zs") || "1");
  state.viewport.tx = Number.parseFloat(p.get("zx") || "0");
  state.viewport.ty = Number.parseFloat(p.get("zy") || "0");
  if (!Number.isFinite(state.viewport.scale) || state.viewport.scale <= 0) state.viewport.scale = 1;
  if (!Number.isFinite(state.viewport.tx)) state.viewport.tx = 0;
  if (!Number.isFinite(state.viewport.ty)) state.viewport.ty = 0;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function byIdMap(items) {
  return new Map(items.map((x) => [x.id, x]));
}

function matchTask(task, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystack = [task.id, task.title, ...(task.aliases || [])].join(" ").toLowerCase();
  return haystack.includes(q);
}

function recalcVisible() {
  state.visibleTaskIds = new Set(state.tasks.map((task) => task.id));
}

function taskYear(task) {
  return TASK_YEAR[task.id] || 1975;
}

function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function jitter(value, amplitude) {
  const n = hashString(value) / 0xffffffff;
  return (n * 2 - 1) * amplitude;
}

function splitTitleLines(title, maxChars = 16, maxLines = 2) {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [title];

  const lines = [];
  let current = "";
  let idx = 0;
  while (idx < words.length && lines.length < maxLines) {
    const next = current ? `${current} ${words[idx]}` : words[idx];
    if (next.length <= maxChars || !current) {
      if (words[idx].length > maxChars) {
        const chunk = words[idx].slice(0, maxChars - 1);
        const rest = words[idx].slice(maxChars - 1);
        current = current ? `${current} ${chunk}\u2026` : `${chunk}\u2026`;
        words[idx] = rest;
      } else {
        current = next;
        idx += 1;
      }
    } else {
      lines.push(current);
      current = "";
    }
  }
  if (lines.length < maxLines && current) lines.push(current);

  if (idx < words.length && lines.length > 0) {
    const lastIndex = lines.length - 1;
    const shortened = lines[lastIndex].slice(0, Math.max(0, maxChars - 1)).trimEnd();
    lines[lastIndex] = `${shortened}\u2026`;
  }
  return lines.slice(0, maxLines);
}

function edgeBucketKey(p1, p2) {
  const y1 = Math.round(p1.y / 120);
  const y2 = Math.round(p2.y / 120);
  const xBand = Math.round((p1.x + p2.x) / 220);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return `${minY}:${maxY}:${xBand}`;
}

function buildEdgeBundleOffsets(visibleReductions, pos) {
  const groups = new Map();
  for (const red of visibleReductions) {
    const p1 = pos.get(red.from);
    const p2 = pos.get(red.to);
    if (!p1 || !p2) continue;
    const key = edgeBucketKey(p1, p2);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(red.id);
  }
  const offsets = new Map();
  for (const ids of groups.values()) {
    ids.sort();
    const mid = (ids.length - 1) / 2;
    for (let i = 0; i < ids.length; i += 1) {
      offsets.set(ids[i], (i - mid) * 10);
    }
  }
  return offsets;
}

function buildCurvedEdgePath(p1, p2, offset = 0) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const exitPad = (vx, vy) =>
    Math.min(
      len / 3,
      Math.min(
        (NODE_W / 2) / Math.max(Math.abs(vx), 0.0001),
        (NODE_H / 2) / Math.max(Math.abs(vy), 0.0001),
      ),
    );
  const startPad = exitPad(ux, uy);
  const endPad = exitPad(ux, uy) + 2;
  const x1 = p1.x + (dx / len) * startPad;
  const y1 = p1.y + (dy / len) * startPad;
  const x2 = p2.x - (dx / len) * endPad;
  const y2 = p2.y - (dy / len) * endPad;

  const nx = -dy / len;
  const ny = dx / len;
  const baseCurvature = Math.min(62, 20 + Math.abs(dy) * 0.09);
  const bend = baseCurvature + offset;
  const cx = (x1 + x2) / 2 + nx * bend;
  const cy = (y1 + y2) / 2 + ny * bend;
  const path = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
  return { path, x1, y1, x2, y2 };
}

function yearLayout(visibleTasks) {
  const byYear = new Map();
  for (const task of visibleTasks) {
    const y = taskYear(task);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(task);
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  const leftPad = 26;
  const rightPad = 26;
  const topPad = 22;
  const bottomPad = 22;
  const width = VIEW_W - leftPad - rightPad;
  const maxPerRow = Math.max(1, Math.floor((width + NODE_ROW_GAP) / (NODE_W + NODE_ROW_GAP)));

  const layers = years.map((year) => {
    const tasks = byYear
      .get(year)
      .slice()
      .sort((a, b) => {
        const ca = jitter(`order:${year}:${a.id}`, 1);
        const cb = jitter(`order:${year}:${b.id}`, 1);
        if (Math.abs(ca - cb) > 0.18) return ca - cb;
        return a.title.localeCompare(b.title);
      });
    const rowCount = Math.ceil(tasks.length / maxPerRow);
    const layerHeight = rowCount * NODE_H + (rowCount - 1) * NODE_ROW_GAP;
    return { tasks, rowCount, layerHeight };
  });

  const totalLayerHeight =
    layers.reduce((acc, layer) => acc + layer.layerHeight, 0) + (layers.length - 1) * LAYER_GAP;
  const viewHeight = Math.max(VIEW_H, topPad + totalLayerHeight + bottomPad);

  const positions = new Map();
  let currentY = topPad;
  for (const layer of layers) {
    const layerTop = currentY;
    for (let row = 0; row < layer.rowCount; row += 1) {
      const start = row * maxPerRow;
      const rowTasks = layer.tasks.slice(start, start + maxPerRow);
      const rowY =
        layerTop + row * (NODE_H + NODE_ROW_GAP) + NODE_H / 2 + jitter(`row-y:${currentY}:${row}`, 7);
      const rowCount = rowTasks.length;
      const rowWidth = rowCount * NODE_W + (rowCount - 1) * NODE_ROW_GAP;
      const rowShift = jitter(`row-x:${currentY}:${row}`, 48);
      const startX = leftPad + (width - rowWidth) / 2 + NODE_W / 2 + rowShift;
      for (let i = 0; i < rowTasks.length; i += 1) {
        const task = rowTasks[i];
        const baseX = startX + i * (NODE_W + NODE_ROW_GAP);
        const zigzag = i % 2 === 0 ? -10 : 10;
        const chaosX = jitter(`node-x:${task.id}`, 24) + zigzag;
        const chaosY = jitter(`node-y:${task.id}`, 8);
        const x = Math.max(leftPad + NODE_W / 2, Math.min(VIEW_W - rightPad - NODE_W / 2, baseX + chaosX));
        positions.set(task.id, { x, y: rowY + chaosY });
      }
    }
    currentY += layer.layerHeight + LAYER_GAP;
  }

  return { positions, viewHeight };
}

function satDepthLayout(visibleTasks, visibleReductions) {
  if (visibleTasks.length === 0) {
    return { positions: new Map(), viewWidth: VIEW_W, viewHeight: VIEW_H };
  }

  const taskById = new Map(visibleTasks.map((t) => [t.id, t]));
  const out = new Map(visibleTasks.map((t) => [t.id, []]));
  const deg = new Map(visibleTasks.map((t) => [t.id, 0]));
  for (const red of visibleReductions) {
    if (!taskById.has(red.from) || !taskById.has(red.to)) continue;
    out.get(red.from).push(red.to);
    deg.set(red.from, (deg.get(red.from) || 0) + 1);
    deg.set(red.to, (deg.get(red.to) || 0) + 1);
  }

  const rootId = taskById.has("sat") ? "sat" : visibleTasks[0].id;
  const depth = new Map(visibleTasks.map((t) => [t.id, Number.POSITIVE_INFINITY]));
  depth.set(rootId, 0);
  const queue = [rootId];

  while (queue.length > 0) {
    const cur = queue.shift();
    const d = depth.get(cur);
    for (const nxt of out.get(cur) || []) {
      if (depth.get(nxt) !== Number.POSITIVE_INFINITY) continue;
      depth.set(nxt, d + 1);
      queue.push(nxt);
    }
  }

  const finiteDepths = [...depth.values()].filter(Number.isFinite);
  const maxReached = finiteDepths.length > 0 ? Math.max(...finiteDepths) : 0;
  for (const task of visibleTasks) {
    if (!Number.isFinite(depth.get(task.id))) depth.set(task.id, maxReached + 1);
  }

  const byDepth = new Map();
  for (const task of visibleTasks) {
    const d = depth.get(task.id) || 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(task);
  }

  const leftPad = 36;
  const rightPad = 36;
  const topPad = 28;
  const bottomPad = 28;
  const layerStep = NODE_W + 84;
  const rowGap = 18;
  const maxDepth = Math.max(...byDepth.keys());
  const viewWidth = Math.max(VIEW_W, leftPad + (maxDepth + 1) * layerStep + rightPad);

  const maxLayerSize = Math.max(...[...byDepth.values()].map((tasks) => tasks.length));
  const contentHeight = maxLayerSize * NODE_H + Math.max(0, maxLayerSize - 1) * rowGap;
  const viewHeight = Math.max(VIEW_H, topPad + contentHeight + bottomPad);
  const usableHeight = viewHeight - topPad - bottomPad;
  const positions = new Map();
  for (const [d, tasks] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    tasks.sort((a, b) => {
      const da = deg.get(a.id) || 0;
      const db = deg.get(b.id) || 0;
      if (da !== db) return db - da;
      return a.title.localeCompare(b.title);
    });
    const x = leftPad + d * layerStep + NODE_W / 2;
    const columnHeight = tasks.length * NODE_H + Math.max(0, tasks.length - 1) * rowGap;
    const startY = topPad + Math.max(0, (usableHeight - columnHeight) / 2) + NODE_H / 2;
    for (let i = 0; i < tasks.length; i += 1) {
      const y = startY + i * (NODE_H + rowGap);
      positions.set(tasks[i].id, { x, y });
    }
  }

  return { positions, viewWidth, viewHeight };
}

function clearSvg() {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function buildHighlightSets() {
  const nodes = new Set();
  const edges = new Set();
  if (state.selectedTaskId) {
    nodes.add(state.selectedTaskId);
    for (const nb of state.adjacency.get(state.selectedTaskId) || []) nodes.add(nb);
    for (const red of state.reductions) {
      if (red.from === state.selectedTaskId || red.to === state.selectedTaskId) edges.add(red.id);
    }
    return { nodes, edges, active: true };
  }

  if (state.selectedReductionId) {
    const red = state.reductionById.get(state.selectedReductionId);
    if (!red) return { nodes, edges, active: false };
    nodes.add(red.from);
    nodes.add(red.to);
    for (const nb of state.adjacency.get(red.from) || []) nodes.add(nb);
    for (const nb of state.adjacency.get(red.to) || []) nodes.add(nb);
    for (const r of state.reductions) {
      if (r.id === red.id) edges.add(r.id);
      else if (r.from === red.from || r.to === red.from || r.from === red.to || r.to === red.to) {
        edges.add(r.id);
      }
    }
    return { nodes, edges, active: true };
  }
  return { nodes, edges, active: false };
}

function getViewMetrics() {
  const vb = svg.viewBox.baseVal;
  return {
    width: vb && vb.width ? vb.width : VIEW_W,
    height: vb && vb.height ? vb.height : VIEW_H,
    pxToUnitX: (vb && vb.width ? vb.width : VIEW_W) / Math.max(1, svg.clientWidth),
    pxToUnitY: (vb && vb.height ? vb.height : VIEW_H) / Math.max(1, svg.clientHeight),
  };
}

function applyViewportTransform() {
  const g = document.getElementById(VIEWPORT_GROUP_ID);
  if (!g) return;
  const { scale, tx, ty } = state.viewport;
  g.setAttribute("transform", `matrix(${scale} 0 0 ${scale} ${tx} ${ty})`);
}

function zoomBy(factor) {
  const oldScale = state.viewport.scale;
  const newScale = Math.max(0.4, Math.min(3, oldScale * factor));
  if (newScale === oldScale) return;
  const metrics = getViewMetrics();
  const cx = metrics.width / 2;
  const cy = metrics.height / 2;
  state.viewport.tx = cx - (newScale * (cx - state.viewport.tx)) / oldScale;
  state.viewport.ty = cy - (newScale * (cy - state.viewport.ty)) / oldScale;
  state.viewport.scale = newScale;
  applyViewportTransform();
  setHash();
}

function resetViewport() {
  state.viewport.scale = 1;
  state.viewport.tx = 0;
  state.viewport.ty = 0;
  applyViewportTransform();
  setHash();
}

function drawGraph() {
  clearSvg();
  const visibleTasks = state.tasks.filter((t) => state.visibleTaskIds.has(t.id));
  const visibleTaskIds = new Set(visibleTasks.map((t) => t.id));
  const visibleReductions = state.reductions.filter(
    (r) => visibleTaskIds.has(r.from) && visibleTaskIds.has(r.to),
  );

  const { positions: pos, viewWidth, viewHeight } = satDepthLayout(visibleTasks, visibleReductions);
  for (const [taskId, offset] of state.nodeOffsets.entries()) {
    const base = pos.get(taskId);
    if (!base || !offset) continue;
    pos.set(taskId, { x: base.x + offset.dx, y: base.y + offset.dy });
  }
  svg.setAttribute("viewBox", `0 0 ${viewWidth} ${viewHeight}`);
  svg.style.height = `${Math.max(680, viewHeight)}px`;
  const highlight = buildHighlightSets();
  const edgeOffsets = buildEdgeBundleOffsets(visibleReductions, pos);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  svg.appendChild(defs);
  const sketchFilter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  sketchFilter.setAttribute("id", "sketch-filter");
  sketchFilter.setAttribute("x", "-10%");
  sketchFilter.setAttribute("y", "-10%");
  sketchFilter.setAttribute("width", "120%");
  sketchFilter.setAttribute("height", "120%");
  const noise = document.createElementNS("http://www.w3.org/2000/svg", "feTurbulence");
  noise.setAttribute("type", "fractalNoise");
  noise.setAttribute("baseFrequency", "0.9");
  noise.setAttribute("numOctaves", "1");
  noise.setAttribute("seed", "7");
  noise.setAttribute("result", "noise");
  sketchFilter.appendChild(noise);
  const wobble = document.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
  wobble.setAttribute("in", "SourceGraphic");
  wobble.setAttribute("in2", "noise");
  wobble.setAttribute("scale", "0.8");
  wobble.setAttribute("xChannelSelector", "R");
  wobble.setAttribute("yChannelSelector", "G");
  sketchFilter.appendChild(wobble);
  defs.appendChild(sketchFilter);
  const nodeGradientByClass = new Map();
  for (const [klass, base] of Object.entries(colorByClass)) {
    const grad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    const gradId = `node-grad-${klass.replaceAll(/[^a-z0-9_-]/gi, "_")}`;
    grad.setAttribute("id", gradId);
    grad.setAttribute("x1", "0%");
    grad.setAttribute("y1", "0%");
    grad.setAttribute("x2", "0%");
    grad.setAttribute("y2", "100%");

    const stop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", base);
    stop1.setAttribute("stop-opacity", "1");
    grad.appendChild(stop1);

    const stop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", base);
    stop2.setAttribute("stop-opacity", "1");
    grad.appendChild(stop2);

    defs.appendChild(grad);
    nodeGradientByClass.set(klass, gradId);
  }

  const viewportGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewportGroup.setAttribute("id", VIEWPORT_GROUP_ID);
  svg.appendChild(viewportGroup);

  const edgesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewportGroup.appendChild(edgesGroup);
  for (const red of visibleReductions) {
    const p1 = pos.get(red.from);
    const p2 = pos.get(red.to);
    if (!p1 || !p2) continue;
    const geometry = buildCurvedEdgePath(p1, p2, edgeOffsets.get(red.id) || 0);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", geometry.path);
    line.classList.add("edge");
    const isPathEdge = state.pathReductionIds.has(red.id);
    const isSelectedEdge = state.selectedReductionId === red.id;
    if (isPathEdge) line.classList.add("path-edge");
    if (isSelectedEdge) line.classList.add("selected-edge");
    if (highlight.active) {
      if (highlight.edges.has(red.id)) line.classList.add("edge-highlight");
      else line.classList.add("edge-dim");
    }
    line.addEventListener("click", (event) => {
      event.stopPropagation();
      clearActivePath();
      state.selectedReductionId = red.id;
      state.selectedTaskId = null;
      renderDetails();
      setHash();
      drawGraph();
    });
    edgesGroup.appendChild(line);
  }

  const nodesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewportGroup.appendChild(nodesGroup);
  for (const task of visibleTasks) {
    const p = pos.get(task.id);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const tilt = jitter(`tilt:${task.id}`, 1.1);
    group.setAttribute("transform", `rotate(${tilt} ${p.x} ${p.y})`);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(p.x - NODE_W / 2));
    rect.setAttribute("y", String(p.y - NODE_H / 2));
    rect.setAttribute("width", String(NODE_W));
    rect.setAttribute("height", String(NODE_H));
    rect.setAttribute("rx", "8");
    rect.setAttribute("ry", "8");
    const nodeGradId = nodeGradientByClass.get(task.class);
    rect.setAttribute("fill", nodeGradId ? `url(#${nodeGradId})` : colorByClass[task.class] || "#b0beca");
    rect.classList.add("node-block");
    rect.setAttribute("filter", "url(#sketch-filter)");
    if (state.selectedTaskId === task.id) rect.classList.add("selected-node");
    if (highlight.active) {
      if (highlight.nodes.has(task.id)) rect.classList.add("node-highlight");
      else rect.classList.add("node-dim");
    }
    group.appendChild(rect);

    const inner = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    inner.setAttribute("x", String(p.x - NODE_W / 2 + 1.5));
    inner.setAttribute("y", String(p.y - NODE_H / 2 + 1.5));
    inner.setAttribute("width", String(NODE_W - 3));
    inner.setAttribute("height", String(NODE_H - 3));
    inner.setAttribute("rx", "7");
    inner.setAttribute("ry", "7");
    inner.classList.add("node-inner");
    group.appendChild(inner);

    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    title.classList.add("node-title");
    title.setAttribute("x", String(p.x));
    title.setAttribute("text-anchor", "middle");
    const lines = splitTitleLines(task.title);
    if (task.title.length > 22) title.style.fontSize = "10px";
    const startY = p.y - ((lines.length - 1) * NODE_LINE_HEIGHT) / 2 + 4;
    title.setAttribute("y", String(startY));
    if (highlight.active && !highlight.nodes.has(task.id)) title.style.opacity = "0.32";
    lines.forEach((line, idx) => {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("x", String(p.x));
      if (idx > 0) tspan.setAttribute("dy", String(NODE_LINE_HEIGHT));
      tspan.textContent = line;
      title.appendChild(tspan);
    });
    group.appendChild(title);

    group.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.nodeDrag.moved) {
        state.nodeDrag.moved = false;
        return;
      }
      clearActivePath();
      state.selectedTaskId = task.id;
      state.selectedReductionId = null;
      renderDetails();
      setHash();
      drawGraph();
    });
    group.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const currentOffset = state.nodeOffsets.get(task.id) || { dx: 0, dy: 0 };
      state.nodeDrag.active = true;
      state.nodeDrag.taskId = task.id;
      state.nodeDrag.startClientX = event.clientX;
      state.nodeDrag.startClientY = event.clientY;
      state.nodeDrag.startOffsetX = currentOffset.dx;
      state.nodeDrag.startOffsetY = currentOffset.dy;
      state.nodeDrag.moved = false;
      svg.classList.add("dragging-node");
    });
    nodesGroup.appendChild(group);
  }

  if (visibleTasks.length === 0) {
    const msg = document.createElementNS("http://www.w3.org/2000/svg", "text");
    msg.setAttribute("x", "520");
    msg.setAttribute("y", "380");
    msg.setAttribute("fill", "#607180");
    msg.textContent = "No nodes match current filters";
    viewportGroup.appendChild(msg);
  }

  applyViewportTransform();
}

function renderDetails() {
  if (state.selectedTaskId) {
    const task = state.taskById.get(state.selectedTaskId);
    if (!task) return;
    const related = state.reductions.filter((r) => r.from === task.id || r.to === task.id);
    const references = task.references
      .map((r) => `<li><a href="${escapeHtml(r.url)}" target="_blank">${escapeHtml(r.label)}</a></li>`)
      .join("");
    const relatedRows = related
      .slice(0, 12)
      .map((r) => `<li>${escapeHtml(r.from)} -> ${escapeHtml(r.to)}</li>`)
      .join("");
    detailsPanel.innerHTML = `
      <h3>${escapeHtml(task.title)}</h3>
      <div class="meta">${escapeHtml(task.id)} | ${escapeHtml(task.class)}</div>
      <p>${escapeHtml(task.statement)}</p>
      <strong>References</strong>
      <ul>${references}</ul>
      <strong>Related Reductions (${related.length})</strong>
      <ul>${relatedRows || "<li>None</li>"}</ul>
    `;
    return;
  }

  if (state.selectedReductionId) {
    const red = state.reductionById.get(state.selectedReductionId);
    if (!red) return;
    const refs = red.references
      .map((r) => `<li><a href="${escapeHtml(r.url)}" target="_blank">${escapeHtml(r.label)}</a></li>`)
      .join("");
    detailsPanel.innerHTML = `
      <h3>Reduction: ${escapeHtml(red.id)}</h3>
      <div class="meta">${escapeHtml(red.from)} -> ${escapeHtml(red.to)} | ${escapeHtml(red.type)}</div>
      <p>${escapeHtml(red.idea)}</p>
      <strong>References</strong>
      <ul>${refs}</ul>
    `;
    return;
  }

  detailsPanel.innerHTML = "<p>Select a node or edge.</p>";
}

function fillTaskSelect(selectEl, selectedId) {
  const opts = [`<option value="">-- select --</option>`];
  for (const task of state.tasks) {
    const selected = task.id === selectedId ? "selected" : "";
    opts.push(`<option value="${escapeHtml(task.id)}" ${selected}>${escapeHtml(task.title)}</option>`);
  }
  selectEl.innerHTML = opts.join("");
}

function bfsPath(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return [];

  const queue = [sourceId];
  const seen = new Set([sourceId]);
  const prevNode = new Map();
  const prevEdge = new Map();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === targetId) break;
    for (const edge of state.outgoing.get(cur) || []) {
      const nxt = edge.to;
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      prevNode.set(nxt, cur);
      prevEdge.set(nxt, edge.id);
      queue.push(nxt);
    }
  }

  if (!seen.has(targetId)) return [];
  const path = [];
  let cur = targetId;
  while (cur !== sourceId) {
    const edgeId = prevEdge.get(cur);
    path.push(edgeId);
    cur = prevNode.get(cur);
  }
  path.reverse();
  return path;
}

function renderPath(pathEdges) {
  if (pathEdges.length === 0) {
    pathResult.textContent = "No path found.";
    return;
  }
  const rows = pathEdges.map((id, i) => {
    const r = state.reductionById.get(id);
    return `${i + 1}. ${r.from} -> ${r.to} (${r.id})`;
  });
  pathResult.textContent = rows.join("\n");
}

function clearActivePath(resetSelectors = true) {
  state.pathReductionIds = new Set();
  pathResult.textContent = "";
  if (resetSelectors) {
    state.sourceId = "";
    state.targetId = "";
    sourceSelect.value = "";
    targetSelect.value = "";
  }
}

function wireEvents() {
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = searchInput.value.trim();
      const hit = state.tasks.find((task) => matchTask(task, state.query));
      state.selectedTaskId = hit ? hit.id : null;
      state.selectedReductionId = null;
      renderDetails();
      drawGraph();
      setHash();
    }, 160);
  });

  sourceSelect.addEventListener("change", () => {
    state.sourceId = sourceSelect.value;
    setHash();
  });
  targetSelect.addEventListener("change", () => {
    state.targetId = targetSelect.value;
    setHash();
  });

  findPathBtn.addEventListener("click", () => {
    const path = bfsPath(state.sourceId, state.targetId);
    state.pathReductionIds = new Set(path);
    renderPath(path);
    drawGraph();
    setHash();
  });

  clearPathBtn.addEventListener("click", () => {
    clearActivePath();
    drawGraph();
    setHash();
  });

  svg.addEventListener("click", () => {
    if (state.viewport.moved) {
      state.viewport.moved = false;
      return;
    }
    state.selectedTaskId = null;
    state.selectedReductionId = null;
    renderDetails();
    setHash();
    drawGraph();
  });

  zoomInBtn.addEventListener("click", () => zoomBy(1.15));
  zoomOutBtn.addEventListener("click", () => zoomBy(1 / 1.15));
  resetViewBtn.addEventListener("click", () => resetViewport());

  svg.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (event.target !== svg) return;
    state.viewport.dragging = true;
    state.viewport.moved = false;
    state.viewport.lastClientX = event.clientX;
    state.viewport.lastClientY = event.clientY;
    svg.classList.add("dragging");
  });

  window.addEventListener("mousemove", (event) => {
    if (state.nodeDrag.active && state.nodeDrag.taskId) {
      const dxPx = event.clientX - state.nodeDrag.startClientX;
      const dyPx = event.clientY - state.nodeDrag.startClientY;
      if (Math.abs(dxPx) + Math.abs(dyPx) > 2) state.nodeDrag.moved = true;
      const metrics = getViewMetrics();
      const scale = Math.max(0.0001, state.viewport.scale);
      const dx = (dxPx * metrics.pxToUnitX) / scale;
      const dy = (dyPx * metrics.pxToUnitY) / scale;
      state.nodeOffsets.set(state.nodeDrag.taskId, {
        dx: state.nodeDrag.startOffsetX + dx,
        dy: state.nodeDrag.startOffsetY + dy,
      });
      if (!state.nodeDrag.rafPending) {
        state.nodeDrag.rafPending = true;
        window.requestAnimationFrame(() => {
          state.nodeDrag.rafPending = false;
          drawGraph();
        });
      }
      return;
    }

    if (!state.viewport.dragging) return;
    const dxPx = event.clientX - state.viewport.lastClientX;
    const dyPx = event.clientY - state.viewport.lastClientY;
    if (Math.abs(dxPx) + Math.abs(dyPx) > 2) state.viewport.moved = true;
    const metrics = getViewMetrics();
    state.viewport.tx += dxPx * metrics.pxToUnitX;
    state.viewport.ty += dyPx * metrics.pxToUnitY;
    state.viewport.lastClientX = event.clientX;
    state.viewport.lastClientY = event.clientY;
    applyViewportTransform();
  });

  window.addEventListener("mouseup", () => {
    if (state.nodeDrag.active) {
      state.nodeDrag.active = false;
      state.nodeDrag.taskId = null;
      state.nodeDrag.rafPending = false;
      svg.classList.remove("dragging-node");
      if (state.nodeDrag.moved) setHash();
    }
    if (!state.viewport.dragging) return;
    state.viewport.dragging = false;
    svg.classList.remove("dragging");
    if (state.viewport.moved) setHash();
  });
}

async function loadData() {
  const [taskRes, redRes] = await Promise.all([
    fetch("../data/tasks/tasks.json"),
    fetch("../data/reductions/reductions.json"),
  ]);
  const taskData = await taskRes.json();
  const redData = await redRes.json();
  state.tasks = taskData.tasks || [];
  state.reductions = redData.reductions || [];
  state.taskById = byIdMap(state.tasks);
  state.reductionById = byIdMap(state.reductions);
  state.outgoing = new Map(state.tasks.map((t) => [t.id, []]));
  state.adjacency = new Map(state.tasks.map((t) => [t.id, new Set()]));
  for (const r of state.reductions) {
    if (state.outgoing.has(r.from)) {
      state.outgoing.get(r.from).push(r);
    }
    if (state.adjacency.has(r.from) && state.adjacency.has(r.to)) {
      state.adjacency.get(r.from).add(r.to);
      state.adjacency.get(r.to).add(r.from);
    }
  }
}

function hydrateInitialControls() {
  searchInput.value = state.query;
  fillTaskSelect(sourceSelect, state.sourceId);
  fillTaskSelect(targetSelect, state.targetId);
}

async function main() {
  loadHash();
  await loadData();
  wireEvents();
  hydrateInitialControls();
  recalcVisible();
  if (state.query) {
    const hit = state.tasks.find((task) => matchTask(task, state.query));
    state.selectedTaskId = hit ? hit.id : state.selectedTaskId;
    state.selectedReductionId = hit ? null : state.selectedReductionId;
  }
  drawGraph();
  renderDetails();

  if (state.sourceId && state.targetId) {
    const path = bfsPath(state.sourceId, state.targetId);
    state.pathReductionIds = new Set(path);
    renderPath(path);
    drawGraph();
  }
}

main().catch((err) => {
  detailsPanel.innerHTML = `<p>Failed to load data: ${escapeHtml(String(err))}</p>`;
});
