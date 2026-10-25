/**
 * The conformance of the scanner of the derived properties with the golden
 * vectors of `shared/query-vectors.json`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractProps, type NoteProps } from '../core/metadata/extract';

interface MetadataVector {
  name: string;
  markdown: string;
  props: {
    tags: string[];
    title: string;
    has_task_list: boolean;
    has_incomplete_tasks: boolean;
    has_code: boolean;
    has_image: boolean;
    has_link: boolean;
  };
}

interface VectorFile {
  metadata: MetadataVector[];
}

const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const VECTORS_PATH = resolve(cwd, '..', 'shared', 'query-vectors.json');

/** The golden vectors speak snake_case, the scanner speaks camelCase. */
function toCamelCase(props: MetadataVector['props']): NoteProps {
  return {
    tags: props.tags,
    title: props.title,
    hasTaskList: props.has_task_list,
    hasIncompleteTasks: props.has_incomplete_tasks,
    hasCode: props.has_code,
    hasImage: props.has_image,
    hasLink: props.has_link,
  };
}

describe('the derived properties of a note', () => {
  const vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as VectorFile;

  it('has the golden vectors', () => {
    expect(Array.isArray(vectors.metadata)).toBe(true);
    expect(vectors.metadata.length).toBeGreaterThan(0);
  });

  for (const vector of vectors.metadata) {
    it(`scans: ${vector.name}`, () => {
      expect(extractProps(vector.markdown)).toEqual(toCamelCase(vector.props));
    });
  }
});
