package sqlitestore

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"noto/backend/internal/model"
)

// maxSnippetLen is the maximum length of a snippet returned by Search.
const maxSnippetLen = 160

// fallbackScanLimit bounds the number of rows inspected by the LIKE based
// fallback search when FTS5 is unavailable.
const fallbackScanLimit = 2000

// searchCandidate is the sortable representation of a search result.
type searchCandidate struct {
	hit   model.SearchHit
	kind  string
	score float64
}

// Search returns ranked matches for a free text query. Both the file name and
// the content of a note are searched.
func (s *Store) Search(ctx context.Context, query string, limit int) ([]model.SearchHit, error) {
	if limit <= 0 {
		limit = 50
	}
	tokens := tokenize(query)
	if len(tokens) == 0 {
		return []model.SearchHit{}, nil
	}

	var hits []model.SearchHit
	var err error
	if s.FTS5Available() {
		hits, err = s.searchFTS5(ctx, tokens, limit)
	} else {
		hits, err = s.searchLike(ctx, tokens, limit)
	}
	if err != nil {
		return nil, err
	}
	if hits == nil {
		hits = []model.SearchHit{}
	}
	return hits, nil
}

// searchFTS5 uses the FTS5 virtual table for candidate selection.
func (s *Store) searchFTS5(ctx context.Context, tokens []string, limit int) ([]model.SearchHit, error) {
	var all []searchCandidate

	for _, column := range []string{"name", "body"} {
		expr := matchExpr(tokens, column)
		const q = `SELECT path, name, body, bm25(notes_fts_v) FROM notes_fts_v
WHERE notes_fts_v MATCH ? ORDER BY bm25(notes_fts_v) LIMIT ?`
		rows, err := s.db.QueryContext(ctx, q, expr, limit)
		if err != nil {
			return nil, fmt.Errorf("sqlitestore: search (%s): %w", column, err)
		}
		for rows.Next() {
			var path, name, body string
			var rank float64
			if err := rows.Scan(&path, &name, &body, &rank); err != nil {
				rows.Close()
				return nil, fmt.Errorf("sqlitestore: scan search hit: %w", err)
			}
			kind, text := "content", body
			if column == "name" {
				kind, text = "name", name
			}
			all = append(all, searchCandidate{
				hit: model.SearchHit{
					Path:    path,
					Name:    name,
					Kind:    kind,
					Snippet: snippet(text, tokens),
				},
				kind:  kind,
				score: -rank,
			})
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("sqlitestore: iterate search hits: %w", err)
		}
		rows.Close()
	}

	// Merge both kinds and cut the result down to the requested limit.
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].score != all[j].score {
			return all[i].score > all[j].score
		}
		if all[i].kind != all[j].kind {
			return all[i].kind == "name"
		}
		return all[i].hit.Path < all[j].hit.Path
	})
	out := make([]model.SearchHit, 0, len(all))
	seen := map[string]bool{}
	for _, c := range all {
		key := c.hit.Path + "\x00" + c.hit.Kind
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, c.hit)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

// searchLike is the fallback used when FTS5 is unavailable. It performs a
// bounded LIKE scan over the notes_fts table.
func (s *Store) searchLike(ctx context.Context, tokens []string, limit int) ([]model.SearchHit, error) {
	like := "%" + escapeLike(tokens[0]) + "%"
	const q = `SELECT path, name, body FROM notes_fts
WHERE name LIKE ? ESCAPE '\' OR body LIKE ? ESCAPE '\' LIMIT ?`
	rows, err := s.db.QueryContext(ctx, q, like, like, fallbackScanLimit)
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: search (like): %w", err)
	}
	defer rows.Close()

	out := []model.SearchHit{}
	for rows.Next() {
		var path, name, body string
		if err := rows.Scan(&path, &name, &body); err != nil {
			return nil, fmt.Errorf("sqlitestore: scan search hit: %w", err)
		}
		if !matchesAll([]string{name, body}, tokens) {
			continue
		}
		kind, text := "content", body
		if matchesAll([]string{name}, tokens) {
			kind, text = "name", name
		}
		out = append(out, model.SearchHit{
			Path:    path,
			Name:    name,
			Kind:    kind,
			Snippet: snippet(text, tokens),
		})
		if len(out) >= limit {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitestore: iterate search hits: %w", err)
	}
	return out, nil
}

// tokenize splits a user query into safe FTS tokens. Every character that is
// not a letter, a digit or an underscore is dropped, so no FTS5 syntax can
// leak into the query.
func tokenize(query string) []string {
	var tokens []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			tokens = append(tokens, cur.String())
			cur.Reset()
		}
	}
	for _, r := range query {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_':
			cur.WriteRune(unicode.ToLower(r))
		default:
			flush()
		}
	}
	flush()
	return dropStopWords(tokens)
}

// stopWords are the FTS5 operator words. They are dropped so that a query
// such as "alpha OR beta" searches for "alpha beta" instead of failing.
var stopWords = map[string]bool{
	"and":  true,
	"or":   true,
	"not":  true,
	"near": true,
}

// dropStopWords removes the operator words from a token list.
func dropStopWords(tokens []string) []string {
	out := make([]string, 0, len(tokens))
	for _, t := range tokens {
		if stopWords[t] {
			continue
		}
		out = append(out, t)
	}
	return out
}

// matchExpr builds an FTS5 MATCH expression for the given tokens and column.
// Every token becomes a quoted phrase with a prefix wildcard, so special
// characters can never be interpreted as FTS operators.
func matchExpr(tokens []string, column string) string {
	parts := make([]string, 0, len(tokens))
	for _, t := range tokens {
		parts = append(parts, `"`+t+`"*`)
	}
	inner := strings.Join(parts, " AND ")
	if column == "" {
		return inner
	}
	return column + ` : (` + inner + `)`
}

// matchesAll reports whether all tokens occur in the given texts.
func matchesAll(texts []string, tokens []string) bool {
	for _, t := range tokens {
		found := false
		for _, text := range texts {
			if strings.Contains(strings.ToLower(text), t) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// snippet extracts a short excerpt around the first matching token and
// highlights every match inside it.
func snippet(text string, tokens []string) string {
	if text == "" {
		return ""
	}
	lower := strings.ToLower(text)
	pos := -1
	for _, t := range tokens {
		if i := strings.Index(lower, t); i >= 0 && (pos < 0 || i < pos) {
			pos = i
		}
	}
	if pos < 0 {
		// No token matched in this text; fall back to the beginning.
		pos = 0
	}
	start := 0
	if pos > 40 {
		start = pos - 40
	}
	end := len(text)
	if start+maxSnippetLen < end {
		end = start + maxSnippetLen
	}
	// Do not cut in the middle of a rune.
	for start > 0 && start < len(text) && !isRuneStart(text[start]) {
		start--
	}
	for end < len(text) && !isRuneStart(text[end]) {
		end++
	}
	out := highlight(text[start:end], tokens)
	if start > 0 {
		out = "…" + out
	}
	if end < len(text) {
		out += "…"
	}
	return out
}

// isRuneStart reports whether b starts a UTF-8 rune.
func isRuneStart(b byte) bool { return b&0xC0 != 0x80 }

// highlight wraps every occurrence of the tokens in ** **.
func highlight(text string, tokens []string) string {
	lower := strings.ToLower(text)
	type span struct{ start, end int }
	var spans []span
	for _, t := range tokens {
		if t == "" {
			continue
		}
		from := 0
		for {
			i := strings.Index(lower[from:], t)
			if i < 0 {
				break
			}
			spans = append(spans, span{from + i, from + i + len(t)})
			from += i + len(t)
		}
	}
	if len(spans) == 0 {
		return text
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].start < spans[j].start })
	merged := []span{spans[0]}
	for _, sp := range spans[1:] {
		last := &merged[len(merged)-1]
		if sp.start <= last.end {
			if sp.end > last.end {
				last.end = sp.end
			}
			continue
		}
		merged = append(merged, sp)
	}
	var b strings.Builder
	prev := 0
	for _, sp := range merged {
		b.WriteString(text[prev:sp.start])
		b.WriteString("**")
		b.WriteString(text[sp.start:sp.end])
		b.WriteString("**")
		prev = sp.end
	}
	b.WriteString(text[prev:])
	return b.String()
}
