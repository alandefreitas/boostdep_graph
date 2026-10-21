// Small DOM and label helpers shared by the graph, details panel, legend and phone focus view.

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

/** Relation to the selection -> the option that switches it on (used by the graph, the lists and the legend). */
export const REL_OPTION = {
  dep: 'deps', tdep: 'tdeps', rdep: 'rdeps', trdep: 'trdeps', category: 'category',
  testdep: 'tests', testrdep: 'tests', exampledep: 'examples', examplerdep: 'examples',
};

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
