package sqlitestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"noto/backend/internal/model"
)

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
			return nil, fmt.Errorf("sqlitastore: scan attachment: %w", err)
		}
		a.CreatedAt = fromMillis(created)
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitastore: iterate attachments: %w", err)
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
		return fmt.Errorf("sqlitastore: delete attachment %q: %w", id, err)
	}
	return nil
}
