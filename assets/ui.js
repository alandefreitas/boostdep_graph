// Legend as control panel: every row shows a real sample (same SVG symbols and CSS classes as the graph),
// a plain-words label and a switch. Also category and C++ standard filters, and Reset.
import { DEFAULT_OPTIONS } from './state.js';
import { relations, extraNeeds, extraDependants, visibleModules } from './graph.js';
import { el as s, stdClass, expandStd, diamondGeom, badgeGeom } from './render.js';

const STDS = [['03', 'C++98/03'], ['11', 'C++11'], ['14', 'C++14'], ['17', 'C++17'], ['20', 'C++20'], ['23', 'C++23']];
const SAMPLE_W = 46;
const NODE_X = 34;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * A small SVG that reuses the graph's classes. `edge` is an edge class string drawn into the node.
 * Badge geometry follows render.js: symbol centred on a point just inside the rim, at `badge.angle` degrees.
 */
function sample({ std = 'std-11', cls = '', r = 7, alt = false, badge = null, halo = false, edge = null, cx = edge ? NODE_X : SAMPLE_W / 2 } = {}) {
  const svg = sampleSvg();
  if (edge) s('path', { class: `edge ${edge}`, d: `M2,14 H${cx}` }, svg);
  const g = s('g', { class: `node ${std} ${cls}`.trim(), transform: `translate(${cx},14)` }, svg);
  if (halo) s('circle', { class: 'halo', r: r + 6 }, g);
  if (alt) {
    const { side } = diamondGeom(r);
    s('rect', { class: 'shape diamond', rx: 2, x: -side / 2, y: -side / 2, width: side, height: side, transform: 'rotate(45)' }, g);
  } else s('circle', { class: 'shape', r }, g);
  if (badge) {
    const bg = badgeGeom(r, badge.angle);
    s('use', { href: `#${badge.sym}`, class: 'badge', x: bg.x, y: bg.y, width: bg.size, height: bg.size }, g);
  }
  return svg;
}

function sampleSvg() {
  return s('svg', { class: 'lg-sample', width: SAMPLE_W, height: 28, viewBox: `0 0 ${SAMPLE_W} 28`, 'aria-hidden': 'true', focusable: 'false' });
}

function customSample(draw) {
  const svg = sampleSvg();
  draw(svg);
  return svg;
}

/**
 * @param {HTMLElement} root the <aside id="legend">
 * @param {object} graph from buildGraph()
 * @param {(fn: (state: object) => void) => void} onChange mutate state inside fn (store.change)
 * @param {() => void} onLayout called after the panel collapses or expands (the stage size changed)
 * @returns {{update: (state: object) => void}}
 */
export function createLegend(root, graph, onChange, onLayout = () => {}) {
  const switches = new Map();
  const counts = new Map();

  // ---- generic pieces ----
  function row({ sampleEl, label, help, option, countKey, extra }) {
    const lab = h('label', 'lg-row');
    lab.appendChild(sampleEl ?? h('span', 'lg-sample'));
    const text = h('span', 'lg-text');
    const top = h('span', 'lg-top');
    top.appendChild(h('span', 'lg-label', label));
    if (countKey) {
      const c = h('span', 'lg-count');
      counts.set(countKey, c);
      top.appendChild(c);
    }
    text.appendChild(top);
    if (help) text.appendChild(h('span', 'lg-help', help));
    lab.appendChild(text);
    if (option) {
      const input = h('input', 'lg-switch');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      input.addEventListener('change', () => onChange(st => { st.options[option] = input.checked; }));
      switches.set(option, input);
      lab.appendChild(input);
    } else lab.appendChild(h('span', 'lg-noswitch'));
    if (extra) {
      const wrap = h('div', 'lg-rowwrap');
      wrap.append(lab, extra);
      return wrap;
    }
    return lab;
  }

  function group(title, intro) {
    const d = h('details', 'lg-group');
    d.open = true;
    d.appendChild(h('summary', '', title));
    const body = h('div', 'lg-body');
    if (intro) body.appendChild(h('p', 'lg-intro', intro));
    d.appendChild(body);
    return { d, body };
  }

  // ---- header ----
  const head = h('div', 'lg-head');
  const toggle = h('button', 'lg-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', 'legend-panel');
  const title = h('h2', 'lg-title', 'Legend & options');
  const reset = h('button', 'lg-reset', 'Reset');
  reset.type = 'button';
  reset.title = 'Back to the default view (keeps the selected library)';
  head.append(toggle, title, reset);
  const panel = h('div', 'lg-panel');
  panel.id = 'legend-panel';
  root.append(head, panel);

  function setCollapsed(v, save = true) {
    root.classList.toggle('collapsed', v);
    toggle.setAttribute('aria-expanded', String(!v));
    toggle.setAttribute('aria-label', v ? 'Show legend and options' : 'Hide legend and options');
    toggle.title = v ? 'Show legend and options' : 'Hide legend and options';
    toggle.textContent = v ? '»' : '«';
    panel.hidden = v;
    if (save) try { localStorage.setItem('bdg-legend', v ? 'closed' : 'open'); } catch { /* storage unavailable */ }
    if (save) onLayout();
  }
  toggle.addEventListener('click', () => setCollapsed(!root.classList.contains('collapsed')));
  let startCollapsed = window.innerWidth < 1280;
  try {
    const saved = localStorage.getItem('bdg-legend');
    if (saved) startCollapsed = saved === 'closed';
  } catch { /* storage unavailable */ }
  setCollapsed(startCollapsed, false);

  reset.addEventListener('click', () => onChange(st => {
    st.options = { ...DEFAULT_OPTIONS };
    st.filters = { categories: null, cxxstd: null };
  }));

  // ---- group: selected library ----
  const g1 = group('When a library is selected');
  const hint = h('p', 'lg-hint', 'Click a library to see what it depends on and what depends on it.');
  g1.body.appendChild(hint);
  const selRow = row({ sampleEl: sample({ cls: 'rel-self rel', halo: true, cx: NODE_X, edge: null, r: 6 }), label: 'Selected library', help: 'Glowing orange ring.' });
  g1.body.appendChild(selRow);
  const RELS = [
    ['dep', 'deps', 'Direct dependencies', 'What it includes directly. Orange.', 'hi-dep'],
    ['tdep', 'tdeps', 'Indirect dependencies', 'Needed through its dependencies. Light orange.', 'hi-tdep'],
    ['rdep', 'rdeps', 'Direct dependants', 'Libraries that use it directly. Blue.', 'hi-rdep'],
    ['trdep', 'trdeps', 'Indirect dependants', 'Use it through other libraries. Light blue.', 'hi-trdep'],
  ];
  for (const [rel, opt, label, help, edge] of RELS) {
    g1.body.appendChild(row({ sampleEl: sample({ cls: `rel-${rel} rel`, edge }), label, help, option: opt, countKey: rel }));
  }
  g1.body.appendChild(row({ sampleEl: sample({ cls: 'rel-category rel' }), label: 'Same category', help: 'Shares a category with it. Green ring.', option: 'category', countKey: 'category' }));
  const pathSample = customSample(svg => {
    const t = s('text', { x: 2, y: 18, class: 'lg-path' }, svg);
    t.textContent = 'a → b → c';
  });
  g1.body.appendChild(row({ sampleEl: pathSample, label: 'Dependency paths', help: 'Hover a library in the details panel to see how the two connect.', option: 'paths' }));

  // ---- group: include ----
  const g2 = group('Include (off by default)', 'By default only what users actually pull in is shown.');
  const INCL = [
    ['test', 'tests', 'rel-testdep', 'rel-testrdep', 'x-test', 'Test dependencies', 'Also count what the library\u2019s tests pull in. Dashed orange.', 'Blue dashed: libraries whose tests need it.'],
    ['example', 'examples', 'rel-exampledep', 'rel-examplerdep', 'x-example', 'Example dependencies', 'Also count what the library\u2019s examples pull in. Dotted orange.', 'Blue dotted: libraries whose examples need it.'],
  ];
  for (const [kind, opt, depCls, rdepCls, edgeCls, label, help, rhelp] of INCL) {
    const sub = row({ sampleEl: sample({ cls: `${rdepCls} rel`, edge: `${edgeCls} hi-xr` }), label: 'Dependants', help: rhelp, countKey: `${kind}r` });
    sub.classList.add('lg-sub');
    g2.body.appendChild(row({ sampleEl: sample({ cls: `${depCls} rel`, edge: `${edgeCls} hi-x` }), label, help, option: opt, countKey: kind, extra: sub }));
  }

  // ---- group: libraries ----
  const g3 = group('Libraries');
  const stdChips = new Map();
  const stdCount = new Map(STDS.map(([k]) => [k, 0]));
  for (const m of graph.modules.values()) {
    const k = stdClass(m.cxxstd).slice(4);
    if (stdCount.has(k)) stdCount.set(k, stdCount.get(k) + 1);
  }
  const chipWrap = h('div', 'lg-chips lg-stdchips');
  for (const [key, label] of STDS) {
    const c = h('label', 'lg-chip');
    const input = h('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', `Show ${label} libraries`);
    input.addEventListener('change', () => toggleStd(key, input.checked));
    const dot = s('svg', { class: 'lg-dot', width: 12, height: 12, viewBox: '-6 -6 12 12', 'aria-hidden': 'true' });
    const g = s('g', { class: `node ${stdClass(key)}` }, dot);
    s('circle', { class: 'shape', r: 4.5 }, g);
    c.append(input, dot, h('span', 'lg-chip-text', label), h('span', 'lg-chip-n', String(stdCount.get(key))));
    stdChips.set(key, input);
    chipWrap.appendChild(c);
  }
  const colorSample = customSample(svg => {
    [['std-11', 8], ['std-17', 23], ['std-23', 38]].forEach(([c, x]) => {
      const g = s('g', { class: `node ${c}`, transform: `translate(${x},14)` }, svg);
      s('circle', { class: 'shape', r: 5.5 }, g);
    });
  });
  g3.body.appendChild(row({ sampleEl: colorSample, label: 'Color = minimum C++ standard', help: 'Untick a standard to dim those libraries.', option: 'colorStd', extra: chipWrap }));
  const sizeSample = customSample(svg => {
    [[13, 4.5], [32, 10]].forEach(([x, r]) => {
      const g = s('g', { class: 'node std-none', transform: `translate(${x},14)` }, svg);
      s('circle', { class: 'shape', r }, g);
    });
  });
  g3.body.appendChild(row({ sampleEl: sizeSample, label: 'Size = how many libraries depend on it', help: 'Bigger means more widely used.', option: 'sizeImportance' }));
  g3.body.appendChild(row({ sampleEl: sample({ alt: true, std: 'std-14' }), label: 'Diamond = has a standard alternative', help: 'Part of it now exists in the C++ standard library.', option: 'stdAltMarker' }));
  g3.body.appendChild(row({ sampleEl: sample({ badge: { sym: 'sym-buildable', angle: -45 }, std: 'std-14' }), label: 'Can be built separately', help: 'Has a compiled part (a library to link).', option: 'buildableMarker' }));
  g3.body.appendChild(row({ sampleEl: sample({ badge: { sym: 'sym-tool', angle: 45 }, std: 'std-14' }), label: 'Boost tool', help: 'A program for developers, not a library.', option: 'toolMarker' }));
  g3.body.appendChild(row({ sampleEl: sample({ badge: { sym: 'sym-deprecated', angle: -135 }, std: 'std-14' }), label: 'Deprecated', help: 'Kept for compatibility, scheduled for removal.', option: 'deprecatedMarker' }));
  g3.body.appendChild(row({ sampleEl: sample({ badge: { sym: 'sym-proposed', angle: 135 }, std: 'std-14' }), label: 'Proposed for Boost', help: 'Under review, not part of a release yet.', option: 'proposedMarker' }));
  const nameSample = customSample(svg => {
    const t = s('text', { x: SAMPLE_W / 2, y: 14, class: 'label lg-name', 'text-anchor': 'middle' }, svg);
    t.textContent = 'url';
  });
  g3.body.appendChild(row({ sampleEl: nameSample, label: 'Names', help: 'Labels next to the libraries.', option: 'labels' }));
  const bgSample = customSample(svg => {
    s('path', { class: 'edge lg-bgedge', d: 'M2,22 C16,22 30,6 44,6' }, svg);
    s('path', { class: 'edge lg-bgedge', d: 'M2,6 C16,6 30,22 44,22' }, svg);
    s('path', { class: 'edge lg-bgedge', d: 'M2,14 H44' }, svg);
  });
  g3.body.appendChild(row({ sampleEl: bgSample, label: 'Background web', help: 'Faint lines for every dependency between libraries.', option: 'background' }));

  // ---- group: categories ----
  const g4 = group('Categories', 'Untick a category to dim its libraries. Dimmed libraries keep their place.');
  const catNames = new Map();
  const catCount = new Map();
  let uncategorized = 0;
  for (const m of graph.modules.values()) {
    if (!m.categories?.length) uncategorized++;
    for (const c of m.categories || []) {
      const k = c.toLowerCase();
      if (!catNames.has(k)) catNames.set(k, c);
      catCount.set(k, (catCount.get(k) || 0) + 1);
    }
  }
  const catList = [...catNames.entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1));
  const bar = h('div', 'lg-bar');
  const allBtn = h('button', 'lg-mini', 'All');
  const noneBtn = h('button', 'lg-mini', 'None');
  allBtn.type = noneBtn.type = 'button';
  allBtn.addEventListener('click', () => onChange(st => { st.filters.categories = null; }));
  noneBtn.addEventListener('click', () => onChange(st => { st.filters.categories = new Set(); }));
  bar.append(allBtn, noneBtn);
  g4.body.appendChild(bar);
  const catWrap = h('div', 'lg-chips lg-catchips');
  const catChips = new Map();
  const allCatKeys = catList.map(([, name]) => name);
  const addCat = (key, label, n) => {
    const c = h('label', 'lg-chip');
    const input = h('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', `Show ${label} libraries`);
    input.addEventListener('change', () => toggleCat(key, input.checked));
    c.append(input, h('span', 'lg-chip-text', label), h('span', 'lg-chip-n', String(n)));
    catChips.set(key, input);
    catWrap.appendChild(c);
  };
  for (const [k, name] of catList) addCat(name, name, catCount.get(k));
  if (uncategorized) {
    addCat('', 'Uncategorized', uncategorized);
    allCatKeys.push('');
  }
  g4.body.appendChild(catWrap);

  panel.append(g1.d, g2.d, g3.d, g4.d);

  // ---- filters ----
  const catIncluded = (set, key) => !set || [...set].some(c => c.toLowerCase() === key.toLowerCase());
  function toggleStd(key, on) {
    onChange(st => {
      const cur = st.filters.cxxstd;
      const have = expandStd(cur);
      const has = k => !have || have.has(k);
      const next = STDS.map(([k]) => k).filter(k => (k === key ? on : has(k)));
      st.filters.cxxstd = next.length === STDS.length ? null : new Set(next);
    });
  }
  function toggleCat(key, on) {
    onChange(st => {
      const cur = st.filters.categories;
      const next = allCatKeys.filter(k => (k.toLowerCase() === key.toLowerCase() ? on : catIncluded(cur, k)));
      st.filters.categories = next.length === allCatKeys.length ? null : new Set(next);
    });
  }

  // Relations and extra needs depend only on selection and the tests/examples switches, not on filters.
  let relCache = null;
  function relationsFor(sel, o) {
    const key = `${sel}|${o.tests}|${o.examples}`;
    if (relCache?.key !== key) {
      const extras = ['test', 'example'].map(kind => {
        const n = extraNeeds(graph, sel, kind);
        return [kind, { needs: [...n.direct, ...n.transitive], dependants: [...extraDependants(graph, sel, kind)] }];
      });
      relCache = { key, rel: relations(graph, sel, { tests: o.tests, examples: o.examples }), extras };
    }
    return relCache;
  }

  // ---- state -> DOM ----
  function update(state) {
    const o = state.options;
    for (const [opt, input] of switches) input.checked = o[opt];
    const sel = state.selected && graph.modules.has(state.selected) ? state.selected : null;
    hint.hidden = Boolean(sel);
    const selLabel = selRow.querySelector('.lg-label');
    selLabel.textContent = sel ? `Selected: ${graph.modules.get(sel).name || sel}` : 'Selected library';

    const stds = state.filters.cxxstd;
    const expStds = expandStd(stds);
    const cats = state.filters.categories;
    const tally = { dep: 0, tdep: 0, rdep: 0, trdep: 0, category: 0, test: 0, example: 0, testr: 0, exampler: 0 };
    if (sel) {
      const vis = visibleModules(graph, { categories: cats, cxxstd: expStds });
      vis.add(sel);
      const { rel, extras } = relationsFor(sel, o);
      for (const [id, r] of rel) if (r in tally && vis.has(id)) tally[r]++;
      for (const [kind, { needs, dependants }] of extras) {
        tally[kind] = needs.filter(id => vis.has(id)).length;
        tally[`${kind}r`] = dependants.filter(id => vis.has(id)).length;
      }
    }
    const put = (key, n) => { const c = counts.get(key); if (c) c.textContent = sel ? `(${n})` : ''; };
    for (const k of Object.keys(tally)) put(k, tally[k]);

    for (const [k, input] of stdChips) input.checked = !expStds || expStds.has(k);
    for (const [k, input] of catChips) input.checked = catIncluded(cats, k);

    const isDefault = Object.keys(DEFAULT_OPTIONS).every(k => o[k] === DEFAULT_OPTIONS[k]) && !cats && !stds;
    reset.disabled = isDefault;
    root.classList.toggle('modified', !isDefault);
  }

  return { update };
}
