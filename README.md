# Boost Dependency Graph

![](banner.png)

An interactive single page that shows how the Boost libraries depend on each other: https://alandefreitas.github.io/boostdep_graph/

Click a library (or search for it) to see what it needs and what needs it. The legend on the page doubles as the control panel: every color, border, marker and edge style is explained there, and each row has a switch to show or hide it. Test and example dependencies are off by default and can be included with two switches.

## Links and URL hash

The page state lives in the URL hash, so views can be shared:

- `#url`: open focused on the `url` library
- `#url&tests=1&examples=1`: also show test and example dependencies
- `#url&labels=0`: only options that differ from the default are stored (`key=0` or `key=1`)
- `#&cat=IO,Math&std=11,14`: filter by category and C++ standard

Old per-library links such as `libs/url.html` redirect to `#url`.

## Generating the data locally

Clone the Boost super-project and build `boostdep`:

```bash
git clone https://github.com/boostorg/boost.git -b develop boost
cd boost
git submodule update --init --recursive
./bootstrap.sh
./b2 tools/boostdep/build
cd ..
```

Generate `data.js` (and the `libs/*.html` redirect stubs), then serve the page:

```bash
python3 main.py --boost-root boost --boostdep boost/dist/bin/boostdep --output-dir .
python3 -m http.server 8000
```

Open http://localhost:8000/. `main.py` uses only the Python standard library; the page has no runtime dependencies and no build step. The generator leaves `data.js` untouched when only the date stamp would change.

## Updating the site

A nightly GitHub Actions job (`.github/workflows/ci.yml`) clones Boost `develop` plus the proposed libraries (capy, corosio, http, websocket, beast2), runs the tests, regenerates `data.js` and `libs/`, and commits them only if something changed. GitHub Pages serves the repository as static files.

## Tests

```bash
python3 -m unittest discover -s tests
node --test tests/*.test.mjs
```

The information about libraries comes from each library's `meta/libraries.json`. When no minimum C++ standard is given, the highest standard among its direct dependencies is used.
