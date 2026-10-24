/**
 * The predicate of the sealed mode: the IR of a query compiled into a
 * predicate over the notes of the vault.
 */

import { describe, expect, it } from 'vitest';
import { parseQuery } from '../core/query/grammar';
import { compilePredicate, type QueryNote } from '../core/query/predicate';
import { matchRanges } from '../core/query/highlight';

/** The moment of the execution of the queries of the test. */
const NOW = 1_700_000_000;

function note(overrides: Partial<QueryNote> & { path: string }): QueryNote {
  const base: QueryNote = {
    path: overrides.path,
    name: overrides.path.split('/').pop() as string,
    content: '',
    title: '',
    tags: [],
    folder: '',
    ext: 'md',
    createdAt: NOW,
    updatedAt: NOW,
    hasTaskList: false,
    hasIncompleteTasks: false,
    hasCode: false,
    hasImage: false,
    hasLink: false,
    hasAttachments: false,
  };
  return { ...base, ...overrides };
}

const work = note({
  path: 'notes/work.md',
  name: 'work.md',
  content: '# Work\n\nThe body of the note.',
  title: 'Work',
  tags: ['work', 'urgent'],
  folder: 'notes',
  ext: 'md',
  createdAt: NOW - 10 * 86400,
  updatedAt: NOW - 5 * 86400,
  hasTaskList: true,
  hasIncompleteTasks: true,
});

const home = note({
  path: 'home.md',
  name: 'home.md',
  content: 'plain text',
  title: '',
  tags: ['home'],
  folder: '',
  ext: 'md',
  createdAt: NOW - 86400,
  updatedAt: NOW - 3600,
});

const notes: QueryNote[] = [work, home];

function matching(source: string): string[] {
  const ast = parseQuery(source);
  const predicate = compilePredicate(ast, NOW);
  return notes.filter((item) => predicate(item)).map((item) => item.path);
}

describe('the predicate of a query', () => {
  it('matches nothing when the query is empty', () => {
    expect(matching('')).toEqual([]);
  });

  it('compares a tag without the case', () => {
    expect(matching('tag == "work"')).toEqual(['notes/work.md']);
    expect(matching('tag == "WORK"')).toEqual(['notes/work.md']);
    expect(matching('tag == "missing"')).toEqual([]);
  });

  it('negates a comparison', () => {
    expect(matching('tag != "work"')).toEqual(['home.md']);
  });

  it('looks for a tag in a list', () => {
    expect(matching('tag in ["home", "urgent"]')).toEqual(['notes/work.md', 'home.md']);
    expect(matching('tag in []')).toEqual([]);
  });

  it('compares the content without the case', () => {
    expect(matching('content == "PLAIN TEXT"')).toEqual(['home.md']);
    expect(matching('content.contains("BODY")')).toEqual(['notes/work.md']);
    expect(matching('content.contains("nothing")')).toEqual([]);
  });

  it('compares the name without the case', () => {
    expect(matching('name == "WORK.MD"')).toEqual(['notes/work.md']);
    expect(matching('name endsWith ".MD"')).toEqual(['notes/work.md', 'home.md']);
    expect(matching('name startsWith "HOME"')).toEqual(['home.md']);
  });

  it('compares the path, the title, the folder and the extension with the case', () => {
    expect(matching('path == "notes/work.md"')).toEqual(['notes/work.md']);
    expect(matching('path == "NOTES/WORK.MD"')).toEqual([]);
    expect(matching('title == "Work"')).toEqual(['notes/work.md']);
    expect(matching('title == "work"')).toEqual([]);
    expect(matching('folder == "notes"')).toEqual(['notes/work.md']);
    expect(matching('folder != ""')).toEqual(['notes/work.md']);
    expect(matching('ext == "md"')).toEqual(['notes/work.md', 'home.md']);
  });

  it('reads the flags', () => {
    expect(matching('has_task_list')).toEqual(['notes/work.md']);
    expect(matching('!has_task_list')).toEqual(['home.md']);
    expect(matching('has_task_list && !has_incomplete_tasks')).toEqual([]);
    expect(matching('has_code || has_image')).toEqual([]);
  });

  it('compares the timestamps', () => {
    expect(matching('created_at >= now - 7d')).toEqual(['home.md']);
    expect(matching('updated_at >= now - 7d')).toEqual(['notes/work.md', 'home.md']);
    expect(matching('updated_at >= now - 1h')).toEqual(['home.md']);
    expect(matching('updated_at > now - 1h')).toEqual([]);
    expect(matching('created_at < now')).toEqual(['notes/work.md', 'home.md']);
  });

  it('freezes the moment of the execution', () => {
    const ast = parseQuery('created_at >= now - 1d');
    const predicate = compilePredicate(ast, NOW);
    expect(predicate(home)).toBe(true);
    expect(predicate({ ...home, createdAt: NOW - 2 * 86400 })).toBe(false);
  });

  it('groups the conditions', () => {
    expect(matching('(has_code || has_image) && tag == "x"')).toEqual([]);
    expect(matching('tag == "work" && (tag == "b" || tag == "home")')).toEqual([]);
    expect(matching('tag == "work" || tag == "home"')).toEqual([
      'notes/work.md',
      'home.md',
    ]);
  });
});

describe('the ranges of a query', () => {
  it('finds every occurrence in the content', () => {
    const ast = parseQuery('content.contains("note")');
    const ranges = matchRanges('a note and a note', ast, NOW);
    expect(ranges).toEqual([
      { from: 2, to: 6 },
      { from: 13, to: 17 },
    ]);
  });

  it('ignores the case', () => {
    const ast = parseQuery('content.contains("NOTE")');
    expect(matchRanges('a note', ast, NOW)).toEqual([{ from: 2, to: 6 }]);
  });

  it('marks the whole text when the content is equal', () => {
    const ast = parseQuery('content == "exact"');
    expect(matchRanges('exact', ast, NOW)).toEqual([{ from: 0, to: 5 }]);
  });

  it('gives no range for the other fields', () => {
    const ast = parseQuery('tag == "work" && content.contains("x")');
    expect(matchRanges('no x here', ast, NOW)).toEqual([{ from: 3, to: 4 }]);
    const other = parseQuery('tag == "work"');
    expect(matchRanges('no x here', other, NOW)).toEqual([]);
  });
});
