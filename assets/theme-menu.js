// Theme menu: Dark, Light and one entry per fun mode, with the saved choice and the hash's `theme=`.
import { THEMES } from './state.js';
import { FUN } from './fun.js';
import { h, $ } from './dom.js';

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
 * @param {{state: object, change: (fn: (state: object) => void, opts?: object) => void}} store
 * @returns {{apply: (state: object) => {fun: object|null, changed: boolean}, choose: (name: string) => void, leaveFun: () => void}}
 *   `apply` paints the theme for a state (root classes, button, backdrop) and says which fun mode is in effect and whether it
 *   changed since the last call; `choose` picks a theme by name; `leaveFun` goes back to the plain theme the fun mode replaced.
 */
export function setupTheme(store) {
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
