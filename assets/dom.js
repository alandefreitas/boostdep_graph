// Small DOM, SVG and label helpers shared by the graph, details panel, legend and phone focus view.

const NS = 'http://www.w3.org/2000/svg';

/** Element by id. */
export const $ = id => document.getElementById(id);

/** Create an SVG element with attributes, optionally appended to `parent`. */
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

/** Create an element with an optional class and text. */
export function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Display name of a module (falls back to its id). */
export const moduleName = (graph, id) => graph.modules.get(id).name || id;

/** CSS class for a C++ standard: 98 and 03 share one chip, so `std-03`. */
export function stdClass(cxxstd) {
  const s = String(cxxstd);
  return s === '98' || s === '03' ? 'std-03' : `std-${s}`;
}

/** Label of a module's C++ standard, e.g. `C++11` or `C++11 (inferred)`. */
export function stdLabel(m) {
  return `C++${m.cxxstd}${m.cxxstdInferred ? ' (inferred)' : ''}`;
}

/** Extra edge kind -> the "include" option that turns it on (and its plural label). */
export const KIND_OPTION = { test: 'tests', example: 'examples' };

/** Edge kinds ('test', 'example') whose include option is on in `o` (the state's options). */
export const enabledKinds = o => Object.keys(KIND_OPTION).filter(kind => o[KIND_OPTION[kind]]);

/**
 * Marker badges: option key, symbol id, module flag, angle in degrees (0 = right, clockwise) and pill label.
 * The graph, the legend samples and the details pills all read this table, so they cannot drift apart.
 */
export const BADGES = [
  { option: 'buildableMarker', sym: 'sym-buildable', flag: 'buildable', angle: -45, label: 'Buildable' },
  { option: 'toolMarker', sym: 'sym-tool', flag: 'tool', angle: 45, label: 'Tool' },
  { option: 'proposedMarker', sym: 'sym-proposed', flag: 'proposed', angle: 135, label: 'Proposed' },
  { option: 'deprecatedMarker', sym: 'sym-deprecated', flag: 'deprecated', angle: -135, label: 'Deprecated' },
];
export const badgeOf = flag => BADGES.find(b => b.flag === flag);
