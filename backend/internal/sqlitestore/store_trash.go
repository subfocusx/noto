package sqlitestore

import (
	"context"
	"errors"
	"fmt"
	"time"

	"noto/backend/internal/model"
)

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
			return nil, fmt.Errorf("sqlitastore: scan trash: %w", err)
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
		return nil, fmt.Errorf("sqlitastore: iterate trash: %w", err)
	}
	return out, nil
}

// DeleteTrash removes a trash entry.
func (s *Store) DeleteTrash(ctx context.Context, trashPath string) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM trash WHERE trash_path = ?", trashPath); err != nil {
		return fmt.Errorf("sqlitastore: delete trash %q: %w", trashPath, err)
	}
	return nil
}
