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
