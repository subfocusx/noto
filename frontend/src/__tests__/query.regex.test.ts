/**
 * The regular expressions of the query language in the browser.
 *
 * The test reads the golden vectors of `shared/vectors/regex.json`: the very
 * same file is read by the backend (`backend/internal/query/regex_vectors_test.go`),
 * so the two implementations of the language cannot drift.
 *
 * The browser has no RE2: the expressions are compiled with the `RegExp` of
 * JavaScript, whose language is close but not the same.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQuery, QueryParseError } from '../core/query/grammar';
import { toCanonical } from '../core/query/ir';
import { compilePredicate, type QueryNote } from '../core/query/predicate';
import { matchRanges } from '../core/query/highlight';
import { MAX_REGEX_BYTES } from '../core/query/regex';

interface QueryVector {
  name: string;
  source: string;
  ast?: unknown;
  error?: string;
}

interface VectorFile {
  queries: QueryVector[];
}

const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const VECTORS_PATH = resolve(cwd, '..', 'shared', 'vectors', 'regex.json');

function loadVectors(): VectorFile {
  return JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as VectorFile;
}

const NOTE: QueryNote = {
  path: 'notes/todo.md',
  name: 'todo.md',
  content: '# Todo\n\n#work #urgent\n\n- [ ] a task\n',
  title: 'Todo',
  tags: ['work', 'urgent'],
  folder: 'notes',
  ext: 'md',
  createdAt: 1000,
  updatedAt: 2000,
  hasTaskList: true,
  hasIncompleteTasks: true,
  hasCode: false,
  hasImage: false,
  hasLink: false,
  hasAttachments: false,
};

function matching(source: string): boolean {
  const ast = parseQuery(source);
  expect(ast).not.toBeNull();
  return compilePredicate(ast)(NOTE);
}

describe('the golden vectors of the regular expressions', () => {
  const vectors = loadVectors();

  it('has the golden vectors', () => {
    expect(Array.isArray(vectors.queries)).toBe(true);
    expect(vectors.queries.length).toBeGreaterThan(0);
  });

  for (const vector of vectors.queries) {
    it(`parses: ${vector.name}`, () => {
      if (vector.error !== undefined) {
        let message: string | null = null;
        try {
          parseQuery(vector.source);
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toBe(vector.error);
        return;
      }
      const ast = parseQuery(vector.source);
      expect(toCanonical(ast)).toEqual(vector.ast);
    });
  }
});

describe('the operator of the regular expressions', () => {
  it('matches the title', () => {
    expect(matching('title matches "^To"')).toBe(true);
    expect(matching('title matches "^to"')).toBe(false);
    expect(matching('title.matches("^To")')).toBe(true);
  });

  it('matches the text of the note', () => {
    expect(matching('content matches "#work"')).toBe(true);
    expect(matching('content matches "^# Todo"')).toBe(true);
    expect(matching('content matches "pineapple"')).toBe(false);
  });

  it('matches the path, the name, the folder and the extension', () => {
    expect(matching('path matches "^notes/"')).toBe(true);
    expect(matching('name matches "\\.md$"')).toBe(true);
    expect(matching('folder matches "^notes$"')).toBe(true);
    expect(matching('ext matches "^md$"')).toBe(true);
  });

  it('matches the tags, which are lower cased', () => {
    expect(matching('tag matches "^w"')).toBe(true);
    expect(matching('tag matches "^W"')).toBe(false);
    expect(matching('tag matches "^z"')).toBe(false);
  });

  it('is case sensitive', () => {
    expect(matching('title matches "Todo"')).toBe(true);
    expect(matching('title matches "todo"')).toBe(false);
  });

  it('lives with the other operators', () => {
    expect(matching('!title matches "^To"')).toBe(false);
    expect(matching('title matches "^To" && has_task_list')).toBe(true);
    expect(matching('title matches "^To" && has_code')).toBe(false);
  });
});

describe('the prefix form of the operator of the regular expressions', () => {
  it('looks for the expression in the title, in the text, in the path and in the tags', () => {
    expect(matching('match:^Todo')).toBe(true);
    expect(matching('match:^todo')).toBe(false);
    expect(matching('match:urgent')).toBe(true);
    expect(matching('match:^notes/')).toBe(true);
    expect(matching('match:pineapple')).toBe(false);
  });

  it('ends at the first space', () => {
    expect(matching('match:^Todo && has_task_list')).toBe(true);
    expect(matching('match:^Todo && has_code')).toBe(false);
    expect(matching('match:^Todo || has_code')).toBe(true);
  });

  it('accepts a quoted expression', () => {
    expect(matching('match:"^Todo"')).toBe(true);
  });
});

describe('the broken expressions of the browser', () => {
  it('are refused with a typed error', () => {
    for (const source of ['title matches "["', 'match:[']) {
      let error: unknown = null;
      try {
        parseQuery(source);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(QueryParseError);
      expect((error as Error).message).toMatch(/^invalid regular expression: /);
    }
  });

  it('are bounded in size', () => {
    const long = 'a'.repeat(MAX_REGEX_BYTES + 1);
    expect(() => parseQuery(`title matches "${long}"`)).toThrow(QueryParseError);
    expect(() => parseQuery(`title matches "${'a'.repeat(MAX_REGEX_BYTES)}"`)).not.toThrow();
  });

  it('never make the predicate throw', () => {
    const ast = {
      k: 'cmp' as const,
      f: 'title' as const,
      op: 'matches' as const,
      v: { k: 'str' as const, v: '[' },
    };
    const predicate = compilePredicate(ast);
    expect(predicate(NOTE)).toBe(false);
  });
});

describe('the highlight of the matches', () => {
  it('gives the ranges of the text that the expression matches', () => {
    const ast = parseQuery('content matches "task"');
    const ranges = matchRanges(NOTE.content, ast);
    expect(ranges).toEqual([{ from: NOTE.content.indexOf('task'), to: NOTE.content.indexOf('task') + 4 }]);
  });

  it('gives no range when the expression matches nothing', () => {
    const ast = parseQuery('content matches "pineapple"');
    expect(matchRanges(NOTE.content, ast)).toEqual([]);
  });
});
