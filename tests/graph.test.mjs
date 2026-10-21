import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraph, depsClosure, dependantsClosure, extraNeeds, extraDependants, relation, relations,
  dependencyPath, dependantPath, visibleModules, layout, importance, maxImportance,
  cxxstdOrder, compareStd,
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
