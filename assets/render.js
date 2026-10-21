// Hand-written SVG renderer: builds the DOM once, then only toggles classes and attributes.
import { relationMap, relationGroups, extraNeeds, extraDependants, visibleModules, maxImportance } from './graph.js';
import { h, stdClass, stdLabel, REL_OPTION, BADGES, enabledKinds } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const MIN_R = 4.5;
const LABEL_PX = 10.5;
const MAX_K = 6;
const CLICK_SLOP = 4;

export function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** Diamond (standard-alternative) side and halo-relevant radius for a node of radius r. */
export function diamondGeom(r) {
  const rr = r * 0.9;
  return { rr, side: rr * 1.45 };
}

/** Points of a 5-point star with outer radius `R` (pointing up) and inner radius `R * inner`. */
export function starPoints(R, inner = 0.45) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? R * inner : R;
    pts.push(`${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** Badge symbol size and top-left offset for a node of radius r, at `angle` degrees (0 = right, clockwise). */
export function badgeGeom(r, angle) {
  const size = Math.max(9, Math.min(13, r * 0.9));
  const a = (angle * Math.PI) / 180;
  return {
    size,
    x: (Math.cos(a) * (r + 1) * 0.85 - size / 2).toFixed(1),
    y: (Math.sin(a) * (r + 1) * 0.85 - size / 2).toFixed(1),
  };
}

/**
 * @param {SVGSVGElement} svg
 * @param {object} graph from buildGraph()
 * @param {Map<string, {x: number, y: number}>} layout from layout()
 * @param {Map<string, number>} importance from importance()
 * @param {'horizontal'|'vertical'} [orientation] orientation `layout` was computed for (drives grid steps and edge curves)
 * @returns {{onSelect: ((id: string|null) => void)|null, update: (state: object) => void, relayout: () => void,
 *            setLayout: (layout: Map<string, {x: number, y: number}>, orientation: 'horizontal'|'vertical') => void,
 *            setInset: (v: number|{right?: number, bottom?: number}) => void, fit: (animate?: boolean) => void,
 *            focus: (id: string) => void, focusSet: (ids: string[]) => void, refocus: () => void, settle: () => void, stats: () => object}}
 *   The view API (also `setDecor(mode, redraw, state)` for fun-mode decorations; `state` is the state the redraw should show). Assign `onSelect` to receive node clicks (`null` when the background is clicked).
 */
export function createGraphView(svg, graph, layout, importance, orientation = 'horizontal') {
  const maxImp = maxImportance(importance) || 1;
  const host = svg.parentElement;
  const tooltip = host.querySelector('#tooltip');

  // Grid steps come from the stage size, measured at creation and on relayout() (legend collapse or expand).
  // Toggling options never changes them, so nodes never move. setLayout() swaps the grid (orientation change).
  let gx0 = 0, gx1 = 0, gy0 = 0, gy1 = 0;
  let vertical = orientation === 'vertical';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let rMax = 14;
  let bounds = { x: 0, y: 0, w: 1, h: 1 };
  const pos = new Map();
  // Fun-mode decorations: the active mode (see fun.js) and the extra margin it needs above and below the graph.
  let decorMode = null;
  let decorPad = { top: 0, bottom: 0, left: 0, right: 0 };
  let decorAvoid = [];
  let buildDecor = () => {};
  function computeGrid() {
    gx0 = Infinity; gx1 = -Infinity; gy0 = Infinity; gy1 = -Infinity;
    for (const p of layout.values()) {
      gx0 = Math.min(gx0, p.x); gx1 = Math.max(gx1, p.x);
      gy0 = Math.min(gy0, p.y); gy1 = Math.max(gy1, p.y);
    }
    const areaW = Math.max(host.clientWidth || window.innerWidth, 400);
    const areaH = Math.max(host.clientHeight || window.innerHeight - 90, 300);
    const fitStep = (area, pad, span, lo, hi) => clamp((area - pad) / Math.max(1, span), lo, hi);
    const spanX = gx1 - gx0, spanY = gy1 - gy0;
    let xStep, yStep;
    if (vertical) {
      xStep = fitStep(areaW, 100, spanX, 22, 110);
      yStep = fitStep(areaH, 110, spanY, 24, 90);
      // Row step at its minimum means the fit is width-limited: stretch the levels by the overflow so the tree fills the height.
      yStep = clamp(yStep * Math.max(1, (spanX * xStep + 140) / areaW), 24, 90);
    } else {
      xStep = fitStep(areaW, 150, spanX, 36, 150);
      yStep = fitStep(areaH, 110, spanY, 14, 56);
    }
    rMax = Math.min(14, (vertical ? Math.min(xStep, yStep) : yStep) * 0.45);
    for (const [id, p] of layout) pos.set(id, { x: p.x * xStep, y: p.y * yStep });
    bounds = { x: gx0 * xStep - 70, y: gy0 * yStep - 40, w: (gx1 - gx0) * xStep + 140, h: (gy1 - gy0) * yStep + 90 };
    buildDecor();
    bounds.y -= decorPad.top;
    bounds.h += decorPad.top + decorPad.bottom;
    bounds.x -= decorPad.left;
    bounds.w += decorPad.left + decorPad.right;
  }
  computeGrid();

  const viewport = el('g', { class: 'viewport' }, svg);
  const gDecorBack = el('g', { class: 'decor decor-back' }, viewport);
  const gBg = el('g', { class: 'edges-bg' }, viewport);
  const gDecorMid = el('g', { class: 'decor decor-mid' }, viewport);
  const gGlow = el('g', { class: 'edges-glow' }, viewport);
  const gHi = el('g', { class: 'edges-hi' }, viewport);
  const gNodes = el('g', { class: 'nodes' }, viewport);
  const gDecorFront = el('g', { class: 'decor decor-front' }, viewport);

  buildDecor = () => {
    for (const g of [gDecorBack, gDecorMid, gDecorFront]) g.replaceChildren();
    decorPad = { top: 0, bottom: 0, left: 0, right: 0 };
    decorAvoid = [];
    if (!decorMode || !vertical || size().w < 2) return;
    const rows = new Map();
    for (const p of pos.values()) {
      const key = Math.round(p.y * 10);
      const r = rows.get(key) ?? { y: p.y, x0: Infinity, x1: -Infinity };
      r.x0 = Math.min(r.x0, p.x);
      r.x1 = Math.max(r.x1, p.x);
      rows.set(key, r);
    }
    const sorted = [...rows.values()].sort((a, b) => a.y - b.y);
    const top = sorted[0];
    const info = { rows: sorted, top: { x: (top.x0 + top.x1) / 2, y: top.y }, base: sorted[sorted.length - 1], rMax, unit: rMax * 2.4, k: Math.min(size().w / bounds.w, size().h / bounds.h) * 0.85 };
    const pad = decorMode.decorate({ back: gDecorBack, mid: gDecorMid, front: gDecorFront }, info);
    if (pad?.avoid) decorAvoid = pad.avoid;
    if (pad) decorPad = { top: pad.top || 0, bottom: pad.bottom || 0, left: pad.left || 0, right: pad.right || 0 };
  };

  const dCache = new Map();
  function pathD(a, b) {
    const key = `${a}|${b}`;
    let d = dCache.get(key);
    if (d) return d;
    const p = pos.get(a);
    const q = pos.get(b);
    const [u0, v0, u1, v1] = vertical ? [p.y, p.x, q.y, q.x] : [p.x, p.y, q.x, q.y];
    const du = u1 - u0;
    const tiny = Math.abs(du) < 1;
    const c = tiny ? 70 : du / 2;
    const pt = (u, v) => (vertical ? `${v},${u}` : `${u},${v}`);
    d = `M${pt(u0, v0)}C${pt(u0 + c, v0)} ${pt(u1 - (tiny ? -70 : c), v1)} ${pt(u1, v1)}`;
    dCache.set(key, d);
    return d;
  }

  const bgEdges = [];
  for (const id of graph.order) {
    for (const to of graph.out.get(id).lib) {
      const path = el('path', { d: pathD(id, to), class: 'edge' }, gBg);
      bgEdges.push({ from: id, to, path, cls: 'edge' });
    }
  }

  const nodes = new Map();
  for (const id of graph.order) {
    const m = graph.modules.get(id);
    const p = pos.get(id);
    const g = el('g', { class: 'node', transform: `translate(${p.x},${p.y})` }, gNodes);
    g.dataset.id = id;
    const body = el('g', { class: 'body' }, g);
    const halo = el('circle', { class: 'halo' }, body);
    const circle = el('circle', { class: 'shape', r: 9 }, body);
    const diamond = el('rect', { class: 'shape diamond', rx: 2 }, body);
    const badges = BADGES.map(b => ({ ...b, u: el('use', { href: `#${b.sym}`, class: 'badge' }, body) }));
    const label = el('text', { class: 'label' }, g);
    label.textContent = m.name || id;
    nodes.set(id, { id, m, g, body, halo, circle, diamond, badges, label, cls: '', r: 0, s: 1, alt: Boolean(m.stdAlternatives?.length), off: false });
  }

  /** Size a node's ornament parts (see ensureOrnaments) for its current radius. */
  function sizeOrnaments(nd) {
    const { r } = nd;
    const sr = diamondGeom(r).rr * 1.45;
    nd.star.setAttribute('points', starPoints(sr));
    nd.starCore.setAttribute('r', (sr * 0.3).toFixed(2));
    nd.gloss.setAttribute('r', r);
    const cw = Math.max(2.4, r * 0.5);
    nd.cap.setAttribute('x', (-cw / 2).toFixed(2));
    nd.cap.setAttribute('y', (-r - cw * 0.55).toFixed(2));
    nd.cap.setAttribute('width', cw.toFixed(2));
    nd.cap.setAttribute('height', (cw * 0.8).toFixed(2));
  }

  /**
   * Ornament parts, hidden unless a fun theme shows them (CSS): a glossy sheen, a cap, and a star for diamond nodes.
   * Created the first time a fun mode is activated, so plain themes carry no extra elements.
   */
  function ensureOrnaments() {
    for (const nd of nodes.values()) {
      if (nd.star) continue;
      const add = (tag, cls, attrs) => nd.body.insertBefore(el(tag, { class: cls, ...attrs }), nd.badges[0].u);
      nd.star = add('polygon', 'orn star shape');
      nd.starCore = add('circle', 'orn star-core');
      nd.gloss = add('circle', 'orn orn-gloss');
      nd.cap = add('rect', 'orn orn-cap', { rx: 0.8 });
      if (nd.r) sizeOrnaments(nd);
    }
  }

  // ---- camera ----
  let k = 1, tx = 0, ty = 0;
  let interacted = false;
  let tween = 0;
  let fitK = 0.3;

  let inset = 0;
  let insetBottom = 0;
  // Left strip covered by the zoom/view button column, and that column's box in svg px (labels avoid it).
  let leftInset = 0;
  let ctrlBox = null;
  /** Usable framing area: `l` px reserved on the left, `w` x `h` usable after it (right/bottom insets already removed). */
  function size() {
    const r = svg.getBoundingClientRect();
    return { l: leftInset, w: Math.max(1, (r.width || 1) - inset - leftInset), h: Math.max(1, (r.height || 1) - insetBottom) };
  }

  function applyCamera() {
    viewport.setAttribute('transform', `translate(${tx},${ty}) scale(${k})`);
    svg.style.setProperty('--ls', `${(LABEL_PX / k).toFixed(2)}px`);
    svg.style.setProperty('--lh', `${(3 / k).toFixed(2)}px`);
    scheduleSettle();
  }

  // Work that only needs to happen once the camera stops: minimum node size and label placement.
  let settleTimer = 0;
  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 90);
  }
  function settle() {
    clearTimeout(settleTimer);
    applyScale();
    placeLabels();
  }

  function applyScale() {
    for (const nd of nodes.values()) {
      const s = Math.min(6, Math.max(1, MIN_R / (k * Math.max(nd.r, 1))));
      if (Math.abs(s - nd.s) > 0.01) {
        nd.s = s;
        nd.body.setAttribute('transform', s === 1 ? '' : `scale(${s.toFixed(3)})`);
      }
    }
  }

  let measureCtx = null;
  const widthCache = new Map();
  function textWidth(text, bold) {
    const key = `${bold ? 1 : 0}|${text}`;
    let v = widthCache.get(key);
    if (v === undefined) {
      measureCtx ??= document.createElement('canvas').getContext('2d');
      const fam = getComputedStyle(svg).fontFamily || 'sans-serif';
      measureCtx.font = `${bold ? 800 : 600} ${LABEL_PX}px ${fam}`;
      v = measureCtx.measureText(text).width;
      widthCache.set(key, v);
    }
    return v;
  }

  let labelsOn = true;
  let selId = null;
  const stats = { labelsShown: 0, labelsTotal: 0, minRadius: 0 };
  function placeLabels() {
    const { w: uw, h, l } = size();
    const w = uw + l;
    stats.labelsShown = 0;
    stats.labelsTotal = 0;
    stats.minRadius = Infinity;
    const cand = [];
    for (const nd of nodes.values()) {
      const p = pos.get(nd.id);
      const sx = tx + p.x * k;
      const sy = ty + p.y * k;
      nd.sx = sx;
      nd.sy = sy;
      nd.rs = nd.r * (nd.altShown ? 0.9 : 1) * nd.s * k;
      const vis = !nd.filtered && sx > -40 && sx < w + 40 && sy > -40 && sy < h + 40;
      nd.vis = vis;
      if (vis) {
        stats.labelsTotal++;
        stats.minRadius = Math.min(stats.minRadius, nd.rs);
        cand.push(nd);
      }
    }
    const placed = [];
    for (const nd of cand) placed.push([nd.sx - nd.rs, nd.sy - nd.rs, nd.sx + nd.rs, nd.sy + nd.rs, nd]);
    const hit = (b, skip) => {
      for (const q of placed) {
        if (q[4] === skip) continue;
        if (b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]) return true;
      }
      return false;
    };
    const prio = nd => (nd.id === selId ? 3 : nd.cls.includes(' rel ') || nd.cls.endsWith(' rel') ? 2 : 1);
    const imp = nd => importance.get(nd.id);
    cand.sort((a, b) => prio(b) - prio(a) || imp(b) - imp(a) || (a.id < b.id ? -1 : 1));
    const lh = LABEL_PX + 3;
    const labelBoxes = ctrlBox ? [ctrlBox] : [];
    // Decorations (hanging ornaments, gifts) keep labels off them: labels try another side or drop out.
    for (const [x0, y0, x1, y1] of decorAvoid) labelBoxes.push([tx + x0 * k, ty + y0 * k, tx + x1 * k, ty + y1 * k]);
    for (const nd of nodes.values()) nd.labelOn = false;
    if (labelsOn) {
      for (const nd of cand) {
        const self = nd.id === selId;
        const scale = self ? 1.3 : 1;
        const lw = textWidth(nd.label.textContent, self) * scale + 4;
        const hh = lh * scale;
        const options = [
          { x: nd.sx, y: nd.sy + nd.rs + 2 + hh / 2, anchor: 'middle', box: [nd.sx - lw / 2, nd.sy + nd.rs + 2, nd.sx + lw / 2, nd.sy + nd.rs + 2 + hh] },
          { x: nd.sx + nd.rs + 3, y: nd.sy, anchor: 'start', box: [nd.sx + nd.rs + 3, nd.sy - hh / 2, nd.sx + nd.rs + 3 + lw, nd.sy + hh / 2] },
          { x: nd.sx - nd.rs - 3, y: nd.sy, anchor: 'end', box: [nd.sx - nd.rs - 3 - lw, nd.sy - hh / 2, nd.sx - nd.rs - 3, nd.sy + hh / 2] },
          { x: nd.sx, y: nd.sy - nd.rs - 2 - hh / 2, anchor: 'middle', box: [nd.sx - lw / 2, nd.sy - nd.rs - 2 - hh, nd.sx + lw / 2, nd.sy - nd.rs - 2] },
        ];
        let chosen = null;
        const inside = b => b[0] >= 0 && b[2] <= w && b[1] >= 0 && b[3] <= h;
        for (const o of options) {
          if (inside(o.box) && !hit(o.box, nd) && !labelBoxes.some(b => o.box[0] < b[2] && o.box[2] > b[0] && o.box[1] < b[3] && o.box[3] > b[1])) { chosen = o; break; }
        }
        if (!chosen && self) {
          chosen = options.find(o => inside(o.box));
          if (!chosen) {
            const cx = Math.max(lw / 2, Math.min(w - lw / 2, nd.sx));
            const top = Math.max(0, Math.min(h - hh, nd.sy + nd.rs + 2));
            chosen = { x: cx, y: top + hh / 2, anchor: 'middle', box: [cx - lw / 2, top, cx + lw / 2, top + hh] };
          }
        }
        if (chosen) {
          labelBoxes.push(chosen.box);
          nd.label.setAttribute('x', ((chosen.x - nd.sx) / k).toFixed(2));
          nd.label.setAttribute('y', ((chosen.y - nd.sy) / k).toFixed(2));
          nd.label.setAttribute('text-anchor', chosen.anchor);
          nd.labelOn = true;
        }
      }
    }
    for (const nd of nodes.values()) {
      if (nd.labelOn !== nd.labelShown) {
        nd.label.style.display = nd.labelOn ? '' : 'none';
        nd.labelShown = nd.labelOn;
      }
      if (nd.labelOn) stats.labelsShown++;
    }
    if (!isFinite(stats.minRadius)) stats.minRadius = 0;
  }

  function computeFit() {
    const { l, w, h } = size();
    fitK = Math.min(w / bounds.w, h / bounds.h);
    return { k: fitK, x: l + (w - bounds.w * fitK) / 2 - bounds.x * fitK, y: (h - bounds.h * fitK) / 2 - bounds.y * fitK };
  }

  function clampK(v) {
    return Math.max(fitK * 0.7, Math.min(MAX_K, v));
  }

  function zoomAt(cx, cy, factor) {
    const nk = clampK(k * factor);
    const f = nk / k;
    tx = cx - (cx - tx) * f;
    ty = cy - (cy - ty) * f;
    k = nk;
    applyCamera();
  }

  function stopTween() {
    cancelAnimationFrame(tween);
    tween = 0;
  }

  function animateTo(target) {
    stopTween();
    const from = { k, x: tx, y: ty };
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / 280);
      const e = 1 - (1 - t) ** 3;
      k = from.k + (target.k - from.k) * e;
      tx = from.x + (target.x - from.x) * e;
      ty = from.y + (target.y - from.y) * e;
      applyCamera();
      if (t < 1) tween = requestAnimationFrame(step);
      else tween = 0;
    };
    tween = requestAnimationFrame(step);
  }

  function fit(animate = false) {
    viewMode = null;
    const f = computeFit();
    interacted = false;
    if (animate) animateTo(f);
    else { k = f.k; tx = f.x; ty = f.y; applyCamera(); }
  }

  /**
   * Animate the camera to frame the given module ids inside the usable area (insets and the button column excluded),
   * with 70 px of padding, zoom capped at 2.5 and never below the overview fit. Unknown ids are ignored.
   */
  function focusSet(list) {
    const ids = list.filter(n => pos.has(n));
    if (!ids.length) return;
    computeFit();
    interacted = true;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ids) {
      const q = pos.get(n);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    const pad = 70;
    const { l, w, h } = size();
    const bw = x1 - x0 + 2 * pad;
    const bh = y1 - y0 + 2 * pad;
    const nk = Math.max(fitK, Math.min(2.5, w / bw, h / bh));
    animateTo({ k: nk, x: l + w / 2 - ((x0 + x1) / 2) * nk, y: h / 2 - ((y0 + y1) / 2) * nk });
  }

  // The framing the user last asked for ('around' | 'deps' | 'dependants'); null after fit. Re-run when the usable area changes.
  let viewMode = null;

  /**
   * Ids of the visible, highlighted modules for a view mode, always including the selection.
   * 'deps' = dependency relations (dep, tdep, test/example needs); 'dependants' = dependant relations; each only when its option is on.
   */
  const VIEW_RELS = {
    deps: ['dep', 'tdep', 'testdep', 'exampledep'],
    dependants: ['rdep', 'trdep', 'testrdep', 'examplerdep'],
  };
  // Visible set computed by the last update() (includes the selection).
  let lastVisible = null;
  function viewIds(mode, onlyVisible = true, allOptions = false) {
    if (!selId) return [];
    if (mode === 'around') return [selId, ...graph.out.get(selId).lib, ...graph.in.get(selId).lib];
    const o = lastState.options;
    const groups = relationGroups(graph, selId, allOptions ? { tests: false, examples: false } : { tests: o.tests, examples: o.examples });
    const ids = [selId];
    for (const rel of VIEW_RELS[mode]) {
      if (!allOptions && !o[REL_OPTION[rel]]) continue;
      for (const id of groups[rel]) if (!onlyVisible || lastVisible.has(id)) ids.push(id);
    }
    return ids;
  }

  /** Frame a view mode for the selection and remember it. */
  function showView(mode) {
    if (!selId || !lastState) return;
    const ids = viewIds(mode);
    if (ids.length < 2 && mode !== 'around') return;
    viewMode = mode;
    focusSet(ids);
  }

  /** Re-run the remembered framing (Around by default); used when the usable area changes. */
  function refocus() {
    if (selId) showView(viewMode ?? 'around');
  }

  /** Selection plus its direct library dependencies and dependants. */
  function focus(id) {
    if (!pos.has(id)) return;
    selId = id;
    showView('around');
  }

  // ---- input ----
  const pointers = new Map();
  let downTarget = null;
  let moved = 0;
  let pinch = null;
  const api = { onSelect: null };

  function localPoint(e) {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  svg.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button > 0) return;
    stopTween();
    pointers.set(e.pointerId, localPoint(e));
    if (pointers.size === 1) { downTarget = e.target; moved = 0; }
    else moved = CLICK_SLOP + 1;
    try { svg.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    hideTooltip();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  });

  svg.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') hover(e);
      return;
    }
    const prev = pointers.get(e.pointerId);
    const cur = localPoint(e);
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      if (moved > CLICK_SLOP) {
        interacted = true;
        tx += cur.x - prev.x;
        ty += cur.y - prev.y;
        applyCamera();
      }
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      tx += cx - pinch.cx;
      ty += cy - pinch.cy;
      zoomAt(cx, cy, d / pinch.d);
      pinch = { d, cx, cy };
      interacted = true;
    }
  });

  function endPointer(e, cancelled) {
    if (!pointers.has(e.pointerId)) return;
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    pinch = null;
    if (pointers.size === 1) moved = CLICK_SLOP + 1;
    if (wasSingle && !cancelled && moved <= CLICK_SLOP && api.onSelect) {
      const n = downTarget?.closest?.('.node');
      api.onSelect(n ? n.dataset.id : null);
    }
  }
  svg.addEventListener('pointerup', e => endPointer(e, false));
  svg.addEventListener('pointercancel', e => endPointer(e, true));
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideTooltip(); });

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    interacted = true;
    stopTween();
    const p = localPoint(e);
    const unit = e.deltaMode === 1 ? 16 : 1;
    const dy = e.deltaY * unit;
    zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
  }, { passive: false });

  function hover(e) {
    const n = e.target.closest?.('.node');
    if (!n) return hideTooltip();
    const nd = nodes.get(n.dataset.id);
    if (tooltip.dataset.id !== nd.id) fillTooltip(nd);
    const r = host.getBoundingClientRect();
    let x = e.clientX - r.left + 14;
    let y = e.clientY - r.top + 14;
    tooltip.hidden = false;
    x = Math.min(x, r.width - tooltip.offsetWidth - 8);
    y = Math.min(y, r.height - tooltip.offsetHeight - 8);
    tooltip.style.transform = `translate(${Math.max(8, x)}px,${Math.max(8, y)}px)`;
  }

  function fillTooltip(nd) {
    const m = nd.m;
    tooltip.dataset.id = nd.id;
    tooltip.replaceChildren();
    const title = h('div', 'tt-title', m.name || nd.id);
    title.append(' ', h('span', 'tt-std', stdLabel(m)));
    tooltip.appendChild(title);
    if (m.description) tooltip.appendChild(h('div', 'tt-desc', m.description));
  }

  function hideTooltip() {
    tooltip.hidden = true;
    delete tooltip.dataset.id;
  }

  // ---- state -> DOM ----
  let lastState = null;
  function update(state) {
    lastState = state;
    const o = state.options;
    const sel = state.selected;
    const relMap = sel ? relationMap(graph, sel, { tests: o.tests, examples: o.examples }) : null;
    const visible = visibleModules(graph, {
      categories: state.filters.categories,
      cxxstd: state.filters.cxxstd,
    });
    if (sel) visible.add(sel);
    const relOf = id => (relMap ? relMap.get(id) : null);
    if (sel !== selId) viewMode = null;
    selId = sel;
    lastVisible = visible;
    paintViewButtons();
    labelsOn = o.labels;

    svg.classList.toggle('has-sel', Boolean(sel));
    svg.classList.toggle('no-labels', !o.labels);
    svg.classList.toggle('no-bg', !o.background);

    for (const nd of nodes.values()) {
      const rel = relOf(nd.id);
      const shown = rel && (rel === 'self' || o[REL_OPTION[rel]]) ? rel : null;
      const alt = nd.alt && o.stdAltMarker;
      const r = o.sizeImportance ? MIN_R + (rMax - MIN_R) * (importance.get(nd.id) / maxImp) : (MIN_R + rMax) / 2;
      const parts = ['node', o.colorStd ? stdClass(nd.m.cxxstd) : 'std-none'];
      nd.filtered = !visible.has(nd.id);
      if (nd.filtered) parts.push('filtered');
      else if (shown) parts.push(`rel-${shown}`, 'rel');
      else if (sel) parts.push('dim');
      if (alt) parts.push('alt');
      const cls = parts.join(' ');
      if (cls !== nd.cls) { nd.g.setAttribute('class', cls); nd.cls = cls; }
      if (r !== nd.r || nd.altShown !== alt) {
        nd.r = r;
        nd.altShown = alt;
        const { rr: dr, side: s } = diamondGeom(r);
        nd.circle.setAttribute('r', r);
        nd.circle.style.display = alt ? 'none' : '';
        nd.diamond.style.display = alt ? '' : 'none';
        nd.diamond.setAttribute('x', -s / 2);
        nd.diamond.setAttribute('y', -s / 2);
        nd.diamond.setAttribute('width', s);
        nd.diamond.setAttribute('height', s);
        nd.diamond.setAttribute('transform', 'rotate(45)');
        nd.halo.setAttribute('r', (alt ? dr : r) + 6);
        if (nd.star) sizeOrnaments(nd);
        for (const b of nd.badges) {
          const bg = badgeGeom(r, b.angle);
          b.u.setAttribute('x', bg.x);
          b.u.setAttribute('y', bg.y);
          b.u.setAttribute('width', bg.size);
          b.u.setAttribute('height', bg.size);
        }
      }
      for (const b of nd.badges) {
        const on = o[b.option] && nd.m[b.flag];
        if (b.on !== on) { b.u.style.display = on ? '' : 'none'; b.on = on; }
      }
    }

    rebuildEdges(sel, o, visible, relOf);
    settle();
  }

  const isOneOf = (v, ...xs) => xs.includes(v);

  function rebuildEdges(sel, o, visible, relOf) {
    const hi = [];
    const needs = {};
    if (sel) {
      // Edges follow the raw needs (colour = the edge's role: orange for needs, blue for dependants),
      // independent of the ranked ring on the target; rings and counts use relationGroups().
      for (const kind of enabledKinds(o)) {
        const n = extraNeeds(graph, sel, kind);
        needs[kind] = { direct: n.direct, all: new Set([...n.direct, ...n.transitive]), rdeps: extraDependants(graph, sel, kind) };
      }
    }
    for (const e of bgEdges) {
      let cls = 'edge';
      if (!visible.has(e.from) || !visible.has(e.to)) cls = 'edge dim';
      else if (sel) {
        const rf = relOf(e.from);
        const rt = relOf(e.to);
        let kind = null;
        if (e.from === sel && rt === 'dep') kind = 'dep';
        else if (isOneOf(rf, 'self', 'dep', 'tdep') && isOneOf(rt, 'dep', 'tdep')) kind = 'tdep';
        else if (e.to === sel && rf === 'rdep') kind = 'rdep';
        else if (isOneOf(rt, 'self', 'rdep', 'trdep') && isOneOf(rf, 'rdep', 'trdep')) kind = 'trdep';
        if (kind && o[REL_OPTION[kind]]) {
          cls = 'edge off';
          hi.push({ from: e.from, to: e.to, cls: `edge hi-${kind}` });
        } else cls = 'edge dim';
      }
      if (cls !== e.cls) { e.path.setAttribute('class', cls); e.cls = cls; }
    }
    for (const kind of enabledKinds(o)) {
      for (const id of graph.order) {
        if (!visible.has(id)) continue;
        for (const to of graph.out.get(id)[kind]) {
          if (!visible.has(to) || graph.out.get(id).lib.has(to)) continue;
          if (sel) {
            const rt = relOf(to);
            const need = id === sel && needs[kind].direct.has(to);
            const dependant = needs[kind].rdeps.has(id) && isOneOf(rt, 'self', 'rdep', 'trdep');
            if (!need && !dependant) continue;
            hi.push({ from: id, to, cls: `edge x-${kind} ${need ? 'hi-x' : 'hi-xr'}` });
          } else {
            hi.push({ from: id, to, cls: `edge x-${kind} faint-x` });
          }
        }
      }
    }
    for (const kind of Object.keys(needs)) {
      const all = needs[kind].all;
      for (const e of bgEdges) {
        if (all.has(e.from) && all.has(e.to) && visible.has(e.from) && visible.has(e.to)) {
          hi.push({ from: e.from, to: e.to, cls: `edge x-${kind} hi-x` });
        }
      }
    }
    gHi.replaceChildren();
    gGlow.replaceChildren();
    const frag = document.createDocumentFragment();
    // Fun themes get a wide, faint copy under each highlighted edge: a baked glow with no filter to re-raster while panning.
    const glow = decorMode ? document.createDocumentFragment() : null;
    for (const e of hi) {
      const d = pathD(e.from, e.to);
      frag.appendChild(el('path', { d, class: e.cls }));
      glow?.appendChild(el('path', { d, class: e.cls }));
    }
    gHi.appendChild(frag);
    if (glow) gGlow.appendChild(glow);
  }

  new ResizeObserver(() => {
    layoutControls();
    const { w, h } = size();
    if (w < 2 || h < 2) return;
    const f = computeFit();
    if (!interacted && !tween) { k = f.k; tx = f.x; ty = f.y; applyCamera(); }
    else fitK = f.k;
  }).observe(svg);

  const zoomBy = f => { const { l, w, h } = size(); interacted = true; stopTween(); zoomAt(l + w / 2, h / 2, f); };
  host.querySelector('#zoom-in')?.addEventListener('click', () => zoomBy(1.4));
  host.querySelector('#zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.4));
  host.querySelector('#zoom-fit')?.addEventListener('click', () => { interacted = false; fit(true); });

  const viewBtns = {
    around: host.querySelector('#view-around'),
    deps: host.querySelector('#view-deps'),
    dependants: host.querySelector('#view-dependants'),
  };
  const ARROWS = {
    deps: { horizontal: 'M13 9H5M8 6L5 9L8 12', vertical: 'M9 5V13M6 10L9 13L12 10' },
    dependants: { horizontal: 'M5 9H13M10 6L13 9L10 12', vertical: 'M9 13V5M6 8L9 5L12 8' },
  };
  function paintViewIcons() {
    const o = vertical ? 'vertical' : 'horizontal';
    const svgOf = inner => `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
    if (viewBtns.around) viewBtns.around.innerHTML = svgOf('<circle cx="9" cy="9" r="5.5"/><circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none"/>');
    for (const key of ['deps', 'dependants']) {
      if (viewBtns[key]) viewBtns[key].innerHTML = svgOf(`<circle cx="9" cy="9" r="7.5" opacity="0.55"/><path d="${ARROWS[key][o]}"/>`);
    }
  }
  function paintViewButtons() {
    const name = selId ? graph.modules.get(selId)?.name || selId : '';
    const empty = { deps: !selId, dependants: !selId };
    const text = {
      around: selId ? `Around ${name}` : 'Around the selected library',
      deps: 'Dependencies of the selected library',
      dependants: 'Dependents of the selected library',
    };
    if (selId) {
      const noun = { deps: 'dependencies', dependants: 'dependents' };
      for (const key of ['deps', 'dependants']) {
        empty[key] = viewIds(key).length < 2;
        text[key] = !empty[key] ? `${name}'s ${noun[key]}`
          : viewIds(key, false, true).length > 1 ? `No visible ${noun[key]} of ${name}` : `${name} has no ${noun[key]}`;
      }
      if (empty[viewMode]) viewMode = null;
    }
    const off = { around: !selId, ...empty };
    for (const [key, btn] of Object.entries(viewBtns)) {
      if (!btn) continue;
      if (off[key] && document.activeElement === btn) host.querySelector('#zoom-fit')?.focus();
      btn.disabled = off[key];
      btn.title = text[key];
      btn.setAttribute('aria-label', text[key]);
    }
  }
  viewBtns.around?.addEventListener('click', () => showView('around'));
  viewBtns.deps?.addEventListener('click', () => showView('deps'));
  viewBtns.dependants?.addEventListener('click', () => showView('dependants'));
  paintViewIcons();

  const controls = host.querySelector('.zoom-controls');
  /** Measure the button column: reserve its width on the left, keep labels off it, and use two columns when it would not fit above the sheet. */
  function layoutControls() {
    if (!controls) return;
    const r = svg.getBoundingClientRect();
    if (!r.height) return;
    controls.classList.remove('two-col');
    if (controls.getBoundingClientRect().height > r.height - insetBottom - 24) controls.classList.add('two-col');
    const c = controls.getBoundingClientRect();
    leftInset = Math.max(0, c.right - r.left + 8);
    ctrlBox = [c.left - r.left - 4, c.top - r.top - 4, c.right - r.left + 4, c.bottom - r.top + 4];
  }

  function relayout() {
    computeGrid();
    dCache.clear();
    for (const nd of nodes.values()) {
      const p = pos.get(nd.id);
      nd.g.setAttribute('transform', `translate(${p.x},${p.y})`);
    }
    for (const e of bgEdges) e.path.setAttribute('d', pathD(e.from, e.to));
    if (lastState) update(lastState);
    layoutControls();
    const f = computeFit();
    if (selId) refocus();
    else if (!interacted && !tween) { k = f.k; tx = f.x; ty = f.y; applyCamera(); }
  }

  /**
   * Reserve space covered by an overlaid details panel; fit and focus centre in what is left.
   * A number reserves that many px on the right; {right, bottom} also reserves a bottom sheet.
   */
  function setInset(v) {
    const right = typeof v === 'number' ? v : v.right || 0;
    const bottom = typeof v === 'number' ? 0 : v.bottom || 0;
    if (right === inset && bottom === insetBottom) return;
    inset = right;
    insetBottom = bottom;
    layoutControls();
    const f = computeFit();
    if (selId) refocus();
    else if (!interacted && !tween) { k = f.k; tx = f.x; ty = f.y; applyCamera(); }
    else applyCamera();
  }

  /** Swap the grid (new layout() result and its orientation), re-place everything and refit or refocus. */
  function setLayout(next, nextOrientation) {
    layout = next;
    vertical = nextOrientation === 'vertical';
    paintViewIcons();
    stopTween();
    interacted = false;
    relayout();
  }

  /**
   * Switch the fun-mode decorations (a mode from fun.js, or null). `redraw` false only stores the mode (stage hidden):
   * the next relayout() draws it. Decorations live in the camera group, built once per relayout.
   */
  function setDecor(mode, redraw = true, state = null) {
    decorMode = mode;
    if (mode) ensureOrnaments();
    if (redraw) {
      if (state) lastState = state;
      if (!selId) interacted = false;
      relayout();
    }
  }

  layoutControls();
  fit();
  api.relayout = relayout;
  api.setDecor = setDecor;
  api.setLayout = setLayout;
  api.setInset = setInset;
  // Debug/test hooks (not used by the app): label-placement stats and a synchronous settle().
  api.stats = stats;
  api.settle = settle;
  api.update = update;
  api.fit = fit;
  api.focus = focus;
  api.focusSet = focusSet;
  api.refocus = refocus;
  return api;
}
