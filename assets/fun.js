// Fun modes: a theme that decorates the real graph. Each entry is one mode; adding another is one entry plus CSS.
//
//   { label, glyph, orientation, className,
//     backdrop(container)         fill the fixed, non-moving layer behind the graph (bokeh, snow) once,
//     decorate(layers, info) }    draw into the camera layers {back, mid, front}; returns the extra margin {top, bottom}
//
// `info` (vertical layouts only): k (rough zoom, to turn label pixels into graph units), rows [{y, x0, x1}] top to bottom, top {x, y} (the top-level library),
// base (the bottom row), rMax (largest node radius) and unit (a comfortable ornament size), all in graph units.
// Decorations are built once per layout and never touched per frame.
import { el, starPoints } from './render.js';
import { FUN_NAMES } from './themes.js';

/** Small deterministic random generator so the decorations look the same on every load. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BULBS = ['#ff5a6e', '#ffd23f', '#4fd8c8', '#6fa8ff', '#ffffff', '#ff9f43'];
const BALLS = ['#d62839', '#2f6fe0', '#e9b949', '#1f9d55', '#c9d3e6'];
const GIFTS = [
  // dx and w/h in units; row 0 is the bottom row, then the ones stacked on it.
  [0, -3.1, 1.5, 1.2, '#1f9d55', '#f3c14b'], [0, -1.45, 1.3, 1.7, '#2f6fe0', '#f5f7ff'], [0, 0.1, 1.7, 1.35, '#d62839', '#f3c14b'],
  [0, 1.85, 1.4, 1.1, '#8e44ad', '#f3c14b'], [0, 3.15, 1.0, 0.85, '#1aa6b7', '#f5f7ff'],
  [1, -2.1, 1.3, 1.1, '#f0b429', '#d62839'], [1, -0.2, 1.4, 1.2, '#1aa6b7', '#f5f7ff'], [1, 1.6, 1.2, 1.0, '#d62839', '#f3c14b'],
  [2, -0.9, 1.15, 1.0, '#2f6fe0', '#f3c14b'], [2, 0.7, 1.0, 0.9, '#8e44ad', '#f5f7ff'],
];

const f = n => +n.toFixed(2);

function gift(g, cx, bottom, w, h, color, ribbon) {
  const x = cx - w / 2;
  const y = bottom - h;
  const stroke = { stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.8 };
  el('rect', { x: f(x), y: f(y), width: f(w), height: f(h), rx: f(w * 0.06), fill: color, ...stroke }, g);
  el('rect', { x: f(x - w * 0.04), y: f(y), width: f(w * 1.08), height: f(h * 0.24), rx: f(w * 0.05), fill: color, ...stroke }, g);
  el('rect', { x: f(x - w * 0.04), y: f(y), width: f(w * 1.08), height: f(h * 0.24), rx: f(w * 0.05), fill: '#fff', opacity: 0.2 }, g);
  el('rect', { x: f(cx - w * 0.09), y: f(y), width: f(w * 0.18), height: f(h), fill: ribbon, stroke: 'rgba(0,0,0,.3)', 'stroke-width': 0.5 }, g);
  for (const s of [-1, 1]) {
    el('ellipse', {
      cx: f(cx + s * w * 0.19), cy: f(y - w * 0.06), rx: f(w * 0.22), ry: f(w * 0.12), fill: ribbon,
      stroke: 'rgba(0,0,0,.4)', 'stroke-width': 0.6, transform: `rotate(${-s * 24} ${f(cx + s * w * 0.19)} ${f(y - w * 0.06)})`,
    }, g);
  }
  el('circle', { cx: f(cx), cy: f(y - w * 0.02), r: f(w * 0.09), fill: ribbon, stroke: 'rgba(0,0,0,.4)', 'stroke-width': 0.6 }, g);
}

function ball(g, x, y, r, color) {
  el('circle', { cx: f(x), cy: f(y), r: f(r), fill: color, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.8 }, g);
  el('circle', { cx: f(x), cy: f(y), r: f(r), fill: 'url(#orn-gloss)' }, g);
  el('rect', { x: f(x - r * 0.28), y: f(y - r * 1.18), width: f(r * 0.56), height: f(r * 0.34), rx: 0.8, fill: '#e9b949', stroke: '#7a5a14', 'stroke-width': 0.5 }, g);
}

function hangingStar(g, x, y, R, silver) {
  const s = el('polygon', { points: starPoints(R, 0.46), transform: `translate(${f(x)},${f(y)})`, fill: silver ? '#cfd8ea' : 'url(#orn-gold)', stroke: silver ? '#6b778f' : '#8a6414', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, g);
  return s;
}

/** Point on a cubic Bezier. */
const cubic = (p, t) => {
  const m = 1 - t;
  const a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
};

function christmasBackdrop(box) {
  const rnd = rng(1224);
  const frag = document.createDocumentFragment();
  const glows = ['255,214,120', '255,120,130', '120,200,255', '140,230,170', '255,255,255'];
  for (let i = 0; i < 18; i++) {
    const b = document.createElement('i');
    b.className = 'bokeh';
    const size = 46 + rnd() * 120;
    const r = rnd() * 60;
    const bx = r < 30 ? r : r + 40;
    const c = glows[Math.floor(rnd() * glows.length)];
    b.style.cssText = `left:${f(bx)}%;top:${f(rnd() * 100)}%;--s:${f(size)}px;`
      + `--c:${c};--o:${f(0.1 + rnd() * 0.16)};--t:${f(5 + rnd() * 7)}s;--dl:-${f(rnd() * 8)}s`;
    frag.appendChild(b);
  }
  for (let i = 0; i < 46; i++) {
    const s = document.createElement('i');
    s.className = 'flake';
    const size = 2 + rnd() * 3.2;
    s.style.cssText = `left:${f(rnd() * 100)}%;--y:${f(rnd() * 100)}%;width:${f(size)}px;height:${f(size)}px;`
      + `opacity:${f(0.45 + rnd() * 0.45)};--d:${f(10 + rnd() * 14)}s;--dl:-${f(rnd() * 24)}s;--dx:${f((rnd() - 0.5) * 70)}px`;
    frag.appendChild(s);
  }
  box.replaceChildren(frag);
}

function christmasDecorate({ back, mid, front }, info) {
  const { rows, top, base, rMax, unit: u } = info;
  const cx = top.x;
  // Smoothed half-width of each row: the silhouette and the places the garland hangs from.
  const half = rows.map(r => Math.max(Math.abs(r.x0 - cx), Math.abs(r.x1 - cx)));
  const smooth = half.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(half.length - 1, i + 2); j++) { sum += half[j]; n++; }
    return Math.max(sum / n, half[i] * 0.8);
  });

  // Star on top.
  const R = u * 1.15;
  const starY = top.y - rMax - 8 - R;
  el('circle', { cx: f(cx), cy: f(starY), r: f(R * 2.4), fill: 'url(#orn-glow)' }, front);
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const r0 = R * 1.12, r1 = R * (i % 2 ? 1.45 : 1.8);
    el('line', { x1: f(cx + Math.cos(a) * r0), y1: f(starY + Math.sin(a) * r0), x2: f(cx + Math.cos(a) * r1), y2: f(starY + Math.sin(a) * r1), class: 'ray' }, front);
  }
  el('polygon', { points: starPoints(R, 0.42), transform: `translate(${f(cx)},${f(starY)})`, fill: 'url(#orn-gold)', stroke: '#8a6414', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }, front);
  el('polygon', { points: starPoints(R * 0.5, 0.42), transform: `translate(${f(cx)},${f(starY)})`, fill: '#fff6c8', opacity: 0.55 }, front);

  // Faint tree silhouette behind everything.
  const padW = u * 1.1;
  const pts = rows.map((r, i) => ({ y: r.y, l: cx - smooth[i] - padW, r: cx + smooth[i] + padW }));
  const baseY = base.y + rMax + 19 / info.k;
  let d = `M${f(cx)},${f(starY + R * 0.4)}`;
  for (const p of pts) d += ` L${f(p.l)},${f(p.y)}`;
  const last = pts[pts.length - 1];
  d += ` L${f(last.l - u * 0.5)},${f(baseY)} L${f(last.r + u * 0.5)},${f(baseY)}`;
  for (let i = pts.length - 1; i >= 0; i--) d += ` L${f(pts[i].r)},${f(pts[i].y)}`;
  el('path', { d: `${d}Z`, class: 'tree-sil', 'stroke-linejoin': 'round' }, back);

  // Garland: one zigzag strand with little coloured lights, crossing the tree like the picture people joke about.
  const rnd = rng(7);
  const n = rows.length;
  // Anchors hang outside the widest rows the ornament can touch; labels step aside for the rest (`avoid`).
  const rowStep = n > 1 ? rows[1].y - rows[0].y : u;
  const span = Math.ceil((u * 3.8) / rowStep) + 1;
  const labelRoom = u * 0.6;
  const anchors = [0.1, 0.3, 0.5, 0.7, 0.9].map((fr, i) => {
    const idx = Math.min(n - 1, Math.max(1, Math.round(fr * (n - 1))));
    const side = i % 2 ? 1 : -1;
    let w = 0;
    for (let j = Math.max(0, idx - 1); j <= Math.min(n - 1, idx + span); j++) w = Math.max(w, half[j]);
    return { x: cx + side * (w + labelRoom + u * 2), y: rows[idx].y, side };
  });
  const avoid = [];
  const nodeL = Math.min(...rows.map(r => r.x0));
  const nodeR = Math.max(...rows.map(r => r.x1));
  const outL = Math.max(...anchors.map(a => cx - a.x));
  const outR = Math.max(...anchors.map(a => a.x - cx));
  const sag = u * 1.3;
  const bulbs = el('g', { class: 'bulbs' }, mid);
  let colorIdx = 0;
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i], b = anchors[i + 1];
    const p = [a, { x: a.x + (b.x - a.x) * 0.33, y: a.y + (b.y - a.y) * 0.33 + sag }, { x: a.x + (b.x - a.x) * 0.66, y: a.y + (b.y - a.y) * 0.66 + sag }, b];
    el('path', { d: `M${f(a.x)},${f(a.y)}C${f(p[1].x)},${f(p[1].y)} ${f(p[2].x)},${f(p[2].y)} ${f(b.x)},${f(b.y)}`, class: 'garland' }, mid);
    const len = Math.hypot(b.x - a.x, b.y - a.y) * 1.05;
    const count = Math.max(6, Math.round(len / (u * 0.85)));
    for (let j = 0; j <= count; j++) {
      const q = cubic(p, j / count);
      const c = BULBS[colorIdx++ % BULBS.length];
      const r = u * (0.15 + rnd() * 0.05);
      el('circle', { cx: f(q.x), cy: f(q.y + u * 0.12), r: f(r * 2.6), fill: c, opacity: 0.2 }, bulbs);
      el('circle', { cx: f(q.x), cy: f(q.y + u * 0.12), r: f(r), fill: c, class: 'bulb' }, bulbs);
    }
  }
  // Hanging ornaments at the strand's turning points, behind the nodes so nothing real is ever covered.
  const hang = el('g', { class: 'hang' }, mid);
  anchors.forEach((a, i) => {
    const len = u * (1.5 + rnd() * 0.8);
    avoid.push([a.x - u * 0.8, a.y, a.x + u * 0.8, a.y + len + u * 1.5]);
    el('line', { x1: f(a.x), y1: f(a.y), x2: f(a.x), y2: f(a.y + len), class: 'string' }, hang);
    if (i % 2) hangingStar(hang, a.x, a.y + len + u * 0.55, u * 0.7, i === 3);
    else ball(hang, a.x, a.y + len + u * 0.5, u * 0.52, BALLS[i % BALLS.length]);
  });

  // Gifts on a round red mat below the base row.
  // The stack starts below the base row's labels; the mat follows from the stack's height.
  const stackH = [0, 1, 2].reduce((sum, row) => sum + Math.max(...GIFTS.filter(g => g[0] === row).map(g => g[3])), 0) * u;
  const matY = baseY + stackH + u * 0.15;
  const mat = el('ellipse', { cx: f(cx), cy: f(matY), rx: f(u * 5.4), ry: f(u * 0.8), class: 'mat' }, front);
  mat.setAttribute('stroke-width', 1.4);
  const rowBottom = [matY - u * 0.15, 0, 0];
  const rowTop = [0, 0, 0];
  GIFTS.forEach(([row, dx, w, h, color, ribbon]) => {
    if (row > 0 && !rowBottom[row]) rowBottom[row] = rowTop[row - 1] - u * 0.02;
    const bottom = rowBottom[row];
    gift(front, cx + dx * u, bottom, w * u, h * u, color, ribbon);
    rowTop[row] = Math.min(rowTop[row] || Infinity, bottom - h * u);
  });

  avoid.push([cx - R * 1.8, starY - R * 1.8, cx + R * 1.8, starY + R * 1.1]);
  avoid.push([cx - u * 5.4, baseY - u * 0.3, cx + u * 5.4, matY + u]);
  return {
    avoid,
    top: Math.max(0, top.y - 40 - (starY - R * 1.9)),
    bottom: Math.max(0, matY + u * 0.9 - (base.y + 50)),
    left: Math.max(0, outL + u * 1.3 - (cx - nodeL + 70)),
    right: Math.max(0, outR + u * 1.3 - (nodeR - cx + 70)),
  };
}

const MODES = {
  christmas: {
    label: 'Christmas',
    glyph: '★',
    orientation: 'vertical',
    className: 'fun-christmas',
    backdrop: christmasBackdrop,
    decorate: christmasDecorate,
  },
};

/** The registry; its keys are exactly FUN_NAMES (themes.js), which state.js and the head script of index.html rely on. */
export const FUN = Object.fromEntries(FUN_NAMES.map(name => [name, MODES[name]]));
