// Implementation of the plugin data API.
//
// Boundary note: `core/**` must not import from `src/plugins/**` (rule R1),
// so the API surface is declared structurally here. It is compatible with
// `PluginApi` of the plugin contract, and the host passes it through.
//
// All HTTP goes through the existing API modules (`src/api/notes.ts`,
// `src/api/tree.ts`, `src/api/search.ts`); this file never calls `fetch`.
import type { NoteContent, SaveNoteResponse, SearchHit, TreeResponse } from '../../types';
import { getNote as apiGetNote, saveNote as apiSaveNote } from '../../api/notes';
import { getTree as apiGetTree } from '../../api/tree';
import { search as apiSearch } from '../../api/search';

/** Structural shape of the plugin API (compatible with `PluginApi`). */
export interface PluginApiLike {
  getNote(path: string): Promise<NoteContent>;
  getTree(): Promise<TreeResponse>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  saveNote(path: string, content: string, revision: number): Promise<SaveNoteResponse>;
}

/**
 * Creates the plugin data API.
 *
 * @param deps optional overrides, used by tests and by hosts that want to
 * intercept the calls.
 */
export function createPluginApi(
  deps: {
    getNote?: (path: string) => Promise<NoteContent>;
    saveNote?: (path: string, content: string, revision: number) => Promise<SaveNoteResponse>;
    getTree?: () => Promise<TreeResponse>;
    search?: (query: string, limit?: number) => Promise<SearchHit[]>;
  } = {},
): PluginApiLike {
  const getNote = deps.getNote ?? apiGetNote;
  const saveNote = deps.saveNote ?? apiSaveNote;
  const getTree = deps.getTree ?? apiGetTree;
  const search = deps.search ?? ((query: string, limit?: number) => apiSearch(query, limit ?? 50));

  return {
    getNote(path: string): Promise<NoteContent> {
      return getNote(path);
    },
    getTree(): Promise<TreeResponse> {
      return getTree();
    },
    search(query: string, limit?: number): Promise<SearchHit[]> {
      return search(query, limit);
    },
    /**
     * Saves a note with optimistic locking. The server rejects a stale
     * revision with an `ApiError` whose code is `revision_conflict`; that
     * error is propagated unchanged so the plugin can handle it.
     */
    saveNote(path: string, content: string, revision: number): Promise<SaveNoteResponse> {
      return saveNote(path, content, revision);
    },
  };
}
