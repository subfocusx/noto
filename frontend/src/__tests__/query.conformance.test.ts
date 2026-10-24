/**
 * The conformance of the TypeScript implementation of the query language
 * with the golden vectors of `shared/query-vectors.json`.
 *
 * The backend reads the same file: the language cannot drift.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQuery } from '../core/query/grammar';
import { toCanonical } from '../core/query/ir';

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
const VECTORS_PATH = resolve(cwd, '..', 'shared', 'query-vectors.json');

function loadVectors(): VectorFile {
  return JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as VectorFile;
}

describe('the conformance of the query language', () => {
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
