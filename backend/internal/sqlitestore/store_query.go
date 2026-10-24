package sqlitestore

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"noto/backend/internal/model"
	"noto/backend/internal/query"
)

// QueryNotes returns the notes that match a query of the query language.
//
// The query is compiled into SQL with parameters: a query can never inject
// SQL. The names of the matching notes are returned, and a short excerpt of
// the text of the note.
func (s *Store) QueryNotes(ctx context.Context, e query.Expr, limit int) ([]model.SearchHit, error) {
	if limit <= 0 {
		limit = 50
	}
	if e == nil {
		return []model.SearchHit{}, nil
	}
	statement, args, err := query.Compile(e, time.Now())
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: compile the query: %w", err)
	}
	rows, err := s.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: run the query: %w", err)
	}
	defer rows.Close()

	hits := []model.SearchHit{}
	for rows.Next() {
		var path, name string
		if err := rows.Scan(&path, &name); err != nil {
			return nil, fmt.Errorf("sqlitestore: read the result of the query: %w", err)
		}
		hits = append(hits, model.SearchHit{Path: path, Name: name, Kind: "query"})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitestore: read the result of the query: %w", err)
	}
	if len(hits) > limit {
		hits = hits[:limit]
	}
	return hits, nil
}

// countQueryNotes returns the total number of the notes that match a query,
// without the limit.
func (s *Store) countQueryNotes(ctx context.Context, e query.Expr) (int, error) {
	if e == nil {
		return 0, nil
	}
	where, args, err := query.CompileWhere(e, time.Now())
	if err != nil {
		return 0, fmt.Errorf("sqlitestore: compile the query: %w", err)
	}
	statement := "SELECT COUNT(*) " + query.FromClause + " WHERE " + where
	var total int
	if err := s.db.QueryRowContext(ctx, statement, args...).Scan(&total); err != nil {
		return 0, fmt.Errorf("sqlitestore: count the result of the query: %w", err)
	}
	return total, nil
}

// querySnippet returns a short excerpt of the text of a note, for the answer
// of a query.
func (s *Store) querySnippet(ctx context.Context, path string) string {
	var body string
	err := s.db.QueryRowContext(ctx, "SELECT body FROM notes_fts WHERE path = ?", path).Scan(&body)
	if err != nil {
		if err == sql.ErrNoRows {
			return ""
		}
		return ""
	}
	if len(body) > 160 {
		return body[:160]
	}
	return body
}
