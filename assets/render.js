// Hand-written SVG renderer: builds the DOM once, then only toggles classes and attributes.
import { relations, visibleModules, maxImportance, extraNeeds } from './graph.js';

const NS = 'http://www.w3.org/2000/svg';
const MIN_R = 4.5;
const LABEL_PX = 10.5;
const MAX_K = 6;
const CLICK_SLOP = 4;

const REL_OPTION = {
  dep: 'deps', tdep: 'tdeps', rdep: 'rdeps', trdep: 'trdeps', category: 'category',
  testdep: 'tests', testrdep: 'tests', exampledep: 'examples', examplerdep: 'examples',
};

// Badge slots: option key, symbol id, module flag, angle in degrees (0 = right, clockwise).
const BADGES = [
  ['buildableMarker', 'sym-buildable', 'buildable', -45],
  ['toolMarker', 'sym-tool', 'tool', 45],
  ['deprecatedMarker', 'sym-deprecated', 'deprecated', -135],
  ['proposedMarker', 'sym-proposed', 'proposed', 135],
];

function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** 98 and 03 are one chip: a filter containing either matches both. */
function expandStd(set) {
  if (!set) return null;
  const res = new Set(set);
  if (res.has('03')) res.add('98');
  if (res.has('98')) res.add('03');
  return res;
}

/** CSS class suffix for a C++ standard: 98 and 03 share one chip. */
export function stdClass(cxxstd) {
  const s = String(cxxstd);
  return s === '98' || s === '03' ? 'std-03' : `std-${s}`;
}

/**
 * @param {SVGSVGElement} svg
 * @param {object} graph from buildGraph()
 * @param {Map<string, {x: number, y: number}>} layout from layout()
 * @param {Map<string, number>} importance from importance()
 */
export function createGraphView(svg, graph, layout, importance) {
  const maxImp = maxImportance(importance) || 1;
  const host = svg.parentElement;
  const tooltip = host.querySelector('#tooltip');

  // Grid steps come from the available area once, so nodes never move afterwards.
  const area = host.parentElement;
  const areaW = Math.max((area?.clientWidth || window.innerWidth) - 24, 640);
  const areaH = Math.max(host.clientHeight || window.innerHeight - 90, 420);
  let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
  for (const p of layout.values()) {
    gx0 = Math.min(gx0, p.x); gx1 = Math.max(gx1, p.x);
    gy0 = Math.min(gy0, p.y); gy1 = Math.max(gy1, p.y);
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const xStep = clamp((areaW - 150) / Math.max(1, gx1 - gx0), 48, 150);
  const yStep = clamp((areaH - 110) / Math.max(1, gy1 - gy0), 22, 56);
  const rMax = Math.min(14, yStep * 0.45);
  const pos = new Map();
  for (const [id, p] of layout) pos.set(id, { x: p.x * xStep, y: p.y * yStep });
  const bounds = { x: gx0 * xStep - 70, y: gy0 * yStep - 40, w: (gx1 - gx0) * xStep + 140, h: (gy1 - gy0) * yStep + 90 };

  const viewport = el('g', { class: 'viewport' }, svg);
  const gBg = el('g', { class: 'edges-bg' }, viewport);
  const gHi = el('g', { class: 'edges-hi' }, viewport);
  const gNodes = el('g', { class: 'nodes' }, viewport);

  const dCache = new Map();
  function pathD(a, b) {
    const key = `${a}|${b}`;
    let d = dCache.get(key);
    if (d) return d;
    const p = pos.get(a);
    const q = pos.get(b);
    const dx = q.x - p.x;
    const c = Math.abs(dx) < 1 ? 70 : dx / 2;
    d = `M${p.x},${p.y}C${p.x + c},${p.y} ${q.x - (Math.abs(dx) < 1 ? -70 : c)},${q.y} ${q.x},${q.y}`;
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
    const badges = BADGES.map(([opt, sym, flag, angle]) => {
      const u = el('use', { href: `#${sym}`, class: 'badge' }, body);
      return { u, opt, flag, angle };
    });
    const label = el('text', { class: 'label' }, g);
    label.textContent = m.name || id;
    nodes.set(id, { id, m, g, body, halo, circle, diamond, badges, label, cls: '', r: 0, s: 1, alt: Boolean(m.stdAlternatives?.length), off: false });
  }

  // ---- camera ----
  let k = 1, tx = 0, ty = 0;
  let interacted = false;
  let tween = 0;
  let fitK = 0.3;

  function size() {
    const r = svg.getBoundingClientRect();
    return { w: r.width || 1, h: r.height || 1 };
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
    const { w, h } = size();
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
      const vis = !nd.hidden && sx > -40 && sx < w + 40 && sy > -40 && sy < h + 40;
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
    const labelBoxes = [];
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
    const { w, h } = size();
    fitK = Math.min(w / bounds.w, h / bounds.h);
    return { k: fitK, x: (w - bounds.w * fitK) / 2 - bounds.x * fitK, y: (h - bounds.h * fitK) / 2 - bounds.y * fitK };
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
    const f = computeFit();
    interacted = false;
    if (animate) animateTo(f);
    else { k = f.k; tx = f.x; ty = f.y; applyCamera(); }
  }

  function focus(id) {
    const p = pos.get(id);
    if (!p) return;
    computeFit();
    interacted = true;
    const ids = [id, ...graph.out.get(id).lib, ...graph.in.get(id).lib];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ids) {
      const q = pos.get(n);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    const pad = 70;
    const { w, h } = size();
    const bw = x1 - x0 + 2 * pad;
    const bh = y1 - y0 + 2 * pad;
    const nk = Math.max(fitK, Math.min(2.5, w / bw, h / bh));
    animateTo({ k: nk, x: w / 2 - ((x0 + x1) / 2) * nk, y: h / 2 - ((y0 + y1) / 2) * nk });
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
    svg.setPointerCapture(e.pointerId);
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
    const title = document.createElement('div');
    title.className = 'tt-title';
    title.textContent = m.name || nd.id;
    const std = document.createElement('span');
    std.className = 'tt-std';
    std.textContent = `C++${m.cxxstd}${m.cxxstdInferred ? ' (inferred)' : ''}`;
    title.append(' ', std);
    tooltip.appendChild(title);
    if (m.description) {
      const d = document.createElement('div');
      d.className = 'tt-desc';
      d.textContent = m.description;
      tooltip.appendChild(d);
    }
  }

  function hideTooltip() {
    tooltip.hidden = true;
    delete tooltip.dataset.id;
  }

  // ---- state -> DOM ----
  function update(state) {
    const o = state.options;
    const sel = state.selected && graph.modules.has(state.selected) ? state.selected : null;
    const relMap = sel ? relations(graph, sel, { tests: o.tests, examples: o.examples }) : null;
    const visible = visibleModules(graph, {
      categories: state.filters.categories,
      cxxstd: expandStd(state.filters.cxxstd),
    });
    const relOf = id => (relMap ? relMap.get(id) : null);
    selId = sel;
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
      if (shown) parts.push(`rel-${shown}`, 'rel');
      else if (sel) parts.push('dim');
      nd.hidden = !visible.has(nd.id);
      if (nd.hidden) parts.push('hidden');
      if (alt) parts.push('alt');
      const cls = parts.join(' ');
      if (cls !== nd.cls) { nd.g.setAttribute('class', cls); nd.cls = cls; }
      if (r !== nd.r || nd.altShown !== alt) {
        nd.r = r;
        nd.altShown = alt;
        const rr = alt ? r * 0.9 : r;
        nd.circle.setAttribute('r', r);
        nd.circle.style.display = alt ? 'none' : '';
        nd.diamond.style.display = alt ? '' : 'none';
        const s = rr * 1.45;
        nd.diamond.setAttribute('x', -s / 2);
        nd.diamond.setAttribute('y', -s / 2);
        nd.diamond.setAttribute('width', s);
        nd.diamond.setAttribute('height', s);
        nd.diamond.setAttribute('transform', 'rotate(45)');
        nd.halo.setAttribute('r', rr + 6);
        const bs = Math.max(9, Math.min(13, r * 0.9));
        for (const b of nd.badges) {
          const a = (b.angle * Math.PI) / 180;
          b.u.setAttribute('x', (Math.cos(a) * (r + 1) * 0.85 - bs / 2).toFixed(1));
          b.u.setAttribute('y', (Math.sin(a) * (r + 1) * 0.85 - bs / 2).toFixed(1));
          b.u.setAttribute('width', bs);
          b.u.setAttribute('height', bs);
        }
      }
      for (const b of nd.badges) {
        const on = o[b.opt] && nd.m[b.flag];
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
      for (const kind of ['test', 'example']) {
        if (!o[`${kind}s`]) continue;
        const n = extraNeeds(graph, sel, kind);
        needs[kind] = { direct: n.direct, all: new Set([...n.direct, ...n.transitive]) };
      }
    }
    for (const e of bgEdges) {
      let cls = 'edge';
      if (!visible.has(e.from) || !visible.has(e.to)) cls = 'edge off';
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
    for (const kind of ['test', 'example']) {
      if (!o[`${kind}s`]) continue;
      for (const id of graph.order) {
        if (!visible.has(id)) continue;
        for (const to of graph.out.get(id)[kind]) {
          if (!visible.has(to) || graph.out.get(id).lib.has(to)) continue;
          if (sel) {
            const rf = relOf(id);
            const rt = relOf(to);
            const need = id === sel && needs[kind].direct.has(to);
            const dependant = rf === `${kind}rdep` && isOneOf(rt, 'self', 'rdep', 'trdep');
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
    const frag = document.createDocumentFragment();
    for (const e of hi) frag.appendChild(el('path', { d: pathD(e.from, e.to), class: e.cls }));
    gHi.appendChild(frag);
  }

  new ResizeObserver(() => {
    const { w, h } = size();
    if (w < 2 || h < 2) return;
    const f = computeFit();
    if (!interacted && !tween) { k = f.k; tx = f.x; ty = f.y; applyCamera(); }
    else fitK = f.k;
  }).observe(svg);

  const zoomBy = f => { const { w, h } = size(); interacted = true; stopTween(); zoomAt(w / 2, h / 2, f); };
  host.querySelector('#zoom-in')?.addEventListener('click', () => zoomBy(1.4));
  host.querySelector('#zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.4));
  host.querySelector('#zoom-fit')?.addEventListener('click', () => { interacted = false; fit(true); });

  fit();
  api.stats = stats;
  api.settle = settle;
  api.update = update;
  api.fit = fit;
  api.focus = focus;
  return api;
}
