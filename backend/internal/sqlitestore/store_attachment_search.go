package sqlitestore

import (
	"context"
	"fmt"

	"noto/backend/internal/port"
)

// The search inside the text of the attachments.
//
// The text of an attachment is extracted by the domain layer (see
// `internal/notes/attachsearch.go`) and indexed here. The search uses the
// FTS5 index of the attachments when the driver supports it, and falls back
// to a LIKE scan of the table `attachment_text` otherwise.

// defaultAttachmentLimit is the number of the hits of a search when the
// caller does not ask for a specific limit.
const defaultAttachmentLimit = 50

// SearchAttachments searches the text that was extracted from the attachments.
//
// The hit carries the text around the match, so that the interface can show
// it without reading the file again.
func (s *Store) SearchAttachments(ctx context.Context, query string, limit int) ([]port.AttachmentSearchHit, error) {
	if limit <= 0 {
		limit = defaultAttachmentLimit
	}
	tokens := tokenize(query)
	if len(tokens) == 0 {
		return []port.AttachmentSearchHit{}, nil
	}

	if s.FTS5Available() {
		return s.searchAttachmentIndexFTS5(ctx, tokens, limit)
	}
	return s.searchAttachmentIndexLike(ctx, tokens, limit)
}

// searchAttachmentIndexFTS5 searches the text of the attachments with the
// FTS5 index.
func (s *Store) searchAttachmentIndexFTS5(ctx context.Context, tokens []string, limit int) ([]port.AttachmentSearchHit, error) {
	const q = `SELECT t.id, t.note_path, t.name, t.body, COALESCE(a.mime, '')
FROM attachment_fts_v t LEFT JOIN attachments a ON a.id = t.id
WHERE attachment_fts_v MATCH ? ORDER BY bm25(attachment_fts_v) LIMIT ?`
	rows, err := s.db.QueryContext(ctx, q, matchExpr(tokens, ""), limit)
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: search the attachments: %w", err)
	}
	defer rows.Close()

	out := []port.AttachmentSearchHit{}
	for rows.Next() {
		var hit port.AttachmentSearchHit
		var body string
		if err := rows.Scan(&hit.AttachmentID, &hit.NotePath, &hit.Name, &body, &hit.MIME); err != nil {
			return nil, fmt.Errorf("sqlitestore: scan an attachment hit: %w", err)
		}
		hit.Snippet = snippet(body, tokens)
		out = append(out, hit)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitestore: iterate the attachment hits: %w", err)
	}
	return out, nil
}

// searchAttachmentIndexLike searches the text of the attachments with a LIKE
// scan. It is the fallback of searchAttachmentIndexFTS5.
func (s *Store) searchAttachmentIndexLike(ctx context.Context, tokens []string, limit int) ([]port.AttachmentSearchHit, error) {
	like := "%" + escapeLike(tokens[0]) + "%"
	const q = `SELECT t.id, t.note_path, t.name, t.body, COALESCE(a.mime, '')
FROM attachment_text t LEFT JOIN attachments a ON a.id = t.id
WHERE t.name LIKE ? ESCAPE '\' OR t.body LIKE ? ESCAPE '\'`
	rows, err := s.db.QueryContext(ctx, q, like, like)
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: search the attachments (like): %w", err)
	}
	defer rows.Close()

	out := []port.AttachmentSearchHit{}
	for rows.Next() {
		var hit port.AttachmentSearchHit
		var body string
		if err := rows.Scan(&hit.AttachmentID, &hit.NotePath, &hit.Name, &body, &hit.MIME); err != nil {
			return nil, fmt.Errorf("sqlitestore: scan an attachment hit: %w", err)
		}
		if !matchesAll([]string{hit.Name, body}, tokens) {
			continue
		}
		hit.Snippet = snippet(body, tokens)
		out = append(out, hit)
		if len(out) >= limit {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitestore: iterate the attachment hits: %w", err)
	}
	return out, nil
}
