const state = {
  tasks: [],
  reductions: [],
  taskById: new Map(),
  reductionById: new Map(),
  outgoing: new Map(),
  incoming: new Map(),
  adjacency: new Map(),
  visibleTaskIds: new Set(),
  selectedTaskId: null,
  selectedReductionId: null,
  viewport: {
    scale: 1,
    baseWidth: 0,
    baseHeight: 0,
  },
  lastLayout: {
    positions: new Map(),
  },
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
const NODE_RADIUS = 7;
const NODE_LABEL_GAP = 12;
const NODE_TEXT_MAX_CHARS = 28;
const NODE_MIN_WIDTH = 112;
const NODE_MAX_WIDTH = 176;
const NODE_FILL = "#111111";

const svg = document.getElementById("graphSvg");
const graphPanel = document.querySelector(".graph-panel");
const detailsPanel = document.getElementById("detailsPanel");
const taskList = document.getElementById("taskList");
const VIEWPORT_GROUP_ID = "viewport-root";

function qsHash() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

function setHash() {
  const p = new URLSearchParams();
  if (state.selectedTaskId) p.set("node", state.selectedTaskId);
  if (state.selectedReductionId) p.set("edge", state.selectedReductionId);
  window.location.hash = p.toString();
}

function loadHash() {
  const p = qsHash();
  state.selectedTaskId = p.get("node") || null;
  state.selectedReductionId = p.get("edge") || null;
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

function recalcVisible() {
  state.visibleTaskIds = new Set(state.tasks.map((task) => task.id));
}

function taskYear(task) {
  return Number.isFinite(task.year) ? task.year : 0;
}

function truncateLabel(text, maxChars = NODE_TEXT_MAX_CHARS) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}\u2026`;
}

function estimateNodeWidth(task) {
  const label = truncateLabel(task?.title || "");
  const estimatedLabelWidth = Math.max(48, label.length * 7.2);
  return Math.max(
    NODE_MIN_WIDTH,
    Math.min(NODE_MAX_WIDTH, estimatedLabelWidth + NODE_LABEL_GAP + NODE_RADIUS * 2 + 12),
  );
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
  const x1 = Math.round(p1.x / 120);
  const x2 = Math.round(p2.x / 120);
  const yBand = Math.round((p1.y + p2.y) / 220);
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  return `${minX}:${maxX}:${yBand}`;
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
  const startPad = Math.min(len / 3, NODE_RADIUS + 4);
  const endPad = Math.min(len / 3, NODE_RADIUS + 6);
  const x1 = p1.x + (dx / len) * startPad;
  const y1 = p1.y + (dy / len) * startPad;
  const x2 = p2.x - (dx / len) * endPad;
  const y2 = p2.y - (dy / len) * endPad;

  const nx = -dy / len;
  const ny = dx / len;
  const baseCurvature = Math.min(40, 12 + Math.abs(dy) * 0.05);
  const bend = baseCurvature + offset;
  const cx = (x1 + x2) / 2 + nx * bend;
  const cy = (y1 + y2) / 2 + ny * bend;
  const path = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
  return { path, x1, y1, x2, y2 };
}

function compareTasksForTree(a, b) {
  const yearDiff = taskYear(a) - taskYear(b);
  if (yearDiff !== 0) return yearDiff;
  const titleDiff = a.title.localeCompare(b.title);
  if (titleDiff !== 0) return titleDiff;
  return a.id.localeCompare(b.id);
}

function graphLayout(visibleTasks, visibleReductions) {
  if (visibleTasks.length === 0) {
    return { positions: new Map(), viewWidth: VIEW_W, viewHeight: NODE_RADIUS * 2 + 36, yearBands: [] };
  }

  const visibleTaskMap = new Map(visibleTasks.map((task) => [task.id, task]));
  const primaryByTarget = new Map();
  for (const red of visibleReductions) {
    if (!visibleTaskMap.has(red.from) || !visibleTaskMap.has(red.to)) continue;
    const existing = primaryByTarget.get(red.to);
    if (!existing || compareParentReductions(red, existing) < 0) {
      primaryByTarget.set(red.to, red);
    }
  }

  const children = new Map(visibleTasks.map((task) => [task.id, []]));
  for (const red of primaryByTarget.values()) {
    if (children.has(red.from)) {
      children.get(red.from).push(red.to);
    }
  }
  for (const childIds of children.values()) {
    childIds.sort((aId, bId) => compareTasksForTree(visibleTaskMap.get(aId), visibleTaskMap.get(bId)));
  }

  const sortedTasks = visibleTasks.slice().sort(compareTasksForTree);
  const roots = sortedTasks.filter((task) => !primaryByTarget.has(task.id));
  const orderedRoots = roots.slice();
  for (const task of sortedTasks) {
    if (!orderedRoots.some((root) => root.id === task.id)) orderedRoots.push(task);
  }

  const leftPad = 44;
  const rightPad = 220;
  const topPad = 28;
  const bottomPad = 36;
  const siblingGap = 18;
  const rootGap = 26;
  const levelStep = 210;
  const positions = new Map();
  const heightCache = new Map();
  let maxDepth = 0;

  function measureSubtreeHeight(taskId, stack = new Set()) {
    if (heightCache.has(taskId)) return heightCache.get(taskId);
    if (stack.has(taskId)) return NODE_RADIUS * 2 + 20;
    stack.add(taskId);
    const childIds = (children.get(taskId) || []).filter((childId) => !stack.has(childId));
    let height = NODE_RADIUS * 2 + 20;
    if (childIds.length > 0) {
      const childrenHeight =
        childIds.reduce((sum, childId) => sum + measureSubtreeHeight(childId, stack), 0) +
        siblingGap * Math.max(0, childIds.length - 1);
      height = Math.max(height, childrenHeight);
    }
    stack.delete(taskId);
    heightCache.set(taskId, height);
    return height;
  }

  function placeSubtree(taskId, depth, top, height, stack = new Set()) {
    if (positions.has(taskId)) return;
    const centerX = leftPad + depth * levelStep + NODE_RADIUS;
    const centerY = top + height / 2;
    positions.set(taskId, { x: centerX, y: centerY });
    maxDepth = Math.max(maxDepth, depth);

    const nextStack = new Set(stack);
    nextStack.add(taskId);
    const childIds = (children.get(taskId) || []).filter((childId) => !nextStack.has(childId));
    if (childIds.length === 0) return;

    const childHeights = childIds.map((childId) => measureSubtreeHeight(childId, nextStack));
    const totalHeight =
      childHeights.reduce((sum, childHeight) => sum + childHeight, 0) +
      siblingGap * Math.max(0, childHeights.length - 1);
    let cursor = top + (height - totalHeight) / 2;

    childIds.forEach((childId, idx) => {
      const childHeight = childHeights[idx];
      placeSubtree(childId, depth + 1, cursor, childHeight, nextStack);
      cursor += childHeight + siblingGap;
    });
  }

  let yCursor = topPad;
  for (const root of orderedRoots) {
    if (positions.has(root.id)) continue;
    const rootHeight = measureSubtreeHeight(root.id);
    placeSubtree(root.id, 0, yCursor, rootHeight);
    yCursor += rootHeight + rootGap;
  }

  const occupiedHeight = Math.max(0, yCursor - rootGap);
  const viewWidth = Math.max(VIEW_W, leftPad + maxDepth * levelStep + NODE_RADIUS * 2 + rightPad);
  const viewHeight = Math.max(NODE_RADIUS * 2 + topPad + bottomPad, occupiedHeight + bottomPad);
  return { positions, viewWidth, viewHeight, yearBands: [] };
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

function compareParentReductions(a, b) {
  const yearDiff = taskYear(state.taskById.get(a.from) || {}) - taskYear(state.taskById.get(b.from) || {});
  if (yearDiff !== 0) return yearDiff;
  const titleA = state.taskById.get(a.from)?.title || a.from;
  const titleB = state.taskById.get(b.from)?.title || b.from;
  const titleDiff = titleA.localeCompare(titleB);
  if (titleDiff !== 0) return titleDiff;
  return a.id.localeCompare(b.id);
}

function pickPrimaryParent(taskId) {
  const incoming = state.incoming.get(taskId) || [];
  if (incoming.length === 0) return null;
  return incoming.slice().sort(compareParentReductions)[0];
}

function buildVisibleReductions(visibleTaskIds) {
  const primaryByTarget = new Map();
  const visibleReductions = [];

  for (const red of state.reductions) {
    if (!visibleTaskIds.has(red.from) || !visibleTaskIds.has(red.to)) continue;
    const existing = primaryByTarget.get(red.to);
    if (!existing || compareParentReductions(red, existing) < 0) {
      primaryByTarget.set(red.to, red);
    }
  }

  for (const red of state.reductions) {
    if (primaryByTarget.get(red.to)?.id !== red.id) continue;
    visibleReductions.push(red);
  }

  const extraIds = new Set();
  if (state.selectedReductionId) extraIds.add(state.selectedReductionId);
  for (const redId of extraIds) {
    if (visibleReductions.some((red) => red.id === redId)) continue;
    const red = state.reductionById.get(redId);
    if (!red) continue;
    if (!visibleTaskIds.has(red.from) || !visibleTaskIds.has(red.to)) continue;
    visibleReductions.push(red);
  }

  return visibleReductions;
}

function taskLabel(taskId) {
  const task = state.taskById.get(taskId);
  return task ? `${task.title} (${task.id})` : taskId;
}

function reductionListItem(red) {
  return `${escapeHtml(taskLabel(red.from))} -> ${escapeHtml(taskLabel(red.to))}`;
}

function applyViewportTransform() {
  const g = document.getElementById(VIEWPORT_GROUP_ID);
  if (!g) return;
  g.setAttribute("transform", "matrix(1 0 0 1 0 0)");
  const scale = state.viewport.scale;
  svg.style.width = `${state.viewport.baseWidth * scale}px`;
  svg.style.height = `${state.viewport.baseHeight * scale}px`;
}

function focusTaskInGraph(taskId) {
  const point = state.lastLayout.positions.get(taskId);
  if (!point || !graphPanel) return;

  const scale = state.viewport.scale;
  const targetLeft = Math.max(0, point.x * scale - graphPanel.clientWidth / 2);
  const targetTop = Math.max(0, point.y * scale - graphPanel.clientHeight / 2);

  graphPanel.scrollTo({
    left: targetLeft,
    top: targetTop,
    behavior: "smooth",
  });
}

function drawGraph() {
  clearSvg();
  const visibleTasks = state.tasks.filter((t) => state.visibleTaskIds.has(t.id));
  const visibleTaskIds = new Set(visibleTasks.map((t) => t.id));
  const visibleReductions = buildVisibleReductions(visibleTaskIds);

  const { positions: basePos, viewWidth, viewHeight, yearBands } = getGraphLayoutCached(
    visibleTasks,
    visibleReductions,
  );
  const pos = new Map(basePos);
  state.lastLayout = { positions: pos };
  svg.setAttribute("viewBox", `0 0 ${viewWidth} ${viewHeight}`);
  state.viewport.baseWidth = viewWidth;
  state.viewport.baseHeight = viewHeight;
  const highlight = buildHighlightSets();
  const edgeOffsets = buildEdgeBundleOffsets(visibleReductions, pos);

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
    const isSelectedEdge = state.selectedReductionId === red.id;
    if (isSelectedEdge) line.classList.add("selected-edge");
    if (highlight.active) {
      if (highlight.edges.has(red.id)) line.classList.add("edge-highlight");
      else line.classList.add("edge-dim");
    }
    line.addEventListener("click", (event) => {
      event.stopPropagation();
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
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hit.setAttribute("cx", String(p.x));
    hit.setAttribute("cy", String(p.y));
    hit.setAttribute("r", "16");
    hit.classList.add("node-hit-area");
    group.appendChild(hit);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    rect.setAttribute("cx", String(p.x));
    rect.setAttribute("cy", String(p.y));
    rect.setAttribute("r", String(NODE_RADIUS));
    rect.setAttribute("fill", NODE_FILL);
    rect.classList.add("node-block", "node-dot");
    if (state.selectedTaskId === task.id) rect.classList.add("selected-node");
    if (highlight.active) {
      if (highlight.nodes.has(task.id)) rect.classList.add("node-highlight");
      else rect.classList.add("node-dim");
    }
    group.appendChild(rect);

    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    title.classList.add("node-title");
    title.setAttribute("x", String(p.x + NODE_RADIUS + NODE_LABEL_GAP));
    title.setAttribute("y", String(p.y));
    title.setAttribute("text-anchor", "start");
    title.setAttribute("dominant-baseline", "middle");
    if (highlight.active && !highlight.nodes.has(task.id)) title.style.opacity = "0.32";
    title.textContent = truncateLabel(task.title);
    group.appendChild(title);

    group.addEventListener("click", (event) => {
      event.stopPropagation();
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

function renderTaskList() {
  const filteredTasks = state.tasks
    .slice()
    .sort(compareTasksForTree);

  if (filteredTasks.length === 0) {
    taskList.innerHTML = '<p class="task-list-empty">No vertices found.</p>';
    return;
  }

  taskList.innerHTML = filteredTasks
    .map((task) => {
      const activeClass = state.selectedTaskId === task.id ? " is-active" : "";
      return `
        <button class="task-list-item${activeClass}" data-task-id="${escapeHtml(task.id)}" type="button">
          ${escapeHtml(task.title)}
        </button>
      `;
    })
    .join("");
}

function renderDetails() {
  renderTaskList();

  if (state.selectedTaskId) {
    const task = state.taskById.get(state.selectedTaskId);
    if (!task) return;
    const incoming = state.incoming.get(task.id) || [];
    const primaryParent = pickPrimaryParent(task.id);
    const extraParents = incoming
      .filter((red) => red.id !== primaryParent?.id)
      .slice()
      .sort(compareParentReductions);
    const outgoing = state.outgoing.get(task.id) || [];
    const references = task.references
      .map((r) => `<li><a href="${escapeHtml(r.url)}" target="_blank">${escapeHtml(r.label)}</a></li>`)
      .join("");
    const extraParentRows = extraParents
      .map((r) => `<li>${reductionListItem(r)}</li>`)
      .join("");
    const outgoingRows = outgoing
      .slice(0, 12)
      .map((r) => `<li>${reductionListItem(r)}</li>`)
      .join("");
    detailsPanel.innerHTML = `
      <h3>${escapeHtml(task.title)}</h3>
      <div class="meta">${escapeHtml(task.id)} | ${escapeHtml(task.class)} | ${escapeHtml(String(taskYear(task)))}</div>
      <p>${escapeHtml(task.statement)}</p>
      <strong>References</strong>
      <ul>${references}</ul>
      <strong>Parent In Graph</strong>
      <ul>${primaryParent ? `<li>${reductionListItem(primaryParent)}</li>` : "<li>None</li>"}</ul>
      <strong>Hidden Parents</strong>
      <ul>${extraParentRows || "<li>None</li>"}</ul>
      <strong>Outgoing Reductions (${outgoing.length})</strong>
      <ul>${outgoingRows || "<li>None</li>"}</ul>
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

function wireEvents() {
  taskList.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-task-id]") : null;
    if (!target) return;
    const taskId = target.getAttribute("data-task-id");
    if (!taskId) return;
    state.selectedTaskId = taskId;
    state.selectedReductionId = null;
    renderDetails();
    drawGraph();
    setHash();
    requestAnimationFrame(() => focusTaskInGraph(taskId));
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
  state.incoming = new Map(state.tasks.map((t) => [t.id, []]));
  state.adjacency = new Map(state.tasks.map((t) => [t.id, new Set()]));
  for (const r of state.reductions) {
    if (state.outgoing.has(r.from)) {
      state.outgoing.get(r.from).push(r);
    }
    if (state.incoming.has(r.to)) {
      state.incoming.get(r.to).push(r);
    }
    if (state.adjacency.has(r.from) && state.adjacency.has(r.to)) {
      state.adjacency.get(r.from).add(r.to);
      state.adjacency.get(r.to).add(r.from);
    }
  }
}

async function main() {
  loadHash();
  await loadData();
  wireEvents();
  recalcVisible();
  drawGraph();
  renderDetails();
}

main().catch((err) => {
  detailsPanel.innerHTML = `<p>Failed to load data: ${escapeHtml(String(err))}</p>`;
});
