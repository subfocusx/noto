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

// defaultPageLimit is the number of the items of a page when the caller does
// not ask for a specific limit.
const defaultPageLimit = 100

// searchCandidate is the sortable representation of a search result.
type searchCandidate struct {
	hit   model.SearchHit
	kind  string
	score float64
}

// Search returns ranked matches for a free text query. The file name, the
// content of a note and the text extracted from its attachments are searched.
//
// The FTS5 index is used when the driver supports it. The support is detected
// once, when the database is opened (see detectFTS5); the LIKE fallback is
// used only when FTS5 is really unavailable.
func (s *Store) Search(ctx context.Context, query string, limit int) ([]model.SearchHit, error) {
	if limit <= 0 {
		limit = 50
	}
	tokens := tokenize(query)
	if len(tokens) == 0 {
		return []model.SearchHit{}, nil
	}

	// The fallback returns at most one hit per note, the FTS5 branch may
	// return a hit for the name and a hit for the content of a note.
	dedupeByPath := !s.FTS5Available()

	var (
		cands []searchCandidate
		err   error
	)
	if s.FTS5Available() {
		cands, err = s.searchFTS5(ctx, tokens, limit)
		if err != nil {
			return nil, err
		}
		att, err := s.searchAttachmentsFTS5(ctx, tokens, limit)
		if err != nil {
			return nil, err
		}
		cands = append(cands, att...)
	} else {
		cands, err = s.searchLike(ctx, tokens, limit)
		if err != nil {
			return nil, err
		}
		att, err := s.searchAttachmentsLike(ctx, tokens, limit)
		if err != nil {
			return nil, err
		}
		cands = append(cands, att...)
	}

	out := []model.SearchHit{}
	seen := map[string]bool{}
	for _, c := range cands {
		key := c.hit.Path + "\x00" + c.hit.Kind
		if dedupeByPath {
			key = c.hit.Path
		}
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

// searchFTS5 uses the FTS5 virtual table for candidate selection.
func (s *Store) searchFTS5(ctx context.Context, tokens []string, limit int) ([]searchCandidate, error) {
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

	// Merge both kinds: the best score first, then the names before the
	// contents, then the path.
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].score != all[j].score {
			return all[i].score > all[j].score
		}
		if all[i].kind != all[j].kind {
			return all[i].kind == "name"
		}
		return all[i].hit.Path < all[j].hit.Path
	})
	return all, nil
}

// searchLike is the fallback used when FTS5 is unavailable. It performs a
// LIKE scan over the notes_fts table.
//
// The scan is complete: every row of the index that matches the first token
// is inspected and every other token is checked, so the fallback finds the
// same notes as the FTS5 branch. The cost of the scan is the price of a build
// without FTS5.
func (s *Store) searchLike(ctx context.Context, tokens []string, limit int) ([]searchCandidate, error) {
	like := "%" + escapeLike(tokens[0]) + "%"
	const q = `SELECT path, name, body FROM notes_fts
	WHERE name LIKE ? ESCAPE '\' OR body LIKE ? ESCAPE '\'`
	rows, err := s.db.QueryContext(ctx, q, like, like)
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: search (like): %w", err)
	}
	defer rows.Close()

	out := []searchCandidate{}
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
		out = append(out, searchCandidate{
			hit: model.SearchHit{
				Path:    path,
				Name:    name,
				Kind:    kind,
				Snippet: snippet(text, tokens),
			},
			kind: kind,
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

// searchAttachmentsFTS5 searches the text extracted from the attachments with
// the FTS5 index of the attachments.
func (s *Store) searchAttachmentsFTS5(ctx context.Context, tokens []string, limit int) ([]searchCandidate, error) {
	var all []searchCandidate
	for _, column := range []string{"name", "body"} {
		expr := matchExpr(tokens, column)
		const q = `SELECT id, note_path, name, body, bm25(attachment_fts_v) FROM attachment_fts_v
		WHERE attachment_fts_v MATCH ? ORDER BY bm25(attachment_fts_v) LIMIT ?`
		rows, err := s.db.QueryContext(ctx, q, expr, limit)
		if err != nil {
			return nil, fmt.Errorf("sqlitestore: search the attachments (%s): %w", column, err)
		}
		for rows.Next() {
			var id, notePath, name, body string
			var rank float64
			if err := rows.Scan(&id, &notePath, &name, &body, &rank); err != nil {
				rows.Close()
				return nil, fmt.Errorf("sqlitestore: scan an attachment hit: %w", err)
			}
			all = append(all, searchCandidate{
				hit:   attachmentHit(notePath, name, body, tokens),
				kind:  "content",
				score: -rank,
			})
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("sqlitestore: iterate the attachment hits: %w", err)
		}
		rows.Close()
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].score != all[j].score {
			return all[i].score > all[j].score
		}
		return all[i].hit.Path < all[j].hit.Path
	})
	return all, nil
}

// searchAttachmentsLike searches the text extracted from the attachments with
// a LIKE scan. It is the fallback of searchAttachmentsFTS5.
func (s *Store) searchAttachmentsLike(ctx context.Context, tokens []string, limit int) ([]searchCandidate, error) {
	like := "%" + escapeLike(tokens[0]) + "%"
	const q = `SELECT id, note_path, name, body FROM attachment_text
	WHERE name LIKE ? ESCAPE '\' OR body LIKE ? ESCAPE '\'`
	rows, err := s.db.QueryContext(ctx, q, like, like)
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: search the attachments (like): %w", err)
	}
	defer rows.Close()

	out := []searchCandidate{}
	for rows.Next() {
		var id, notePath, name, body string
		if err := rows.Scan(&id, &notePath, &name, &body); err != nil {
			return nil, fmt.Errorf("sqlitestore: scan an attachment hit: %w", err)
		}
		if !matchesAll([]string{name, body}, tokens) {
			continue
		}
		out = append(out, searchCandidate{
			hit:  attachmentHit(notePath, name, body, tokens),
			kind: "content",
		})
		if len(out) >= limit {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitastore: iterate the attachment hits: %w", err)
	}
	return out, nil
}

// attachmentHit builds the hit of an attachment. The hit points at the note
// of the attachment, because the note is what the interface opens.
func attachmentHit(notePath, name, body string, tokens []string) model.SearchHit {
	return model.SearchHit{
		Path:    notePath,
		Name:    baseName(notePath),
		Kind:    "content",
		Snippet: name + ": " + snippet(body, tokens),
	}
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
			spans = append(spans, span{start: from + i, end: from + i + len(t)})
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
