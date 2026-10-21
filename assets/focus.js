// Phone focus view: the selected library in the middle, what it needs on the left, what needs it on the right.
// With nothing selected it shows a short intro and the most depended-upon libraries as tappable chips.
import { relationGroups, extraNeeds, visibleModules } from './graph.js';
import { h, moduleName, stdClass, stdLabel } from './dom.js';

const POPULAR = 10;
const HIDDEN = 'Hidden by your filters or options.';

/**
 * @param {HTMLElement} root the <section id="focus">
 * @param {object} graph from buildGraph()
 * @param {Map<string, number>} importance from importance()
 * @param {{onSelect: (id: string) => void, onOpenDetails: () => void}} handlers
 * @returns {{update: (state: object) => void}}
 */
export function createFocus(root, graph, importance, { onSelect, onOpenDetails }) {
  const name = id => moduleName(graph, id);
  const byName = (a, b) => name(a).toLowerCase().localeCompare(name(b).toLowerCase()) || (a < b ? -1 : 1);
  const expanded = { deps: false, dependants: false };
  let lastSel = null;
  let key = '';

  function row(id, cls, colorStd) {
    const m = graph.modules.get(id);
    const b = h('button', `f-row ${cls}`);
    b.type = 'button';
    b.style.setProperty('--chip-std', colorStd ? `var(--${stdClass(m.cxxstd)})` : 'var(--std-none)');
    b.append(h('span', 'f-dot'), h('span', 'f-name', name(id)), h('span', 'f-std', String(m.cxxstd)));
    b.setAttribute('aria-label', `${name(id)}, C++${m.cxxstd}`);
    b.addEventListener('click', () => onSelect(id));
    return b;
  }

  /**
   * One column. `direct` and `extras` are lists of [id, cssClass]; `indirect` is the expandable rest.
   */
  function column({ side, title, arrow, direct, extras, indirect, shown, empty, colorStd, onToggle, indirectLabel }) {
    const col = h('div', `f-col f-col-${side}`);
    const head = h('h3', 'f-head');
    head.append(h('span', '', side === 'deps' ? `${arrow} ${title}` : `${title} ${arrow}`), h('span', 'f-n', String(direct.length)));
    col.appendChild(head);
    if (!direct.length && !extras.some(x => x.items.length) && !(shown && indirect.length)) col.appendChild(h('p', 'f-empty', empty));
    for (const [id, cls] of direct) col.appendChild(row(id, cls, colorStd));
    for (const { label, items } of extras) {
      if (!items.length) continue;
      col.appendChild(h('h4', 'f-sub', `${label} (${items.length})`));
      for (const [id, cls] of items) col.appendChild(row(id, cls, colorStd));
    }
    if (indirect.length) {
      const t = h('button', 'f-more', shown ? 'Hide indirect' : `Show ${indirect.length} indirect`);
      t.type = 'button';
      t.setAttribute('aria-expanded', String(shown));
      t.title = indirectLabel;
      t.addEventListener('click', onToggle);
      col.appendChild(t);
      if (shown) for (const [id, cls] of indirect) col.appendChild(row(id, cls, colorStd));
    }
    return col;
  }

  function renderHome(state) {
    root.replaceChildren();
    if (state.notFound) {
      const n = h('p', 'f-notice', `Library not found: "${state.notFound}". Pick one below or search above.`);
      n.setAttribute('role', 'status');
      root.appendChild(n);
    }
    const home = h('div', 'f-home');
    home.appendChild(h('h2', '', 'Who needs whom in Boost?'));
    home.appendChild(h('p', 'f-lead', 'Search for a library above, or start with one of the most depended-upon:'));
    const pop = h('div', 'f-pop');
    const ids = [...graph.order].sort((a, b) => importance.get(b) - importance.get(a) || (a < b ? -1 : 1)).slice(0, POPULAR);
    for (const id of ids) {
      const m = graph.modules.get(id);
      const b = h('button', 'f-chip');
      b.type = 'button';
      b.style.setProperty('--chip-std', `var(--${stdClass(m.cxxstd)})`);
      b.append(h('span', 'f-dot'), h('span', 'f-name', name(id)));
      b.addEventListener('click', () => onSelect(id));
      pop.appendChild(b);
    }
    home.appendChild(pop);
    home.appendChild(h('p', 'f-tip', 'Each library shows what it needs on the left and who needs it on the right. "Legend & options" explains every colour and marker, and "Full graph" shows all libraries at once.'));
    root.appendChild(home);
  }

  function renderFocus(sel, state) {
    const o = state.options;
    const m = graph.modules.get(sel);
    const scroll = lastSel === sel ? [...root.querySelectorAll('.f-col')].map(c => c.scrollTop) : [];
    const vis = visibleModules(graph, { categories: state.filters.categories, cxxstd: state.filters.cxxstd });
    vis.add(sel);
    const keep = ids => [...ids].filter(id => vis.has(id)).sort(byName);

    const groups = relationGroups(graph, sel, { tests: o.tests, examples: o.examples });
    const ofRel = (r, allowed = true) => (allowed ? keep(groups[r]) : []);
    const depsDirect = ofRel('dep', o.deps).map(id => [id, 'f-dep']);
    const depsInd = ofRel('tdep', o.tdeps).map(id => [id, 'f-tdep']);
    const rdDirect = ofRel('rdep', o.rdeps).map(id => [id, 'f-rdep']);
    const rdInd = ofRel('trdep', o.trdeps).map(id => [id, 'f-trdep']);
    const depExtras = [];
    const rdExtras = [];
    const indirectExtras = [];
    for (const [kind, on, label] of [['test', o.tests, 'tests'], ['example', o.examples, 'examples']]) {
      if (!on) continue;
      const direct = extraNeeds(graph, sel, kind).direct;
      const needs = ofRel(`${kind}dep`);
      depExtras.push({ label: `Its ${label} also need`, items: needs.filter(id => direct.has(id)).map(id => [id, `f-${kind}dep`]) });
      if (o.tdeps) indirectExtras.push(...needs.filter(id => !direct.has(id)).map(id => [id, `f-${kind}dep`]));
      rdExtras.push({ label: `Libraries whose ${label} need it`, items: ofRel(`${kind}rdep`).map(id => [id, `f-${kind}rdep`]) });
    }
    depsInd.push(...indirectExtras);
    depsInd.sort((a, b) => byName(a[0], b[0]));
    const rawDeps = graph.out.get(sel).lib.size;
    const rawRdeps = graph.in.get(sel).lib.size;

    root.replaceChildren();
    const view = h('div', 'focus-view');

    const center = h('button', 'f-center');
    center.type = 'button';
    center.setAttribute('aria-label', `${name(sel)}: open details`);
    const top = h('span', 'f-ctop');
    top.append(h('span', 'f-cname', name(sel)), h('span', `pill std ${stdClass(m.cxxstd)}`, stdLabel(m)));
    center.appendChild(top);
    if (m.description) center.appendChild(h('span', 'f-cdesc', m.description));
    center.appendChild(h('span', 'f-chint', 'Tap for details'));
    center.addEventListener('click', onOpenDetails);
    view.appendChild(center);

    const cols = h('div', 'f-cols');
    cols.appendChild(column({
      side: 'deps', title: 'Needs', arrow: '←', direct: depsDirect, extras: depExtras, indirect: depsInd, shown: expanded.deps,
      empty: rawDeps ? HIDDEN : 'Needs no other Boost library.', colorStd: o.colorStd, onToggle: () => { expanded.deps = !expanded.deps; renderNow('deps'); },
      indirectLabel: 'Libraries it needs through its dependencies',
    }));
    cols.appendChild(column({
      side: 'dependants', title: 'Needed by', arrow: '→', direct: rdDirect, extras: rdExtras, indirect: rdInd, shown: expanded.dependants,
      empty: rawRdeps ? HIDDEN : 'No other library needs it.', colorStd: o.colorStd, onToggle: () => { expanded.dependants = !expanded.dependants; renderNow('dependants'); },
      indirectLabel: 'Libraries that use it through other libraries',
    }));
    view.appendChild(cols);
    root.appendChild(view);
    [...root.querySelectorAll('.f-col')].forEach((c, i) => { if (scroll[i]) c.scrollTop = scroll[i]; });
  }

  let current = null;
  function renderNow(side) {
    if (!current) return;
    key = '';
    update(current);
    if (side) root.querySelector(`.f-col-${side} .f-more`)?.focus({ preventScroll: true });
  }

  function update(state) {
    current = state;
    const sel = state.selected && graph.modules.has(state.selected) ? state.selected : null;
    if (sel !== lastSel) {
      expanded.deps = false;
      expanded.dependants = false;
    }
    const o = state.options;
    const f = state.filters;
    const k = [sel, state.notFound, expanded.deps, expanded.dependants, o.deps, o.tdeps, o.rdeps, o.trdeps, o.tests, o.examples, o.colorStd,
      f.categories ? [...f.categories].join('|') : '*', f.cxxstd ? [...f.cxxstd].join('|') : '*'].join('~');
    if (k === key) return;
    key = k;
    if (sel) renderFocus(sel, state);
    else renderHome(state);
    root.classList.toggle('has-sel', Boolean(sel));
    if (sel !== lastSel) root.scrollTop = 0;
    lastSel = sel;
  }

  return { update };
}
