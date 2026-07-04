"""Unit tests for the pip-wrapper command resolution.

Stdlib ``unittest`` (no third-party dep) so the node verify gate can run these with a
bare ``python3 -m unittest``. Covers the resolution order, argv forwarding, and the
recursion-safety guarantee (the wrapper never shells to a bare ``codegraph``).
"""

from __future__ import annotations

import unittest

from codegraph_cli.runner import (
    ENV_CLI,
    ENV_NODE,
    NPM_PACKAGE,
    NodeNotFoundError,
    resolve_command,
)


def which_of(*present: str):
    """A fake ``shutil.which`` that only knows about ``present`` executables."""
    found = set(present)
    return lambda name: f"/usr/bin/{name}" if name in found else None


class ResolveCommandTests(unittest.TestCase):
    def test_uses_local_cli_when_env_set(self) -> None:
        cmd = resolve_command(
            ["graph", "."],
            which=which_of("node"),
            env={ENV_CLI: "/repo/dist/cli.js"},
        )
        self.assertEqual(cmd, ["/usr/bin/node", "/repo/dist/cli.js", "graph", "."])

    def test_honors_explicit_node_bin(self) -> None:
        cmd = resolve_command(
            ["serve"],
            which=which_of(),  # node not on PATH, but the override supplies it
            env={ENV_CLI: "/repo/dist/cli.js", ENV_NODE: "/opt/node20/bin/node"},
        )
        self.assertEqual(cmd, ["/opt/node20/bin/node", "/repo/dist/cli.js", "serve"])

    def test_falls_back_to_npx_when_no_env(self) -> None:
        cmd = resolve_command(["query", "what calls login"], which=which_of("npx"), env={})
        self.assertEqual(cmd, ["/usr/bin/npx", "-y", NPM_PACKAGE, "query", "what calls login"])

    def test_forwards_args_verbatim_including_flags(self) -> None:
        cmd = resolve_command(["serve", "--from-artifact"], which=which_of("npx"), env={})
        self.assertEqual(cmd[-2:], ["serve", "--from-artifact"])

    def test_never_delegates_to_a_bare_codegraph_on_path(self) -> None:
        # Even if a `codegraph` exists on PATH (this very wrapper), we go through npx,
        # never shell out to `codegraph` — which would recurse into the wrapper.
        cmd = resolve_command(["skill"], which=which_of("npx", "codegraph"), env={})
        self.assertNotEqual(cmd[0], "/usr/bin/codegraph")
        self.assertEqual(cmd[0], "/usr/bin/npx")

    def test_raises_when_no_node_available(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            resolve_command(["graph"], which=which_of(), env={})

    def test_raises_when_env_cli_set_but_node_missing(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            resolve_command(["graph"], which=which_of(), env={ENV_CLI: "/repo/dist/cli.js"})


if __name__ == "__main__":
    unittest.main()
