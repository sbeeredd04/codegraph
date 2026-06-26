const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

/** Bundle the extension host entry. `vscode` is provided by the host, never bundled. */
async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension/index.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: "dist/extension.js",
    external: ["vscode"],
    sourcemap: true,
    logLevel: "info",
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
