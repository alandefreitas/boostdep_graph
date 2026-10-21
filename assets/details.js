// Details panel for the selected module.
import { relationGroups, visibleModules, dependencyPath, extraNeeds } from './graph.js';
import { h, moduleName, stdClass, stdLabel } from './dom.js';

/**
 * @param {HTMLElement} root the <aside>
 * @param {object} graph from buildGraph()
 * @param {{onSelect: (id: string) => void, onClose: () => void}} handlers
 */
export function createDetails(root, graph, { onSelect, onClose }) {
  let shownKey = '';
  const level = id => graph.modules.get(id).level;
  const name = id => moduleName(graph, id);

  function chipList(ids, sel, hint, withPath) {
    const wrap = h('div', 'chips');
    for (const id of ids) {
      const b = h('button', 'chip', name(id));
      b.type = 'button';
      b.dataset.id = id;
      b.style.setProperty('--chip-std', `var(--${stdClass(graph.modules.get(id).cxxstd)})`);
      b.addEventListener('click', () => onSelect(id));
      if (withPath) {
        const show = () => {
          const p = dependencyPath(graph, sel, id);
          setHint(p ? p.map(name).join(' → ') : '');
        };
        b.addEventListener('mouseenter', show);
        b.addEventListener('focus', show);
        b.addEventListener('mouseleave', () => { setHint(''); });
        b.addEventListener('blur', () => { setHint(''); });
      }
      wrap.appendChild(b);
    }
    return wrap;
  }

  let hint = null;
  const IDLE = "Hover an indirect dependency to see how it's reached";
  const setHint = text => { hint.textContent = text || IDLE; hint.classList.toggle('idle', !text); };
  let vis = null;
  function section(title, all, sel, { pathsOn, from }) {
    const ids = all.filter(id => vis.has(id));
    const hidden = all.length - ids.length;
    if (!all.length) return null;
    const s = h('section', 'sec');
    s.appendChild(h('h3', '', `${title} (${ids.length})`));
    if (ids.length) s.appendChild(chipList(ids, from ?? sel, hint, pathsOn && from !== undefined));
    if (hidden) s.appendChild(h('p', 'muted det-hidden', `+${hidden} hidden by filters`));
    return s;
  }

  function render(sel, state) {
    const o = state.options;
    vis = visibleModules(graph, state.filters);
    vis.add(sel);
    const m = graph.modules.get(sel);
    root.replaceChildren();
    hint = h('div', 'det-foot');
    hint.setAttribute('aria-live', 'polite');
    setHint('');

    const head = h('header', 'det-head');
    const titles = h('div', 'det-titles');
    titles.appendChild(h('h2', '', m.name || sel));
    titles.appendChild(h('code', 'det-id', sel));
    head.appendChild(titles);
    const close = h('button', 'icon-btn det-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close details');
    close.addEventListener('click', onClose);
    head.appendChild(close);
    root.appendChild(head);

    const body = h('div', 'det-body');
    const facts = h('div', 'facts');
    const std = h('span', `pill std ${stdClass(m.cxxstd)}`, stdLabel(m));
    facts.appendChild(std);
    for (const [flag, label] of [['buildable', 'Buildable'], ['tool', 'Tool'], ['proposed', 'Proposed'], ['deprecated', 'Deprecated']]) {
      if (m[flag]) facts.appendChild(h('span', `pill flag-${flag}`, label));
    }
    body.appendChild(facts);

    if (m.description) body.appendChild(h('p', 'desc', m.description));
    if (m.authors?.length) {
      const p = h('p', 'authors');
      p.append('By ', h('span', '', m.authors.join(', ')));
      body.appendChild(p);
    }
    if (m.categories?.length) {
      const c = h('div', 'chips cats');
      for (const cat of m.categories) c.appendChild(h('span', 'pill cat', cat));
      body.appendChild(c);
    }
    if (m.stdAlternatives?.length) {
      const s = h('section', 'sec');
      s.appendChild(h('h3', '', 'Partial alternatives in the C++ standard library'));
      const c = h('div', 'chips');
      for (const a of m.stdAlternatives) c.appendChild(h('code', 'pill alt', a));
      s.appendChild(c);
      body.appendChild(s);
    }

    const groups = relationGroups(graph, sel, { tests: o.tests, examples: o.examples });
    const byLevelDesc = (a, b) => level(b) - level(a) || (a < b ? -1 : 1);
    const byLevelAsc = (a, b) => level(a) - level(b) || (a < b ? -1 : 1);
    const pathsOn = o.paths;

    const secs = [
      section('Direct dependencies', [...groups.dep].sort(byLevelDesc), sel, { pathsOn }),
      section('Indirect dependencies', [...groups.tdep].sort(byLevelDesc), sel, { pathsOn, from: sel }),
      section('Direct dependants', [...groups.rdep].sort(byLevelAsc), sel, { pathsOn }),
      section('Indirect dependants', [...groups.trdep].sort(byLevelAsc), sel, { pathsOn: false }),
    ];
    for (const [kind, on, label] of [['test', o.tests, 'tests'], ['example', o.examples, 'examples']]) {
      if (!on) continue;
      const direct = extraNeeds(graph, sel, kind).direct;
      const needs = groups[`${kind}dep`];
      const indirect = needs.filter(id => !direct.has(id));
      secs.push(
        section(`Also needed by its ${label}`, needs.filter(id => direct.has(id)).sort(byLevelDesc), sel, { pathsOn }),
        section(`Needed indirectly by its ${label}`, indirect.sort(byLevelDesc), sel, { pathsOn }),
        section(`Libraries whose ${label} need it`, [...groups[`${kind}rdep`]].sort(byLevelAsc), sel, { pathsOn: false }),
      );
    }
    for (const s of secs) if (s) body.appendChild(s);
    if (!secs.some(Boolean)) body.appendChild(h('p', 'muted', 'No dependencies and no dependants.'));

    root.appendChild(body);
    if (o.paths && groups.tdep.some(id => vis.has(id))) root.appendChild(hint);
  }

  return {
    update(state) {
      const sel = state.selected && graph.modules.has(state.selected) ? state.selected : null;
      root.hidden = !sel;
      if (!sel) { shownKey = ''; return; }
      const o = state.options;
      const f = state.filters;
      const key = [sel, o.tests, o.examples, o.paths, f.categories ? [...f.categories].join('|') : '*', f.cxxstd ? [...f.cxxstd].join('|') : '*'].join('~');
      if (key === shownKey) return;
      shownKey = key;
      render(sel, state);
    },
  };
}
