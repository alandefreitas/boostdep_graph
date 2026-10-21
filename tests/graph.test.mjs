import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraph, depsClosure, dependantsClosure, extraNeeds, extraDependants, relation, relations,
  dependencyPath, dependantPath, visibleModules, layout, importance, maxImportance,
  cxxstdOrder, compareStd, relationGroups, expandStd, viewSet,
} from '../assets/graph.js';
import { data, cyclic } from './fixtures/graph.mjs';

const g = buildGraph(data);
const sorted = s => [...s].sort();

test('buildGraph: every module in both maps, order sorted', () => {
  assert.equal(g.modules.size, 9);
  for (const id of g.order) {
    assert.ok(g.out.has(id) && g.in.has(id));
  }
  assert.deepEqual(g.order, [...g.order].sort());
  assert.equal(g.out.get('loner').lib.size, 0);
  assert.deepEqual(sorted(g.out.get('core').test), ['testtool']);
  assert.deepEqual(sorted(g.in.get('base').lib), ['core', 'leaf', 'util']);
});

test('buildGraph: rejects unknown modules and kinds', () => {
  assert.throws(() => buildGraph({ modules: data.modules, edges: [{ from: 'x', to: 'base', kind: 'lib' }] }));
  assert.throws(() => buildGraph({ modules: data.modules, edges: [{ from: 'core', to: 'base', kind: 'foo' }] }));
});

test('closures over lib edges only', () => {
  assert.deepEqual(sorted(depsClosure(g, 'app')), ['base', 'core', 'mid']);
  assert.deepEqual(sorted(dependantsClosure(g, 'base')), ['app', 'core', 'extra', 'leaf', 'mid', 'testtool', 'util']);
  assert.deepEqual(sorted(depsClosure(g, 'loner')), []);
  assert.equal(depsClosure(g, 'core').has('testtool'), false);
});

test('closures are cycle-safe and exclude the module itself', () => {
  const c = buildGraph(cyclic);
  assert.deepEqual(sorted(depsClosure(c, 'base')), ['core', 'mid']);
  assert.ok(!depsClosure(c, 'core').has('core'));
  assert.ok(depsClosure(c, 'core').has('mid'));
  assert.ok(!dependantsClosure(c, 'mid').has('mid'));
});

test('closures return fresh sets', () => {
  const a = depsClosure(g, 'app');
  a.add('zzz');
  assert.ok(!depsClosure(g, 'app').has('zzz'));
});

test('extraNeeds: direct and transitive, test edge forming a cycle', () => {
  const n = extraNeeds(g, 'core', 'test');
  assert.deepEqual(sorted(n.direct), ['testtool']);
  assert.deepEqual(sorted(n.transitive), ['app', 'mid']);
  assert.ok(!n.transitive.has('core') && !n.transitive.has('base'));
});

test('extraNeeds: skips existing lib deps and never follows others\' test edges', () => {
  const t = extraNeeds(g, 'leaf', 'test');
  assert.deepEqual(sorted(t.direct), ['util']);
  assert.deepEqual(sorted(t.transitive), []);
  const b = extraNeeds(g, 'base', 'test');
  assert.deepEqual(sorted(b.direct), ['core']);
  assert.deepEqual(sorted(b.transitive), []);
  assert.ok(!b.transitive.has('testtool'));
});

test('extraNeeds: examples', () => {
  const n = extraNeeds(g, 'core', 'example');
  assert.deepEqual(sorted(n.direct), ['extra']);
  assert.deepEqual(sorted(n.transitive), ['util']);
  assert.deepEqual(sorted(extraNeeds(g, 'mid', 'example').direct), []);
});

test('extraDependants', () => {
  assert.deepEqual(sorted(extraDependants(g, 'testtool', 'test')), ['core']);
  assert.deepEqual(sorted(extraDependants(g, 'app', 'test')), ['core']);
  assert.deepEqual(sorted(extraDependants(g, 'util', 'test')), ['leaf']);
  assert.deepEqual(sorted(extraDependants(g, 'extra', 'example')), ['core']);
  assert.deepEqual(sorted(extraDependants(g, 'util', 'example')), ['core']);
  assert.deepEqual(sorted(extraDependants(g, 'mid', 'test')), ['core']);
});

test('relations: lib only', () => {
  const r = relations(g, 'mid');
  assert.equal(r.get('mid'), 'self');
  assert.equal(r.get('core'), 'dep');
  assert.equal(r.get('base'), 'tdep');
  assert.equal(r.get('app'), 'rdep');
  assert.equal(r.get('testtool'), 'trdep');
  assert.equal(r.get('loner'), null);
  assert.equal(r.get('leaf'), null);
  assert.equal(r.size, 9);
});

test('relations: test and example switches', () => {
  assert.equal(relations(g, 'leaf').get('util'), null);
  assert.equal(relations(g, 'leaf', { tests: true }).get('util'), 'testdep');
  assert.equal(relations(g, 'util', { tests: true }).get('leaf'), 'testrdep');
  assert.equal(relations(g, 'util', { tests: false }).get('leaf'), null);
  assert.equal(relations(g, 'core').get('extra'), null);
  const on = relations(g, 'core', { tests: true, examples: true });
  assert.equal(on.get('extra'), 'exampledep');
  assert.equal(on.get('util'), 'exampledep');
  assert.equal(on.get('testtool'), 'trdep');
  assert.equal(relations(g, 'extra', { examples: true }).get('core'), 'examplerdep');
  assert.equal(relations(g, 'extra', { examples: false }).get('core'), null);
  assert.equal(relations(g, 'core', { tests: true }).get('extra'), null);
});

test('relations: priority and categories case-insensitive', () => {
  const r = relations(g, 'base');
  assert.equal(r.get('core'), 'rdep');
  assert.equal(r.get('util'), 'rdep');
  assert.equal(r.get('mid'), 'trdep');
  const c = relations(g, 'core');
  assert.equal(c.get('base'), 'dep');
  assert.equal(c.get('mid'), 'rdep');
  assert.equal(c.get('leaf'), null);
  const u = relations(g, 'util');
  assert.equal(u.get('base'), 'dep');
  assert.equal(u.get('core'), 'category');
  assert.equal(u.get('extra'), 'rdep');
});

test('relations: no categories, unknown selection', () => {
  const r = relations(g, 'loner');
  assert.equal(r.get('loner'), 'self');
  for (const id of g.order) if (id !== 'loner') assert.equal(r.get(id), null);
  const u = relations(g, 'nope');
  assert.ok([...u.values()].every(v => v === null));
});

test('relation matches relations and handles option changes', () => {
  for (const opts of [{}, { tests: true }, { examples: true }, { tests: true, examples: true }]) {
    const all = relations(g, 'core', opts);
    for (const id of g.order) assert.equal(relation(g, 'core', id, opts), all.get(id));
  }
  assert.equal(relation(g, 'leaf', 'util'), null);
  assert.equal(relation(g, 'leaf', 'util', { tests: true }), 'testdep');
  assert.equal(relation(g, 'core', 'missing'), null);
});

test('extraNeeds and extraDependants on a lib cycle', () => {
  const c = buildGraph(cyclic);
  const n = extraNeeds(c, 'core', 'test');
  assert.deepEqual(sorted(n.direct), ['testtool']);
  assert.deepEqual(sorted(n.transitive), ['app']);
  assert.deepEqual(sorted(extraDependants(c, 'testtool', 'test')), ['core']);
  assert.deepEqual(sorted(extraDependants(c, 'core', 'test')), []);
});

test('closures and relations tolerate unknown ids and null opts', () => {
  assert.deepEqual(sorted(depsClosure(g, 'nope')), []);
  assert.deepEqual(sorted(dependantsClosure(g, 'nope')), []);
  assert.equal(relation(g, 'core', 'base', null), 'dep');
  assert.equal(relations(g, 'core', null).get('base'), 'dep');
});

test('relations are cycle-safe', () => {
  const c = buildGraph(cyclic);
  const r = relations(c, 'core', { tests: true, examples: true });
  assert.equal(r.get('core'), 'self');
  assert.equal(r.get('base'), 'dep');
  assert.equal(r.get('mid'), 'tdep');
  assert.equal(r.get('app'), 'trdep');
});

test('dependencyPath and dependantPath', () => {
  assert.deepEqual(dependencyPath(g, 'app', 'base'), ['app', 'mid', 'core', 'base']);
  assert.deepEqual(dependencyPath(g, 'app', 'app'), ['app']);
  assert.equal(dependencyPath(g, 'base', 'app'), null);
  assert.equal(dependencyPath(g, 'app', 'loner'), null);
  assert.equal(dependencyPath(g, 'app', 'nope'), null);
  assert.deepEqual(dependantPath(g, 'base', 'app'), ['base', 'core', 'mid', 'app']);
  assert.equal(dependantPath(g, 'app', 'base'), null);
});

test('paths: shortest and deterministic tie-break, cycle-safe', () => {
  const diamond = {
    modules: ['a', 'b', 'c', 'd'].map(id => ({ id, level: 0, cxxstd: '11', categories: [] })),
    edges: [
      { from: 'a', to: 'c', kind: 'lib' }, { from: 'a', to: 'b', kind: 'lib' },
      { from: 'b', to: 'd', kind: 'lib' }, { from: 'c', to: 'd', kind: 'lib' },
    ],
  };
  const d = buildGraph(diamond);
  assert.deepEqual(dependencyPath(d, 'a', 'd'), ['a', 'b', 'd']);
  assert.deepEqual(dependantPath(d, 'd', 'a'), ['d', 'b', 'a']);
  const c = buildGraph(cyclic);
  assert.equal(dependencyPath(c, 'base', 'core').join('>'), 'base>mid>core');
});

test('visibleModules', () => {
  assert.equal(visibleModules(g).size, 9);
  assert.deepEqual(sorted(visibleModules(g, { categories: ['core'] })), ['base', 'core', 'util']);
  assert.deepEqual(sorted(visibleModules(g, { categories: ['CORE', ''] })), ['base', 'core', 'loner', 'util']);
  assert.deepEqual(sorted(visibleModules(g, { categories: [] })), []);
  assert.deepEqual(sorted(visibleModules(g, { cxxstd: ['11'] })), ['core', 'leaf', 'loner']);
  assert.deepEqual(sorted(visibleModules(g, { categories: ['Core'], cxxstd: ['98', '03'] })), ['base', 'util']);
  assert.ok(!visibleModules(g, { categories: ['Core'] }).has('loner'));
});

test('layout: x = level, rows sorted by id and centered', () => {
  const p = layout(g);
  assert.equal(p.size, 9);
  assert.equal(p.get('app').x, 3);
  assert.deepEqual(p.get('base'), { x: 0, y: 1 + 3 - 1 });
  assert.deepEqual(p.get('loner'), { x: 0, y: 1 + 3 - 1 + 1 });
  assert.deepEqual(p.get('core'), { x: 1, y: 1 + 3 - 1.5 });
  assert.deepEqual(p.get('leaf'), { x: 1, y: 1 + 3 - 1.5 + 1 });
  assert.deepEqual(p.get('util'), { x: 1, y: 1 + 3 - 1.5 + 2 });
});

test('layout: deterministic and independent of input order', () => {
  const shuffled = buildGraph({ ...data, modules: [...data.modules].reverse() });
  assert.deepEqual([...layout(shuffled)].sort(), [...layout(g)].sort());
});

test('layout: vertical puts level 0 at the bottom and the top level at y = 0', () => {
  const p = layout(g, { orientation: 'vertical' });
  assert.equal(p.size, 9);
  const top = Math.max(...[...g.modules.values()].map(m => m.level));
  assert.equal(Math.min(...[...p.values()].map(q => q.y)), 0);
  assert.equal(p.get('base').y, top);
  assert.equal(p.get('loner').y, top);
  assert.equal(p.get('core').y, top - 1);
  assert.equal(p.get('app').y, top - 3);
  const row = ids => ids.map(id => p.get(id).x);
  assert.deepEqual(row(['base', 'loner']), [1 + 3 - 1, 1 + 3 - 1 + 1]);
  assert.deepEqual(row(['core', 'leaf', 'util']), [1 + 3 - 1.5, 1 + 3 - 1.5 + 1, 1 + 3 - 1.5 + 2]);
});

test('layout: vertical is the horizontal grid transposed and flipped, and deterministic', () => {
  const h = layout(g);
  const v = layout(g, { orientation: 'vertical' });
  const maxLevel = Math.max(...[...h.values()].map(q => q.x));
  for (const [id, q] of h) assert.deepEqual(v.get(id), { x: q.y, y: maxLevel - q.x });
  const shuffled = buildGraph({ ...data, modules: [...data.modules].reverse() });
  assert.deepEqual([...layout(shuffled, { orientation: 'vertical' })].sort(), [...v].sort());
  assert.deepEqual(layout(g, { orientation: 'horizontal' }), h);
});

test('importance and maxImportance', () => {
  const imp = importance(g);
  assert.equal(imp.get('base'), 7);
  assert.equal(imp.get('core'), 3);
  assert.equal(imp.get('loner'), 0);
  assert.equal(maxImportance(imp), 7);
  assert.equal(maxImportance(new Map()), 0);
  assert.equal(importance(buildGraph(cyclic)).get('base'), 7);
});

test('cxxstdOrder and compareStd', () => {
  assert.deepEqual(cxxstdOrder, ['98', '03', '11', '14', '17', '20', '23']);
  assert.ok(compareStd('98', '03') < 0);
  assert.ok(compareStd('23', '17') > 0);
  assert.equal(compareStd('11', '11'), 0);
  assert.ok(compareStd('xx', '23') > 0);
  assert.deepEqual(['20', '98', '11'].sort(compareStd), ['98', '11', '20']);
});

test('relationGroups: lib only, ids in id order, no self', () => {
  const gr = relationGroups(g, 'mid');
  assert.deepEqual(gr.dep, ['core']);
  assert.deepEqual(gr.tdep, ['base']);
  assert.deepEqual(gr.rdep, ['app']);
  assert.deepEqual(gr.trdep, ['testtool']);
  assert.deepEqual(gr.category, []);
  for (const k of ['testdep', 'exampledep', 'testrdep', 'examplerdep']) assert.deepEqual(gr[k], []);
  assert.ok(Object.values(gr).every(a => !a.includes('mid')));
});

test('relationGroups: membership equals relations(), one group per module', () => {
  for (const opts of [{}, { tests: true }, { examples: true }, { tests: true, examples: true }]) {
    for (const sel of g.order) {
      const map = relations(g, sel, opts);
      const gr = relationGroups(g, sel, opts);
      const seen = new Map();
      for (const [k, ids] of Object.entries(gr)) {
        assert.deepEqual([...ids], [...ids].sort(), `${k} sorted`);
        for (const id of ids) {
          assert.ok(!seen.has(id), `${id} in two groups`);
          seen.set(id, k);
          assert.equal(map.get(id), k);
        }
      }
      for (const [id, r] of map) if (r && r !== 'self') assert.equal(seen.get(id), r);
    }
  }
});

test('relationGroups: ranked, so a test need that is already a dependant is not a testdep', () => {
  assert.deepEqual(extraNeeds(g, 'core', 'test').direct.has('testtool'), true);
  const gr = relationGroups(g, 'core', { tests: true, examples: true });
  assert.ok(gr.trdep.includes('testtool'));
  assert.ok(!gr.testdep.includes('testtool'));
  assert.deepEqual(gr.exampledep, ['extra', 'util']);
  assert.deepEqual(relationGroups(g, 'leaf', { tests: true }).testdep, ['util']);
  assert.deepEqual(relationGroups(g, 'util', { tests: true }).testrdep, ['leaf']);
  assert.deepEqual(relationGroups(g, 'leaf').testdep, []);
});

test('relationGroups: cached per selection and options, frozen, unknown selection empty', () => {
  assert.equal(relationGroups(g, 'core', { tests: true }), relationGroups(g, 'core', { tests: true }));
  assert.notEqual(relationGroups(g, 'core', { tests: true }), relationGroups(g, 'core'));
  assert.ok(Object.isFrozen(relationGroups(g, 'core').dep));
  assert.ok(Object.values(relationGroups(g, 'nope')).every(a => a.length === 0));
});

test('expandStd and visibleModules treat 98 and 03 as one chip', () => {
  assert.equal(expandStd(null), null);
  assert.deepEqual(sorted(expandStd(['03'])), ['03', '98']);
  assert.deepEqual(sorted(expandStd(['98', '11'])), ['03', '11', '98']);
  assert.deepEqual(sorted(visibleModules(g, { cxxstd: ['03'] })), ['base', 'util']);
  assert.deepEqual(sorted(visibleModules(g, { cxxstd: ['98'] })), ['base', 'util']);
  assert.deepEqual(sorted(visibleModules(g, { cxxstd: new Set(['03', '17']) })), ['app', 'base', 'util']);
});

const ALL_ON = { deps: true, tdeps: true, rdeps: true, trdeps: true, tests: false, examples: false };

test('viewSet: around is the selection plus direct library dependencies and dependants', () => {
  assert.deepEqual(sorted(viewSet(g, 'core', 'around', ALL_ON)), ['base', 'core', 'mid']);
  assert.equal(viewSet(g, 'core', 'around', ALL_ON)[0], 'core');
  assert.deepEqual(viewSet(g, 'loner', 'around', ALL_ON), ['loner']);
});

test('viewSet: deps and dependants include indirect relations and the selection', () => {
  assert.deepEqual(sorted(viewSet(g, 'app', 'deps', ALL_ON)), ['app', 'base', 'core', 'mid']);
  assert.deepEqual(sorted(viewSet(g, 'base', 'dependants', ALL_ON)), ['app', 'base', 'core', 'extra', 'leaf', 'mid', 'testtool', 'util']);
  assert.deepEqual(viewSet(g, 'base', 'deps', ALL_ON), ['base']);
  assert.deepEqual(viewSet(g, 'loner', 'dependants', ALL_ON), ['loner']);
});

test('viewSet: relation options switch their relations off', () => {
  assert.deepEqual(sorted(viewSet(g, 'app', 'deps', { ...ALL_ON, tdeps: false })), ['app', 'mid']);
  assert.deepEqual(sorted(viewSet(g, 'app', 'deps', { ...ALL_ON, deps: false })), ['app', 'base', 'core']);
  assert.deepEqual(sorted(viewSet(g, 'base', 'dependants', { ...ALL_ON, rdeps: false, trdeps: false })), ['base']);
});

test('viewSet: test and example extras only with their options', () => {
  assert.deepEqual(sorted(viewSet(g, 'leaf', 'deps', ALL_ON)), ['base', 'leaf']);
  assert.deepEqual(sorted(viewSet(g, 'leaf', 'deps', { ...ALL_ON, tests: true })), ['base', 'leaf', 'util']);
  assert.deepEqual(sorted(viewSet(g, 'util', 'dependants', { ...ALL_ON, tests: true })), ['extra', 'leaf', 'util']);
  assert.ok(viewSet(g, 'core', 'deps', { ...ALL_ON, examples: true }).includes('extra'));
});

test('viewSet: visible filter drops modules but keeps the selection', () => {
  const vis = visibleModules(g, { cxxstd: ['03'] });
  assert.deepEqual(sorted(viewSet(g, 'base', 'around', ALL_ON, vis)), ['base', 'util']);
  assert.deepEqual(sorted(viewSet(g, 'base', 'dependants', ALL_ON, vis)), ['base', 'util']);
  assert.deepEqual(viewSet(g, 'core', 'around', ALL_ON, new Set(['base'])).sort(), ['base', 'core']);
  assert.deepEqual(viewSet(g, 'core', 'deps', ALL_ON, new Set()), ['core']);
});

test('viewSet: unknown id is empty', () => {
  assert.deepEqual(viewSet(g, 'nope', 'around', ALL_ON), []);
  assert.deepEqual(viewSet(g, 'nope', 'deps', ALL_ON), []);
});
