package sqlitestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"noto/backend/internal/model"
)

// ---------------------------------------------------------------- props ---

// UpsertNoteProps inserts or replaces the derived properties of a note.
//
// The properties are a cache of the text of the note: the file on the disk
// stays the source of truth, and the row is rebuilt when the note is saved or
// when the index is rebuilt.
func (s *Store) UpsertNoteProps(ctx context.Context, p model.NoteProps) error {
	if p.Path == "" {
		return errors.New("sqlitestore: empty path")
	}
	tags := p.Tags
	if tags == nil {
		tags = []string{}
	}
	encoded, err := json.Marshal(tags)
	if err != nil {
		return fmt.Errorf("sqlitestore: encode the tags of %q: %w", p.Path, err)
	}
	updated := millis(p.UpdatedAt)
	if _, err := s.db.ExecContext(ctx, `
INSERT INTO note_props (path, name, title, tags, flags, updated_at) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(path) DO UPDATE SET
  name = excluded.name,
  title = excluded.title,
  tags = excluded.tags,
  flags = excluded.flags,
  updated_at = excluded.updated_at`,
		p.Path, p.Name, p.Title, string(encoded), p.Flags, updated); err != nil {
		return fmt.Errorf("sqlitestore: upsert the properties of %q: %w", p.Path, err)
	}
	return nil
}

// GetNoteProps returns the derived properties of a single path.
func (s *Store) GetNoteProps(ctx context.Context, path string) (model.NoteProps, bool, error) {
	var (
		props   model.NoteProps
		tags    string
		updated int64
	)
	err := s.db.QueryRowContext(ctx,
		"SELECT path, name, title, tags, flags, updated_at FROM note_props WHERE path = ?", path).
		Scan(&props.Path, &props.Name, &props.Title, &tags, &props.Flags, &updated)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return model.NoteProps{}, false, nil
	case err != nil:
		return model.NoteProps{}, false, fmt.Errorf("sqlitestore: read the properties of %q: %w", path, err)
	}
	props.Tags = decodeTags(tags)
	props.UpdatedAt = fromMillis(updated)
	return props, true, nil
}

// ListNoteProps returns the derived properties of every known note.
func (s *Store) ListNoteProps(ctx context.Context) ([]model.NoteProps, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT path, name, title, tags, flags, updated_at FROM note_props")
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: read the properties: %w", err)
	}
	defer rows.Close()

	out := []model.NoteProps{}
	for rows.Next() {
		var (
			props   model.NoteProps
			tags    string
			updated int64
		)
		if err := rows.Scan(&props.Path, &props.Name, &props.Title, &tags, &props.Flags, &updated); err != nil {
			return nil, fmt.Errorf("sqlitestore: read the properties: %w", err)
		}
		props.Tags = decodeTags(tags)
		props.UpdatedAt = fromMillis(updated)
		out = append(out, props)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitestore: read the properties: %w", err)
	}
	return out, nil
}

// DeleteNoteProps drops the derived properties of a path.
func (s *Store) DeleteNoteProps(ctx context.Context, path string) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM note_props WHERE path = ?", path); err != nil {
		return fmt.Errorf("sqlitestore: delete the properties of %q: %w", path, err)
	}
	return nil
}

// ListTagCounts returns the tags of the vault and the number of the notes
// that carry every one of them.
//
// The counts are calculated from the cached properties: they are a view of the
// index, not a second source of truth.
func (s *Store) ListTagCounts(ctx context.Context) ([]model.TagCount, error) {
	props, err := s.ListNoteProps(ctx)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, p := range props {
		for _, tag := range p.Tags {
			counts[tag]++
		}
	}
	out := make([]model.TagCount, 0, len(counts))
	for tag, count := range counts {
		out = append(out, model.TagCount{Tag: tag, Count: count})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Tag < out[j].Tag
	})
	return out, nil
}

// decodeTags reads the JSON list of the tags of a note.
func decodeTags(encoded string) []string {
	if encoded == "" {
		return []string{}
	}
	var tags []string
	if err := json.Unmarshal([]byte(encoded), &tags); err != nil {
		return []string{}
	}
	if tags == nil {
		return []string{}
	}
	return tags
}
