// Wiring: data -> graph -> store -> views.
import { buildGraph, layout, importance } from './graph.js';
import { createStore } from './state.js';
import { createGraphView } from './render.js';
import { createDetails } from './details.js';

const data = window.BOOSTDEP_DATA;
const $ = id => document.getElementById(id);

function setupTheme() {
  const btn = $('theme');
  const root = document.documentElement;
  const paint = () => {
    const dark = root.classList.contains('dark');
    btn.textContent = dark ? '☀' : '☾';
    btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  };
  btn.addEventListener('click', () => {
    root.classList.toggle('dark');
    try { localStorage.setItem('bdg-theme', root.classList.contains('dark') ? 'dark' : 'light'); } catch { /* storage unavailable */ }
    paint();
  });
  paint();
}

function setupStamp() {
  const s = data.stamp;
  $('stamp').textContent = `Boost develop @ ${s.boostCommit}, ${s.boostDate}`;
  $('stamp').title = `Generated ${s.generated}`;
}

function setupSearch(graph, store, select) {
  const input = $('search');
  const list = $('search-results');
  let items = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const paintActive = () => {
    [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
    if (active >= 0) list.children[active].scrollIntoView({ block: 'nearest' });
  };
  const choose = id => {
    select(id);
    input.value = '';
    input.blur();
    close();
  };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      items = [];
      return close();
    }
    const score = id => {
      const m = graph.modules.get(id);
      const n = (m.name || '').toLowerCase();
      if (id === q || n === q) return 0;
      if (id.startsWith(q) || n.startsWith(q)) return 1;
      if (id.includes(q) || n.includes(q)) return 2;
      return 3;
    };
    items = graph.order.filter(id => score(id) < 3).sort((a, b) => score(a) - score(b) || (a < b ? -1 : 1)).slice(0, 12);
    list.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No library matches';
      list.appendChild(li);
    }
    for (const id of items) {
      const m = graph.modules.get(id);
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const n = document.createElement('span');
      n.className = 'r-name';
      n.textContent = m.name || id;
      const d = document.createElement('span');
      d.className = 'r-desc';
      d.textContent = m.description || id;
      li.append(n, d);
      li.addEventListener('pointerdown', e => { e.preventDefault(); choose(id); });
      list.appendChild(li);
    }
    active = items.length ? 0 : -1;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    paintActive();
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paintActive();
    } else if (e.key === 'Enter') {
      if (items[active]) choose(items[active]);
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });
  document.addEventListener('keydown', e => {
    const t = e.target;
    const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      input.focus();
      input.select();
    } else if (e.key === 'Escape' && !typing) {
      if (store.state.selected || store.state.notFound) {
        store.change(s => { s.selected = null; s.notFound = null; }, { push: true });
      }
    }
  });
}

function main() {
  const graph = buildGraph(data);
  const store = createStore(graph.modules);
  setupTheme();
  setupStamp();
  const select = id => store.change(s => { s.selected = id; }, { push: true });
  setupSearch(graph, store, select);

  const view = createGraphView($('graph'), graph, layout(graph), importance(graph));
  view.onSelect = select;

  const details = createDetails($('details'), graph, {
    onSelect: select,
    onClose: () => select(null),
  });

  const notice = $('notice');
  let lastSelected;
  store.subscribe(state => {
    view.update(state);
    details.update(state);
    if (state.notFound) {
      const f = state.filters;
      notice.textContent = `Library not found: "${state.notFound}". ${f.categories || f.cxxstd ? 'Showing the overview.' : 'Showing all libraries.'}`;
      notice.hidden = false;
    } else notice.hidden = true;
    if (state.selected !== lastSelected) {
      if (state.selected) view.focus(state.selected);
      else if (lastSelected !== undefined) view.fit(true);
      lastSelected = state.selected;
    }
  });

  window.bdg = { graph, store, view };
}

main();
