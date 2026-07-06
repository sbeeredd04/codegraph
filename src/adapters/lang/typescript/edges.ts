import * as path from "node:path";
import { Node, SyntaxKind } from "ts-morph";
import type { Project, ClassDeclaration } from "ts-morph";
import type { GraphEdge } from "../../../core/graph/types.js";

// Accurate edge layer (AD-9): ts-morph resolves cross-file references the
// tree-sitter skeleton can't — module-level `depends-on` (imports) via
// resolveImportEdges, and `calls` (function/method -> function/method) via
// resolveCallEdges over the type checker. Both ship here and are wired in bootstrap.

function toRel(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

/**
 * A repo-relative path is first-party when it lives inside the root and isn't a
 * dependency or a declaration file. Edges to external packages (node_modules) and
 * `.d.ts` files are noise — and, worse, unstable: a baseline worktree resolves
 * them to a different absolute path than the working tree, so they read as
 * phantom changes. The graph stays first-party only.
 */
function isFirstParty(rel: string): boolean {
  return !rel.startsWith("..") && !rel.includes("node_modules") && !rel.endsWith(".d.ts");
}

/**
 * Resolve module-level dependency edges for every source file in the project.
 * Imports that don't resolve to a first-party file (external packages, missing
 * modules, .d.ts) are skipped — only real intra-project dependencies become edges.
 */
export function resolveImportEdges(project: Project, rootDir: string): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    const from = `ts:${toRel(rootDir, sourceFile.getFilePath())}`;
    for (const decl of sourceFile.getImportDeclarations()) {
      const target = decl.getModuleSpecifierSourceFile();
      if (!target) continue;
      const rel = toRel(rootDir, target.getFilePath());
      if (!isFirstParty(rel)) continue;
      const to = `ts:${rel}`;
      if (from !== to) edges.push({ from, to, type: "depends-on" });
    }
  }
  return edges;
}

/** Address of a function/method declaration, matching the tree-sitter skeleton's
 * scheme. Returns undefined for anonymous decls or external files (lib/.d.ts/deps). */
function declarationAddress(node: Node | undefined, rootDir: string): string | undefined {
  if (!node) return undefined;
  const rel = toRel(rootDir, node.getSourceFile().getFilePath());
  if (!isFirstParty(rel)) return undefined;
  if (Node.isFunctionDeclaration(node)) {
    const name = node.getName();
    return name ? `ts:${rel}#${name}` : undefined;
  }
  if (Node.isMethodDeclaration(node)) {
    const name = node.getName();
    const className = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName();
    return name && className ? `ts:${rel}#${className}.${name}` : undefined;
  }
  // FR-83: `const App = () => …` / `const useThing = function…` — a VariableDeclaration
  // whose initializer is an arrow/function expression. The tree-sitter skeleton emits
  // it as `ts:rel#Name`, so mirror that here to make React/RN components + hooks first-
  // class call endpoints (both caller and target).
  if (Node.isVariableDeclaration(node) && isFunctionInitialized(node)) {
    const name = node.getName();
    return name ? `ts:${rel}#${name}` : undefined;
  }
  return undefined;
}

/** Whether a variable is initialized with a function value (arrow or function
 *  expression) — i.e. it defines a callable, not just holds data. */
function isFunctionInitialized(decl: Node): boolean {
  if (!Node.isVariableDeclaration(decl)) return false;
  const init = decl.getInitializer();
  return !!init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init));
}

/**
 * Resolve `calls` edges (function/method -> function/method) via the type
 * checker. Calls to external/anonymous/arrow targets are skipped — only edges
 * whose endpoints match a skeleton node survive.
 */
export function resolveCallEdges(project: Project, rootDir: string): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const sourceFile of project.getSourceFiles()) {
    const callers: Node[] = [
      ...sourceFile.getFunctions(),
      ...sourceFile.getClasses().flatMap((c) => c.getMethods()),
      // FR-83: arrow/function-expression components + hooks (`const App = () => …`).
      ...sourceFile.getVariableDeclarations().filter(isFunctionInitialized),
    ];
    for (const caller of callers) {
      const from = declarationAddress(caller, rootDir);
      if (!from) continue;
      for (const call of caller.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const symbol = call.getExpression().getSymbol();
        if (!symbol) continue;
        // Symbol declarations, plus the import-alias target for cross-file calls.
        const targets = [
          ...symbol.getDeclarations(),
          ...(symbol.getAliasedSymbol()?.getDeclarations() ?? []),
        ];
        for (const target of targets) {
          const to = declarationAddress(target, rootDir);
          if (!to || to === from) continue;
          const key = `${from}->${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ from, to, type: "calls" });
          break;
        }
      }
    }
  }
  return edges;
}

/** Address of a first-party class declaration (`ts:rel#Class`), matching the skeleton's
 *  scheme. Undefined for anonymous classes or external files (lib/.d.ts/node_modules). */
function classAddress(cls: ClassDeclaration, rootDir: string): string | undefined {
  const rel = toRel(rootDir, cls.getSourceFile().getFilePath());
  if (!isFirstParty(rel)) return undefined;
  const name = cls.getName();
  return name ? `ts:${rel}#${name}` : undefined;
}

/** The `ts:file` prefix of a node address (everything before `#`), to tell same-file
 *  from cross-file — the guard that keeps this layer from duplicating the skeleton's. */
const fileOf = (address: string): string => address.split("#")[0];

/** `getBaseClass()` uses the type checker and can throw on unresolvable heritage
 *  (mixin expressions, malformed extends); treat any failure as "no base". */
function safeBaseClass(cls: ClassDeclaration): ClassDeclaration | undefined {
  try {
    return cls.getBaseClass();
  } catch {
    return undefined;
  }
}

/** Walk up `cls`'s resolved base chain (nearest base first) to the first base class that
 *  declares a method named `methodName`; returns that base method's address. Bases resolve
 *  across files via the type checker; external (node_modules/.d.ts) bases drop out via
 *  classAddress. Cycle-safe on the resolved addresses. */
function nearestBaseMethod(cls: ClassDeclaration, methodName: string, rootDir: string): string | undefined {
  const seen = new Set<string>();
  let base = safeBaseClass(cls);
  while (base) {
    const baseAddress = classAddress(base, rootDir);
    if (!baseAddress || seen.has(baseAddress)) break;
    seen.add(baseAddress);
    if (base.getMethod(methodName)) return `${baseAddress}.${methodName}`;
    base = safeBaseClass(base);
  }
  return undefined;
}

/**
 * FR-97 cross-file: a subclass method that redefines an inherited method emits an
 * `overrides` edge to the base method, even when the base class is imported from another
 * file (`class HTTPAdapter extends BaseAdapter` with BaseAdapter imported). ts-morph's
 * getBaseClass() resolves the base ClassDeclaration across files via the type checker —
 * the TS analog of Pyright's definition lookup. The tree-sitter skeleton already resolves
 * SAME-FILE inheritance (T17.1), so this emits ONLY the cross-file edges (base method in a
 * different file) to avoid duplicating that layer — the same split as the Python two-layer.
 */
export function resolveOverrideEdges(project: Project, rootDir: string): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const sourceFile of project.getSourceFiles()) {
    for (const cls of sourceFile.getClasses()) {
      const subAddress = classAddress(cls, rootDir);
      if (!subAddress) continue;
      for (const method of cls.getMethods()) {
        const from = `${subAddress}.${method.getName()}`;
        const to = nearestBaseMethod(cls, method.getName(), rootDir);
        if (!to || to === from || fileOf(to) === fileOf(from)) continue;
        const key = `${from}->${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from, to, type: "overrides" });
      }
    }
  }
  return edges;
}

/**
 * FR-84: resolve JSX `renders` edges (component -> the component it renders in JSX).
 * A `<Card/>` element isn't a CallExpression, so resolveCallEdges misses it; this pass
 * walks each component's JSX and resolves the tag's symbol via the type checker, so it
 * catches both same-file and imported components. Host elements (`<div>`, `<View>`)
 * resolve to lib/node_modules/.d.ts and are dropped by isFirstParty, so only real
 * first-party components become edges. The edge stays `type: "calls"` (JSX compiles to
 * `React.createElement`) with a `render` sub-kind for the nicer "renders" label.
 */
export function resolveRenderEdges(project: Project, rootDir: string): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const sourceFile of project.getSourceFiles()) {
    const components: Node[] = [
      ...sourceFile.getFunctions(),
      // Arrow/function-expression components (`const App = () => <…>`), per FR-83.
      ...sourceFile.getVariableDeclarations().filter(isFunctionInitialized),
    ];
    for (const component of components) {
      const from = declarationAddress(component, rootDir);
      if (!from) continue;
      const elements = [
        ...component.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
        ...component.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ];
      for (const element of elements) {
        const tag = element.getTagNameNode();
        // Only Capitalized tags are components — `<div>`/`<view>` are host elements.
        // (`<Nav.Item>` → check the trailing member.)
        const leaf = tag.getText().replace(/^.*\./, "");
        if (!/^[A-Z]/.test(leaf)) continue;
        const symbol = tag.getSymbol();
        if (!symbol) continue;
        const targets = [
          ...symbol.getDeclarations(),
          ...(symbol.getAliasedSymbol()?.getDeclarations() ?? []),
        ];
        for (const target of targets) {
          const to = declarationAddress(target, rootDir);
          if (!to || to === from) continue;
          const key = `${from}->${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ from, to, type: "calls", call: "render" });
          break;
        }
      }
    }
  }
  return edges;
}
