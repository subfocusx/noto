// The highlighting of the code blocks of the preview.
//
// The highlighter is small on purpose: it knows a handful of languages and
// it never brings a parser of its own. The text of the code is escaped
// first, so a block of code can never carry markup into the preview.

import { escapeHtml } from './escape';

/** The kinds of the tokens of the highlighter. */
export type CodeTokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number';

/** A token of the highlighter. */
export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
}

/** The rules of one language. */
interface LanguageProfile {
  /** The words that are painted as keywords. */
  keywords: string[];
  /** The markers of a comment that ends with the line. */
  lineComments: string[];
  /** The pairs of the markers of a comment that may span the lines. */
  blockComments: [string, string][];
  /** The characters that open a string. */
  quotes: string[];
  /** True when the keywords are written in lower case only. */
  lowerCase?: boolean;
}

const JS_KEYWORDS = [
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'of', 'return',
  'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
  'var', 'void', 'while', 'yield',
];

const PYTHON_KEYWORDS = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'false', 'finally', 'for', 'from', 'global', 'if', 'import',
  'in', 'is', 'lambda', 'none', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'true', 'try', 'while', 'with', 'yield',
];

const SHELL_KEYWORDS = [
  'case', 'cd', 'do', 'done', 'echo', 'elif', 'else', 'esac', 'exit', 'export', 'fi',
  'for', 'function', 'if', 'in', 'local', 'readonly', 'return', 'set', 'source', 'then',
  'unset', 'while',
];

const SQL_KEYWORDS = [
  'all', 'and', 'as', 'asc', 'by', 'case', 'create', 'delete', 'desc', 'distinct', 'drop',
  'else', 'end', 'from', 'group', 'having', 'in', 'inner', 'insert', 'into', 'is', 'join',
  'left', 'limit', 'not', 'null', 'offset', 'on', 'or', 'order', 'outer', 'right',
  'select', 'set', 'table', 'then', 'union', 'update', 'values', 'when', 'where',
];

const CSS_KEYWORDS = [
  'absolute', 'auto', 'block', 'bold', 'border', 'bottom', 'center', 'color', 'column',
  'content', 'display', 'flex', 'fixed', 'font', 'grid', 'height', 'hidden', 'inline',
  'italic', 'left', 'margin', 'none', 'normal', 'padding', 'pointer', 'position',
  'relative', 'right', 'solid', 'top', 'transparent', 'upper', 'var', 'width',
];

/** The languages the highlighter knows. */
const PROFILES: Record<string, LanguageProfile> = {
  javascript: {
    keywords: JS_KEYWORDS,
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    quotes: ['"', "'", '`'],
  },
  json: {
    keywords: ['true', 'false', 'null'],
    lineComments: [],
    blockComments: [],
    quotes: ['"'],
  },
  python: {
    keywords: PYTHON_KEYWORDS,
    lineComments: ['#'],
    blockComments: [],
    quotes: ['"', "'"],
    lowerCase: true,
  },
  shell: {
    keywords: SHELL_KEYWORDS,
    lineComments: ['#'],
    blockComments: [],
    quotes: ['"', "'"],
    lowerCase: true,
  },
  sql: {
    keywords: SQL_KEYWORDS,
    lineComments: ['--'],
    blockComments: [['/*', '*/']],
    quotes: ['"', "'"],
    lowerCase: true,
  },
  css: {
    keywords: CSS_KEYWORDS,
    lineComments: [],
    blockComments: [['/*', '*/']],
    quotes: ['"', "'"],
    lowerCase: true,
  },
};

/** The names of the languages, as they are written in the fence of the code. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
  typescript: 'javascript',
  mjs: 'javascript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  console: 'shell',
  json: 'json',
  json5: 'json',
  sql: 'sql',
  css: 'css',
  scss: 'css',
};

/** True when the character may be a part of a word. */
function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/**
 * The profile of a language, or `null` when the language is unknown.
 *
 * The name of the language is the one of the fence of the code block; the
 * aliases of the usual names are known.
 */
export function languageProfile(language: string): LanguageProfile | null {
  const name = language.trim().toLowerCase();
  const key = ALIASES[name] ?? name;
  return PROFILES[key] ?? null;
}

/**
 * Splits the code into the tokens of the highlighter.
 *
 * A language that is not known gives one plain token: the code is shown as
 * it is, without a colour.
 */
export function tokenizeCode(code: string, language: string): CodeToken[] {
  const profile = languageProfile(language);
  if (!profile) return [{ kind: 'plain', text: code }];
  const keywords = new Set(profile.keywords);
  const tokens: CodeToken[] = [];
  let index = 0;

  const push = (kind: CodeTokenKind, text: string): void => {
    if (text === '') return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) {
      last.text += text;
      return;
    }
    tokens.push({ kind, text });
  };

  while (index < code.length) {
    const rest = code.slice(index);

    const lineComment = profile.lineComments.find((marker) => rest.startsWith(marker));
    if (lineComment) {
      const end = code.indexOf('\n', index);
      const stop = end === -1 ? code.length : end;
      push('comment', code.slice(index, stop));
      index = stop;
      continue;
    }

    const blockComment = profile.blockComments.find(([open]) => rest.startsWith(open));
    if (blockComment) {
      const [open, close] = blockComment;
      const end = code.indexOf(close, index + open.length);
      const stop = end === -1 ? code.length : end + close.length;
      push('comment', code.slice(index, stop));
      index = stop;
      continue;
    }

    const ch = code[index] as string;
    if (profile.quotes.includes(ch)) {
      let cursor = index + 1;
      while (cursor < code.length) {
        const current = code[cursor] as string;
        if (current === '\\') {
          cursor += 2;
          continue;
        }
        if (current === ch) {
          cursor += 1;
          break;
        }
        if (current === '\n' && ch !== '`') break;
        cursor += 1;
      }
      push('string', code.slice(index, cursor));
      index = cursor;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let cursor = index;
      while (cursor < code.length && /[0-9._]/.test(code[cursor] as string)) cursor += 1;
      push('number', code.slice(index, cursor));
      index = cursor;
      continue;
    }

    if (isWordChar(ch)) {
      let cursor = index;
      while (cursor < code.length && isWordChar(code[cursor] as string)) cursor += 1;
      const word = code.slice(index, cursor);
      const key = profile.lowerCase ? word.toLowerCase() : word;
      push(keywords.has(key) ? 'keyword' : 'plain', word);
      index = cursor;
      continue;
    }

    push('plain', ch);
    index += 1;
  }

  return tokens;
}

/**
 * The highlighted code, as HTML.
 *
 * The text is escaped, so the result can never carry markup into the
 * preview.
 */
export function highlightCode(code: string, language: string): string {
  return tokenizeCode(code, language)
    .map((token) => {
      const text = escapeHtml(token.text);
      if (token.kind === 'plain') return text;
      return `<span class="noto-code-${token.kind}">${text}</span>`;
    })
    .join('');
}
