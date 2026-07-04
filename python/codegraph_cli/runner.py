"""Resolve how to run the Node ``codegraph`` CLI from the pip wrapper.

codegraph's engine is the Node CLI (``dist/cli.js``, published to npm as
``codegraph``). This pip package is a *thin wrapper* so Python developers can
``pip install codegraph`` and get the same ``codegraph graph``/``serve``/``query``/
``skill`` commands — it reimplements nothing, it locates Node and delegates.

Kept free of side effects so the resolution logic is unit-testable: ``resolve_command``
takes injectable ``which`` and ``env`` and returns the argv to exec; ``__main__``
does the actual process launch.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Callable, Mapping, Sequence

#: The npm package the Node CLI publishes under (what ``npx`` resolves).
NPM_PACKAGE = "codegraph"

#: Env override: absolute path to a local ``dist/cli.js`` (run with node). The dev /
#: pre-publish path, and how the owner tests before the npm publish lands.
ENV_CLI = "CODEGRAPH_CLI"
#: Env override: the node executable to use (default: ``node`` on PATH).
ENV_NODE = "CODEGRAPH_NODE_BIN"

Which = Callable[[str], "str | None"]


class NodeNotFoundError(RuntimeError):
    """Neither a local ``dist/cli.js`` nor ``npx`` could be located."""


def resolve_command(
    args: Sequence[str],
    *,
    which: Which = shutil.which,
    env: Mapping[str, str] | None = None,
) -> list[str]:
    """Build the argv that runs the Node codegraph CLI with ``args`` appended.

    Resolution order:

    1. ``$CODEGRAPH_CLI`` (a ``dist/cli.js`` path) run via node — the dev / local path.
    2. ``npx -y codegraph`` when ``npx`` is on PATH — the published path.

    It never delegates to a bare ``codegraph`` on PATH: this wrapper installs a console
    script of that same name, so that would recurse forever. ``npx`` resolves the npm
    *package* (not this Python script), so it is recursion-safe.

    Raises:
        NodeNotFoundError: when no way to reach the Node CLI can be found.
    """
    environ: Mapping[str, str] = os.environ if env is None else env
    forwarded = list(args)

    cli = environ.get(ENV_CLI)
    if cli:
        node = environ.get(ENV_NODE) or which("node")
        if not node:
            raise NodeNotFoundError(
                f"{ENV_CLI} is set but Node.js was not found. Install Node >= 20, "
                f"or set {ENV_NODE} to the node executable."
            )
        return [node, cli, *forwarded]

    npx = which("npx")
    if npx:
        return [npx, "-y", NPM_PACKAGE, *forwarded]

    raise NodeNotFoundError(
        "codegraph requires Node.js. Install Node >= 20 (which provides npx), or set "
        f"{ENV_CLI} to a local dist/cli.js. codegraph is one tool with two install "
        "paths: npm/npx for JS devs, pip for Python devs (this wrapper)."
    )
