package sqlitestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"noto/backend/internal/model"
)

// -------------------------------------------------------------- derived ---

// PutDerivedProps stores the cache of the derived properties of a note.
//
// The properties are a cache: the file on the disk stays the source of truth.
// The write replaces the whole row, so a recomputation clears the stale flag.
func (s *Store) PutDerivedProps(ctx context.Context, d model.DerivedProps) error {
	if d.Path == "" {
		return errors.New("sqlitestore: empty path")
	}
	stale := 0
	if d.Stale {
		stale = 1
	}
	derived := string(d.Derived)
	if derived == "" {
		derived = "{}"
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO note_derived (path, derived, computed_at, stale) VALUES (?, ?, ?, ?)
ON CONFLICT(path) DO UPDATE SET
  derived = excluded.derived,
  computed_at = excluded.computed_at,
  stale = excluded.stale`,
		d.Path, derived, millis(d.ComputedAt), stale)
	if err != nil {
		return fmt.Errorf("sqlitestore: store the derived properties of %q: %w", d.Path, err)
	}
	return nil
}

// GetDerivedProps returns the cache of the derived properties of a note.
func (s *Store) GetDerivedProps(ctx context.Context, path string) (model.DerivedProps, bool, error) {
	var (
		d        model.DerivedProps
		derived  string
		computed int64
		stale    int
	)
	err := s.db.QueryRowContext(ctx,
		"SELECT path, derived, computed_at, stale FROM note_derived WHERE path = ?", path).
		Scan(&d.Path, &derived, &computed, &stale)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return model.DerivedProps{}, false, nil
	case err != nil:
		return model.DerivedProps{}, false, fmt.Errorf("sqlitestore: read the derived properties of %q: %w", path, err)
	}
	d.Derived = []byte(derived)
	d.ComputedAt = fromMillis(computed)
	d.Stale = stale != 0
	return d, true, nil
}

// MarkDerivedPropsStale marks the cached properties of a note as stale.
//
// The properties are not recomputed: the note changed and the row only says
// so. A note without a row is left alone: there is nothing to mark.
func (s *Store) MarkDerivedPropsStale(ctx context.Context, path string) error {
	if _, err := s.db.ExecContext(ctx,
		"UPDATE note_derived SET stale = 1 WHERE path = ?", path); err != nil {
		return fmt.Errorf("sqlitestore: mark the derived properties of %q as stale: %w", path, err)
	}
	return nil
}

// DeleteDerivedProps drops the cached properties of a note.
func (s *Store) DeleteDerivedProps(ctx context.Context, path string) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM note_derived WHERE path = ?", path); err != nil {
		return fmt.Errorf("sqlitestore: delete the derived properties of %q: %w", path, err)
	}
	return nil
}
