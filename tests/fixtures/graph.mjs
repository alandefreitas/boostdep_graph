// Small hand-written dataset in the data.js schema.
// lib chain: app -> mid -> core -> base; leaf -> base; util -> base
// testtool (tests of core) depends on app via lib, so core -test-> testtool closes a cycle.
// core -example-> extra; extra -> util. loner has no categories and no edges.
const mod = (id, level, cxxstd, categories) => ({
  id, name: id, level, cxxstd, cxxstdInferred: false, authors: [], description: '',
  categories, buildable: true, tool: false, proposed: false, deprecated: false, stdAlternatives: [],
});

export const data = {
  stamp: { boostCommit: 'abc', boostDate: '2025-01-01', generated: '2025-01-02' },
  modules: [
    mod('base', 0, '03', ['Core']),
    mod('core', 1, '11', ['core', 'Algorithms']),
    mod('mid', 2, '14', ['Algorithms']),
    mod('app', 3, '17', ['IO']),
    mod('leaf', 1, '11', ['Strings']),
    mod('util', 1, '98', ['CORE']),
    mod('extra', 2, '20', ['Misc']),
    mod('testtool', 4, '23', ['Misc']),
    mod('loner', 0, '11', []),
  ],
  edges: [
    { from: 'core', to: 'base', kind: 'lib' },
    { from: 'mid', to: 'core', kind: 'lib' },
    { from: 'app', to: 'mid', kind: 'lib' },
    { from: 'leaf', to: 'base', kind: 'lib' },
    { from: 'util', to: 'base', kind: 'lib' },
    { from: 'extra', to: 'util', kind: 'lib' },
    { from: 'testtool', to: 'app', kind: 'lib' },
    { from: 'core', to: 'testtool', kind: 'test' },
    { from: 'leaf', to: 'util', kind: 'test' },
    { from: 'core', to: 'extra', kind: 'example' },
    { from: 'base', to: 'core', kind: 'test' },
  ],
};

// Same data plus a genuine lib cycle: base -> mid.
export const cyclic = {
  ...data,
  edges: [...data.edges, { from: 'base', to: 'mid', kind: 'lib' }],
};
