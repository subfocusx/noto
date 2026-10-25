// The service of the query language.
//
// The query is answered in the two modes of the storage, but the answer looks
// the same:
//
//   - `open`   — the backend compiles the query into SQL and answers;
//   - `sealed` — the notes are decrypted in the browser, so the browser
//                compiles the query into a predicate and applies it to the
//                notes it holds in memory.
//
// The interface (the store) never knows the mode: it always asks this
// service, and the service decides where the answer comes from.
//
// A broken query never throws out of the service: the answer carries a typed
// error (`QueryServiceError`), so the caller can show it without parsing a
// message by hand.
import { getTags as serverTags, runQuery as serverQuery } from '../../api/query';
import type { Node, NoteContent, SearchHit, TagCount, TreeResponse } from '../../types';
import { extractProps } from '../metadata/extract';
import { getVaultService } from '../vault/vaultService';
import { parseQuery, QueryParseError } from './grammar';
import { compilePredicate, type QueryNote } from './predicate';

/** The code of an error of the service. */
export type QueryErrorCode =
  /** The query does not belong to the language of the specification. */
  | 'parse_error'
  /** The storage could not be read (locked vault, broken request...). */
  | 'vault_error';

/** The typed error of the service. */
export class QueryServiceError extends Error {
  /** The stable code of the error. */
  readonly code: QueryErrorCode;

  constructor(code: QueryErrorCode, message: string) {
    super(message);
    this.name = 'QueryServiceError';
    this.code = code;
  }
}

/** The answer of a query. */
export interface QueryOutcome {
  /** The notes that match the query. */
  hits: SearchHit[];
  /** The total number of the matching notes (before the limit). */
  total: number;
  /**
   * True when the properties of some notes could not be recalculated, so the
   * answer may be incomplete.
   */
  partial: boolean;
  /** The error of the query, or `null` when the query was answered. */
  error: QueryServiceError | null;
}

/**
 * The part of the storage the service needs.
 *
 * The interface is structural on purpose: the service depends on the
 * operations, not on the class, so that a test can use a double.
 */
export interface QueryVault {
  /** The mode of the storage. */
  readonly mode: 'open' | 'sealed';
  /** The tree of the folders and of the notes. */
  listTree(): Promise<TreeResponse>;
  /** The content of a note. */
  readNote(path: string): Promise<NoteContent>;
}

/** The service of the query language. */
export interface QueryService {
  /** Runs a query and answers with the matching notes. */
  runQuery(query: string, limit?: number): Promise<QueryOutcome>;
  /** Returns the tags of the vault with the number of the notes that carry them. */
  loadTags(): Promise<TagCount[]>;
}

/** The dependencies of the service; every one of them can be replaced. */
export interface QueryServiceOptions {
  /** Returns the storage the service reads; the current one by default. */
  vault?: () => QueryVault;
  /** Runs the query on the server (the open mode). */
  serverQuery?: (query: string, limit: number) => Promise<{
    hits: SearchHit[];
    total: number;
    partial: boolean;
  }>;
  /** Reads the tags on the server (the open mode). */
  serverTags?: () => Promise<TagCount[]>;
  /** The moment of the execution of a query, in unix seconds. */
  now?: () => number;
}

/** The default number of the notes of an answer. */
const DEFAULT_LIMIT = 50;

/** An empty answer. */
function emptyOutcome(): QueryOutcome {
  return { hits: [], total: 0, partial: false, error: null };
}

/** The message of an unknown error. */
function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'the query failed';
}

/** The directory of a path, relative to the root of the vault. */
function folderOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** The extension of a file name, without the dot, lower cased. */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** A moment of the metadata of a node, in unix seconds. */
function secondsOf(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

/** The first line of a note that carries something. */
function snippetOf(content: string, title: string): string {
  if (title) return title;
  for (const line of content.split(/\r?\n/)) {
    const text = line.trim();
    if (text) return text.slice(0, 120);
  }
  return '';
}

/**
 * Builds the note of the predicate from the node of the tree and its text.
 */
function toQueryNote(node: Node, content: string): QueryNote {
  const props = extractProps(content);
  return {
    path: node.path,
    name: node.name,
    content,
    title: props.title,
    tags: props.tags,
    folder: folderOf(node.path),
    ext: extOf(node.name),
    createdAt: secondsOf(node.createdAt),
    updatedAt: secondsOf(node.updatedAt),
    hasTaskList: props.hasTaskList,
    hasIncompleteTasks: props.hasIncompleteTasks,
    hasCode: props.hasCode,
    hasImage: props.hasImage,
    hasLink: props.hasLink,
    // The attachments of a sealed note are not part of the tree of the notes:
    // the flag stays false until the storage can tell more.
    hasAttachments: false,
  };
}

/**
 * Creates the service of the query language.
 */
export function createQueryService(options: QueryServiceOptions = {}): QueryService {
  const vault = options.vault ?? (() => getVaultService());
  const runOnServer = options.serverQuery ?? serverQuery;
  const tagsOnServer = options.serverTags ?? serverTags;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  /**
   * Reads the notes of the vault and answers the query in the browser.
   *
   * Limitation: every note of the tree is read (and decrypted) to be able to
   * filter it, so the cost of a query grows with the size of the vault. The
   * answer is marked as `partial` when a note could not be read.
   */
  const runLocally = async (query: string, limit: number): Promise<QueryOutcome> => {
    let ast;
    try {
      ast = parseQuery(query);
    } catch (err) {
      if (err instanceof QueryParseError) {
        return { ...emptyOutcome(), error: new QueryServiceError('parse_error', err.message) };
      }
      throw err;
    }
    if (ast === null) return emptyOutcome();

    let files: Node[];
    try {
      const tree = await vault().listTree();
      files = tree.files ?? [];
    } catch (err) {
      return {
        ...emptyOutcome(),
        error: new QueryServiceError('vault_error', messageOf(err)),
      };
    }

    const predicate = compilePredicate(ast, now());
    const hits: SearchHit[] = [];
    let total = 0;
    let partial = false;

    for (const file of files) {
      let content = '';
      try {
        const note = await vault().readNote(file.path);
        content = note.content;
      } catch {
        // The note could not be read: the answer is incomplete.
        partial = true;
        continue;
      }
      const queryNote = toQueryNote(file, content);
      if (!predicate(queryNote)) continue;
      total += 1;
      if (hits.length < limit) {
        hits.push({
          path: queryNote.path,
          name: queryNote.name,
          kind: 'query',
          snippet: snippetOf(content, queryNote.title),
        });
      }
    }

    return { hits, total, partial, error: null };
  };

  return {
    runQuery: async (query: string, limit = DEFAULT_LIMIT): Promise<QueryOutcome> => {
      const trimmed = query.trim();
      if (!trimmed) return emptyOutcome();
      if (vault().mode === 'open') {
        try {
          const res = await runOnServer(trimmed, limit);
          return {
            hits: res.hits ?? [],
            total: res.total ?? 0,
            partial: res.partial ?? false,
            error: null,
          };
        } catch (err) {
          return {
            ...emptyOutcome(),
            error: new QueryServiceError('vault_error', messageOf(err)),
          };
        }
      }
      return runLocally(trimmed, limit);
    },

    loadTags: async (): Promise<TagCount[]> => {
      if (vault().mode === 'open') {
        try {
          return await tagsOnServer();
        } catch {
          // The tags are a convenience: a failure must not break the sidebar.
          return [];
        }
      }

      // The sealed mode: the tags are counted over the decrypted notes.
      const counts = new Map<string, number>();
      let files: Node[];
      try {
        const tree = await vault().listTree();
        files = tree.files ?? [];
      } catch {
        return [];
      }
      for (const file of files) {
        let content = '';
        try {
          content = (await vault().readNote(file.path)).content;
        } catch {
          continue;
        }
        for (const tag of extractProps(content).tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => a.tag.localeCompare(b.tag));
    },
  };
}

/** The service of the application; it is replaced by the tests. */
let service: QueryService = createQueryService();

/** The service of the query language. */
export function getQueryService(): QueryService {
  return service;
}

/** Installs the service of the query language; the tests use it. */
export function setQueryService(next: QueryService | null): void {
  service = next ?? createQueryService();
}

/**
 * Runs a query and answers with the matching notes.
 *
 * The function never throws: a broken query is answered with a typed error.
 */
export async function runVaultQuery(query: string, limit?: number): Promise<QueryOutcome> {
  return getQueryService().runQuery(query, limit);
}

/** Returns the tags of the vault with the number of the notes that carry them. */
export async function loadVaultTags(): Promise<TagCount[]> {
  return getQueryService().loadTags();
}
