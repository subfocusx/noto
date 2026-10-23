package sqlitestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"noto/backend/internal/model"
)

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
