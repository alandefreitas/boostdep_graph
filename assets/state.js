// Single state object and URL-hash (de)serialization.
// cat=- means no category selected (empty set); cat= alone means only uncategorized modules (the '' sentinel).
// Hash format: #<id>&key=0|1 (only options that differ from the default)&cat=IO,Math&std=11,14

/** Every option key with its default. */
export const DEFAULT_OPTIONS = Object.freeze({
  background: true,
  deps: true,
  tdeps: true,
  rdeps: true,
  trdeps: true,
  category: true,
  paths: true,
  colorStd: true,
  sizeImportance: true,
  stdAltMarker: true,
  buildableMarker: true,
  toolMarker: true,
  deprecatedMarker: true,
  proposedMarker: true,
  labels: true,
  tests: false,
  examples: false,
});

export function createState() {
  return {
    selected: null,
    notFound: null,
    options: { ...DEFAULT_OPTIONS },
    filters: { categories: null, cxxstd: null },
  };
}

function splitList(v) {
  return v.split(',').map(s => safeDecode(s)).filter(s => s !== '');
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Parse a location hash into a plain object. Unknown option keys are ignored.
 * @param {string} hash e.g. "#url&tests=1&cat=IO,Math"
 * @returns {{selected: string|null, options: Record<string, boolean>, categories: Set<string>|null, cxxstd: Set<string>|null}}
 */
export function parseHash(hash) {
  const parts = String(hash || '').replace(/^#/, '').split('&').filter(Boolean);
  const res = { selected: null, options: {}, categories: null, cxxstd: null };
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) {
      if (res.selected === null) res.selected = safeDecode(p);
      continue;
    }
    const key = p.slice(0, eq);
    const val = p.slice(eq + 1);
    if (key === 'cat') res.categories = val === '-' ? new Set() : new Set(val.split(',').map(safeDecode));
    else if (key === 'std') res.cxxstd = new Set(splitList(val));
    else if (Object.hasOwn(DEFAULT_OPTIONS, key) && (val === '0' || val === '1')) res.options[key] = val === '1';
  }
  return res;
}

/**
 * Serialize state to a hash string (with leading "#", or "" for the default view).
 */
export function serializeHash(state) {
  const parts = [];
  if (state.selected) parts.push(encodeURIComponent(state.selected));
  for (const [k, def] of Object.entries(DEFAULT_OPTIONS)) {
    if (state.options[k] !== def) parts.push(`${k}=${state.options[k] ? 1 : 0}`);
  }
  const list = s => [...s].map(encodeURIComponent).join(',');
  if (state.filters.categories) parts.push(`cat=${state.filters.categories.size ? list(state.filters.categories) : '-'}`);
  if (state.filters.cxxstd) parts.push(`std=${list(state.filters.cxxstd)}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

/**
 * Apply a parsed hash onto the state. Unknown selection ids set `notFound`.
 * @param {object} state
 * @param {ReturnType<typeof parseHash>} parsed
 * @param {Set<string>|Map<string, unknown>} knownIds
 */
export function applyParsed(state, parsed, knownIds) {
  if (parsed.selected && !knownIds.has(parsed.selected)) {
    state.selected = null;
    state.notFound = parsed.selected;
  } else {
    state.selected = parsed.selected;
    state.notFound = null;
  }
  state.options = { ...DEFAULT_OPTIONS, ...parsed.options };
  state.filters = { categories: parsed.categories, cxxstd: parsed.cxxstd };
}

/**
 * Tiny store keeping state, the URL hash and subscribers in sync.
 * change(fn, {push}) mutates state inside fn, rewrites the hash (pushState when
 * `push`, else replaceState) and notifies subscribers. hashchange re-parses the hash.
 * @param {Set<string>|Map<string, unknown>} knownIds
 */
export function createStore(knownIds) {
  const state = createState();
  const subs = new Set();
  const notify = () => subs.forEach(fn => fn(state));
  let current = '';

  function readHash() {
    applyParsed(state, parseHash(location.hash), knownIds);
    current = location.hash;
  }
  function writeHash(push) {
    const next = serializeHash(state);
    if (next === (current === '#' ? '' : current)) return;
    const url = location.pathname + location.search + next;
    history[push ? 'pushState' : 'replaceState'](null, '', url);
    current = next;
  }

  readHash();
  window.addEventListener('hashchange', () => {
    if (location.hash === current || (location.hash === '' && current === '')) return;
    readHash();
    notify();
  });

  return {
    state,
    subscribe(fn) { subs.add(fn); fn(state); },
    change(fn, { push = false } = {}) {
      const before = state.selected;
      fn(state);
      if (state.selected !== before) state.notFound = null;
      writeHash(push);
      notify();
    },
  };
}
