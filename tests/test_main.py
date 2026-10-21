import contextlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import main  # noqa: E402

FIXTURES = os.path.join(HERE, 'fixtures')


def fixture(name):
    with open(os.path.join(FIXTURES, name), encoding='utf-8') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class ParsingTests(unittest.TestCase):
    def test_module_levels(self):
        levels, edges = main.parse_module_levels(fixture('module-levels.txt'))
        self.assertEqual(levels['config'], 0)
        self.assertEqual(levels['numeric~conversion'], 6)
        self.assertNotIn('(unknown)', levels)
        self.assertEqual(edges['config'], [])
        self.assertEqual(edges['assert'], ['config'])
        self.assertEqual(edges['numeric~conversion'],
                         ['config', 'core', 'mp11', 'throw_exception', 'type_traits'])

    def test_module_levels_drops_unknown_dependency(self):
        _, edges = main.parse_module_levels(fixture('module-levels.txt'))
        self.assertEqual(edges['regex'],
                         ['assert', 'config', 'core', 'predef', 'throw_exception', 'type_traits'])

    def test_list_dependencies(self):
        deps = main.parse_list_dependencies(fixture('list-dependencies-tests.txt'))
        self.assertEqual(deps['config'], [])
        self.assertEqual(deps['assert'], ['config', 'core'])
        self.assertIn('numeric~conversion', deps)

    def test_list_buildable(self):
        self.assertEqual(main.parse_list_buildable(fixture('list-buildable.txt')), {'regex'})

    def test_gitmodules_paths(self):
        text = '[submodule "a"]\n\tpath = libs/a\n\turl = ../a.git\n[submodule "b"]\n\tpath = tools/b\n'
        self.assertEqual(main.parse_gitmodules_paths(text), ['libs/a', 'tools/b'])

    def test_normalize_cxxstd(self):
        self.assertEqual(main.normalize_cxxstd('11'), '11')
        self.assertEqual(main.normalize_cxxstd(' C++17 '), '17')
        self.assertEqual(main.normalize_cxxstd('0x'), '11')
        self.assertEqual(main.normalize_cxxstd('2020'), '20')
        self.assertIsNone(main.normalize_cxxstd('banana'))
        self.assertIsNone(main.normalize_cxxstd(None))

    def test_max_cxxstd_orders_by_standard_not_string(self):
        self.assertEqual(main.max_cxxstd(['98', '03']), '03')
        self.assertEqual(main.max_cxxstd(['11', None, '23', '14']), '23')
        self.assertIsNone(main.max_cxxstd([None]))


class CategoryTests(unittest.TestCase):
    def test_typos_case_and_dedupe(self):
        self.assertEqual(
            main.normalize_categories(['programing', 'system', 'System', ' IO ', 'Error-handling', '']),
            ['Error-handling', 'IO', 'Programming', 'System'])

    def test_string_and_missing(self):
        self.assertEqual(main.normalize_categories('Math'), ['Math'])
        self.assertEqual(main.normalize_categories(None), [])

    def test_first_letter_only(self):
        self.assertEqual(main.normalize_categories(['Function-objects', 'data structures']),
                         ['Data structures', 'Function-objects'])


class MetaTests(unittest.TestCase):
    def test_string_author_and_author_key(self):
        self.assertEqual(main.module_meta({'authors': 'A B', 'name': 'N'}, 'n')['authors'], ['A B'])
        self.assertEqual(main.module_meta({'author': ['A', 'B']}, 'n')['authors'], ['A', 'B'])
        self.assertEqual(main.module_meta({'authors': ''}, 'n')['authors'], [])

    def test_list_meta_picks_entry_by_key_and_max_cxxstd(self):
        meta = [{'key': 'bind', 'name': 'Bind', 'cxxstd': '03'},
                {'key': 'bind/mem_fn', 'name': 'Mem Fn', 'cxxstd': '14'}]
        got = main.module_meta(meta, 'bind')
        self.assertEqual(got['name'], 'Bind')
        self.assertEqual(got['cxxstd'], '14')

    def test_list_meta_falls_back_to_first_entry(self):
        meta = [{'key': 'a/one', 'name': 'One'}, {'key': 'a/two', 'name': 'Two'}]
        self.assertEqual(main.module_meta(meta, 'a')['name'], 'One')

    def test_nested_key_uses_slash(self):
        meta = [{'key': 'numeric/conversion', 'name': 'NC'}, {'key': 'other', 'name': 'O'}]
        self.assertEqual(main.module_meta(meta, 'numeric~conversion')['name'], 'NC')

    def test_deprecated_and_description(self):
        got = main.module_meta({'status': 'deprecated', 'description': 'a  b\n c'}, 'x')
        self.assertTrue(got['deprecated'])
        self.assertEqual(got['description'], 'a b c')


class FakeTree:
    """A tiny Boost tree, with the real depinst.py copied in."""

    def __init__(self, root):
        self.root = root
        shutil.copytree(os.path.join(FIXTURES, 'depinst'),
                        os.path.join(root, 'tools', 'boostdep', 'depinst'))
        write(os.path.join(root, '.gitmodules'),
              '[submodule "config"]\n\tpath = libs/config\n'
              '[submodule "core"]\n\tpath = libs/core\n'
              '[submodule "url"]\n\tpath = libs/url\n'
              '[submodule "numeric_conversion"]\n\tpath = libs/numeric/conversion\n'
              '[submodule "orphan"]\n\tpath = libs/orphan\n'
              '[submodule "x"]\n\tpath = tools/x\n')
        os.makedirs(os.path.join(root, 'tools', 'x'))
        write(os.path.join(root, 'libs', 'config', 'meta', 'libraries.json'), json.dumps([
            {'key': 'config', 'name': 'Config', 'authors': 'Vesa', 'category': ['Miscellaneous'],
             'cxxstd': '03'},
            {'key': 'config/extra', 'name': 'Extra', 'cxxstd': '14'}]))
        write(os.path.join(root, 'libs', 'core', 'meta', 'libraries.json'), json.dumps(
            {'key': 'core', 'name': 'Core', 'authors': ['Peter'], 'description': 'Core stuff',
             'category': ['system', 'programing'], 'cxxstd': '11'}))
        write(os.path.join(root, 'libs', 'url', 'meta', 'libraries.json'), json.dumps(
            {'key': 'url', 'name': 'URL', 'authors': ['Vinnie', 'Alan'], 'category': ['IO']}))
        write(os.path.join(root, 'libs', 'numeric', 'conversion', 'meta', 'libraries.json'), json.dumps(
            {'key': 'numeric/conversion', 'name': 'Numeric Conversion', 'cxxstd': '03',
             'status': 'deprecated'}))
        os.makedirs(os.path.join(root, 'libs', 'newlib'))
        os.makedirs(os.path.join(root, 'libs', 'x'))
        write(os.path.join(root, 'libs', 'url', 'example', 'a.cpp'),
              '#include <boost/core/ignore_unused.hpp>\n'
              '#include <boost/config.hpp>\n'
              '  #  include "boost/numeric/conversion/cast.hpp"\n'
              '#include <boost/newlib/thing.hpp>\n'
              '#include <boost/not_a_module/thing.hpp>\n'
              '#include <boost/orphan/thing.hpp>\n')
        write(os.path.join(root, 'libs', 'url', 'examples', 'b.cpp'),
              '#include <boost/core/ignore_unused.hpp>\n#include <boost/config.hpp>\n')
        write(os.path.join(root, 'libs', 'core', 'test', 'a.cpp'), '#include <boost/url.hpp>\n')

    MODULES = ['config', 'core', 'newlib', 'numeric~conversion', 'url', 'x']


class ScanExamplesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.tree = FakeTree(self.tmp.name)

    def test_scans_example_and_examples_with_tilde_ids(self):
        got, dropped = main.scan_examples(self.tmp.name, FakeTree.MODULES)
        self.assertEqual(dropped, 1)
        self.assertEqual(got['url'], {'core', 'config', 'numeric~conversion', 'newlib'})
        self.assertEqual(got['core'], set())

    def test_restores_cwd_and_argv(self):
        cwd, argv0 = os.getcwd(), sys.argv[0]
        main.scan_examples(self.tmp.name, FakeTree.MODULES)
        self.assertEqual(os.getcwd(), cwd)
        self.assertEqual(sys.argv[0], argv0)

    def test_restores_cwd_on_error(self):
        os.remove(os.path.join(self.tmp.name, '.gitmodules'))
        cwd = os.getcwd()
        with self.assertRaises(main.GeneratorError):
            main.scan_examples(self.tmp.name, FakeTree.MODULES)
        self.assertEqual(os.getcwd(), cwd)

    def test_missing_depinst_is_an_error(self):
        os.remove(os.path.join(self.tmp.name, 'tools', 'boostdep', 'depinst', 'depinst.py'))
        with self.assertRaisesRegex(main.GeneratorError, 'depinst.py not found'):
            main.scan_examples(self.tmp.name, FakeTree.MODULES)


def sample_inputs(root):
    return dict(
        boost_root=root,
        levels={'config': 0, 'core': 1, 'newlib': 0, 'numeric~conversion': 2, 'url': 2, 'x': 0},
        lib_deps={'config': [], 'core': ['config'], 'newlib': [], 'numeric~conversion': ['core'],
                  'url': ['config', 'core'], 'x': []},
        test_deps={'core': ['config', 'core', 'url'], 'url': ['config', 'newlib']},
        example_deps={'url': {'core', 'config', 'numeric~conversion'}},
        buildable={'url'},
        module_ids=FakeTree.MODULES,
        gitmodules_paths=['libs/config', 'libs/core', 'libs/url', 'libs/numeric/conversion', 'tools/x'],
        stamp={'boostCommit': 'abc', 'boostDate': '2025-01-02', 'generated': '2026-03-04'})


class BuildDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        FakeTree(self.tmp.name)
        self.data = main.build_data(**sample_inputs(self.tmp.name))
        self.mods = {m['id']: m for m in self.data['modules']}

    def edges(self, kind, src):
        return [e['to'] for e in self.data['edges'] if e['kind'] == kind and e['from'] == src]

    def test_modules_sorted_and_complete(self):
        self.assertEqual([m['id'] for m in self.data['modules']], FakeTree.MODULES)

    def test_test_and_example_edges_exclude_lib_edges_and_self(self):
        self.assertEqual(self.edges('lib', 'url'), ['config', 'core'])
        self.assertEqual(self.edges('test', 'url'), ['newlib'])
        self.assertEqual(self.edges('test', 'core'), ['url'])
        self.assertEqual(self.edges('example', 'url'), ['numeric~conversion'])

    def test_edges_sorted(self):
        keys = [(e['from'], e['kind'], e['to']) for e in self.data['edges']]
        self.assertEqual(keys, sorted(keys))

    def test_cxxstd_explicit_and_inferred(self):
        self.assertEqual((self.mods['core']['cxxstd'], self.mods['core']['cxxstdInferred']), ('11', False))
        self.assertEqual((self.mods['config']['cxxstd'], self.mods['config']['cxxstdInferred']),
                         ('14', False))
        self.assertEqual((self.mods['url']['cxxstd'], self.mods['url']['cxxstdInferred']), ('14', True))
        self.assertEqual((self.mods['newlib']['cxxstd'], self.mods['newlib']['cxxstdInferred']),
                         ('98', True))

    def test_proposed_tool_deprecated_buildable(self):
        self.assertTrue(self.mods['newlib']['proposed'])
        self.assertFalse(self.mods['url']['proposed'])
        self.assertFalse(self.mods['numeric~conversion']['proposed'])
        self.assertTrue(self.mods['x']['tool'])
        self.assertFalse(self.mods['x']['proposed'])
        self.assertTrue(self.mods['numeric~conversion']['deprecated'])
        self.assertTrue(self.mods['url']['buildable'])
        self.assertFalse(self.mods['core']['buildable'])

    def test_metadata_fields(self):
        core = self.mods['core']
        self.assertEqual(core['categories'], ['Programming', 'System'])
        self.assertEqual(core['description'], 'Core stuff')
        self.assertEqual(self.mods['config']['authors'], ['Vesa'])
        self.assertEqual(self.mods['newlib']['name'], 'newlib')
        self.assertEqual(self.mods['newlib']['authors'], [])
        self.assertEqual(self.mods['newlib']['description'], '')

    def test_std_alternatives(self):
        self.assertEqual(self.mods['config']['stdAlternatives'], ['feature test macros'])
        self.assertEqual(self.mods['url']['stdAlternatives'], [])

    def test_unknown_lib_target_raises(self):
        inputs = sample_inputs(self.tmp.name)
        inputs['lib_deps']['url'] = ['ghost']
        with self.assertRaisesRegex(main.GeneratorError, 'ghost'):
            main.build_data(**inputs)

    def test_unknown_test_source_raises(self):
        inputs = sample_inputs(self.tmp.name)
        inputs['test_deps']['ghost'] = []
        with self.assertRaisesRegex(main.GeneratorError, 'ghost'):
            main.build_data(**inputs)

    def test_module_without_level_raises(self):
        inputs = sample_inputs(self.tmp.name)
        del inputs['levels']['x']
        with self.assertRaisesRegex(main.GeneratorError, 'without a level'):
            main.build_data(**inputs)


class OutputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        FakeTree(self.tmp.name)
        self.data = main.build_data(**sample_inputs(self.tmp.name))
        self.out = os.path.join(self.tmp.name, 'out', 'data.js')

    def test_render_is_deterministic_and_line_per_item(self):
        text = main.render_data_js(self.data)
        self.assertEqual(text, main.render_data_js(json.loads(json.dumps(self.data))))
        self.assertTrue(text.startswith('window.BOOSTDEP_DATA = {\n'))
        self.assertTrue(text.endswith('};\n'))
        self.assertEqual(len(text.splitlines()),
                         len(self.data['modules']) + len(self.data['edges']) + 7)
        self.assertEqual(main.parse_data_js(text), self.data)

    def test_non_ascii_round_trip(self):
        self.data['modules'][0]['authors'] = ['Ion Gaztañaga', 'a b']
        text = main.render_data_js(self.data)
        self.assertIn('Ion Gaztañaga', text)
        self.assertNotIn(' ', text)
        self.assertEqual(main.parse_data_js(text), self.data)

    def test_write_then_unchanged_payload_is_not_rewritten(self):
        self.assertTrue(main.write_data_js(self.out, self.data))
        with open(self.out, encoding='utf-8') as f:
            first = f.read()
        os.utime(self.out, (1, 1))
        newer = json.loads(json.dumps(self.data))
        newer['stamp'] = {'boostCommit': 'zzz', 'boostDate': '2026-01-01', 'generated': '2026-06-06'}
        self.assertFalse(main.write_data_js(self.out, newer))
        with open(self.out, encoding='utf-8') as f:
            self.assertEqual(f.read(), first)
        self.assertEqual(os.stat(self.out).st_mtime, 1)

    def test_changed_payload_is_rewritten_with_new_stamp(self):
        main.write_data_js(self.out, self.data)
        newer = json.loads(json.dumps(self.data))
        newer['edges'].append({'from': 'url', 'to': 'x', 'kind': 'example'})
        newer['stamp']['generated'] = '2027-01-01'
        self.assertTrue(main.write_data_js(self.out, newer))
        with open(self.out, encoding='utf-8') as f:
            self.assertEqual(main.parse_data_js(f.read()), newer)

    def test_corrupt_existing_file_is_rewritten(self):
        write(self.out, 'garbage')
        self.assertTrue(main.write_data_js(self.out, self.data))


class EndToEndTests(unittest.TestCase):
    """main() against a fake boostdep that replays the recorded fixtures."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.join(self.tmp.name, 'boost')
        os.makedirs(self.root)
        shutil.copytree(os.path.join(FIXTURES, 'depinst'),
                        os.path.join(self.root, 'tools', 'boostdep', 'depinst'))
        write(os.path.join(self.root, '.gitmodules'),
              ''.join(f'[submodule "{m}"]\n\tpath = libs/{m.replace("~", "/")}\n'
                      for m in ('config', 'mp11', 'assert', 'regex', 'predef',
                                'throw_exception', 'type_traits', 'core', 'url', 'numeric~conversion')))
        write(os.path.join(self.root, 'libs', 'url', 'example', 'a.cpp'),
              '#include <boost/regex.hpp>\n#include <boost/predef.h>\n')
        self.boostdep = os.path.join(self.tmp.name, 'fake-boostdep')
        outputs = {
            '--module-levels': 'module-levels.txt',
            '--list-buildable': 'list-buildable.txt',
            '--track-tests': 'list-dependencies-tests.txt',
        }
        cases = ''.join(f'  *{flag}*) cat "{os.path.join(FIXTURES, name)}";;\n'
                        for flag, name in outputs.items())
        write(self.boostdep,
              '#!/bin/sh\ncase "$*" in\n  *--list-modules*) sed -n \'s/^    \\([a-z0-9_~]*\\).*/\\1/p\' '
              f'"{os.path.join(FIXTURES, "module-levels.txt")}";;\n{cases}'
              '  *) echo "unexpected: $*" >&2; exit 2;;\nesac\n')
        os.chmod(self.boostdep, os.stat(self.boostdep).st_mode | stat.S_IXUSR)
        env = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t',
                   GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t',
                   GIT_AUTHOR_DATE='2025-05-06T00:00:00', GIT_COMMITTER_DATE='2025-05-06T00:00:00')
        for args in (['init', '-q'], ['add', '.'], ['commit', '-q', '-m', 'x']):
            subprocess.run(['git', '-C', self.root, *args], check=True, env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.out = os.path.join(self.tmp.name, 'out')

    def run_main(self, *extra):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = main.main(['--boost-root', self.root, '--boostdep', self.boostdep,
                              '--output-dir', self.out, *extra])
        return code, buf.getvalue()

    def test_generates_then_reports_unchanged(self):
        code, out = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn('data.js written', out)
        self.assertTrue(os.path.isfile(os.path.join(self.out, 'libs', 'url.html')))
        with open(os.path.join(self.out, 'data.js'), encoding='utf-8') as f:
            data = main.parse_data_js(f.read())
        self.assertEqual(data['stamp']['boostDate'], '2025-05-06')
        self.assertRegex(data['stamp']['generated'], r'^\d{4}-\d{2}-\d{2}$')
        self.assertEqual(len(data['modules']), 10)
        kinds = {e['kind'] for e in data['edges']}
        self.assertEqual(kinds, {'lib', 'test', 'example'})
        self.assertIn({'from': 'core', 'to': 'type_traits', 'kind': 'test'}, data['edges'])
        self.assertIn({'from': 'url', 'to': 'predef', 'kind': 'example'}, data['edges'])
        self.assertNotIn({'from': 'url', 'to': 'regex', 'kind': 'example'}, data['edges'])
        self.assertNotIn({'from': 'url', 'to': 'url', 'kind': 'test'}, data['edges'])
        code, out = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn('data.js unchanged', out)

    def test_missing_boostdep_fails_loudly(self):
        self.boostdep = os.path.join(self.tmp.name, 'nope')
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code, _ = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn('boostdep not found', err.getvalue())


class RedirectStubTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def read(self, name):
        with open(os.path.join(self.tmp.name, 'libs', name), encoding='utf-8') as f:
            return f.read()

    def test_stub_content_and_size(self):
        main.write_redirect_stubs(self.tmp.name, ['url', 'numeric~conversion'])
        text = self.read('url.html')
        self.assertLess(len(text.encode()), 1000)
        self.assertIn('<meta http-equiv="refresh" content="0; url=../#url">', text)
        self.assertIn('<link rel="canonical" href="../#url">', text)
        self.assertIn('<a href="../#url">', text)
        self.assertIn('location.replace("../#"+"url"', text)
        self.assertIn('../#numeric~conversion', self.read('numeric~conversion.html'))

    def test_keeps_old_pages_as_stubs_and_is_idempotent(self):
        write(os.path.join(self.tmp.name, 'libs', 'asem.html'), 'x' * 5000)
        self.assertEqual(main.write_redirect_stubs(self.tmp.name, ['url']), 2)
        self.assertIn('../#asem', self.read('asem.html'))
        self.assertEqual(main.write_redirect_stubs(self.tmp.name, ['url']), 0)

    def test_id_is_escaped(self):
        text = main.render_redirect_stub('a"<b')
        self.assertIn('a%22%3Cb', text)
        self.assertNotIn('<b', text)


if __name__ == '__main__':
    unittest.main()
