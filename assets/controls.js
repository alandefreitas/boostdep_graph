// Zoom and view buttons of the stage: zoom in/out, the three view buttons (around, dependencies, dependents) and fit.
// DOM only: the camera and the framing stay in render.js, which passes callbacks in and reads the measured box out.

const ARROWS = {
  deps: { horizontal: 'M13 9H5M8 6L5 9L8 12', vertical: 'M9 5V13M6 10L9 13L12 10' },
  dependants: { horizontal: 'M5 9H13M10 6L13 9L10 12', vertical: 'M9 13V5M6 8L9 5L12 8' },
};
const svgOf = inner => `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const NOUN = { deps: 'dependencies', dependants: 'dependents' };

/**
 * Wire the buttons found inside `host` (#zoom-in, #zoom-out, #view-around, #view-deps, #view-dependants, #zoom-fit, .zoom-controls).
 * @param {HTMLElement} host the stage
 * @param {SVGSVGElement} svg the graph, used to measure the column against
 * @param {{zoomBy: (factor: number) => void, fit: () => void, showView: (mode: 'around'|'deps'|'dependants') => void}} handlers
 * @returns {{
 *   paintIcons: (vertical: boolean) => void,
 *   paintViews: (sel: null|{name: string, deps: {count: number, total: number}, dependants: {count: number, total: number}}) => {deps: boolean, dependants: boolean},
 *   measure: (insetBottom: number) => null|{leftInset: number, ctrlBox: number[]}
 * }}
 *   `paintIcons` redraws the arrows for the orientation. `paintViews` enables the buttons and sets their tooltips from the selection
 *   (null = none): `count` is how many other libraries the view would frame, `total` how many exist ignoring filters and options;
 *   it returns which of the two relation views are empty. `measure` sizes the column (two columns when it would not fit above
 *   `insetBottom`) and returns the strip it covers on the left and its box in svg px, or null while the svg has no size.
 */
export function createControls(host, svg, { zoomBy, fit, showView }) {
  const q = sel => host.querySelector(sel);
  q('#zoom-in')?.addEventListener('click', () => zoomBy(1.4));
  q('#zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.4));
  q('#zoom-fit')?.addEventListener('click', fit);

  const viewBtns = { around: q('#view-around'), deps: q('#view-deps'), dependants: q('#view-dependants') };
  for (const [mode, btn] of Object.entries(viewBtns)) btn?.addEventListener('click', () => showView(mode));

  function paintIcons(vertical) {
    const o = vertical ? 'vertical' : 'horizontal';
    if (viewBtns.around) viewBtns.around.innerHTML = svgOf('<circle cx="9" cy="9" r="5.5"/><circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none"/>');
    for (const key of ['deps', 'dependants']) {
      if (viewBtns[key]) viewBtns[key].innerHTML = svgOf(`<circle cx="9" cy="9" r="7.5" opacity="0.55"/><path d="${ARROWS[key][o]}"/>`);
    }
  }

  function paintViews(sel) {
    const empty = { deps: !sel, dependants: !sel };
    const text = {
      around: sel ? `Around ${sel.name}` : 'Around the selected library',
      deps: 'Dependencies of the selected library',
      dependants: 'Dependents of the selected library',
    };
    if (sel) {
      for (const key of ['deps', 'dependants']) {
        const { count, total } = sel[key];
        empty[key] = count < 1;
        text[key] = !empty[key] ? `${sel.name}'s ${NOUN[key]}`
          : total > 0 ? `No visible ${NOUN[key]} of ${sel.name}` : `${sel.name} has no ${NOUN[key]}`;
      }
    }
    const off = { around: !sel, ...empty };
    for (const [key, btn] of Object.entries(viewBtns)) {
      if (!btn) continue;
      if (off[key] && document.activeElement === btn) q('#zoom-fit')?.focus();
      btn.disabled = off[key];
      btn.title = text[key];
      btn.setAttribute('aria-label', text[key]);
    }
    return empty;
  }

  const column = q('.zoom-controls');
  function measure(insetBottom) {
    if (!column) return null;
    const r = svg.getBoundingClientRect();
    if (!r.height) return null;
    column.classList.remove('two-col');
    if (column.getBoundingClientRect().height > r.height - insetBottom - 24) column.classList.add('two-col');
    const c = column.getBoundingClientRect();
    return {
      leftInset: Math.max(0, c.right - r.left + 8),
      ctrlBox: [c.left - r.left - 4, c.top - r.top - 4, c.right - r.left + 4, c.bottom - r.top + 4],
    };
  }

  return { paintIcons, paintViews, measure };
}
