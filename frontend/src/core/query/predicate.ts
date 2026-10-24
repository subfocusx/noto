/**
 * The compiler of the IR into a predicate over the notes of the vault.
 *
 * This is the sealed mode of the language: the query is compiled once and
 * then applied to every note of the decrypted tree.
 */

import type { QueryNode, QueryValue } from './ir';
import type { QueryField } from './schema';

/** The data of a note the predicate works with. */
export interface QueryNote {
  /** The path of the note, relative to the root of the vault. */
  path: string;
  /** The file name of the note, with the extension. */
  name: string;
  /** The whole text of the note. */
  content: string;
  /** The title of the note: the text of the first `# heading`. */
  title: string;
  /** The tags of the note, without the `#`. */
  tags: string[];
  /** The directory of the note, relative to the root of the vault. */
  folder: string;
  /** The extension of the file name, without the dot. */
  ext: string;
  /** The moment of the creation of the note, in unix seconds. */
  createdAt: number;
  /** The moment of the last change of the note, in unix seconds. */
  updatedAt: number;
  /** The note contains a task list. */
  hasTaskList: boolean;
  /** The note contains a task that is not done. */
  hasIncompleteTasks: boolean;
  /** The note contains a code block or inline code. */
  hasCode: boolean;
  /** The note contains an image. */
  hasImage: boolean;
  /** The note contains a link. */
  hasLink: boolean;
  /** The note has at least one attachment. */
  hasAttachments: boolean;
}

/** A predicate over the notes of the vault. */
export type NotePredicate = (note: QueryNote) => boolean;

/** The fields that are compared case insensitively. */
const CASE_INSENSITIVE_FIELDS: readonly QueryField[] = ['content', 'name'];

/**
 * The midnight of the day of the moment, in the local time.
 */
export function startOfDay(nowSeconds: number): number {
  const date = new Date(nowSeconds * 1000);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/**
 * The moment a value points at, in unix seconds. `null` when the value is
 * not a moment.
 */
export function valueSeconds(value: QueryValue, nowSeconds: number): number | null {
  switch (value.k) {
    case 'num':
      return value.v;
    case 'now':
      return nowSeconds;
    case 'today':
      return startOfDay(nowSeconds);
    case 'rel': {
      const base = value.base === 'now' ? nowSeconds : startOfDay(nowSeconds);
      return base + value.off;
    }
    default:
      return null;
  }
}

function lower(value: string): string {
  return value.toLowerCase();
}

function booleanOf(note: QueryNote, field: QueryField): boolean {
  switch (field) {
    case 'has_task_list':
      return note.hasTaskList;
    case 'has_incomplete_tasks':
      return note.hasIncompleteTasks;
    case 'has_code':
      return note.hasCode;
    case 'has_image':
      return note.hasImage;
    case 'has_link':
      return note.hasLink;
    case 'has_attachments':
      return note.hasAttachments;
    default:
      return false;
  }
}

function textOf(note: QueryNote, field: QueryField): string {
  switch (field) {
    case 'path':
      return note.path;
    case 'name':
      return note.name;
    case 'title':
      return note.title;
    case 'folder':
      return note.folder;
    case 'ext':
      return note.ext;
    case 'content':
      return note.content;
    default:
      return '';
  }
}

function timestampOf(note: QueryNote, field: QueryField): number {
  return field === 'created_at' ? note.createdAt : note.updatedAt;
}

/**
 * Compiles the IR into a predicate.
 *
 * The moment of the execution is frozen for the whole query: it is given
 * once, at the compilation, and never changes.
 */
export function compilePredicate(
  ast: QueryNode | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): NotePredicate {
  if (ast === null) {
    return () => false;
  }

  const evaluate = (node: QueryNode, note: QueryNote): boolean => {
    switch (node.k) {
      case 'and':
        return evaluate(node.l, note) && evaluate(node.r, note);
      case 'or':
        return evaluate(node.l, note) || evaluate(node.r, note);
      case 'not':
        return !evaluate(node.e, note);
      case 'truthy':
        return booleanOf(note, node.f);
      case 'cmp':
        return compare(node, note);
      default:
        return false;
    }
  };

  const compare = (node: Extract<QueryNode, { k: 'cmp' }>, note: QueryNote): boolean => {
    const { f, op, v } = node;

    if (f === 'tag') {
      const tags = note.tags.map(lower);
      if (op === 'in') {
        const items = v.k === 'list' ? v.items : [];
        return items.some((item) => item.k === 'str' && tags.includes(lower(item.v)));
      }
      if (v.k !== 'str') return false;
      const has = tags.includes(lower(v.v));
      return op === '==' ? has : !has;
    }

    if (f === 'has_task_list' || f === 'has_incomplete_tasks' || f === 'has_code' ||
        f === 'has_image' || f === 'has_link' || f === 'has_attachments') {
      const actual = booleanOf(note, f);
      if (v.k === 'bool') {
        return op === '==' ? actual === v.v : actual !== v.v;
      }
      if (v.k === 'str' && (v.v === 'true' || v.v === 'false')) {
        const expected = v.v === 'true';
        return op === '==' ? actual === expected : actual !== expected;
      }
      return false;
    }

    if (f === 'created_at' || f === 'updated_at') {
      const actual = timestampOf(note, f);
      const expected = valueSeconds(v, nowSeconds);
      if (expected === null) return false;
      switch (op) {
        case '==':
          return actual === expected;
        case '!=':
          return actual !== expected;
        case '>':
          return actual > expected;
        case '>=':
          return actual >= expected;
        case '<':
          return actual < expected;
        case '<=':
          return actual <= expected;
        default:
          return false;
      }
    }

    // The string fields.
    const actual = textOf(note, f);
    if (op === 'contains' || op === 'startsWith' || op === 'endsWith') {
      if (v.k !== 'str') return false;
      const haystack = lower(actual);
      const needle = lower(v.v);
      if (op === 'contains') return haystack.includes(needle);
      if (op === 'startsWith') return haystack.startsWith(needle);
      return haystack.endsWith(needle);
    }

    if (v.k !== 'str') {
      if (v.k === 'num') {
        const expected = valueSeconds(v, nowSeconds);
        const numeric = Number(actual);
        if (expected === null || Number.isNaN(numeric)) return false;
        return op === '==' ? numeric === expected : numeric !== expected;
      }
      return false;
    }

    const insensitive = CASE_INSENSITIVE_FIELDS.includes(f);
    const equal = insensitive ? lower(actual) === lower(v.v) : actual === v.v;
    return op === '==' ? equal : !equal;
  };

  return (note: QueryNote) => evaluate(ast, note);
}
