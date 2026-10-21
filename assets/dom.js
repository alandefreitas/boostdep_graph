// Small DOM and label helpers shared by the details panel and the phone focus view.

/** Create an element with an optional class and text. */
export function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Display name of a module (falls back to its id). */
export const moduleName = (graph, id) => graph.modules.get(id).name || id;
