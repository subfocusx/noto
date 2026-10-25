package sqlitestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"noto/backend/internal/model"
)

// -------------------------------------------------------------- versions ---

// AppendVersion appends an immutable version of a note to its history.
//
// A version is written once and never modified: the same revision of a note
// is never written twice. The write of a version that already exists is an
// error, so that a bug cannot rewrite the history.
func (s *Store) AppendVersion(ctx context.Context, v model.NoteVersion) error {
	if v.Path == "" {
		return errors.New("sqlitestore: empty path")
	}
	if v.Revision <= 0 {
		return errors.New("sqlitestore: a version needs a positive revision")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO note_versions (path, revision, title, content, created_at)
VALUES (?, ?, ?, ?, ?)`,
		v.Path, v.Revision, v.Title, v.Content, millis(v.CreatedAt))
	if err != nil {
		return fmt.Errorf("sqlitestore: append the version %d of %q: %w", v.Revision, v.Path, err)
	}
	return nil
}

// ListVersions returns the history of a note, ordered by revision.
func (s *Store) ListVersions(ctx context.Context, path string) ([]model.NoteVersion, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT path, revision, title, content, created_at
FROM note_versions WHERE path = ? ORDER BY revision`, path)
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: list the versions of %q: %w", path, err)
	}
	defer rows.Close()

	out := []model.NoteVersion{}
	for rows.Next() {
		v, err := scanVersion(rows)
		if err != nil {
			return nil, fmt.Errorf("sqlitestore: scan a version of %q: %w", path, err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitestore: iterate the versions of %q: %w", path, err)
	}
	return out, nil
}

// GetVersion returns a single version of a note.
func (s *Store) GetVersion(ctx context.Context, path string, revision int64) (model.NoteVersion, bool, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT path, revision, title, content, created_at
FROM note_versions WHERE path = ? AND revision = ?`, path, revision)
	v, err := scanVersion(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.NoteVersion{}, false, nil
	}
	if err != nil {
		return model.NoteVersion{}, false, fmt.Errorf("sqlitestore: read the version %d of %q: %w", revision, path, err)
	}
	return v, true, nil
}

// scanner is implemented by *sql.Row and *sql.Rows.
type versionScanner interface {
	Scan(dest ...any) error
}

// scanVersion reads a version row.
func scanVersion(sc versionScanner) (model.NoteVersion, error) {
	var (
		v       model.NoteVersion
		created int64
	)
	if err := sc.Scan(&v.Path, &v.Revision, &v.Title, &v.Content, &created); err != nil {
		return model.NoteVersion{}, err
	}
	v.CreatedAt = fromMillis(created)
	return v, nil
}
