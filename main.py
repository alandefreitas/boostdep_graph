#!/usr/bin/env python3
"""Generate data.js for the Boost dependency explorer.

Runs boostdep (and the depinst.py scanner shipped with it) against a Boost
checkout and writes ``data.js``: the modules, their metadata and the
library / test / example dependency edges, plus libs/<module>.html redirect
stubs that keep old per-library links working.  Standard library only.
"""

import argparse
import html
import importlib.util
import json
import os
import re
import subprocess
import sys
import urllib.parse
from datetime import date

CXXSTD_ORDER = ['98', '03', '11', '14', '17', '20', '23']

CATEGORY_TYPOS = {
    'programing': 'Programming',
}

EXAMPLE_DIRS = ['example', 'examples']

CXXSTD_ALTERNATIVES = {
    'tuple': ['std::tuple'],
    'config': ['feature test macros'],
    'move': ['r-value references'],
    'container_hash': ['std::hash'],
    'variant': ['std::variant'],
    'variant2': ['std::variant'],
    'optional': ['std::optional'],
    'system': ['std::system_error', 'std::expected'],
    'outcome': ['std::expected'],
    'smart_ptr': ['std::smart_ptr'],
    'regex': ['std::regex'],
    'chrono': ['std::chrono'],
    'ratio': ['std::ratio'],
    'function': ['std::function'],
    'type_index': ['std::type_index'],
    'bind': ['std::bind'],
    'array': ['std::array'],
    'atomic': ['std::atomic'],
    'any': ['std::any'],
    'container': ['std::map', 'std::set', 'std::vector', 'std::list', 'PMR'],
    'dynamic_bitset': ['std::vector<bool>'],
    'concept_check': ['concepts'],
    'function_types': ['std::invoke_result', '<type_traits>'],
    'range': ['std::ranges'],
    'format': ['std::format'],
    'thread': ['std::thread'],
    'locale': ['std::locale'],
    'coroutine': ['coroutines'],
    'coroutine2': ['coroutines'],
    'algorithm': ['<algorithm>'],
    'random': ['<random>'],
    'sort': ['std::sort'],
    'foreach': ['range-based for loops'],
    'filesystem': ['std::filesystem'],
    'lambda': ['lambdas'],
    'typeof': ['decltype', 'auto'],
    'date_time': ['std::chrono'],
}

verbose = 0


def vprint(*args):
    if verbose >= 1:
        print(*args)


class GeneratorError(Exception):
    pass


# ---------------------------------------------------------------------------
# Pure parsing
# ---------------------------------------------------------------------------

_DEP_TOKEN = re.compile(r'^(.*)\((\d+)\)$')


def parse_module_levels(text):
    """Parse ``boostdep --module-levels``.

    Returns ``(levels, edges)``: ``levels`` maps module id to its level and
    ``edges`` maps module id to the list of its direct library dependencies.
    """
    levels = {}
    edges = {}
    level = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped in ('', 'Module Levels:', '(unknown)'):
            continue
        m = re.match(r'^Level (\d+):$', line)
        if m:
            level = int(m.group(1))
            continue
        if not line.startswith('    ') or level is None:
            continue
        if ' -> ' in line or stripped.endswith(' ->'):
            name, _, rest = stripped.partition(' ->')
        else:
            name, rest = stripped, ''
        deps = []
        for token in rest.split():
            m = _DEP_TOKEN.match(token)
            dep = m.group(1) if m else token
            if dep and dep != '(unknown)':
                deps.append(dep)
        levels[name] = level
        edges[name] = deps
    return levels, edges


def parse_list_dependencies(text):
    """Parse ``boostdep --list-dependencies``: ``name -> dep dep ...``."""
    result = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        name, _, rest = line.strip().partition(' ->')
        deps = [d for d in rest.split() if d != '(unknown)']
        result[name] = deps
    return result


def parse_list_buildable(text):
    return {line.strip() for line in text.splitlines() if line.strip()}


def parse_gitmodules_paths(text):
    return [m.group(1) for m in
            (re.match(r'\s*path\s*=\s*(.*?)\s*$', line) for line in text.splitlines())
            if m]


def normalize_cxxstd(value):
    """Normalise a meta ``cxxstd`` value to one of CXXSTD_ORDER, or None."""
    if value is None:
        return None
    s = str(value).strip().lower()
    if s.startswith('c++'):
        s = s[3:]
    s = {'0x': '11', '1y': '14', '1z': '17', '2a': '20', '2b': '23'}.get(s, s)
    if len(s) == 4 and s.isdigit():
        s = s[2:]
    return s if s in CXXSTD_ORDER else None


def max_cxxstd(values):
    known = [v for v in values if v in CXXSTD_ORDER]
    return max(known, key=CXXSTD_ORDER.index) if known else None


def normalize_categories(value):
    """Strip, fix typos, capitalise the first letter only, dedupe and sort."""
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    result = set()
    for item in value:
        s = str(item).strip()
        if not s:
            continue
        s = CATEGORY_TYPOS.get(s.lower(), s)
        result.add(s[0].upper() + s[1:])
    return sorted(result)


def normalize_authors(value):
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    return [str(a).strip() for a in value if str(a).strip()]


def module_meta(meta, module_id):
    """Reduce parsed meta/libraries.json (dict or list) to the fields we use."""
    entries = meta if isinstance(meta, list) else [meta]
    entries = [e for e in entries if isinstance(e, dict)]
    if not entries:
        return {}
    key = module_id.replace('~', '/')
    entry = next((e for e in entries if e.get('key') == key), entries[0])
    authors = entry['authors'] if 'authors' in entry else entry.get('author')
    return {
        'name': entry.get('name') or None,
        'description': ' '.join(str(entry.get('description') or '').split()),
        'authors': normalize_authors(authors),
        'categories': normalize_categories(entry.get('category')),
        'cxxstd': max_cxxstd(normalize_cxxstd(e.get('cxxstd')) for e in entries),
        'deprecated': entry.get('status') == 'deprecated',
    }


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------

def run_boostdep(boostdep, boost_root, *args):
    cmd = [boostdep, '--boost-root', boost_root, *args]
    vprint('run:', ' '.join(cmd))
    try:
        out = subprocess.run(cmd, check=True, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise GeneratorError(f'boostdep not found: {boostdep}')
    except subprocess.CalledProcessError as e:
        raise GeneratorError(f'{" ".join(cmd)} failed: {e.stderr.decode("utf-8", "replace").strip()}')
    return out.stdout.decode('utf-8')


def read_gitmodules_paths(boost_root):
    path = os.path.join(boost_root, '.gitmodules')
    if not os.path.isfile(path):
        raise GeneratorError(f'.gitmodules not found in {boost_root}')
    with open(path, encoding='utf-8') as f:
        return parse_gitmodules_paths(f.read())


def read_meta(boost_root, module_id):
    """Meta fields of a module, or {} when it has no meta/libraries.json."""
    path = os.path.join(boost_root, 'libs', *module_id.split('~'), 'meta', 'libraries.json')
    if not os.path.isfile(path):
        return {}
    with open(path, encoding='utf-8') as f:
        return module_meta(json.load(f), module_id)


def git_stamp(boost_root, today=None):
    cmd = ['git', '-C', boost_root, 'log', '-1', '--format=%h %cs']
    try:
        out = subprocess.run(cmd, check=True, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.CalledProcessError) as e:
        raise GeneratorError(f'cannot read the Boost commit with "{" ".join(cmd)}": {e}')
    commit, _, commit_date = out.stdout.decode('utf-8').strip().partition(' ')
    return {'boostCommit': commit, 'boostDate': commit_date,
            'generated': (today or date.today()).isoformat()}


def scan_examples(boost_root, module_ids):
    """Direct dependencies found in each module's example dirs by depinst.py.

    Returns ``(result, dropped)``: ``result`` maps module id to the set of
    module ids it depends on (``~`` id form); ``dropped`` counts the targets
    that are not known modules and were left out.
    """
    depinst_dir = os.path.join(boost_root, 'tools', 'boostdep', 'depinst')
    depinst_path = os.path.join(depinst_dir, 'depinst.py')
    if not os.path.isfile(depinst_path):
        raise GeneratorError(f'depinst.py not found: {depinst_path}')
    spec = importlib.util.spec_from_file_location('boostdep_depinst', depinst_path)
    depinst = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(depinst)
    depinst.verbose = -1

    known = set(module_ids)
    result = {}
    dropped = 0
    old_cwd = os.getcwd()
    old_argv0 = sys.argv[0]
    try:
        os.chdir(boost_root)
        sys.argv[0] = depinst_path
        x = depinst.read_exceptions()
        gm = depinst.read_gitmodules()
        listed = set(gm)
        gm.extend(p for p in ('libs/' + m.replace('~', '/') for m in module_ids)
                  if p not in listed)
        for m in module_ids:
            deps = {}
            depinst.scan_module_dependencies(m.replace('~', '/'), x, gm, deps, EXAMPLE_DIRS, [])
            found = {d.replace('/', '~') for d in deps}
            result[m] = found & known
            dropped += len(found - known)
    except Exception as e:
        raise GeneratorError(f'depinst.py scan failed: {type(e).__name__}: {e}')
    finally:
        sys.argv[0] = old_argv0
        os.chdir(old_cwd)
    return result, dropped


# ---------------------------------------------------------------------------
# Data assembly
# ---------------------------------------------------------------------------

def check_known(edges, known, what):
    for src, targets in edges.items():
        if src not in known:
            raise GeneratorError(f'{what}: unknown module "{src}"')
        for t in targets:
            if t not in known:
                raise GeneratorError(f'{what}: "{src}" depends on unknown module "{t}"')


def build_data(*, boost_root, levels, lib_deps, test_deps, example_deps, buildable,
               module_ids, gitmodules_paths, stamp):
    """Assemble the data.js payload from already-parsed inputs."""
    known = set(module_ids)
    check_known(lib_deps, known, 'module levels')
    missing = sorted(known - set(levels))
    if missing:
        raise GeneratorError(f'modules without a level: {", ".join(missing)}')
    check_known(test_deps, known, 'test dependencies')
    check_known(example_deps, known, 'example dependencies')

    submodule_ids = {p[len('libs/'):].replace('/', '~')
                     for p in gitmodules_paths if p.startswith('libs/')}

    order = sorted(known, key=lambda m: (levels[m], m))
    metas = {m: read_meta(boost_root, m) for m in order}
    cxxstd = {}
    inferred = {}
    for m in order:
        own = metas[m].get('cxxstd')
        if own:
            cxxstd[m], inferred[m] = own, False
        else:
            cxxstd[m] = max_cxxstd(cxxstd.get(d) for d in lib_deps.get(m, [])) or '98'
            inferred[m] = True

    modules = []
    for m in sorted(known):
        meta = metas[m]
        is_tool = os.path.isdir(os.path.join(boost_root, 'tools', m))
        modules.append({
            'id': m,
            'name': meta.get('name') or m,
            'level': levels[m],
            'cxxstd': cxxstd[m],
            'cxxstdInferred': inferred[m],
            'authors': meta.get('authors', []),
            'description': meta.get('description', ''),
            'categories': meta.get('categories', []),
            'buildable': m in buildable,
            'tool': is_tool,
            'proposed': m not in submodule_ids and not is_tool,
            'deprecated': meta.get('deprecated', False),
            'stdAlternatives': list(CXXSTD_ALTERNATIVES.get(m, [])),
        })

    seen = set()
    for kind, source in (('lib', lib_deps), ('test', test_deps), ('example', example_deps)):
        for m, targets in source.items():
            for t in targets:
                if t == m:
                    continue
                if kind != 'lib' and t in lib_deps.get(m, []):
                    continue
                seen.add((m, kind, t))
    edges = [{'from': m, 'to': t, 'kind': k} for m, k, t in sorted(seen)]
    return {'stamp': stamp, 'modules': modules, 'edges': edges}


def collect_data(boost_root, boostdep, today=None):
    """Run everything against a real Boost checkout."""
    module_ids = [l.strip() for l in
                  run_boostdep(boostdep, boost_root, '--list-modules').splitlines() if l.strip()]
    levels, lib_deps = parse_module_levels(run_boostdep(boostdep, boost_root, '--module-levels'))
    all_tests = parse_list_dependencies(
        run_boostdep(boostdep, boost_root, '--track-tests', '--list-dependencies'))
    buildable = parse_list_buildable(run_boostdep(boostdep, boost_root, '--list-buildable'))
    known = set(module_ids)

    dropped_tests = 0
    test_deps = {}
    for m, targets in all_tests.items():
        if m not in known:
            raise GeneratorError(f'test dependencies: unknown module "{m}"')
        kept = [t for t in targets if t in known]
        dropped_tests += len(targets) - len(kept)
        test_deps[m] = kept
    example_deps, dropped_examples = scan_examples(boost_root, module_ids)

    data = build_data(
        boost_root=boost_root, levels=levels, lib_deps=lib_deps, test_deps=test_deps,
        example_deps=example_deps, buildable=buildable, module_ids=module_ids,
        gitmodules_paths=read_gitmodules_paths(boost_root),
        stamp=git_stamp(boost_root, today))
    vprint(f'dropped targets that are not modules: {dropped_tests} test, {dropped_examples} example')
    return data


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def _dumps(value):
    s = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return s.replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')


def render_data_js(data):
    """Deterministic data.js text: one module and one edge per line."""
    lines = ['window.BOOSTDEP_DATA = {',
             f'"stamp":{_dumps(data["stamp"])},',
             '"modules":[']
    lines += [_dumps(m) + (',' if i < len(data['modules']) - 1 else '')
              for i, m in enumerate(data['modules'])]
    lines += ['],', '"edges":[']
    lines += [_dumps(e) + (',' if i < len(data['edges']) - 1 else '')
              for i, e in enumerate(data['edges'])]
    lines += [']', '};', '']
    return '\n'.join(lines)


def parse_data_js(text):
    """Inverse of render_data_js; returns None when text is not our format."""
    start = text.find('{')
    end = text.rfind('};')
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(text[start:end + 1])
    except ValueError:
        return None


def payload(data):
    return {'modules': data['modules'], 'edges': data['edges']}


def write_data_js(path, data):
    """Write data.js unless the payload (modules + edges) is unchanged.

    Returns True when the file was written.
    """
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            old = parse_data_js(f.read())
        if old is not None and payload(old) == json.loads(_dumps(payload(data))):
            return False
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(render_data_js(data))
    return True


STUB_TEMPLATE = (
    '<!doctype html>\n'
    '<meta charset="utf-8">\n'
    '<title>{id} - Boost dependency explorer</title>\n'
    '<link rel="canonical" href="../#{id}">\n'
    '<meta http-equiv="refresh" content="0; url=../#{id}">\n'
    '<script>var h=location.hash.slice(1);'
    'location.replace("../#"+{idjs}+(h?"&"+h:""))</script>\n'
    '<p>Moved to <a href="../#{id}">the dependency explorer</a>.</p>\n'
)


def render_redirect_stub(module_id):
    fragment = urllib.parse.quote(module_id, safe='~')
    return STUB_TEMPLATE.format(id=html.escape(fragment, quote=True),
                                idjs=json.dumps(fragment).replace('<', '\\u003c'))


def write_redirect_stubs(output_dir, module_ids):
    """Write libs/<id>.html redirect stubs for the union of module_ids and
    the basenames of existing libs/*.html (old pages are kept as stubs so
    external links keep working). Returns the number of files written."""
    libs = os.path.join(output_dir, 'libs')
    ids = set(module_ids)
    if os.path.isdir(libs):
        ids.update(f[:-5] for f in os.listdir(libs) if f.endswith('.html'))
    os.makedirs(libs, exist_ok=True)
    written = 0
    for module_id in sorted(ids):
        path = os.path.join(libs, module_id + '.html')
        text = render_redirect_stub(module_id)
        if os.path.isfile(path):
            with open(path, encoding='utf-8', newline='') as f:
                if f.read() == text:
                    continue
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
        written += 1
    return written


def main(argv=None):
    global verbose
    parser = argparse.ArgumentParser(
        description='Generate data.js for the Boost dependency explorer.')
    parser.add_argument('--boost-root', default='.', help='the Boost checkout directory')
    parser.add_argument('--boostdep', default='boostdep', help='path to the boostdep executable')
    parser.add_argument('--output-dir', default='.', help='directory that receives data.js and the libs/*.html redirect stubs')
    parser.add_argument('-v', '--verbose', action='count', default=0, help='more output')
    parser.add_argument('-q', '--quiet', action='count', default=0, help='less output (opposite of -v)')
    args = parser.parse_args(argv)
    verbose = args.verbose - args.quiet

    try:
        data = collect_data(os.path.abspath(args.boost_root), args.boostdep)
        written = write_data_js(os.path.join(args.output_dir, 'data.js'), data)
        stubs = write_redirect_stubs(args.output_dir, [m['id'] for m in data['modules']])
    except GeneratorError as e:
        print(f'error: {e}', file=sys.stderr)
        return 1

    kinds = {k: sum(1 for e in data['edges'] if e['kind'] == k) for k in ('lib', 'test', 'example')}
    if verbose >= 0:
        print(f'{len(data["modules"])} modules, edges: lib {kinds["lib"]}, test {kinds["test"]}, '
              f'example {kinds["example"]}; data.js {"written" if written else "unchanged"}; '
              f'{stubs} redirect stubs written')
    return 0


if __name__ == '__main__':
    sys.exit(main())
