import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS, createState, parseHash, serializeHash, applyParsed } from '../assets/state.js';

function stateFrom(hash, known = ['url', 'numeric~conversion', 'a b']) {
  const st = createState();
  applyParsed(st, parseHash(hash), new Set(known));
  return st;
}

test('default view serializes to an empty hash', () => {
  assert.equal(serializeHash(createState()), '');
  assert.equal(serializeHash(stateFrom('')), '');
  assert.equal(serializeHash(stateFrom('#')), '');
});

test('selection round-trips, including ~ and percent-encoded ids', () => {
  for (const id of ['url', 'numeric~conversion', 'a b']) {
    const st = stateFrom(`#${encodeURIComponent(id)}`);
    assert.equal(st.selected, id);
    assert.equal(serializeHash(st), `#${encodeURIComponent(id)}`);
  }
  assert.equal(serializeHash(stateFrom('#numeric~conversion')), '#numeric~conversion');
  assert.equal(serializeHash(stateFrom('#a%20b')), '#a%20b');
});

test('only non-default options are written, in DEFAULT_OPTIONS order', () => {
  const st = stateFrom('#url&tests=1&labels=0&examples=1&deps=1');
  assert.equal(st.options.tests, true);
  assert.equal(st.options.labels, false);
  assert.equal(serializeHash(st), '#url&labels=0&tests=1&examples=1');
  assert.equal(serializeHash(stateFrom('#url&tests=0')), '#url');
});

test('invalid option values and unknown keys are ignored', () => {
  assert.equal(serializeHash(stateFrom('#url&tests=2&bogus=1&foo')), '#url');
  assert.deepEqual(parseHash('#url&bogus=1').options, {});
});

test('#constructor=1 and other prototype names are not options', () => {
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const p = parseHash(`#${key}=1`);
    assert.deepEqual(p.options, {});
    assert.equal(p.selected, null);
  }
  const st = stateFrom('#constructor=1');
  assert.equal(st.selected, null);
  assert.deepEqual(st.options, { ...DEFAULT_OPTIONS });
});

test('unknown library sets notFound and keeps the rest of the state', () => {
  const st = stateFrom('#nope&tests=1');
  assert.equal(st.selected, null);
  assert.equal(st.notFound, 'nope');
  assert.equal(st.options.tests, true);
  assert.equal(stateFrom('#url').notFound, null);
});

test('cat= lists categories, cat=- is the empty set, absent is null', () => {
  assert.equal(parseHash('#url').categories, null);
  const some = stateFrom('#&cat=IO,Math');
  assert.deepEqual([...some.filters.categories], ['IO', 'Math']);
  assert.equal(serializeHash(some), '#cat=IO,Math');
  const none = stateFrom('#url&cat=-');
  assert.equal(none.filters.categories.size, 0);
  assert.equal(serializeHash(none), '#url&cat=-');
  const unc = parseHash('#cat=');
  assert.deepEqual([...unc.categories], ['']);
});

test('category names with commas, spaces and percent signs round-trip', () => {
  const st = createState();
  st.filters.categories = new Set(['Math, numerics', '100%', 'Text processing']);
  const hash = serializeHash(st);
  assert.deepEqual([...parseHash(hash).categories], ['Math, numerics', '100%', 'Text processing']);
});

test('std filter: 03 and 98 stay as written, others pass through', () => {
  assert.deepEqual([...parseHash('#std=03,11').cxxstd], ['03', '11']);
  assert.deepEqual([...parseHash('#std=98').cxxstd], ['98']);
  const st = stateFrom('#url&std=03,17');
  assert.equal(serializeHash(st), '#url&std=03,17');
  const only98 = stateFrom('#std=98');
  assert.equal(serializeHash(only98), '#std=98');
  assert.notEqual(serializeHash(only98), serializeHash(stateFrom('#std=03')));
});

test('full round-trip with selection, options and filters', () => {
  const hash = '#url&labels=0&tests=1&cat=IO,Math&std=11,14';
  assert.equal(serializeHash(stateFrom(hash)), hash);
});

test('malformed percent-encoding does not throw', () => {
  assert.equal(parseHash('#%E0%A4%A').selected, '%E0%A4%A');
  assert.deepEqual([...parseHash('#cat=%zz').categories], ['%zz']);
});

test('layout key: explicit values round-trip, absent or unknown means auto', () => {
  assert.equal(createState().layout, null);
  assert.equal(parseHash('#url').layout, null);
  assert.equal(serializeHash(stateFrom('#url&layout=vertical')), '#url&layout=vertical');
  assert.equal(serializeHash(stateFrom('#layout=horizontal')), '#layout=horizontal');
  assert.equal(stateFrom('#url&layout=sideways').layout, null);
  assert.equal(serializeHash(stateFrom('#url&layout=sideways')), '#url');
  const hash = '#url&labels=0&cat=IO&std=11&layout=vertical';
  assert.equal(serializeHash(stateFrom(hash)), hash);
});

test('theme key: valid values round-trip, absent or unknown means the saved theme', () => {
  assert.equal(createState().theme, null);
  assert.equal(parseHash('#url').theme, null);
  for (const t of ['dark', 'light', 'christmas']) assert.equal(serializeHash(stateFrom(`#url&theme=${t}`)), `#url&theme=${t}`);
  assert.equal(serializeHash(stateFrom('#theme=christmas')), '#theme=christmas');
  assert.equal(stateFrom('#url&theme=halloween').theme, null);
  assert.equal(serializeHash(stateFrom('#url&theme=halloween')), '#url');
  const hash = '#url&labels=0&cat=IO&std=11&layout=vertical&theme=christmas';
  assert.equal(serializeHash(stateFrom(hash)), hash);
  assert.equal(serializeHash(stateFrom('#url&tests=1')), '#url&tests=1');
});
