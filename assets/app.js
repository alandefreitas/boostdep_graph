// Wiring: data -> graph -> store -> views.
import { buildGraph, layout, importance } from './graph.js';
import { createStore } from './state.js';
import { createGraphView } from './render.js';
import { createDetails } from './details.js';
import { createLegend } from './ui.js';
import { createFocus } from './focus.js';
import { h } from './dom.js';

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
  const text = `Boost develop @ ${s.boostCommit}, ${s.boostDate}`;
  for (const id of ['stamp', 'foot']) {
    $(id).textContent = text;
    $(id).title = `Generated ${s.generated}`;
  }
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
    if (!items.length) list.appendChild(h('li', 'empty', 'No library matches'));
    for (const id of items) {
      const m = graph.modules.get(id);
      const li = h('li');
      li.setAttribute('role', 'option');
      li.append(h('span', 'r-name', m.name || id), h('span', 'r-desc', m.description || id));
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
    const typing = t instanceof HTMLElement && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && !/^(checkbox|radio|button)$/.test(t.type)));
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

  const mq = window.matchMedia('(max-width:767px)');
  let mobileView = 'focus';
  let peek = true;
  let peekH = 86;
  const stageHidden = () => mq.matches && mobileView === 'focus';

  let view = null;
  const imp = importance(graph);
  const legend = createLegend($('legend'), graph, fn => store.change(fn), {
    onLayout: () => view?.relayout(),
    onClose: () => setDrawer(false),
  });
  view = createGraphView($('graph'), graph, layout(graph), imp);
  view.onSelect = select;

  const details = createDetails($('details'), graph, {
    onSelect: select,
    onClose: () => select(null),
  });

  const sheet = $('details');
  const paintSheet = () => sheet.classList.toggle('peek', peek);
  const focusView = createFocus($('focus'), graph, imp, {
    onSelect: select,
    onOpenDetails: () => { peek = false; paintSheet(); syncInset(); },
  });

  const syncInset = () => {
    const d = $('details');
    if (mq.matches) {
      if (!d.hidden && d.classList.contains('peek') && d.offsetHeight) peekH = d.offsetHeight + 16;
      const h = d.hidden ? 0 : peekH;
      document.body.style.setProperty('--sheet-h', `${h}px`);
      document.body.classList.toggle('sheet-on', h > 0);
      if (!stageHidden()) view.setInset({ right: 0, bottom: h });
      return;
    }
    document.body.style.removeProperty('--sheet-h');
    document.body.classList.remove('sheet-on');
    const overlay = getComputedStyle(d).position === 'absolute' && !d.hidden;
    view.setInset(overlay ? d.offsetWidth + 24 : 0);
  };
  window.matchMedia('(max-width:1279px)').addEventListener('change', syncInset);
  new ResizeObserver(syncInset).observe($('details'));

  // Bottom sheet: tap or drag the header to expand or collapse it.
  let drag = null;
  sheet.addEventListener('pointerdown', e => {
    if (!mq.matches || drag || e.target.closest('.det-close') || !e.target.closest('.det-head')) return;
    drag = { y: e.clientY, id: e.pointerId };
    try { e.target.closest('.det-head').setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  });
  sheet.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    drag = null;
    peek = dy < -24 ? false : dy > 24 ? true : !peek;
    paintSheet();
    syncInset();
  });
  sheet.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) drag = null; });
  sheet.addEventListener('lostpointercapture', e => { if (drag && e.pointerId === drag.id) drag = null; });

  // Searching on a phone: fold the sheet away so the results are not covered.
  $('search').addEventListener('focus', () => {
    if (!mq.matches || peek) return;
    peek = true;
    paintSheet();
    syncInset();
  });

  // Legend drawer and the full-graph switch (phones only; CSS hides these controls elsewhere).
  const BEHIND_DRAWER = ['topbar', 'mbar', 'focus', 'stage', 'details', 'foot'];
  const setDrawer = open => {
    const was = document.body.classList.contains('drawer-open');
    document.body.classList.toggle('drawer-open', open);
    $('m-legend').setAttribute('aria-expanded', String(open));
    for (const id of BEHIND_DRAWER) {
      $(id).inert = open;
    }
    if (open) $('legend').querySelector('.lg-close')?.focus({ preventScroll: true });
    else if (was) $('m-legend').focus({ preventScroll: true });
  };
  $('m-legend').addEventListener('click', () => setDrawer(true));
  $('scrim').addEventListener('click', () => setDrawer(false));
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) {
      e.stopImmediatePropagation();
      setDrawer(false);
    }
  }, true);

  const stage = $('stage');
  let stageVisible = stage.offsetWidth > 1 && stage.offsetHeight > 1;
  const showStage = () => {
    stageVisible = true;
    view.update(store.state);
    syncInset();
    view.relayout();
    if (!store.state.selected) view.fit();
  };
  const setMobileView = v => {
    mobileView = v;
    document.body.classList.toggle('m-graph', v === 'graph');
    $('m-view').textContent = v === 'graph' ? 'Back to focus' : 'Full graph';
    if (v === 'graph' && mq.matches) showStage();
    else if (stageHidden()) stageVisible = false;
  };
  $('m-view').addEventListener('click', () => setMobileView(mobileView === 'graph' ? 'focus' : 'graph'));
  mq.addEventListener('change', () => {
    if (!mq.matches) setDrawer(false);
    if (!stageHidden()) showStage();
    else stageVisible = false;
    syncInset();
  });
  // Safety net when the media-query event is missed: relayout as soon as the stage becomes visible again.
  new ResizeObserver(() => {
    const vis = stage.offsetWidth > 1 && stage.offsetHeight > 1;
    if (vis && !stageVisible) showStage();
    else if (!vis) stageVisible = false;
  }).observe(stage);

  const notice = $('notice');
  let lastSelected;
  store.subscribe(state => {
    if (state.selected !== lastSelected) { peek = true; paintSheet(); }
    if (!stageHidden()) view.update(state);
    details.update(state);
    focusView.update(state);
    syncInset();
    legend.update(state);
    $('m-legend').classList.toggle('modified', legend.isModified());
    if (state.notFound) {
      const f = state.filters;
      notice.textContent = `Library not found: "${state.notFound}". ${f.categories || f.cxxstd ? 'Showing the overview.' : 'Showing all libraries.'}`;
      notice.hidden = false;
    } else notice.hidden = true;
    if (state.selected !== lastSelected) {
      if (!stageHidden()) {
        if (state.selected) view.focus(state.selected);
        else if (lastSelected !== undefined) view.fit(true);
      }
      lastSelected = state.selected;
    }
  });

  // Debug hook for the browser console and manual checks; the app itself never reads it.
  window.bdg = { graph, store, view };
}

main();
