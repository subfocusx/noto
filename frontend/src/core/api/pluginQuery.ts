// The query capability of the plugin platform.
//
// The capability works in BOTH storage modes:
//
//   * open mode   — the query runs on the server (`POST /api/query`);
//   * sealed mode — the query runs in the browser: the notes are decrypted
//     there, and the query is evaluated over them locally.
//
// The local evaluation reuses the core of the query language
// (`core/query/grammar.ts` and `core/query/predicate.ts`) and the scanner of
// the derived properties (`core/metadata/extract.ts`), so that both modes
// answer the same way.
//
// The module never touches the key material: it reads the decrypted notes
// through the vault service, which is the only component that opens them. A
// plugin therefore sees the answer of a query and nothing else — never a key.
//
// Boundary note: `core/**` must not import from `src/plugins/**` (rule R1) and
// must not import from `src/components/**` (rule R9), so the shapes of the
// answer are declared here and mirrored by the contract.
import type { TagCount } from '../../types';
import { getTags as httpGetTags, runQuery as httpRunQuery } from '../../api/query';
import { parseQuery } from '../query/grammar';
import { compilePredicate, type QueryNote } from '../query/predicate';
import { extractProps } from '../metadata/extract';
import { getVaultSessionState } from '../vault/session';

/** The default number of the hits of a query. */
export const PLUGIN_QUERY_LIMIT = 50;

/**
 * The answer of a query, as the plugins see it.
 *
 * The hits carry the optional timestamps of the note, when the host knows them.
 */
export interface PluginQueryResult {
  hits: PluginQueryHit[];
  total: number;
  partial: boolean;
}

/** A note that matches a query. */
export interface PluginQueryHit {
  path: string;
  name: string;
  kind: string;
  snippet: string;
  /** The moment of the creation of the note (ISO 8601). */
  createdAt?: string;
  /** The moment of the last change of the note (ISO 8601). */
  updatedAt?: string;
}

/** A note of the vault, as the local evaluation of a query sees it. */
export interface PluginQueryNote {
  /** The path of the note, relative to the root of the vault. */
  path: string;
  /** The file name of the note, with the extension. */
  name: string;
  /** The whole text of the note. */
  content: string;
  /** The moment of the creation of the note, in unix seconds. */
  createdAt: number;
  /** The moment of the last change of the note, in unix seconds. */
  updatedAt: number;
}

/** The query capability of the plugin platform. */
export interface PluginQueryApi {
  /** Runs a query of the query language. */
  query(query: string, limit?: number): Promise<PluginQueryResult>;
  /** Returns the tags of the vault with the number of the notes that carry them. */
  tags(): Promise<TagCount[]>;
}

/** The dependencies of {@link createPluginQueryApi}; the tests override them. */
export interface PluginQueryDeps {
  /** The mode of the storage; the session of the vault by default. */
  mode?: () => 'open' | 'sealed';
  /** The decrypted notes of the vault (the sealed mode). */
  notes?: () => Promise<PluginQueryNote[]>;
  /** The query of the server (the open mode). */
  runQuery?: (query: string, limit?: number) => Promise<PluginQueryResult>;
  /** The tags of the server (the open mode). */
  getTags?: () => Promise<TagCount[]>;
  /** The clock of the evaluation, in unix seconds. */
  now?: () => number;
}

/**
 * Converts an ISO 8601 moment into unix seconds.
 *
 * An unknown or broken moment becomes `0`: a note without a date is dated at
 * the beginning of the epoch, and the queries over the dates stay total.
 */
export function toSeconds(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

/** Converts unix seconds into an ISO 8601 moment. */
export function toIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * Builds the data of a note the predicate of the query works with.
 *
 * The derived properties (the tags, the title and the flags) are scanned with
 * the scanner of the core, so the local evaluation and the server agree.
 */
export function toQueryNote(note: PluginQueryNote): QueryNote {
  const props = extractProps(note.content);
  const dot = note.name.lastIndexOf('.');
  const ext = dot > 0 ? note.name.slice(dot + 1) : '';
  const slash = note.path.lastIndexOf('/');
  const folder = slash > 0 ? note.path.slice(0, slash) : '';
  return {
    path: note.path,
    name: note.name,
    content: note.content,
    title: props.title,
    tags: props.tags,
    folder,
    ext,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    hasTaskList: props.hasTaskList,
    hasIncompleteTasks: props.hasIncompleteTasks,
    hasCode: props.hasCode,
    hasImage: props.hasImage,
    hasLink: props.hasLink,
    // The attachments are not part of the text of the note: the local
    // evaluation cannot see them, and the query answers as if there were none.
    hasAttachments: false,
  };
}

/**
 * Evaluates a query over the notes of the vault.
 *
 * The query is parsed and compiled once, and then applied to every note. An
 * empty query matches nothing (like the server does).
 */
export function evaluateQuery(
  notes: readonly PluginQueryNote[],
  query: string,
  limit: number,
  nowSeconds: number,
): PluginQueryResult {
  const ast = parseQuery(query);
  const predicate = compilePredicate(ast, nowSeconds);
  const matched = notes.filter((note) => predicate(toQueryNote(note)));
  const hits = matched.slice(0, Math.max(limit, 0)).map((note) => ({
    path: note.path,
    name: note.name,
    kind: 'content',
    snippet: '',
    createdAt: toIso(note.createdAt),
    updatedAt: toIso(note.updatedAt),
  }));
  return { hits, total: matched.length, partial: false };
}

/**
 * Counts the tags of the notes.
 *
 * The tags are the ones the scanner of the core finds: lower cased, without
 * the `#`. The answer is sorted by the counter (the biggest first) and then by
 * the name, so it is stable.
 */
export function countTags(notes: readonly PluginQueryNote[]): TagCount[] {
  const counters = new Map<string, number>();
  for (const note of notes) {
    for (const tag of extractProps(note.content).tags) {
      counters.set(tag, (counters.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counters.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Reads the decrypted notes of the sealed vault.
 *
 * The vault service is imported lazily: an open storage must not pay for the
 * cryptography it does not use.
 */
async function readSealedNotes(): Promise<PluginQueryNote[]> {
  const { getVaultService } = await import('../vault/vaultService');
  const service = getVaultService();
  const tree = await service.listTree();
  const notes: PluginQueryNote[] = [];
  for (const file of tree.files) {
    const note = await service.readNote(file.path);
    notes.push({
      path: file.path,
      name: file.name,
      content: note.content,
      createdAt: toSeconds(file.createdAt),
      updatedAt: toSeconds(file.updatedAt),
    });
  }
  return notes;
}

/**
 * Creates the query capability of the plugin platform.
 *
 * The capability never throws for a mode: the open mode asks the server, the
 * sealed mode evaluates the query locally over the decrypted notes.
 */
export function createPluginQueryApi(deps: PluginQueryDeps = {}): PluginQueryApi {
  const mode = deps.mode ?? ((): 'open' | 'sealed' => getVaultSessionState().mode);
  const runQuery =
    deps.runQuery ??
    ((query: string, limit?: number): Promise<PluginQueryResult> =>
      httpRunQuery(query, limit ?? PLUGIN_QUERY_LIMIT));
  const getTags = deps.getTags ?? ((): Promise<TagCount[]> => httpGetTags());
  const now = deps.now ?? ((): number => Math.floor(Date.now() / 1000));
  const notes = deps.notes ?? readSealedNotes;

  return {
    async query(query: string, limit?: number): Promise<PluginQueryResult> {
      const trimmed = query.trim();
      // An empty query matches nothing and never touches the storage.
      if (!trimmed) return { hits: [], total: 0, partial: false };
      const max = limit ?? PLUGIN_QUERY_LIMIT;
      if (mode() === 'sealed') {
        return evaluateQuery(await notes(), trimmed, max, now());
      }
      return runQuery(trimmed, max);
    },

    async tags(): Promise<TagCount[]> {
      if (mode() === 'sealed') {
        return countTags(await notes());
      }
      return getTags();
    },
  };
}
