# codegraph (pip wrapper)

`pip install codegraph` for Python developers. codegraph graphs any codebase into a
navigable knowledge surface your AI agent can query instead of grepping — real
call / import / render edges, signatures, an interactive board, and an MCP.

codegraph is **one tool with two install paths**:

- **npm / npx** (JS devs): `npx codegraph graph .`
- **pip** (Python devs): `pip install codegraph`, then `codegraph graph .`

This package is a **thin wrapper**. The engine is the Node CLI (npm package
`codegraph`); the wrapper locates Node and delegates, forwarding your arguments and
exit code. It reimplements nothing.

## Requirements

- **Node.js ≥ 20** (provides `npx`). The wrapper runs the Node CLI — it does not
  bundle a JavaScript runtime. This mirrors how a native tool documents its own
  runtime dependency.

## Usage

Everything the Node CLI does, unchanged:

```bash
codegraph graph .              # write the .codegraph/ artifact (graph.json + report)
codegraph .                    # scan + open the interactive board
codegraph serve --from-artifact  # serve the persisted graph, no re-scan
codegraph query "what calls login"   # a grounded answer from the graph
codegraph skill                # print the agent SKILL.md
```

## How it resolves the CLI

1. `$CODEGRAPH_CLI` — an absolute path to a local `dist/cli.js`, run with `node`
   (the dev / pre-publish path; set `$CODEGRAPH_NODE_BIN` to pick the node binary).
2. `npx -y codegraph` — once the npm package is published.

It never shells out to a bare `codegraph` on `PATH` (that would recurse into this
wrapper); `npx` resolves the npm package, which is recursion-safe.

## Development

```bash
cd python
python3 -m unittest discover -s tests -v     # stdlib tests, no extra deps
CODEGRAPH_CLI=$PWD/../dist/cli.js codegraph --help   # run against a local build
```

## Publishing (owner-gated)

Not yet on PyPI. Publishing requires an owner decision (package **license**, PyPI
account + token) **and** the npm package to be published first so `npx codegraph`
resolves. Build with `python -m build` and upload with `twine` when that is settled.
