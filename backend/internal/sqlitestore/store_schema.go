package sqlitestore

import (
	"context"
	"fmt"
	"log/slog"
)

// schemaVersion is the current schema version. It is stored in the SQLite
// user_version pragma and bumped whenever migrations below change.
//
// Version 2 added the table of the derived properties of the notes. The
// migration is additive: the statements are idempotent, so a database of the
// version 1 is opened, extended and kept.
//
// Version 3 added the history of the versions of the notes
// (note_versions), the cache of the derived properties with its flag
// (note_derived) and the text of the attachments (attachment_text). The
// version 3 migration also fills the creation time of the notes that were
// created before the column was filled: the fill only touches the rows whose
// created_at is still zero, so it is idempotent.
const schemaVersion = 3

// init applies the pragmas and runs the migrations.
func (s *Store) init(ctx context.Context) error {
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
	} {
		if _, err := s.db.ExecContext(ctx, pragma); err != nil {
			return fmt.Errorf("sqlitestore: %s: %w", pragma, err)
		}
	}
	if err := s.migrate(ctx); err != nil {
		return err
	}
	s.ftsMu.Lock()
	s.fts5 = s.detectFTS5(ctx)
	s.ftsMu.Unlock()
	if !s.FTS5Available() {
		slog.Warn("sqlite fts5 unavailable, falling back to LIKE based search")
	}
	return nil
}

// detectFTS5 reports whether the FTS5 virtual tables can be created and used.
//
// The detection happens ONCE, when the database is opened: the flag is never
// recomputed per query, so a query never pays for the detection and the
// behaviour of the store does not change under the feet of a caller.
//
// A missing FTS5 module is not an error: the store falls back to LIKE. The
// fallback is a full scan of the index table, so it is slower, but it finds
// the same notes.
func (s *Store) detectFTS5(ctx context.Context) bool {
	for _, stmt := range fts5TableStatements {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			slog.Warn("sqlite fts5 not supported, using LIKE based search", "error", err)
			return false
		}
	}
	if _, err := s.db.ExecContext(ctx,
		"INSERT INTO notes_fts_v(notes_fts_v) VALUES('integrity-check')"); err != nil {
		slog.Warn("sqlite fts5 integrity check failed, using LIKE based search", "error", err)
		return false
	}
	return true
}

// migrate applies the schema statements in order, tracked by PRAGMA
// user_version so that future schema changes are possible.
func (s *Store) migrate(ctx context.Context) error {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("sqlitestore: read user_version: %w", err)
	}
	if version > schemaVersion {
		return fmt.Errorf("sqlitestore: database schema version %d is newer than supported version %d", version, schemaVersion)
	}
	// Every statement is idempotent, so applying the full set on every open
	// keeps re-opening a database safe even when the version did not change.
	for _, stmt := range schemaStatements {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("sqlitestore: apply schema: %w", err)
		}
	}
	// The data migrations are idempotent as well: they only touch the rows
	// that still miss a value, so they can run on every open.
	for _, stmt := range dataMigrations {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("sqlitestore: apply the data migration: %w", err)
		}
	}
	if version != schemaVersion {
		if _, err := s.db.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); err != nil {
			return fmt.Errorf("sqlitestore: set user_version: %w", err)
		}
	}
	return nil
}

// fts5TableStatements create the FTS5 search indexes: the index of the notes
// and the index of the text of the attachments.
//
// The driver modernc.org/sqlite supports FTS5, so the statements are applied
// on every normal build; they are only skipped when the runtime detection
// finds no FTS5 support, in which case the LIKE fallback is used.
var fts5TableStatements = []string{
	"CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts_v USING fts5(path UNINDEXED, name, body)",
	"CREATE VIRTUAL TABLE IF NOT EXISTS attachment_fts_v USING fts5(id UNINDEXED, note_path UNINDEXED, name, body)",
}

// dataMigrations are the migrations that change the data of an existing
// database. They are idempotent: they only touch the rows that miss a
// value.
var dataMigrations = []string{
	// The creation time of the notes that were created before the column
	// was filled. The modification time is the best known approximation;
	// the modification time of the file is the second best.
	`UPDATE notes SET created_at = updated_at WHERE created_at = 0 AND updated_at > 0`,
	`UPDATE notes SET created_at = mod_time WHERE created_at = 0 AND mod_time > 0`,
}

// schemaStatements is the schema described in CONTRACT.md section 2.
var schemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS notes (
  path        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  parent_path TEXT NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  revision    INTEGER NOT NULL DEFAULT 1,
  mod_time    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
)`,
	`CREATE TABLE IF NOT EXISTS notes_fts (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL
)`,
	`CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, note_path TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
)`,
	`CREATE TABLE IF NOT EXISTS trash (
  trash_path    TEXT PRIMARY KEY,
  original_path TEXT NOT NULL,
  type          TEXT NOT NULL,
  size          INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER NOT NULL DEFAULT 0
)`,
	`CREATE INDEX IF NOT EXISTS idx_notes_parent ON notes(parent_path)`,
	`CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_path)`,
	`CREATE INDEX IF NOT EXISTS idx_trash_original ON trash(original_path)`,
	// The derived properties of the notes. The table is a cache: the files on
	// the disk stay the source of truth.
	`CREATE TABLE IF NOT EXISTS note_props (
  path        TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',
  flags       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
)`,
	`CREATE INDEX IF NOT EXISTS idx_note_props_tag ON note_props(tags)`,
	// The history of the versions of the notes. A version is immutable: it
	// is written once and never modified.
	`CREATE TABLE IF NOT EXISTS note_versions (
  path       TEXT NOT NULL,
  revision   INTEGER NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (path, revision)
)`,
	// The cache of the derived properties of a note. The flag tells whether
	// the note changed since the last calculation.
	`CREATE TABLE IF NOT EXISTS note_derived (
  path        TEXT PRIMARY KEY,
  derived     TEXT NOT NULL DEFAULT '{}',
  computed_at INTEGER NOT NULL DEFAULT 0,
  stale       INTEGER NOT NULL DEFAULT 0
)`,
	// The text extracted from the attachments, so that it is searchable.
	`CREATE TABLE IF NOT EXISTS attachment_text (
  id        TEXT PRIMARY KEY,
  note_path TEXT NOT NULL DEFAULT '',
  name      TEXT NOT NULL DEFAULT '',
  body      TEXT NOT NULL DEFAULT ''
)`,
	`CREATE INDEX IF NOT EXISTS idx_attachment_text_note ON attachment_text(note_path)`,
}
