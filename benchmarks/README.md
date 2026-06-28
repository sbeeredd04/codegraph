# Benchmarks

Real-world `GraphSnapshot` fixtures for building and evaluating the frontend
against substantial graphs (hundreds of nodes), instead of tiny hand-made
fixtures.

## `trpc.snapshot.json`

The [tRPC](https://github.com/trpc/trpc) monorepo (`packages/**`, TS only),
excluding `examples/`, `www/`, `scripts/`, `_artifacts/`, and `__tests__/`.

- **590 nodes** — 198 modules, 312 functions, 63 methods, 17 classes
- **1259 edges** — 392 contains, 381 depends-on, 486 calls
- 7 packages: server (253), client (132), openapi (79), react-query (49),
  next (27), tanstack-react-query (26), upgrade (23)

## Regenerating

Clone the target repo, then point the generator at it:

```sh
git clone --depth 1 https://github.com/trpc/trpc.git /tmp/trpc
npx tsx scripts/gen-benchmark.ts /tmp/trpc benchmarks/trpc.snapshot.json
```

The generator (`scripts/gen-benchmark.ts`) runs `bootstrapRepo` over the repo
and writes an `exportGraphSnapshot` JSON, printing node/edge/coverage stats.
