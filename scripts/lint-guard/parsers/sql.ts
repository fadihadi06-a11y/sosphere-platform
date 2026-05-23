/**
 * SQL pre-tokenizer.
 *
 * We do NOT use a full SQL parser (pgsql-ast-parser) for two reasons:
 *   1. The patterns we forbid (`OR company_id IS NULL`, `USING(true)`, `WITH CHECK(TRUE)`)
 *      are lexical and unambiguous once comments + string literals are masked.
 *   2. A full parser refuses to load files with mild syntax variance (Supabase migrations
 *      sometimes include `\set` psql commands or vendor-specific constructs). Robustness
 *      beats theoretical purity for a guard layer.
 *
 * What this module DOES:
 *   - `maskCommentsAndStrings(source)` returns a string of the same length where
 *     comment/string content has been replaced with spaces. This lets a downstream
 *     regex match real SQL tokens while ignoring strings and comments.
 *   - `lineColOf(source, index)` converts a character index into 1-indexed line/column.
 *
 * Supported syntactic constructs:
 *   - `-- line comment`             (PostgreSQL line comment)
 *   - `/* block comment *​/`        (block comment)
 *   - `'single quoted string'`     (with `''` escape)
 *   - `$$ ... $$` dollar-quoted strings
 *   - `$tag$ ... $tag$` tagged dollar-quoted strings
 *   - `"identifier"`               (preserved — these are identifiers, not strings)
 */

/** Mask comments and string literals in `source` with spaces (preserves length). */
export function maskCommentsAndStrings(source: string): string {
  const out: string[] = new Array(source.length);
  for (let i = 0; i < source.length; i++) out[i] = source[i];

  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    // Line comment: -- ... \n
    if (c === '-' && next === '-') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      for (let j = i; j < stop; j++) if (out[j] !== '\n') out[j] = ' ';
      i = stop;
      continue;
    }

    // Block comment: /* ... */  (PostgreSQL block comments do NOT nest in spec, but
    // we tolerate nesting to be safe — many tools allow it.)
    if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (source[j] === '/' && source[j + 1] === '*') { depth++; j += 2; continue; }
        if (source[j] === '*' && source[j + 1] === '/') { depth--; j += 2; continue; }
        j++;
      }
      for (let k = i; k < j; k++) if (out[k] !== '\n') out[k] = ' ';
      i = j;
      continue;
    }

    // Single-quoted string with '' escape.
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === "'" && source[j + 1] === "'") { j += 2; continue; }
        if (source[j] === "'") { j++; break; }
        j++;
      }
      for (let k = i; k < j; k++) if (out[k] !== '\n') out[k] = ' ';
      i = j;
      continue;
    }

    // Dollar-quoted string: $$ ... $$  or  $tag$ ... $tag$
    if (c === '$') {
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const endIdx = source.indexOf(tag, i + tag.length);
        const stop = endIdx < 0 ? n : endIdx + tag.length;
        for (let k = i; k < stop; k++) if (out[k] !== '\n') out[k] = ' ';
        i = stop;
        continue;
      }
    }

    i++;
  }
  return out.join('');
}

/** Convert a character index into a 1-indexed { line, column } pair. */
export function lineColOf(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, column: col };
}

/**
 * Find all regex matches in `text` and return their 1-indexed positions plus the matched substring.
 * Regex MUST be sticky-or-global; non-global is rejected to avoid infinite loops.
 */
export function findAll(
  text: string,
  re: RegExp,
): Array<{ start: number; end: number; line: number; column: number; match: string }> {
  if (!re.global) throw new Error('findAll requires a global regex');
  const results: Array<{ start: number; end: number; line: number; column: number; match: string }> = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    const { line, column } = lineColOf(text, m.index);
    results.push({ start: m.index, end: m.index + m[0].length, line, column, match: m[0] });
    if (m.index === re.lastIndex) re.lastIndex++; // safety against zero-width
  }
  return results;
}
