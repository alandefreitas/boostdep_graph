// Wiring: data -> graph -> store -> views.
import { buildGraph, layout, importance } from './graph.js';
import { createStore, THEMES } from './state.js';
import { FUN } from './fun.js';
import { createGraphView } from './render.js';
import { createDetails } from './details.js';
import { createLegend } from './ui.js';
import { createFocus } from './focus.js';
import { h } from './dom.js';

const data = window.BOOSTDEP_DATA;
const $ = id => document.getElementById(id);

const THEME_KEY = 'bdg-theme';
const PREV_KEY = 'bdg-theme-prev';
const THEME_ITEMS = [
  { name: 'dark', label: 'Dark', glyph: '\u263E' },
  { name: 'light', label: 'Light', glyph: '\u2600' },
  ...Object.entries(FUN).map(([name, f]) => ({ name, label: f.label, glyph: f.glyph })),
];

function readKey(key) {
  try {
    const v = localStorage.getItem(key);
    return THEMES.includes(v) ? v : null;
  } catch { return null; }
}
function writeKey(key, v) {
  try { localStorage.setItem(key, v); } catch { /* storage unavailable */ }
}

/**
 * Theme menu (Dark, Light, one entry per fun mode). The theme in effect is the hash's `theme=` or else the saved choice.
 * A menu choice is saved; it is written to the hash only for a fun mode, or when the hash already carried a theme,
 * so shared links carry the joke while normal links stay clean.
 */
function setupTheme(store) {
  const btn = $('theme');
  const menu = $('theme-menu');
  const root = document.documentElement;
  const bg = $('fun-bg');
  const now = state => state.theme ?? readKey(THEME_KEY) ?? 'dark';
  let lastFun;

  const items = THEME_ITEMS.map(it => {
    const b = h('button', 'theme-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.tabIndex = -1;
    b.append(h('span', 'theme-glyph', it.glyph), h('span', 'theme-label', it.label));
    b.addEventListener('click', () => { choose(it.name); close(true); });
    menu.appendChild(b);
    return { ...it, b };
  });

  // Where "Back to normal" goes: the saved plain theme, else the plain one in effect when the fun mode was picked
  // (which may have come from the link's theme=).
  const prev = () => {
    const s = readKey(THEME_KEY);
    if (s && !FUN[s]) return s;
    const p = readKey(PREV_KEY);
    return p && !FUN[p] ? p : 'dark';
  };

  function choose(name) {
    const cur = now(store.state);
    if (FUN[name] && !FUN[cur]) writeKey(PREV_KEY, cur);
    writeKey(THEME_KEY, name);
    store.change(s => { s.theme = FUN[name] ? name : s.theme && !FUN[s.theme] ? name : null; });
  }

  /** Paint the theme for `state`; returns the fun mode in effect and whether it changed. */
  function apply(state) {
    const name = now(state);
    const fun = FUN[name] ?? null;
    root.classList.toggle('dark', name !== 'light');
    for (const f of Object.values(FUN)) root.classList.toggle(f.className, f === fun);
    const it = items.find(i => i.name === name);
    btn.textContent = it.glyph;
    btn.title = `Theme: ${it.label}`;
    btn.setAttribute('aria-label', `Theme: ${it.label}`);
    for (const i of items) i.b.setAttribute('aria-checked', String(i.name === name));
    const changed = fun !== lastFun;
    if (changed) {
      lastFun = fun;
      bg.replaceChildren();
      fun?.backdrop(bg);
    }
    return { fun, changed };
  }

  const isOpen = () => !menu.hidden;
  function open(focusLast = false) {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const checked = items.find(i => i.b.getAttribute('aria-checked') === 'true') ?? items[0];
    (focusLast ? items[items.length - 1] : checked).b.focus();
  }
  function close(refocus = false) {
    if (!isOpen()) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  }
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open(e.key === 'ArrowUp');
    }
  });
  menu.addEventListener('keydown', e => {
    const at = items.findIndex(i => i.b === document.activeElement);
    const go = i => { e.preventDefault(); items[(i + items.length) % items.length].b.focus(); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close();
  });
  document.addEventListener('pointerdown', e => {
    if (isOpen() && !e.target.closest('.theme-wrap')) close();
  });

  // A fun mode that comes from storage also goes into the link, so a copied URL carries it.
  if (!store.state.theme && FUN[now(store.state)]) store.change(s => { s.theme = now(s); });

  return { apply, choose, leaveFun: () => choose(prev()) };
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
  const theme = setupTheme(store);
  let fun = theme.apply(store.state).fun;
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
  // Aspect of the window, not of the stage: the stage narrows when the details panel docks beside it.
  const isPortrait = () => window.innerHeight > window.innerWidth;
  const effectiveLayout = () => fun?.orientation ?? store.state.layout ?? (isPortrait() ? 'vertical' : 'horizontal');
  let orientation = effectiveLayout();
  const applyOrientation = () => {
    const next = effectiveLayout();
    if (next === orientation) return false;
    if (store.state.layout == null && document.activeElement === $('search')) return false;
    orientation = next;
    view.setLayout(layout(graph, { orientation }), orientation);
    return true;
  };
  const legend = createLegend($('legend'), graph, fn => store.change(fn), {
    onLayout: () => view?.relayout(),
    onClose: () => setDrawer(false),
    onLeaveFun: () => theme.leaveFun(),
  });
  view = createGraphView($('graph'), graph, layout(graph, { orientation }), imp, orientation);
  if (fun) view.setDecor(fun, !stageHidden());
  view.onSelect = id => select(id !== null && id === store.state.selected ? null : id);

  const details = createDetails($('details'), graph, {
    onSelect: select,
    onClose: () => select(null),
    onToggleHidden: () => {
      if (mq.matches) return;
      syncInset();
      if (store.state.selected) view.refocus();
    },
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
    applyOrientation();
    view.update(store.state);
    legend.update(store.state, orientation, fun);
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
  window.addEventListener('resize', () => {
    if (stageVisible && applyOrientation()) syncInset();
    legend.update(store.state, effectiveLayout(), fun);
  });

  const notice = $('notice');
  let lastSelected;
  store.subscribe(state => {
    if (state.selected !== lastSelected) { peek = true; paintSheet(); }
    const themed = theme.apply(state);
    if (themed.changed) {
      fun = themed.fun;
      view.setDecor(fun, false);
    }
    const live = !stageHidden();
    const reoriented = live && applyOrientation();
    if (themed.changed && live && !reoriented) view.setDecor(fun, true, state);
    else if (live && !reoriented) view.update(state);
    details.update(state);
    focusView.update(state);
    syncInset();
    legend.update(state, effectiveLayout(), fun);
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

  // A direct load with a selection computes the grid before the details panel docks: relayout once so the hash gives the same picture as a click.
  if (store.state.selected && orientation === 'vertical' && !stageHidden()) {
    syncInset();
    view.relayout();
  }

  // Debug hook for the browser console and manual checks; the app itself never reads it.
  window.bdg = { graph, store, view };
}

main();
