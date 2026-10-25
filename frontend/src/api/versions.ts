// The versions of a note.
//
// The history of a note is a list of immutable versions: every write of the
// content of a note appends a new version. The client reads the history, asks
// for the difference between two versions and restores an old one.
//
// The contract of the endpoints is described in `docs/CONTRACT.md` (§3, the
// section "Versions"); the backend owns the implementation.
import type { NoteContent } from '../types';
import { jsonInit, request } from './http';

/** One version of a note: the content of the note at a moment of its life. */
export interface NoteVersion {
  /** The path of the note. */
  path: string;
  /** The revision the note had when the version was written. */
  revision: number;
  /** The title of the note at that moment (empty when it had no heading). */
  title: string;
  /** The text of the note at that moment. */
  content: string;
  /** The moment the version was written (RFC 3339). */
  createdAt: string;
}

/** The answer of the list of the versions of a note. */
export interface VersionsResponse {
  versions: NoteVersion[];
}

/** One line of a difference between two versions. */
export interface DiffLine {
  /** "context", "added" or "removed". */
  kind: 'context' | 'added' | 'removed';
  /** The text of the line. */
  text: string;
  /** The number of the line in the older version (0 when the line is new). */
  fromLine: number;
  /** The number of the line in the newer version (0 when the line is gone). */
  toLine: number;
}

/** The answer of the difference between two versions of a note. */
export interface VersionDiffResponse {
  path: string;
  /** The revision the difference starts at. */
  from: number;
  /** The revision the difference ends at. */
  to: number;
  lines: DiffLine[];
}

/** The history of a note, from the oldest version to the newest. */
export function listVersions(path: string): Promise<VersionsResponse> {
  return request<VersionsResponse>(`/notes/versions?path=${encodeURIComponent(path)}`);
}

/** The difference between two versions of a note. */
export function getVersionDiff(
  path: string,
  from: number,
  to: number,
): Promise<VersionDiffResponse> {
  const query = `path=${encodeURIComponent(path)}&from=${from}&to=${to}`;
  return request<VersionDiffResponse>(`/notes/versions/diff?${query}`);
}

/**
 * Restores an old version of a note.
 *
 * The content of the note becomes the content of the version; the restore is
 * a new write, so the history of the note keeps the version that was restored.
 */
export function restoreVersion(path: string, revision: number): Promise<NoteContent> {
  return request<NoteContent>('/notes/versions/restore', jsonInit('POST', { path, revision }));
}
