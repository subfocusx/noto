/**
 * The regular expressions of the query language.
 *
 * The browser has no RE2: the expression is compiled with the `RegExp` of
 * JavaScript, whose language is close but not the same — the named groups are
 * written `(?<name>...)` in JavaScript and `(?P<name>...)` in RE2, and the
 * look around does not exist in neither of them. The backend uses RE2, the one
 * of Go, where the expression is linear and cannot blow up.
 *
 * The expressions of the golden vectors (`shared/vectors/regex.json`) are the
 * ones both engines understand.
 */

/** The biggest size, in bytes, of a regular expression of the language. */
export const MAX_REGEX_BYTES = 512;

/** The result of the compilation of an expression. */
export interface CompiledRegex {
  /** True when the expression was compiled. */
  readonly ok: boolean;
  /** The compiled expression, when the compilation worked. */
  readonly regex?: RegExp;
  /** Why the expression was refused, when the compilation failed. */
  readonly error?: string;
}

/**
 * Compiles a regular expression of the query language.
 *
 * The expression is bounded in size, and a broken expression is a typed
 * failure, never an exception that escapes.
 */
export function compileRegex(pattern: string): CompiledRegex {
  const size = new TextEncoder().encode(pattern).length;
  if (size > MAX_REGEX_BYTES) {
    return { ok: false, error: `the expression is longer than ${MAX_REGEX_BYTES} bytes` };
  }
  try {
    return { ok: true, regex: new RegExp(pattern) };
  } catch (error) {
    return { ok: false, error: reasonOf(error) };
  }
}

/**
 * The reason of a refusal of the engine of JavaScript, without the noise of
 * its own message.
 */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Invalid regular expression:\s*/, '')
    .replace(/^\/.*\/[a-z]*:\s*/, '')
    .trim();
}
