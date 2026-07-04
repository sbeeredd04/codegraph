"""Console-script entry point for the ``codegraph`` pip wrapper.

Delegates to the Node CLI, forwarding argv and propagating the exit code, so
``codegraph graph .`` / ``serve`` / ``query`` / ``skill`` behave identically whether
installed via pip or npm.
"""

from __future__ import annotations

import subprocess
import sys

from .runner import NodeNotFoundError, resolve_command


def main(argv: list[str] | None = None) -> int:
    """Resolve and run the Node CLI; return its exit code."""
    args = sys.argv[1:] if argv is None else argv
    try:
        command = resolve_command(args)
    except NodeNotFoundError as exc:
        print(f"codegraph: {exc}", file=sys.stderr)
        return 1

    try:
        return subprocess.run(command, check=False).returncode
    except FileNotFoundError:
        print(
            "codegraph: could not launch Node.js — is it installed and on your PATH?",
            file=sys.stderr,
        )
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
