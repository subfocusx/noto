package sqlitestore

import (
	"context"
	"fmt"
	"log/slog"
)

// schemaVersion is the current schema version. It is stored in the SQLite
// user_version pragma and bumped whenever migrations below change.
const schemaVersion = 1

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

// detectFTS5 reports whether the FTS5 virtual table can be created and used.
// A missing FTS5 module is not an error: the store falls back to LIKE.
func (s *Store) detectFTS5(ctx context.Context) bool {
	if _, err := s.db.ExecContext(ctx, fts5TableStatement); err != nil {
		slog.Warn("sqlite fts5 not supported, using LIKE based search", "error", err)
		return false
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
	if version != schemaVersion {
		if _, err := s.db.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); err != nil {
			return fmt.Errorf("sqlitestore: set user_version: %w", err)
		}
	}
	return nil
}

// fts5TableStatement creates the FTS5 search index. The driver
// modernc.org/sqlite supports FTS5 by default, so the statement is applied
// on every normal build; it is only skipped when the runtime detection finds
// no FTS5 support, in which case the LIKE fallback is used.
const fts5TableStatement = "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts_v USING fts5(path UNINDEXED, name, body)"

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
}
