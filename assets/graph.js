// Pure graph logic for the Boost Dependency Graph. No DOM, no globals.
// All functions take the graph built by buildGraph(); the graph is treated as immutable.

/** Edge kinds in data.js. */
const KINDS = ['lib', 'test', 'example'];

/** C++ standards, oldest first (two-digit strings, as stored in data.js). */
export const cxxstdOrder = ['98', '03', '11', '14', '17', '20', '23'];

/**
 * Compare two C++ standard strings by age. Unknown values sort last. (Used by tests only.)
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareStd(a, b) {
  const rank = s => {
    const i = cxxstdOrder.indexOf(String(s));
    return i < 0 ? cxxstdOrder.length : i;
  };
  return rank(a) - rank(b);
}

/**
 * Expand a C++ standard filter so 98 and 03 behave as one chip: a set holding
 * either one matches both. null stays null (no filter).
 * @param {Iterable<string>|null} set
 * @returns {Set<string>|null}
 */
export function expandStd(set) {
  if (!set) return null;
  const res = new Set([...set].map(String));
  if (res.has('03')) res.add('98');
  if (res.has('98')) res.add('03');
  return res;
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const caches = new WeakMap();

function edgeSets() {
  return Object.fromEntries(KINDS.map(k => [k, new Set()]));
}

function cacheOf(g) {
  let c = caches.get(g);
  if (!c) {
    c = { deps: new Map(), rdeps: new Map(), rank: null };
    caches.set(g, c);
  }
  return c;
}

/**
 * Build the graph structure from the data.js payload.
 * Every module appears in both `out` and `in`, even without edges.
 * Throws if an edge references an unknown module or kind.
 * Also precomputes `cats` (id -> lowercased category set) and `outSorted` /
 * `inSorted` (id -> sorted lib neighbour ids) for the lookups below.
 * @param {{modules: object[], edges: {from: string, to: string, kind: string}[]}} data
 * @returns {{modules: Map<string, object>, out: Map<string, Record<string, Set<string>>>,
 *            in: Map<string, Record<string, Set<string>>>, order: string[],
 *            cats: Map<string, Set<string>>, outSorted: Map<string, string[]>,
 *            inSorted: Map<string, string[]>}}
 */
export function buildGraph(data) {
  const modules = new Map();
  const out = new Map();
  const inn = new Map();
  const cats = new Map();
  const order = data.modules.map(m => m.id).sort(cmp);
  for (const m of data.modules) {
    modules.set(m.id, m);
    out.set(m.id, edgeSets());
    inn.set(m.id, edgeSets());
    cats.set(m.id, new Set((m.categories || []).map(c => c.toLowerCase())));
  }
  for (const e of data.edges) {
    if (!KINDS.includes(e.kind)) throw new Error(`unknown edge kind: ${e.kind}`);
    if (!modules.has(e.from) || !modules.has(e.to)) {
      throw new Error(`edge references unknown module: ${e.from} -> ${e.to}`);
    }
    out.get(e.from)[e.kind].add(e.to);
    inn.get(e.to)[e.kind].add(e.from);
  }
  const sortedLib = dir => new Map([...dir].map(([id, k]) => [id, [...k.lib].sort(cmp)]));
  return { modules, out, in: inn, order, cats, outSorted: sortedLib(out), inSorted: sortedLib(inn) };
}

function closure(g, start, dir, memo) {
  const hit = memo.get(start);
  if (hit) return hit;
  if (!dir.has(start)) return new Set();
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of dir.get(cur).lib) {
      if (n !== start && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  memo.set(start, seen);
  return seen;
}

/**
 * Transitive dependencies of `id` over `lib` edges, excluding `id`. Cycle-safe.
 * @returns {Set<string>} a fresh set
 */
export function depsClosure(g, id) {
  return new Set(closure(g, id, g.out, cacheOf(g).deps));
}

/**
 * Transitive dependants of `id` over `lib` edges, excluding `id`. Cycle-safe.
 * @returns {Set<string>} a fresh set
 */
export function dependantsClosure(g, id) {
  return new Set(closure(g, id, g.in, cacheOf(g).rdeps));
}

/**
 * What `id` additionally needs when `kind` ('test' | 'example') edges are on.
 * direct: targets of id's own `kind` edges not already lib dependencies.
 * transitive: lib closure of those targets, minus lib deps, direct and id.
 * Never follows other modules' test/example edges.
 * @returns {{direct: Set<string>, transitive: Set<string>}}
 */
export function extraNeeds(g, id, kind) {
  const base = closure(g, id, g.out, cacheOf(g).deps);
  const direct = new Set();
  for (const t of g.out.get(id)[kind]) {
    if (t !== id && !base.has(t)) direct.add(t);
  }
  const transitive = new Set();
  for (const t of direct) {
    for (const n of closure(g, t, g.out, cacheOf(g).deps)) {
      if (n !== id && !base.has(n) && !direct.has(n)) transitive.add(n);
    }
  }
  return { direct, transitive };
}

/**
 * Modules M (not id) whose `kind` needs include `id` and that do not already
 * depend on `id` through lib edges.
 * @returns {Set<string>}
 */
export function extraDependants(g, id, kind) {
  const rdeps = closure(g, id, g.in, cacheOf(g).rdeps);
  const targets = new Set(rdeps);
  targets.add(id);
  const result = new Set();
  for (const m of g.order) {
    if (m === id || rdeps.has(m)) continue;
    for (const t of g.out.get(m)[kind]) {
      if (targets.has(t)) {
        result.add(m);
        break;
      }
    }
  }
  return result;
}

/**
 * Relation of every module to `selected`, computed once. Priority: self, dep,
 * tdep, rdep, trdep, test/example (only when enabled; direct and transitive
 * needs both map to testdep/exampledep), then same category. Needs (test, example) before dependants (test, example).
 * @param {object} g
 * @param {string} selected
 * @param {{tests?: boolean, examples?: boolean}} [opts]
 * @returns {Map<string, string|null>}
 */
export function relations(g, selected, opts) {
  const { tests = false, examples = false } = opts ?? {};
  const res = new Map();
  for (const id of g.order) res.set(id, null);
  if (!g.modules.has(selected)) return res;

  const setAll = (ids, rel) => {
    for (const id of ids) if (res.get(id) === null) res.set(id, rel);
  };
  res.set(selected, 'self');
  setAll(g.out.get(selected).lib, 'dep');
  setAll(closure(g, selected, g.out, cacheOf(g).deps), 'tdep');
  setAll(g.in.get(selected).lib, 'rdep');
  setAll(closure(g, selected, g.in, cacheOf(g).rdeps), 'trdep');
  const enabled = [['test', tests], ['example', examples]].filter(([, on]) => on).map(([k]) => k);
  for (const kind of enabled) {
    const n = extraNeeds(g, selected, kind);
    setAll(n.direct, `${kind}dep`);
    setAll(n.transitive, `${kind}dep`);
  }
  for (const kind of enabled) setAll(extraDependants(g, selected, kind), `${kind}rdep`);

  const cats = g.cats.get(selected);
  if (cats.size) {
    for (const id of g.order) {
      if (res.get(id) === null && [...g.cats.get(id)].some(c => cats.has(c))) res.set(id, 'category');
    }
  }
  return res;
}

const RELATION_KEYS = ['dep', 'tdep', 'rdep', 'trdep', 'testdep', 'exampledep', 'testrdep', 'examplerdep', 'category'];

function ranked(g, selected, opts) {
  const c = cacheOf(g);
  const key = `${selected}|${opts?.tests ? 1 : 0}|${opts?.examples ? 1 : 0}`;
  if (!c.rank || c.rank.key !== key) {
    const map = relations(g, selected, opts);
    const groups = Object.fromEntries(RELATION_KEYS.map(k => [k, []]));
    for (const id of g.order) {
      const r = map.get(id);
      if (r && r in groups) groups[r].push(id);
    }
    for (const k of RELATION_KEYS) Object.freeze(groups[k]);
    c.rank = { key, map, groups: Object.freeze(groups), needs: {} };
  }
  return c.rank;
}

/**
 * relations() through the one-entry cache shared by relation(), relationMap()
 * and relationGroups(): repeated calls for the same selection and options are
 * cheap. Treat the map as read-only.
 * @returns {Map<string, string|null>}
 */
export function relationMap(g, selected, opts) {
  return ranked(g, selected, opts).map;
}

/**
 * Relation of `id` to `selected` (see relations()). Single lookup, used by tests only.
 * @returns {string|null}
 */
export function relation(g, selected, id, opts) {
  const map = relationMap(g, selected, opts);
  return map.has(id) ? map.get(id) : null;
}

/**
 * The needs of the `kind` ('test' | 'example') edges of `selected`, as ranked by
 * relationGroups(): `direct` = targets of its own `kind` edges, `indirect` = the
 * rest of its testdep/exampledep group. Arrays are in id order, frozen and cached.
 * Empty unless the matching option is on in `opts`.
 * @returns {{direct: readonly string[], indirect: readonly string[]}}
 */
export function needGroups(g, selected, kind, opts) {
  const rank = ranked(g, selected, opts);
  let res = rank.needs[kind];
  if (!res) {
    const direct = extraNeeds(g, selected, kind).direct;
    const all = rank.groups[`${kind}dep`];
    res = Object.freeze({
      direct: Object.freeze(all.filter(id => direct.has(id))),
      indirect: Object.freeze(all.filter(id => !direct.has(id))),
    });
    rank.needs[kind] = res;
  }
  return res;
}

/**
 * The single source of truth for "which libraries stand in which relation to
 * the selection": relations() grouped by relation, so every view shows the same
 * membership. Keys: dep, tdep, rdep, trdep, testdep, exampledep, testrdep,
 * examplerdep, category (each module appears in at most one; 'self' is omitted).
 * Arrays hold module ids in id order, are frozen and cached, so treat them as
 * read-only. testdep/exampledep include direct and transitive needs; views that
 * split them use extraNeeds(...).direct.
 * @param {object} g
 * @param {string} selected
 * @param {{tests?: boolean, examples?: boolean}} [opts]
 * @returns {Record<string, readonly string[]>}
 */
export function relationGroups(g, selected, opts) {
  return ranked(g, selected, opts).groups;
}

/** Relation to the selection -> the option that switches it on (used by the graph, the lists, the legend and viewSet). */
export const REL_OPTION = {
  dep: 'deps', tdep: 'tdeps', rdep: 'rdeps', trdep: 'trdeps', category: 'category',
  testdep: 'tests', testrdep: 'tests', exampledep: 'examples', examplerdep: 'examples',
};

const VIEW_RELS = {
  deps: ['dep', 'tdep', 'testdep', 'exampledep'],
  dependants: ['rdep', 'trdep', 'testrdep', 'examplerdep'],
};

/**
 * Ids framed by a view button for `id`, selection first.
 * 'around': direct library dependencies and dependants. 'deps' / 'dependants': every highlighted dependency (or dependant)
 * relation whose option is on in `options`, indirect ones and test/example extras included.
 * `visible` (a Set, e.g. from visibleModules) drops filtered-out modules; the selection is always kept. Omit it for no filtering.
 * @param {object} g
 * @param {string} id
 * @param {'around'|'deps'|'dependants'} mode
 * @param {{deps?: boolean, tdeps?: boolean, rdeps?: boolean, trdeps?: boolean, tests?: boolean, examples?: boolean}} options
 * @param {Set<string>|null} [visible]
 * @returns {string[]}
 */
export function viewSet(g, id, mode, options, visible = null) {
  if (!g.modules.has(id)) return [];
  const keep = n => !visible || visible.has(n);
  const ids = [id];
  if (mode === 'around') {
    return [...new Set([id, ...g.out.get(id).lib, ...g.in.get(id).lib].filter(n => n === id || keep(n)))];
  }
  const groups = relationGroups(g, id, { tests: Boolean(options.tests), examples: Boolean(options.examples) });
  for (const rel of VIEW_RELS[mode]) {
    if (!options[REL_OPTION[rel]]) continue;
    for (const n of groups[rel]) if (keep(n)) ids.push(n);
  }
  return ids;
}

function bfsPath(g, from, to, sorted) {
  if (!g.modules.has(from) || !g.modules.has(to)) return null;
  if (from === to) return [from];
  const prev = new Map([[from, null]]);
  let frontier = [from];
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      for (const n of sorted.get(cur)) {
        if (prev.has(n)) continue;
        prev.set(n, cur);
        if (n === to) {
          const path = [];
          for (let p = to; p !== null; p = prev.get(p)) path.push(p);
          return path.reverse();
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Shortest lib-dependency path from `from` to `to` (each element depends on the
 * next), both ends included, or null. Ties broken by id order.
 * @returns {string[]|null}
 */
export function dependencyPath(g, from, to) {
  return bfsPath(g, from, to, g.outSorted);
}

/**
 * Shortest lib path following dependants: result[0] = from, last = to, and each
 * element is depended on by the next. Equals dependencyPath(g, to, from) reversed
 * in meaning, but with its own deterministic tie-break.
 * Used by tests only.
 * @returns {string[]|null}
 */
export function dependantPath(g, from, to) {
  return bfsPath(g, from, to, g.inSorted);
}

/**
 * Ids passing the filters. null = no filter. A module with no categories passes
 * the categories filter only when it is null or contains the sentinel ''.
 * Category comparison is case-insensitive; the standards 98 and 03 are one chip
 * (see expandStd).
 * @param {object} g
 * @param {{categories?: Iterable<string>|null, cxxstd?: Iterable<string>|null}} [filters]
 * @returns {Set<string>}
 */
export function visibleModules(g, { categories = null, cxxstd = null } = {}) {
  const cats = categories ? new Set([...categories].map(c => c.toLowerCase())) : null;
  const stds = expandStd(cxxstd);
  const res = new Set();
  for (const id of g.order) {
    const m = g.modules.get(id);
    if (stds && !stds.has(String(m.cxxstd))) continue;
    if (cats) {
      const mine = g.cats.get(id);
      const ok = mine.size ? [...mine].some(c => cats.has(c)) : cats.has('');
      if (!ok) continue;
    }
    res.add(id);
  }
  return res;
}

/**
 * Fixed layout. Rows are centered per level as 1 + maxLevelSize - levelSize / 2 + i (ids sorted).
 * 'horizontal' (default): x = module.level, y = row. 'vertical': x = row, y = maxLevel - level, so
 * level 0 is at the bottom and the top level at the top.
 * @param {object} g from buildGraph()
 * @param {{orientation?: 'horizontal'|'vertical'}} [opts]
 * @returns {Map<string, {x: number, y: number}>}
 */
export function layout(g, { orientation = 'horizontal' } = {}) {
  const levels = new Map();
  let maxLevel = 0;
  for (const id of g.order) {
    const l = g.modules.get(id).level;
    maxLevel = Math.max(maxLevel, l);
    if (!levels.has(l)) levels.set(l, []);
    levels.get(l).push(id);
  }
  let maxSize = 0;
  for (const ids of levels.values()) maxSize = Math.max(maxSize, ids.length);
  const vertical = orientation === 'vertical';
  const pos = new Map();
  for (const [l, ids] of levels) {
    const top = 1 + maxSize - ids.length / 2;
    ids.forEach((id, i) => pos.set(id, vertical ? { x: top + i, y: maxLevel - l } : { x: l, y: top + i }));
  }
  return pos;
}

/**
 * Importance per module: number of transitive lib dependants (drives node size).
 * @returns {Map<string, number>}
 */
export function importance(g) {
  const res = new Map();
  for (const id of g.order) res.set(id, closure(g, id, g.in, cacheOf(g).rdeps).size);
  return res;
}

/**
 * Largest value of an importance() map (0 when empty).
 * @param {Map<string, number>} imp
 * @returns {number}
 */
export function maxImportance(imp) {
  let m = 0;
  for (const v of imp.values()) if (v > m) m = v;
  return m;
}
