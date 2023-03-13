import argparse
from datetime import datetime
import subprocess
import json
import os
import plotly.graph_objects as go

def generate_depgraph(boostdep, boost_root, libs, output, output_path=''):
    report = subprocess.check_output([boostdep, '--boost-root', boost_root, '--module-levels']).decode('utf-8')

    # Read constants
    cxxstd_alternatives = generate_cxxstd_alternatives()
    gitmodules = set()
    gitmodules_path = os.path.join(boost_root, '.gitmodules')
    if os.path.exists(gitmodules_path):
        with open(gitmodules_path) as f:
            for line in f.readlines():
                prefix = '[submodule "'
                if line.startswith(prefix):
                    t = line[len(prefix):]
                    p = t.find('"')
                    if p != -1:
                        print(t[:p])
                        gitmodules.add(t[:p])

    # Get modules per level
    levels = []
    graph = {}
    for line in report.splitlines():
        if line in ['', 'Module Levels:', '    (unknown)']:
            continue
        if line.startswith('Level '):
            levels.append(list())
            continue
        if line.startswith('    '):
            div = line.find(' -> ')
            if div != -1:
                levels[-1].append(line[4:div])
                wdeps = line[div + 4:].split(' ')
                deps = []
                for wdep in wdeps:
                    pos = wdep.rfind('(')
                    if pos != -1:
                        d = wdep[:pos]
                        if d != '(unknown)':
                            deps.append(wdep[:pos])
                graph[line[4:div]] = deps
            else:
                levels[-1].append(line[4:])
                graph[line[4:]] = []

    vprint(levels)
    vprint(graph)

    # Buildable libraries
    compiled_report = subprocess.check_output([boostdep, '--boost-root', boost_root, '--list-buildable']).decode('utf-8')
    buildable = []
    for line in compiled_report.splitlines():
        buildable.append(line.strip())
    vprint(f'buildable: {buildable}')

    # Calculate other module properties
    module_props = {}
    for level in levels:
        for m in level:
            module_props[m] = {}

            # Reverse deps
            reverse = []
            for [other, other_deps] in graph.items():
                if m in other_deps:
                    reverse.append(other)
            module_props[m]['reverse'] = reverse

            # Level
            for i in range(len(levels)):
                if m in levels[i]:
                    module_props[m]['level'] = i
                    break

            # Transitive dependencies
            cur_scan = graph[m]
            transitive = []
            while cur_scan:
                next_scan = []
                for d in cur_scan:
                    for e in graph[d]:
                        if e not in transitive and e not in cur_scan:
                            next_scan.append(e)
                transitive += cur_scan
                cur_scan = next_scan
            module_props[m]['transitive'] = list(set(transitive))

            # cxxstd supported, from the meta files
            meta_path = os.path.join(boost_root, 'libs', m, 'meta', 'libraries.json')
            if os.path.exists(meta_path):
                with open(meta_path) as f:
                    data = json.load(f)
                    if 'description' in data:
                        module_props[m]['description'] = data['description']

                    if 'category' in data:
                        module_props[m]['category'] = data['category']

                    if 'authors' in data:
                        if type(data['authors']) is list:
                            module_props[m]['authors'] = data['authors']
                        elif data['authors'] != '':
                            module_props[m]['authors'] = [data['authors']]
                    elif 'author' in data:
                        if type(data['author']) is list:
                            module_props[m]['authors'] = data['author']
                        else:
                            module_props[m]['authors'] = [data['author']]

                    if 'cxxstd' in data:
                        module_props[m]['cxxstd'] = cxxstd_to_int(data['cxxstd'])
                        module_props[m]['cxxstd_str'] = data['cxxstd']
                    elif type(data) is list:
                        max_cxxstd = 1998
                        has_cxxstd = False
                        for d in data:
                            if 'cxxstd' in d:
                                max_cxxstd = max(max_cxxstd, cxxstd_to_int(d['cxxstd']))
                                has_cxxstd = True
                        if has_cxxstd:
                            module_props[m]['cxxstd'] = max_cxxstd
                            module_props[m]['cxxstd_str'] = cxxstd_to_string(max_cxxstd)
            if 'cxxstd' not in module_props[m]:
                inferred_cxxstd = 1998
                for dep in graph[m]:
                    if 'cxxstd' in module_props[dep]:
                        inferred_cxxstd = max(inferred_cxxstd, module_props[dep]['cxxstd'])
                module_props[m]['cxxstd'] = inferred_cxxstd
                module_props[m]['cxxstd_str'] = cxxstd_to_string(inferred_cxxstd)

    for level in reversed(levels):
        for m in level:
            # Transitive reverse dependencies
            cur_scan = module_props[m]['reverse']
            transitive = []
            while cur_scan:
                next_scan = []
                for d in cur_scan:
                    for e in module_props[d]['reverse']:
                        if e not in transitive and e not in cur_scan:
                            next_scan.append(e)
                transitive += cur_scan
                cur_scan = next_scan
            module_props[m]['reverse_transitive'] = list(set(transitive))

    # Define layout for each module
    max_level_size = 0
    for level in levels:
        max_level_size = max(max_level_size, len(level))

    max_n_reverse_transitive = 0
    for m in graph.keys():
        max_n_reverse_transitive = max(max_n_reverse_transitive, len(module_props[m]['reverse_transitive']))

    layout = {}
    for i in range(len(levels)):
        level = levels[i]
        h = 1 + max_level_size - len(level) / 2
        for m in level:
            layout[m] = {}
            layout[m]['x'] = i
            layout[m]['y'] = h
            h += 1
            layout[m]['color'] = module_props[m]['cxxstd']
            layout[m]['size'] = 15 + 30 * len(module_props[m]['reverse_transitive']) / max_n_reverse_transitive
            layout[m]['level'] = i

            layout[m]['border'] = 'black'
            text = f''
            for lib in libs:
                if m == lib:
                    layout[m]['border'] = "rgb(0, 200, 0)"
                    break
                elif m in graph[lib]:
                    layout[m]['border'] = "rgb(255, 70, 0)"
                    text = f'<b>Direct dependency of {lib}</b><br><br>'
                    break
                elif m in module_props[lib]['transitive']:
                    layout[m]['border'] = "rgb(255, 190, 100)"
                    path = [m]
                    for j in range(i + 1, len(levels)):
                        if path[-1] in graph[lib]:
                            break
                        for lm in levels[j]:
                            if path[-1] in graph[lm] and lm in module_props[lib]['transitive']:
                                path.append(lm)
                                break
                    path.append(lib)
                    text = f'<b>Transitive dependency of {lib}</b>:<br>    {as_paragraph(" -> ".join(path), 50, 4)}<br><br>'
                    break
                elif m in module_props[lib]['reverse']:
                    layout[m]['border'] = "rgb(0, 70, 255)"
                    text = f'<b>Reverse dependency of {lib}</b><br><br>'
                    break
                elif m in module_props[lib]['reverse_transitive']:
                    layout[m]['border'] = "rgb(100, 190, 255)"
                    path = [m]
                    for j in range(i - 1, -1, -1):
                        if path[-1] in module_props[lib]['reverse']:
                            break
                        for lm in levels[j]:
                            if path[-1] in module_props[lm]['reverse'] and lm in module_props[lib]['reverse_transitive']:
                                path.append(lm)
                                break
                    path.append(lib)
                    text = f'<b>Transitive reverse dependency of {lib}</b>:<br>    {as_paragraph(" -> ".join(reversed(path)), 50, 4)}<br><br>'
                    break
                elif 'category' in module_props[m] and 'category' in module_props[lib]:
                    for this_cat in module_props[m]['category']:
                        for that_cat in module_props[lib]['category']:
                            if this_cat.lower() == that_cat.lower():
                                layout[m]['border'] = "rgb(0, 80, 0)"
                                text = f'{m} and {lib} are both in the <b>{this_cat.lower()}</b> category<br><br>'
                                break

            text += f'<b>{m}</b> (C++{module_props[m]["cxxstd_str"]})'
            if os.path.exists(os.path.join(boost_root, 'tools', m)):
                text += '<br><br>Boost Tool'
            if 'authors' in module_props[m]:
                text += f'<br>    by <i>{as_paragraph(humanize_string_list(module_props[m]["authors"], 5), 50, 4)}</i>'
            if os.path.exists(os.path.join(boost_root, 'tools', m)):
                text += '<br>    Boost Tool'
            if m in buildable:
                text += '<br>    Buildable Library'
            text += f'<br>'

            if 'description' in module_props[m]:
                text += f'{as_paragraph(module_props[m]["description"], 80)}<br>'

            if module_props[m]['transitive']:
                deps = sorted(module_props[m]['transitive'], key=lambda d: module_props[d]['level'])
                text = f"{text}<br>Dependencies ({len(deps)}):<br>    {as_paragraph(humanize_string_list(deps, 200), 50, 4)}"
            if graph[m]:
                deps = sorted(graph[m], key=lambda d: module_props[d]['level'], reverse=True)
                text = f"{text}<br>Direct dependencies ({len(deps)}):<br>    {as_paragraph(humanize_string_list(deps, 200), 50, 4)}<br>"

            if module_props[m]['reverse_transitive']:
                deps = sorted(module_props[m]['reverse_transitive'], key=lambda d: module_props[d]['level'],
                              reverse=True)
                text = f"{text}<br>Dependants ({len(deps)}):<br>    {as_paragraph(humanize_string_list(deps, 20), 50, 4)}"
            if module_props[m]['reverse']:
                deps = sorted(module_props[m]['reverse'], key=lambda d: module_props[d]['level'])
                text = f"{text}<br>Direct Dependants ({len(deps)}):<br>    {as_paragraph(humanize_string_list(deps, 20), 50, 4)}"

            layout[m]['symbol'] = 'circle'
            if m in cxxstd_alternatives and cxxstd_alternatives[m]:
                # https://plotly.com/python/marker-style/#custom-marker-symbols
                layout[m]['symbol'] = 'diamond'
                layout[m]['size'] *= 0.8
                text += f"<br><br>Partial alternatives in the C++ standard library:<br>    {as_paragraph(humanize_string_list(cxxstd_alternatives[m], 50), 50, 4)}"
            if gitmodules and not m in gitmodules and not m.startswith('numeric~'):
                layout[m]['symbol'] = 'pentagon'
                layout[m]['size'] *= 0.8
                text += f"<br><br>{m} is a patched module"

            if 'category' in module_props[m] and module_props[m]['category']:
                text += f"<br><br>Category:<br>    {as_paragraph(humanize_string_list(module_props[m]['category'], 50), 50, 4)}"

            layout[m]['text'] = text

    # Arrows
    fig = go.Figure()
    x = []
    y = []
    for [m, deps] in graph.items():
        for d in deps:
            x.append(layout[m]['x'])
            y.append(layout[m]['y'])
            x.append(layout[d]['x'])
            y.append(layout[d]['y'])
            x.append(None)
            y.append(None)
    edges_trace = go.Scatter(x=x, y=y,
                             mode='lines',
                             line_color="rgb(100, 100, 100)",
                             opacity=0.4,
                             line_width=0.3)
    fig.add_trace(edges_trace)

    # Arrows for specified library
    if isinstance(libs, str):
        if libs:
            libs = [libs]
        else:
            libs = []
    for lib in libs:
        # Direct deps
        x = []
        y = []
        for d in graph[lib]:
            x.append(layout[lib]['x'])
            y.append(layout[lib]['y'])
            x.append(layout[d]['x'])
            y.append(layout[d]['y'])
            x.append(None)
            y.append(None)
        edges_trace = go.Scatter(x=x, y=y,
                                 mode='lines',
                                 line_color="rgb(255, 70, 0)",
                                 opacity=0.8,
                                 line_width=2.0,
                                 )
        fig.add_trace(edges_trace)

        # Transitive deps
        x = []
        y = []
        for d0 in module_props[lib]['transitive']:
            for d1 in graph[d0]:
                x.append(layout[d0]['x'])
                y.append(layout[d0]['y'])
                x.append(layout[d1]['x'])
                y.append(layout[d1]['y'])
                x.append(None)
                y.append(None)
        edges_trace = go.Scatter(x=x, y=y,
                                 mode='lines',
                                 line_color="rgb(255, 190, 100)",
                                 opacity=0.8,
                                 line_width=2.0,
                                 )
        fig.add_trace(edges_trace)

        # Rev direct deps
        x = []
        y = []
        for d in module_props[lib]['reverse']:
            x.append(layout[lib]['x'])
            y.append(layout[lib]['y'])
            x.append(layout[d]['x'])
            y.append(layout[d]['y'])
            x.append(None)
            y.append(None)
        edges_trace = go.Scatter(x=x, y=y,
                                 mode='lines',
                                 line_color="rgb(0, 70, 255)",
                                 opacity=0.8,
                                 line_width=2.0,
                                 )
        fig.add_trace(edges_trace)

        # Transitive deps
        x = []
        y = []
        for d0 in module_props[lib]['reverse_transitive']:
            for d1 in module_props[d0]['reverse']:
                x.append(layout[d0]['x'])
                y.append(layout[d0]['y'])
                x.append(layout[d1]['x'])
                y.append(layout[d1]['y'])
                x.append(None)
                y.append(None)
        edges_trace = go.Scatter(x=x, y=y,
                                 mode='lines',
                                 line_color="rgb(100, 190, 255)",
                                 opacity=0.8,
                                 line_width=2.0,
                                 )
        fig.add_trace(edges_trace)

    # Scatter
    max_cxxstd = 1000
    min_cxxstd = 3000
    for [m, ps] in module_props.items():
        if 'cxxstd' in ps:
            max_cxxstd = max(max_cxxstd, ps['cxxstd'])
            min_cxxstd = min(min_cxxstd, ps['cxxstd'])
    cxxstd03f = (2003 - min_cxxstd) / (max_cxxstd - min_cxxstd)
    cxxstd11f = (2011 - min_cxxstd) / (max_cxxstd - min_cxxstd)
    scatter_trace = go.Scatter(x=[xy['x'] for xy in layout.values()], y=[xy['y'] for xy in layout.values()],
                               text=[k for k in layout.keys()],
                               hovertext=[xy['text'] for xy in layout.values()],
                               mode='markers+text',
                               marker_color=[xy['color'] for xy in layout.values()],
                               marker_colorscale=[[0, "rgb(150, 0, 0)"], [cxxstd03f, "rgb(255, 25, 25)"],
                                                  [cxxstd11f, "rgb(100, 100, 255)"],
                                                  [1.0, "rgb(0, 255, 0)"]],
                               marker_opacity=0.9,
                               marker_size=[xy['size'] for xy in layout.values()],
                               marker_line_width=5,
                               marker_line_color=[xy['border'] for xy in layout.values()],
                               marker_symbol=[xy['symbol'] for xy in layout.values()],
                               marker=dict(
                                   colorbar=dict(
                                       title="Min. Standard",
                                       tickvals=[1998, 2003, 2011, 2014, 2017, 2020, 2023],
                                       ticktext=['C++98', 'C++03', 'C++11', 'C++14', 'C++17', 'C++20', 'C++23'],
                                   )),
                               opacity=1.0,
                               textposition="bottom center",
                               textfont=dict(
                                   size=14
                               ))
    fig.add_trace(scatter_trace)
    fig.update_traces(hovertemplate="<br>".join([
        "%{hovertext}<extra></extra>"
    ]))

    links = []
    if output == 'report':
        for m in graph.keys():
            if not libs:
                href = f'libs/{m}.html'
            elif m not in libs:
                href = f'../libs/{m}.html'
            else:
                href = '../index.html'
            links.append(dict(x=layout[m]['x'],
                              y=layout[m]['y'],
                              text=f'<a href="{href}">        </a>',
                              showarrow=False,
                              xanchor='center',
                              yanchor='middle',
                              ))

    date_time = datetime.now()
    fig.update_layout(title=f'Boost Module Dependencies: Visual Report ({date_time.strftime("%d %B, %Y")})',
                      xaxis_title="Level",
                      yaxis=go.layout.YAxis(
                          title='Library',
                          showticklabels=False),
                      yaxis_zeroline=False, xaxis_zeroline=False,
                      showlegend=False,
                      annotations=links)

    if output == 'serve':
        fig.show()
    else:
        if output_path in ['', '.']:
            output_path = 'index.html'
        elif os.path.exists(output_path) and os.path.isdir(output_path):
            output_path = os.path.join(output_path, 'index.html')
        elif not os.path.exists(output_path):
            p = output_path.rfind('/')
            if p != -1:
                last_path_segment = output_path[p + 1:]
            else:
                last_path_segment = output_path
            if last_path_segment.find('.') == -1:
                output_path = os.path.join(output_path, 'index.html')
        try:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
        except FileNotFoundError:
            # don't need to create dir
            pass
        fig.write_html(output_path)

        # Huge workaround to force links in the html

        def rreplace(s, old, new, occurrence):
            li = s.rsplit(old, occurrence)
            return new.join(li)

        with open(output_path, 'r') as html_file:
            html = html_file.read()
            html = rreplace(html, '</script>',
                            "</script><script>const AnnotationElementsWhoseLinksHaveBeenRemovedByPlotly = document.querySelectorAll('text.annotation-text'); AnnotationElementsWhoseLinksHaveBeenRemovedByPlotly.forEach(element => { const childElement = element.querySelector('a'); if (!childElement) {  return; } const dataUnformatted = element.getAttribute('data-unformatted'); if (!dataUnformatted) { return; } const hrefValue = dataUnformatted.match(/href=\"([^&]*)\"/)[1]; if (!hrefValue) { return; } childElement.setAttribute('href', hrefValue); childElement.removeAttribute('target'); }); </script>",
                            1)
        with open(output_path, 'w') as html_file:
            html_file.write(html)
            html_file.close()

    return graph.keys()


def cxxstd_to_int(cxxstd):
    if cxxstd == '98':
        return 1998
    if cxxstd == '03':
        return 2003
    if cxxstd == '11':
        return 2011
    if cxxstd == '14':
        return 2014
    if cxxstd == '17':
        return 2017
    if cxxstd == '20':
        return 2020
    if cxxstd == '23':
        return 2023


def cxxstd_to_string(cxxstd):
    if cxxstd == 1998:
        return '98'
    if cxxstd == 2003:
        return '03'
    if cxxstd == 2011:
        return '11'
    if cxxstd == 2014:
        return '14'
    if cxxstd == 2017:
        return '17'
    if cxxstd == 2020:
        return '20'
    if cxxstd == 2023:
        return '23'


def humanize_string_list(ls, max_els):
    ln = len(ls)
    if ln == 1:
        return ls[0]
    elif ln == 2:
        return f'{ls[0]} and {ls[1]}'
    ls = ls[:max_els]
    text = ''
    for l in ls[:-1]:
        text += l + ', '
    if ln <= len(ls) and len(ls) != 1:
        text += 'and '
    text += ls[-1]
    if ln > len(ls):
        text += f', and {ln - len(ls)} more'
    return text


def as_paragraph(s, max_col, indent=0):
    r = ''
    c = 0
    for w in s.split(' '):
        if c + len(w) > max_col:
            r += '<br>' + ' ' * indent
            c = 0
        r += w
        r += ' '
        c += len(w) + 1
    return r


verbose = 0

def generate_cxxstd_alternatives():
    cxxstd_alternatives = {}
    cxxstd_alternatives['tuple'] = ['std::tuple']
    cxxstd_alternatives['config'] = ['feature test macros']
    cxxstd_alternatives['move'] = ['r-value references']
    cxxstd_alternatives['container_hash'] = ['std::hash']
    cxxstd_alternatives['variant'] = ['std::variant']
    cxxstd_alternatives['variant2'] = ['std::variant']
    cxxstd_alternatives['optional'] = ['std::optional']
    cxxstd_alternatives['system'] = ['std::system_error', 'std::expected']
    cxxstd_alternatives['outcome'] = ['std::expected']
    cxxstd_alternatives['smart_ptr'] = ['std::smart_ptr']
    cxxstd_alternatives['regex'] = ['std::regex']
    cxxstd_alternatives['chrono'] = ['std::chrono']
    cxxstd_alternatives['ratio'] = ['std::ratio']
    cxxstd_alternatives['function'] = ['std::function']
    cxxstd_alternatives['type_index'] = ['std::type_index']
    cxxstd_alternatives['bind'] = ['std::bind']
    cxxstd_alternatives['array'] = ['std::array']
    cxxstd_alternatives['atomic'] = ['std::atomic']
    cxxstd_alternatives['any'] = ['std::any']
    cxxstd_alternatives['container'] = ['std::map', 'std::set', 'std::vector', 'std::list', 'PMR']
    cxxstd_alternatives['dynamic_bitset'] = ['std::vector<bool>']
    cxxstd_alternatives['concept_check'] = ['concepts']
    cxxstd_alternatives['function_types'] = ['std::invoke_result', '<type_traits>']
    cxxstd_alternatives['range'] = ['std::ranges']
    cxxstd_alternatives['format'] = ['std::format']
    cxxstd_alternatives['thread'] = ['std::thread']
    cxxstd_alternatives['locale'] = ['std::locale']
    cxxstd_alternatives['coroutine'] = ['coroutines']
    cxxstd_alternatives['coroutine2'] = ['coroutines']
    cxxstd_alternatives['algorithm'] = ['<algorithm>']
    cxxstd_alternatives['random'] = ['<random>']
    cxxstd_alternatives['sort'] = ['std::sort']
    cxxstd_alternatives['foreach'] = ['range-based for loops']
    cxxstd_alternatives['filesystem'] = ['std::filesystem']
    cxxstd_alternatives['lambda'] = ['lambdas']
    cxxstd_alternatives['typeof'] = ['decltype', 'auto']
    cxxstd_alternatives['date_time'] = ['std::chrono']

    return cxxstd_alternatives

def vprint(*args):
    if verbose >= 1:
        print(*args)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Installs the dependencies needed to test a Boost library.')

    # Main parameters
    parser.add_argument('--boost-root', help="the directory of the boost installation", default='.')
    parser.add_argument('--boostdep', help="the path to the boostdep executable", default='boostdep')
    parser.add_argument('--output', help='output format', choices=['serve', 'html', 'report'], default='serve')
    parser.add_argument('--output_path', help='output directory or file', default='')

    # Graph type
    parser.add_argument('-l', '--libs', help="draw dependencies the given libraries", nargs='+', default=[])

    # Logging
    parser.add_argument('-v', '--verbose', help='enable verbose output', action='count', default=0)
    parser.add_argument('-q', '--quiet', help='quiet output (opposite of -v)', action='count', default=0)

    args = parser.parse_args()
    verbose = args.verbose - args.quiet
    vprint(args)

    # Validate
    if args.output == 'report' and args.libs:
        print(f'"--libs {" ".join(args.libs)}" and "--output report" are invalid')
        exit()

    if not args.output == 'report':
        generate_depgraph(args.boostdep, args.boost_root, args.libs, args.output, output_path=args.output_path)
    else:
        p = os.path.join(os.path.dirname(args.output_path), 'index.html')
        vprint(f'Generate overview: {p}')
        ms = generate_depgraph(args.boostdep, args.boost_root, [], 'report', output_path=p)
        vprint(ms)
        for m in ms:
            p = os.path.join(args.output_path, 'libs', f'{m}.html')
            vprint(f'Generate {m} report: {p}')
            generate_depgraph(args.boostdep, args.boost_root, [m], 'report', output_path=p)
