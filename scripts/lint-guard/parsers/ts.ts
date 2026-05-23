/**
 * TypeScript AST parser wrapper.
 *
 * We use the TypeScript compiler API (already a devDep of this repo) rather than
 * regex because the rules we enforce — e.g. `no-source-pin` — require structural
 * analysis (`callee.name === "toMatch" && callee.receiver.callee.name === "expect"`),
 * which regex cannot do without brittle false positives.
 *
 * Doctrine ref: PHASE_0_TESTING_PHILOSOPHY.md §2 (canonical tool: TypeScript Compiler API).
 */

import ts from 'typescript';

/**
 * Extensions the TypeScript compiler will produce an AST for.
 * Files OUTSIDE this set (e.g. .sql) are still scanned by the engine for rules that
 * target them — those rules just receive `ctx.ast === undefined` and analyze
 * `ctx.source` directly (e.g., with a SQL-aware text/region scanner).
 */
const PARSE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

/** Returns true if the path has a parseable TS/JS extension. */
export function isParseable(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return false;
  return PARSE_EXTENSIONS.has(filePath.slice(dot));
}

/**
 * Parse source with the appropriate script kind for its extension.
 * Returns undefined for non-parseable files (caller falls back to source-only checks).
 */
export function parseSource(filePath: string, source: string): ts.SourceFile | undefined {
  if (!isParseable(filePath)) return undefined;
  const kind = scriptKindFor(filePath);
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, /*setParentNodes*/ true, kind);
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.ts') || filePath.endsWith('.mts') || filePath.endsWith('.cts')) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}

/**
 * Walk every descendant node of `root` and invoke `visit`. Iterative to avoid stack overflow on large files.
 *
 * IMPORTANT: `ts.forEachChild` aborts iteration if the callback returns anything truthy
 * (it's used internally for short-circuit lookups). `Array.push` returns the new length —
 * a truthy number — which silently truncates the walk to only the first child of each node.
 * The explicit `{ }` block + no return is intentional; do not collapse to an arrow body.
 */
export function walk(root: ts.Node, visit: (node: ts.Node) => void): void {
  const stack: ts.Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visit(node);
    node.forEachChild((child) => {
      stack.push(child);
      // Must return undefined; see comment above.
    });
  }
}

/**
 * Resolve a `CallExpression` to its dotted call chain.
 * Examples:
 *   `expect(x).toMatch(y)`             -> ["expect", "toMatch"]
 *   `fs.readFileSync(p, "utf8")`       -> ["fs", "readFileSync"]
 *   `vi.mock("../foo")`                -> ["vi", "mock"]
 *   `foo.bar.baz()`                    -> ["foo", "bar", "baz"]
 *   `foo()()` (IIFE)                   -> []  (we don't track anonymous chains)
 */
export function callChain(call: ts.CallExpression): string[] {
  const parts: string[] = [];
  let expr: ts.Expression = call.expression;

  while (true) {
    if (ts.isIdentifier(expr)) {
      parts.unshift(expr.text);
      break;
    }
    if (ts.isPropertyAccessExpression(expr)) {
      parts.unshift(expr.name.text);
      expr = expr.expression;
      continue;
    }
    if (ts.isCallExpression(expr)) {
      const innerParts = callChain(expr);
      parts.unshift(...innerParts);
      break;
    }
    break;
  }
  return parts;
}

/** Return the position info for a node, 1-indexed for human-readable output. */
export function nodePosition(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number; endLine: number; endColumn: number } {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  const end = source.getLineAndCharacterOfPosition(node.getEnd());
  return {
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

/**
 * If `call` is `foo(stringLiteral, ...)`, return the first string-literal argument's value.
 * Returns undefined otherwise. Used by `no-source-pin` to confirm `readFileSync` is called
 * with a path argument (vs. some other shape).
 */
export function firstStringArg(call: ts.CallExpression): string | undefined {
  const arg = call.arguments[0];
  if (!arg) return undefined;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return undefined;
}
