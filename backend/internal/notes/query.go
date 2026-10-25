package notes

import (
	"context"
	"sort"
	"strings"
	"time"

	"noto/backend/internal/metadata"
	"noto/backend/internal/model"
	"noto/backend/internal/query"
)

// The limit of the number of the matching notes that are counted.
//
// The answer of a query carries the total number of the matching notes, so
// that the interface can say "12 notes" and show the first ones. The count
// stops at this limit: a vault of a hundred thousand notes must not make the
// interface slow.
const queryCountLimit = 1000

// QueryResult is the answer of a query.
type QueryResult struct {
	// Hits are the notes that match the query.
	Hits []model.SearchHit `json:"hits"`
	// Total is the number of the matching notes, up to queryCountLimit.
	Total int `json:"total"`
	// Partial is true when the properties of some notes could not be
	// recalculated, so the answer may be incomplete.
	Partial bool `json:"partial"`
}

// Query returns the notes that match a query of the query language.
//
// The query is parsed here, so that a broken query is reported as a bad
// request instead of an internal error.
func (s *Service) Query(ctx context.Context, source string, limit int) (QueryResult, error) {
	result := QueryResult{Hits: []model.SearchHit{}}
	if strings.TrimSpace(source) == "" {
		return result, nil
	}
	if limit <= 0 {
		limit = 50
	}
	expr, err := query.Parse(source)
	if err != nil {
		return result, newErr(ErrBadRequest, "%s", err.Error())
	}
	hits, err := s.store.QueryNotes(ctx, expr, queryCountLimit)
	if err != nil {
		return result, newErr(ErrInternal, "cannot run the query")
	}
	result.Total = len(hits)
	if len(hits) > limit {
		hits = hits[:limit]
	}
	result.Hits = hits
	result.Partial = s.propertiesAreStale(ctx)
	return result, nil
}

// TagCounts returns the tags of the vault and the number of the notes that
// carry every one of them.
func (s *Service) TagCounts(ctx context.Context) ([]model.TagCount, error) {
	props, err := s.store.ListNoteProps(ctx)
	if err != nil {
		return nil, newErr(ErrInternal, "cannot read the properties of the notes")
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
	sortTagCounts(out)
	return out, nil
}

// sortTagCounts orders the tags by their number (the biggest first) and by
// their name.
func sortTagCounts(counts []model.TagCount) {
	sort.Slice(counts, func(i, j int) bool {
		if counts[i].Count != counts[j].Count {
			return counts[i].Count > counts[j].Count
		}
		return counts[i].Tag < counts[j].Tag
	})
}

// propertiesAreStale reports whether the properties of some notes could not
// be recalculated.
func (s *Service) propertiesAreStale(ctx context.Context) bool {
	props, err := s.store.ListNoteProps(ctx)
	if err != nil {
		return false
	}
	for _, p := range props {
		if p.Flags&model.PropStale != 0 {
			return true
		}
	}
	return false
}

// refreshNoteProps recalculates the properties of a note and stores them.
//
// The properties are a cache: when the calculation fails, the note itself is
// intact and the row is marked as stale, so that the next reindex repairs it.
func (s *Service) refreshNoteProps(ctx context.Context, rel, name, content string) {
	props := metadata.Extract(content)
	row := model.NoteProps{
		Path:      rel,
		Name:      name,
		Title:     props.Title,
		Tags:      props.Tags,
		Flags:     props.Flags(),
		UpdatedAt: time.Now(),
	}
	if err := s.store.UpsertNoteProps(ctx, row); err != nil {
		// The properties are a cache: the note itself is intact. The row is
		// marked as stale, so that the answer of a query can say that it is
		// partial and so that the next reindex repairs it.
		row.Flags |= model.PropStale
		_ = s.store.UpsertNoteProps(ctx, row)
	}
}
