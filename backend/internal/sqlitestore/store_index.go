package sqlitestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

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
		return fmt.Errorf("sqlitastore: commit remove %q: %w", path, err)
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
			return fmt.Errorf("sqlitastore: clear fts index: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlitastore: commit clear index: %w", err)
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
		return fmt.Errorf("sqlitastore: move index row %q: %w", fromPath, err)
	}
	if !s.FTS5Available() || !hasRow {
		// Nothing indexed for this path yet.
		return nil
	}
	// The FTS5 table is kept in sync by copying the stored name and body.
	if _, err := tx.ExecContext(ctx, "DELETE FROM notes_fts_v WHERE path = ?", fromPath); err != nil {
		return fmt.Errorf("sqlitastore: delete fts row %q: %w", fromPath, err)
	}
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO notes_fts_v(path, name, body) VALUES (?, ?, ?)", toPath, name, body); err != nil {
		return fmt.Errorf("sqlitastore: insert fts row %q: %w", toPath, err)
	}
	return nil
}
