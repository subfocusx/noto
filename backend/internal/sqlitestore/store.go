// Package sqlitestore implements port.Store on top of SQLite.
//
// The database holds the metadata of every note and folder, a full text
// search index, attachment metadata and trash entries. The Markdown files on
// disk remain the source of truth for the note bodies; this package only
// mirrors them into the search index.
//
// All methods are safe for concurrent use.
package sqlitestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite" // SQLite driver (pure Go).

	"noto/backend/internal/model"
)

// schemaVersion is the current schema version. It is stored in the SQLite
// user_version pragma and bumped whenever migrations below change.
const schemaVersion = 1

// Store is the SQLite backed implementation of port.Store.
type Store struct {
	db *sql.DB

	// fts5 reports whether the FTS5 virtual table is usable. When it is
	// false the search falls back to a bounded LIKE scan.
	fts5 bool

	// ftsMu guards fts5, which is only written during Open.
	ftsMu sync.RWMutex
}

// Open opens (or creates) the SQLite database at dbPath and applies the
// schema and all pending migrations. The parent directory of dbPath is
// created when it does not exist.
//
// The FTS5 search index is used when the SQLite driver was built with FTS5
// support (build tag "sqlite_fts5"). Without it the store transparently
// falls back to a LIKE based scan; see FTS5Available.
func Open(ctx context.Context, dbPath string) (*Store, error) {
	if strings.TrimSpace(dbPath) == "" {
		return nil, errors.New("sqlitestore: empty database path")
	}
	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("sqlitestore: create database directory: %w", err)
		}
	}
	dsn := dbPath + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: open database: %w", err)
	}
	// SQLite tolerates concurrent readers but a single writer. A modest pool
	// with a bounded number of connections keeps the writer queue short while
	// still allowing parallel reads.
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
	db.SetConnMaxLifetime(0)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("sqlitestore: ping database: %w", err)
	}
	s := &Store{db: db}
	if err := s.init(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// New wraps an already opened database handle. It is handy for tests that
// use an in-memory database (with db.SetMaxOpenConns(1)).
//
// New applies the schema and migrations to the given handle.
func New(ctx context.Context, db *sql.DB) (*Store, error) {
	if db == nil {
		return nil, errors.New("sqlitestore: nil database handle")
	}
	s := &Store{db: db}
	if err := s.init(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

// DB exposes the underlying handle for advanced use cases such as backups.
func (s *Store) DB() *sql.DB { return s.db }

// FTS5Available reports whether the FTS5 backed search index is in use.
// When it returns false the store falls back to a LIKE based scan.
func (s *Store) FTS5Available() bool {
	s.ftsMu.RLock()
	defer s.ftsMu.RUnlock()
	return s.fts5
}

// Close releases the database handle.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

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

// fts5TableStatement creates the FTS5 search index. It is only applied when
// the driver was built with FTS5 support (build tag "sqlite_fts5").
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

// ---------------------------------------------------------------- notes ---

// UpsertNote inserts or updates the metadata of a note or folder.
func (s *Store) UpsertNote(ctx context.Context, n model.Node) error {
	if n.Path == "" {
		return errors.New("sqlitestore: empty path")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO notes (path, name, type, parent_path, size, revision, mod_time, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(path) DO UPDATE SET
  name = excluded.name,
  type = excluded.type,
  parent_path = excluded.parent_path,
  size = excluded.size,
  revision = excluded.revision,
  mod_time = excluded.mod_time,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at`,
		n.Path, n.Name, string(n.Type), n.ParentPath, n.Size, n.Revision,
		millis(n.ModTime), millis(n.CreatedAt), millis(n.UpdatedAt))
	if err != nil {
		return fmt.Errorf("sqlitestore: upsert note %q: %w", n.Path, err)
	}
	return nil
}

// GetNote returns the metadata of a single path.
func (s *Store) GetNote(ctx context.Context, path string) (model.Node, bool, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT path, name, type, parent_path, size, revision, mod_time, created_at, updated_at
FROM notes WHERE path = ?`, path)
	n, err := scanNode(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Node{}, false, nil
	}
	if err != nil {
		return model.Node{}, false, fmt.Errorf("sqlitestore: get note %q: %w", path, err)
	}
	return n, true, nil
}

// DeleteNote removes the metadata of a path.
func (s *Store) DeleteNote(ctx context.Context, path string) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM notes WHERE path = ?", path); err != nil {
		return fmt.Errorf("sqlitestore: delete note %q: %w", path, err)
	}
	return nil
}

// MoveNote moves the metadata of a path to a new path and moves the matching
// search index rows, including every descendant of a moved folder.
//
// The caller may pass the new path of every descendant; descendants that are
// not passed explicitly are relocated by prefix replacement, so the whole
// subtree stays consistent.
func (s *Store) MoveNote(ctx context.Context, fromPath, toPath string) error {
	if fromPath == "" || toPath == "" {
		return errors.New("sqlitestore: empty path")
	}
	if fromPath == toPath {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlitestore: begin move transaction: %w", err)
	}
	defer tx.Rollback()

	// Move the exact node.
	if _, err := tx.ExecContext(ctx, `
UPDATE notes SET
  path = ?,
  name = ?,
  parent_path = ?
WHERE path = ?`,
		toPath, baseName(toPath), parentPath(toPath), fromPath); err != nil {
		return fmt.Errorf("sqlitestore: move note %q: %w", fromPath, err)
	}

	// Move descendants of a moved folder.
	prefix := fromPath + "/"
	newPrefix := toPath + "/"
	rows, err := tx.QueryContext(ctx, `
SELECT path FROM notes WHERE path LIKE ? ESCAPE '\'`, escapeLike(prefix)+"%")
	if err != nil {
		return fmt.Errorf("sqlitestore: list descendants of %q: %w", fromPath, err)
	}
	var descendants []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			rows.Close()
			return fmt.Errorf("sqlitestore: scan descendant: %w", err)
		}
		descendants = append(descendants, p)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("sqlitestore: iterate descendants: %w", err)
	}
	rows.Close()
	for _, p := range descendants {
		np := newPrefix + strings.TrimPrefix(p, prefix)
		if _, err := tx.ExecContext(ctx, `
UPDATE notes SET
  path = ?,
  name = ?,
  parent_path = ?
WHERE path = ?`,
			np, baseName(np), parentPath(np), p); err != nil {
			return fmt.Errorf("sqlitestore: move descendant %q: %w", p, err)
		}
	}

	// Move the search index rows of the node and of its descendants.
	if err := s.moveIndexRows(ctx, tx, fromPath, toPath); err != nil {
		return err
	}
	for _, p := range descendants {
		np := newPrefix + strings.TrimPrefix(p, prefix)
		if err := s.moveIndexRows(ctx, tx, p, np); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlitestore: commit move %q: %w", fromPath, err)
	}
	return nil
}

// moveIndexRows relocates the index rows of a single path.
func (s *Store) moveIndexRows(ctx context.Context, tx *sql.Tx, fromPath, toPath string) error {
	// Read the indexed text before the path is changed.
	var name, body string
	hasRow := true
	err := tx.QueryRowContext(ctx, "SELECT name, body FROM notes_fts WHERE path = ?", fromPath).Scan(&name, &body)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		hasRow = false
	case err != nil:
		return fmt.Errorf("sqlitestore: read index row %q: %w", fromPath, err)
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE notes_fts SET path = ?, name = ? WHERE path = ?`,
		toPath, baseName(toPath), fromPath); err != nil {
		return fmt.Errorf("sqlitestore: move index row %q: %w", fromPath, err)
	}
	if !s.FTS5Available() || !hasRow {
		// Nothing indexed for this path yet.
		return nil
	}
	// The FTS5 table is kept in sync by copying the stored name and body.
	if _, err := tx.ExecContext(ctx, "DELETE FROM notes_fts_v WHERE path = ?", fromPath); err != nil {
		return fmt.Errorf("sqlitestore: delete fts row %q: %w", fromPath, err)
	}
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO notes_fts_v(path, name, body) VALUES (?, ?, ?)", toPath, name, body); err != nil {
		return fmt.Errorf("sqlitestore: insert fts row %q: %w", toPath, err)
	}
	return nil
}

// ListNotes returns the metadata of every known note and folder.
func (s *Store) ListNotes(ctx context.Context) ([]model.Node, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT path, name, type, parent_path, size, revision, mod_time, created_at, updated_at
FROM notes ORDER BY path`)
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: list notes: %w", err)
	}
	defer rows.Close()
	out := []model.Node{}
	for rows.Next() {
		n, err := scanNode(rows)
		if err != nil {
			return nil, fmt.Errorf("sqlitestore: scan note: %w", err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitestore: iterate notes: %w", err)
	}
	return out, nil
}

// ---------------------------------------------------------------- index ---

// IndexContent adds or replaces the searchable text of a path.
func (s *Store) IndexContent(ctx context.Context, path, name, content string) error {
	if path == "" {
		return errors.New("sqlitestore: empty path")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlitestore: begin index transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
INSERT INTO notes_fts (path, name, body) VALUES (?, ?, ?)
ON CONFLICT(path) DO UPDATE SET name = excluded.name, body = excluded.body`,
		path, name, content); err != nil {
		return fmt.Errorf("sqlitestore: index content %q: %w", path, err)
	}
	if s.FTS5Available() {
		if _, err := tx.ExecContext(ctx, "DELETE FROM notes_fts_v WHERE path = ?", path); err != nil {
			return fmt.Errorf("sqlitestore: delete fts row %q: %w", path, err)
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO notes_fts_v(path, name, body) VALUES (?, ?, ?)", path, name, content); err != nil {
			return fmt.Errorf("sqlitestore: insert fts row %q: %w", path, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlitestore: commit index %q: %w", path, err)
	}
	return nil
}

// RemoveContent drops a path from the search index.
func (s *Store) RemoveContent(ctx context.Context, path string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlitestore: begin remove transaction: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "DELETE FROM notes_fts WHERE path = ?", path); err != nil {
		return fmt.Errorf("sqlitestore: remove content %q: %w", path, err)
	}
	if s.FTS5Available() {
		if _, err := tx.ExecContext(ctx, "DELETE FROM notes_fts_v WHERE path = ?", path); err != nil {
			return fmt.Errorf("sqlitestore: remove fts row %q: %w", path, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlitestore: commit remove %q: %w", path, err)
	}
	return nil
}

// ClearIndex removes every entry from the search index.
func (s *Store) ClearIndex(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlitestore: begin clear transaction: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "DELETE FROM notes_fts"); err != nil {
		return fmt.Errorf("sqlitestore: clear index: %w", err)
	}
	if s.FTS5Available() {
		if _, err := tx.ExecContext(ctx, "DELETE FROM notes_fts_v"); err != nil {
			return fmt.Errorf("sqlitestore: clear fts index: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlitestore: commit clear index: %w", err)
	}
	return nil
}

// ---------------------------------------------------------- attachments ---

// PutAttachment stores the metadata of an uploaded attachment.
func (s *Store) PutAttachment(ctx context.Context, a model.Attachment) error {
	if a.ID == "" {
		return errors.New("sqlitestore: empty attachment id")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO attachments (id, name, mime, size, note_path, created_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  mime = excluded.mime,
  size = excluded.size,
  note_path = excluded.note_path,
  created_at = excluded.created_at`,
		a.ID, a.Name, a.MIME, a.Size, a.NotePath, millis(a.CreatedAt))
	if err != nil {
		return fmt.Errorf("sqlitestore: put attachment %q: %w", a.ID, err)
	}
	return nil
}

// ListAttachments returns every known attachment.
func (s *Store) ListAttachments(ctx context.Context) ([]model.Attachment, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, name, mime, size, note_path, created_at FROM attachments ORDER BY created_at, id")
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: list attachments: %w", err)
	}
	defer rows.Close()
	out := []model.Attachment{}
	for rows.Next() {
		var a model.Attachment
		var created int64
		if err := rows.Scan(&a.ID, &a.Name, &a.MIME, &a.Size, &a.NotePath, &created); err != nil {
			return nil, fmt.Errorf("sqlitestore: scan attachment: %w", err)
		}
		a.CreatedAt = fromMillis(created)
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitestore: iterate attachments: %w", err)
	}
	return out, nil
}

// GetAttachment returns the metadata of a single attachment.
func (s *Store) GetAttachment(ctx context.Context, id string) (model.Attachment, bool, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT id, name, mime, size, note_path, created_at FROM attachments WHERE id = ?", id)
	var a model.Attachment
	var created int64
	err := row.Scan(&a.ID, &a.Name, &a.MIME, &a.Size, &a.NotePath, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Attachment{}, false, nil
	}
	if err != nil {
		return model.Attachment{}, false, fmt.Errorf("sqlitestore: get attachment %q: %w", id, err)
	}
	a.CreatedAt = fromMillis(created)
	return a, true, nil
}

// DeleteAttachment removes the metadata of an attachment.
func (s *Store) DeleteAttachment(ctx context.Context, id string) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM attachments WHERE id = ?", id); err != nil {
		return fmt.Errorf("sqlitestore: delete attachment %q: %w", id, err)
	}
	return nil
}

// ---------------------------------------------------------------- trash ---

// PutTrash records a deleted entry so it can be restored.
func (s *Store) PutTrash(ctx context.Context, originalPath, trashPath string, kind model.NodeType, size int64) error {
	if trashPath == "" {
		return errors.New("sqlitestore: empty trash path")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO trash (trash_path, original_path, type, size, deleted_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(trash_path) DO UPDATE SET
  original_path = excluded.original_path,
  type = excluded.type,
  size = excluded.size,
  deleted_at = excluded.deleted_at`,
		trashPath, originalPath, string(kind), size, time.Now().UnixMilli())
	if err != nil {
		return fmt.Errorf("sqlitestore: put trash %q: %w", trashPath, err)
	}
	return nil
}

// ListTrash returns every trashed entry.
func (s *Store) ListTrash(ctx context.Context) ([]model.Node, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT trash_path, original_path, type, size, deleted_at FROM trash ORDER BY deleted_at, trash_path")
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: list trash: %w", err)
	}
	defer rows.Close()
	out := []model.Node{}
	for rows.Next() {
		var trashPath, originalPath, typ string
		var size, deleted int64
		if err := rows.Scan(&trashPath, &originalPath, &typ, &size, &deleted); err != nil {
			return nil, fmt.Errorf("sqlitestore: scan trash: %w", err)
		}
		out = append(out, model.Node{
			ID:         trashPath,
			Name:       baseName(originalPath),
			Path:       trashPath,
			Type:       model.NodeType(typ),
			ParentPath: parentPath(trashPath),
			Size:       size,
			ModTime:    fromMillis(deleted),
			CreatedAt:  fromMillis(deleted),
			UpdatedAt:  fromMillis(deleted),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitestore: iterate trash: %w", err)
	}
	return out, nil
}

// DeleteTrash removes a trash entry.
func (s *Store) DeleteTrash(ctx context.Context, trashPath string) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM trash WHERE trash_path = ?", trashPath); err != nil {
		return fmt.Errorf("sqlitestore: delete trash %q: %w", trashPath, err)
	}
	return nil
}

// ------------------------------------------------------------- helpers ---

// scanner is implemented by *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanNode(sc scanner) (model.Node, error) {
	var n model.Node
	var typ string
	var modTime, created, updated int64
	err := sc.Scan(&n.Path, &n.Name, &typ, &n.ParentPath, &n.Size, &n.Revision, &modTime, &created, &updated)
	if err != nil {
		return model.Node{}, err
	}
	n.Type = model.NodeType(typ)
	n.ModTime = fromMillis(modTime)
	n.CreatedAt = fromMillis(created)
	n.UpdatedAt = fromMillis(updated)
	return n, nil
}

func millis(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UTC().UnixMilli()
}

func fromMillis(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}

func baseName(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}

func parentPath(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[:i]
	}
	return ""
}

// escapeLike escapes the LIKE wildcards of a literal string.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}
