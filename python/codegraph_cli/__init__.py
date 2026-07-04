"""codegraph — pip wrapper for the Node-based codegraph CLI.

Thin delegating shim: the real engine is the Node CLI (npm package ``codegraph``).
See ``runner.resolve_command`` for how the wrapper locates and runs it.
"""

__version__ = "0.0.1"
