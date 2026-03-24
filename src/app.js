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
  pathTaskIds: new Set(),
  viewport: {
    scale: 1,
    baseWidth: 0,
    baseHeight: 0,
  },
  query: "",
  sourceId: "",
  targetId: "",
  layoutCache: {
    key: "",
    value: null,
  },
};

const colorByClass = {
  P: "#3aa7e8",
  NP: "#3aa7e8",
  "NP-complete": "#3aa7e8",
  "NP-hard": "#3aa7e8",
};

const VIEW_W = 1200;
const NODE_W = 182;
const NODE_H = 56;
const NODE_LINE_HEIGHT = 13;

const svg = document.getElementById("graphSvg");
const detailsPanel = document.getElementById("detailsPanel");
const searchInput = document.getElementById("searchInput");
const sourceSelect = document.getElementById("sourceSelect");
const targetSelect = document.getElementById("targetSelect");
const findPathBtn = document.getElementById("findPathBtn");
const clearPathBtn = document.getElementById("clearPathBtn");
const pathResult = document.getElementById("pathResult");
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
  window.location.hash = p.toString();
}

function loadHash() {
  const p = qsHash();
  state.query = p.get("q") || "";
  state.selectedTaskId = p.get("node") || null;
  state.selectedReductionId = p.get("edge") || null;
  state.sourceId = p.get("src") || "";
  state.targetId = p.get("dst") || "";
  state.viewport.scale = 1;
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
  return Number.isFinite(task.year) ? task.year : 0;
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

function graphLayout(visibleTasks, visibleReductions) {
  if (visibleTasks.length === 0) {
    return { positions: new Map(), viewWidth: VIEW_W, viewHeight: NODE_H + 36, yearBands: [] };
  }

  const deg = new Map(visibleTasks.map((t) => [t.id, 0]));
  for (const red of visibleReductions) {
    if (!deg.has(red.from) || !deg.has(red.to)) continue;
    deg.set(red.from, (deg.get(red.from) || 0) + 1);
    deg.set(red.to, (deg.get(red.to) || 0) + 1);
  }

  const leftPad = 66;
  const rightPad = 66;
  const topPad = 44;
  const rowGap = 16;
  const colGap = 26;
  const yearGap = 92;
  const maxRows = 14;
  const rowStep = NODE_H + rowGap;
  const tasksByYear = new Map();
  for (const task of visibleTasks) {
    const year = taskYear(task);
    if (!tasksByYear.has(year)) tasksByYear.set(year, []);
    tasksByYear.get(year).push(task);
  }

  const years = [...tasksByYear.keys()].sort((a, b) => a - b);
  const maxYearRows = Math.min(
    maxRows,
    Math.max(...years.map((year) => tasksByYear.get(year).length)),
  );
  const viewHeight = topPad + maxYearRows * rowStep - rowGap;
  const positions = new Map();
  const yearBands = [];
  let xCursor = leftPad;

  for (const year of years) {
    const tasks = tasksByYear
      .get(year)
      .slice()
      .sort((a, b) => {
        const da = deg.get(a.id) || 0;
        const db = deg.get(b.id) || 0;
        if (da !== db) return db - da;
        return a.title.localeCompare(b.title);
      });
    const yearColumns = Math.ceil(tasks.length / maxRows);
    const yearWidth = yearColumns * NODE_W + Math.max(0, yearColumns - 1) * colGap;
    let minX = Infinity;
    let maxX = -Infinity;

    for (let i = 0; i < tasks.length; i += 1) {
      const col = Math.floor(i / maxRows);
      const row = i % maxRows;
      const x = xCursor + col * (NODE_W + colGap) + NODE_W / 2;
      const y = topPad + row * rowStep + NODE_H / 2;
      positions.set(tasks[i].id, { x, y });
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }

    yearBands.push({ year, x: (minX + maxX) / 2, width: maxX - minX + NODE_W });
    xCursor += yearWidth + yearGap;
  }

  const viewWidth = Math.max(VIEW_W, xCursor - yearGap + rightPad);
  return { positions, viewWidth, viewHeight, yearBands };
}

function layoutCacheKey(visibleTasks, visibleReductions) {
  const taskPart = visibleTasks.map((t) => t.id).join(",");
  const edgePart = visibleReductions.map((r) => r.id).join(",");
  return `${taskPart}|${edgePart}`;
}

function getGraphLayoutCached(visibleTasks, visibleReductions) {
  const key = layoutCacheKey(visibleTasks, visibleReductions);
  if (state.layoutCache.key === key && state.layoutCache.value) {
    return state.layoutCache.value;
  }
  const layout = graphLayout(visibleTasks, visibleReductions);
  state.layoutCache = { key, value: layout };
  return layout;
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

function applyViewportTransform() {
  const g = document.getElementById(VIEWPORT_GROUP_ID);
  if (!g) return;
  g.setAttribute("transform", "matrix(1 0 0 1 0 0)");
  const scale = state.viewport.scale;
  svg.style.width = `${state.viewport.baseWidth * scale}px`;
  svg.style.height = `${state.viewport.baseHeight * scale}px`;
}

function drawGraph() {
  clearSvg();
  const visibleTasks = state.tasks.filter((t) => state.visibleTaskIds.has(t.id));
  const visibleTaskIds = new Set(visibleTasks.map((t) => t.id));
  const visibleReductions = state.reductions.filter(
    (r) => visibleTaskIds.has(r.from) && visibleTaskIds.has(r.to),
  );

  const { positions: basePos, viewWidth, viewHeight, yearBands } = getGraphLayoutCached(
    visibleTasks,
    visibleReductions,
  );
  const pos = new Map(basePos);
  svg.setAttribute("viewBox", `0 0 ${viewWidth} ${viewHeight}`);
  state.viewport.baseWidth = viewWidth;
  state.viewport.baseHeight = viewHeight;
  const highlight = buildHighlightSets();
  const edgeOffsets = buildEdgeBundleOffsets(visibleReductions, pos);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  svg.appendChild(defs);
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

  const yearsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewportGroup.appendChild(yearsGroup);
  for (const band of yearBands) {
    const width = Math.max(54, Math.min(88, band.width - 10));

    const pill = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    pill.setAttribute("x", String(band.x - width / 2));
    pill.setAttribute("y", "8");
    pill.setAttribute("width", String(width));
    pill.setAttribute("height", "18");
    pill.setAttribute("rx", "9");
    pill.setAttribute("fill", "#f5f8fb");
    pill.setAttribute("stroke", "#c7d3df");
    pill.setAttribute("stroke-width", "1");
    yearsGroup.appendChild(pill);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(band.x));
    label.setAttribute("y", "21");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "#304455");
    label.setAttribute("font-size", "11");
    label.setAttribute("font-weight", "700");
    label.setAttribute("font-family", "IBM Plex Sans, Segoe UI, sans-serif");
    label.textContent = String(band.year);
    yearsGroup.appendChild(label);
  }

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
    if (state.pathTaskIds.has(task.id)) rect.classList.add("path-node");
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
      clearActivePath();
      state.selectedTaskId = task.id;
      state.selectedReductionId = null;
      renderDetails();
      setHash();
      drawGraph();
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
      <div class="meta">${escapeHtml(task.id)} | ${escapeHtml(task.class)} | ${escapeHtml(String(taskYear(task)))}</div>
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

function pathTaskIdsFromEdges(pathEdges, sourceId) {
  if (!sourceId || pathEdges.length === 0) return new Set();
  const ids = new Set([sourceId]);
  for (const edgeId of pathEdges) {
    const red = state.reductionById.get(edgeId);
    if (!red) continue;
    ids.add(red.from);
    ids.add(red.to);
  }
  return ids;
}

function clearActivePath(resetSelectors = true) {
  state.pathReductionIds = new Set();
  state.pathTaskIds = new Set();
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
    state.pathTaskIds = pathTaskIdsFromEdges(path, state.sourceId);
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
    state.selectedTaskId = null;
    state.selectedReductionId = null;
    renderDetails();
    setHash();
    drawGraph();
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
    state.pathTaskIds = pathTaskIdsFromEdges(path, state.sourceId);
    renderPath(path);
    drawGraph();
  }
}

main().catch((err) => {
  detailsPanel.innerHTML = `<p>Failed to load data: ${escapeHtml(String(err))}</p>`;
});
