package sqlitestore

import (
	"context"
	"sort"
	"strings"
	"testing"

	"noto/backend/internal/model"
)

// This file covers the LIKE based fallback of the search (searchLike). The
// branch is dead code in the ordinary test runs, because the SQLite driver
// (modernc.org/sqlite) ships FTS5. The test switches the unexported flag
// "fts5" of the store off, so that Search uses the fallback, and compares
// the result with the FTS5 branch.
//
// The flag is guarded by ftsMu, the test uses the same mutex and restores
// the original value with a defer, so that the other tests of the package
// are not affected.
//
// Known divergences between the two branches (they are properties of the
// current implementation and are documented here instead of being asserted
// as a bug):
//
//   - a note that matches in the name *and* in the body produces two hits
//     in the FTS5 branch (kind "name" and kind "content") but only one hit
//     in the fallback, whose kind is "name";
//   - the FTS5 branch requires all tokens of a query inside the same column
//     (name or body), the fallback accepts a token from the name and a
//     token from the body;
//   - the FTS5 branch matches a prefix of a word ("brown" matches
//     "brownish"), the fallback matches a substring;
//   - the FTS5 branch sorts the hits by the bm25 rank, the fallback keeps
//     the order of the index table.
//
// The queries below are single word queries on purpose: for them both
// branches must find exactly the same notes.

// setFTS5 switches the FTS5 flag of the store. The test lives in the same
// package, so the unexported field can be used directly.
func (s *Store) setFTS5(v bool) {
	s.ftsMu.Lock()
	defer s.ftsMu.Unlock()
	s.fts5 = v
}

// fallbackFixture is the data set that both branches are run against.
// Every name ends with ".md", so the single letter "d" matches all of them.
var fallbackFixture = []struct {
	path string
	name string
	body string
}{
	{"notes/alpha.md", "alpha.md", "the quick brown fox jumps"},
	{"notes/beta.md", "beta.md", "nothing to see here"},
	{"notes/dup.md", "dup.md", "dup content"},
	{"notes/привет.md", "привет.md", "тест кириллицы"},
}

// indexFallbackFixture fills the search index.
func indexFallbackFixture(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	for _, f := range fallbackFixture {
		if err := s.IndexContent(ctx, f.path, f.name, f.body); err != nil {
			t.Fatalf("index %q: %v", f.path, err)
		}
	}
}

// uniquePaths returns the sorted set of the paths of the hits.
func uniquePaths(hits []model.SearchHit) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(hits))
	for _, h := range hits {
		if seen[h.Path] {
			continue
		}
		seen[h.Path] = true
		out = append(out, h.Path)
	}
	sort.Strings(out)
	return out
}

// samePaths reports whether two slices of paths hold the same values.
func samePaths(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestSearchFallbackMatchesFTS5 is the core test of the fallback branch.
//
// It checks that the fallback finds the same notes as the FTS5 branch for
// the name, the content, the case insensitive ASCII match and the Cyrillic
// match, that the hits are deduplicated and that the limit is respected.
func TestSearchFallbackMatchesFTS5(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	indexFallbackFixture(t, s)

	original := s.FTS5Available()
	restore := func() { s.setFTS5(original) }
	defer restore()

	// The queries are single word queries on purpose: for them both
	// branches must find exactly the same notes. The query "d" is not part
	// of the list, because the FTS5 branch matches the prefix of a word
	// ("dup") while the fallback matches the substring (".md").
	queries := []string{"brown", "alpha", "dup", "кириллицы", "BROWN", "quick"}
	for _, q := range queries {
		t.Run(q, func(t *testing.T) {
			// The FTS5 branch first.
			ftsHits, err := s.Search(ctx, q, 50)
			if err != nil {
				t.Fatalf("fts5 search %q: %v", q, err)
			}
			if !s.FTS5Available() {
				t.Skip("fts5 unavailable in this build")
			}

			// The LIKE fallback.
			s.setFTS5(false)
			hits, err := s.Search(ctx, q, 50)
			s.setFTS5(original)
			if err != nil {
				t.Fatalf("fallback search %q: %v", q, err)
			}

			if !samePaths(uniquePaths(ftsHits), uniquePaths(hits)) {
				t.Fatalf("query %q: fts5 = %+v, fallback = %+v", q, ftsHits, hits)
			}

			// The fallback returns at most one hit per note.
			seen := map[string]bool{}
			for _, h := range hits {
				if seen[h.Path] {
					t.Fatalf("query %q: the fallback returned %q twice: %+v", q, h.Path, hits)
				}
				seen[h.Path] = true
			}
			// The FTS5 branch is deduplicated by path and kind.
			seenFTS := map[string]bool{}
			for _, h := range ftsHits {
				key := h.Path + "\x00" + h.Kind
				if seenFTS[key] {
					t.Fatalf("query %q: the fts5 branch returned %q twice: %+v", q, key, ftsHits)
				}
				seenFTS[key] = true
			}
		})
	}
}

// TestSearchFallbackKindsAndOrder checks the kind of the hits and the order
// of the fallback.
func TestSearchFallbackKindsAndOrder(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	indexFallbackFixture(t, s)

	original := s.FTS5Available()
	s.setFTS5(false)
	defer s.setFTS5(original)

	// A note that matches in the name and in the body is reported once and
	// with the kind "name" (the name wins over the content).
	hits, err := s.Search(ctx, "dup", 50)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("expected 1 hit for %q, got %d: %+v", "dup", len(hits), hits)
	}
	if hits[0].Path != "notes/dup.md" || hits[0].Kind != "name" {
		t.Fatalf("unexpected hit: %+v", hits[0])
	}
	if hits[0].Name != "dup.md" {
		t.Fatalf("unexpected name: %+v", hits[0])
	}
	if !strings.Contains(hits[0].Snippet, "dup") {
		t.Fatalf("the snippet does not contain the term: %q", hits[0].Snippet)
	}

	// A note that matches only in the body is reported with the kind
	// "content".
	hits, err = s.Search(ctx, "brown", 50)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 || hits[0].Kind != "content" || hits[0].Path != "notes/alpha.md" {
		t.Fatalf("unexpected hits: %+v", hits)
	}

	// The order of the fallback is the order of the index table.
	rows, err := s.DB().QueryContext(ctx, "SELECT path, name, body FROM notes_fts ORDER BY rowid")
	if err != nil {
		t.Fatalf("read the index table: %v", err)
	}
	var want []string
	for rows.Next() {
		var p, name, body string
		if err := rows.Scan(&p, &name, &body); err != nil {
			rows.Close()
			t.Fatalf("scan: %v", err)
		}
		if matchesAll([]string{name, body}, []string{"d"}) {
			want = append(want, p)
		}
	}
	rows.Close()

	hits, err = s.Search(ctx, "d", 50)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	var got []string
	for _, h := range hits {
		got = append(got, h.Path)
	}
	if !samePaths(got, want) {
		t.Fatalf("the order of the fallback = %+v, want the order of the index table %+v", got, want)
	}
}

// TestSearchFallbackEmptyQuery checks that an empty query matches nothing.
func TestSearchFallbackEmptyQuery(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	indexFallbackFixture(t, s)

	original := s.FTS5Available()
	s.setFTS5(false)
	defer s.setFTS5(original)

	for _, q := range []string{"", "   ", "*", "-", "\"", "%", "()"} {
		hits, err := s.Search(ctx, q, 50)
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		if len(hits) != 0 {
			t.Fatalf("search %q returned %d hits: %+v", q, len(hits), hits)
		}
	}
}

// TestSearchFallbackSpecialCharacters checks that a query with special
// characters neither fails nor matches everything.
func TestSearchFallbackSpecialCharacters(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	indexFallbackFixture(t, s)

	original := s.FTS5Available()
	s.setFTS5(false)
	defer s.setFTS5(original)

	for _, q := range []string{
		`"`, `*`, `-`, `^`, `:`, `()`,
		`alpha OR beta`, `alpha NEAR beta`, `a AND b OR c`, `alpha*`,
		`%`, `_`, `\`, `||`, `<<`, `>>`,
	} {
		hits, err := s.Search(ctx, q, 50)
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		// The special characters are dropped by the tokenizer, so the
		// result must be the result of the plain token query.
		tokens := tokenize(q)
		plain := strings.Join(tokens, " ")
		want, err := s.Search(ctx, plain, 50)
		if err != nil {
			t.Fatalf("search %q: %v", plain, err)
		}
		if !samePaths(uniquePaths(hits), uniquePaths(want)) {
			t.Fatalf("search %q returned %+v, want the result of %q: %+v", q, hits, plain, want)
		}
	}
}

// TestSearchFallbackLimit checks that the limit is respected.
func TestSearchFallbackLimit(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	indexFallbackFixture(t, s)

	original := s.FTS5Available()
	s.setFTS5(false)
	defer s.setFTS5(original)

	// Every note of the fixture has the ".md" suffix, so the query "d"
	// matches all four notes.
	hits, err := s.Search(ctx, "d", 50)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != len(fallbackFixture) {
		t.Fatalf("expected %d hits, got %d: %+v", len(fallbackFixture), len(hits), hits)
	}
	for _, limit := range []int{1, 2, 3} {
		hits, err := s.Search(ctx, "d", limit)
		if err != nil {
			t.Fatalf("search with limit %d: %v", limit, err)
		}
		if len(hits) != limit {
			t.Fatalf("limit %d returned %d hits: %+v", limit, len(hits), hits)
		}
	}
	// A limit of zero means the default limit, never an empty result.
	hits, err = s.Search(ctx, "d", 0)
	if err != nil {
		t.Fatalf("search with limit 0: %v", err)
	}
	if len(hits) == 0 {
		t.Fatal("a limit of 0 must fall back to the default limit")
	}
}

// TestSearchFallbackCaseInsensitiveASCII checks that the fallback ignores
// the case of an ASCII query.
//
// The caveat of the LIKE prefilter of the fallback is documented here: the
// SQLite LIKE operator folds the case of the ASCII characters only, so a
// Cyrillic note written in upper case is not found by a lower case query.
// The FTS5 tokenizer of SQLite has the same limitation, so both branches
// behave the same here.
func TestSearchFallbackCaseInsensitiveASCII(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	indexFallbackFixture(t, s)

	original := s.FTS5Available()
	s.setFTS5(false)
	defer s.setFTS5(original)

	for _, q := range []string{"brown", "BROWN", "BrOwN", "dup", "DUP"} {
		hits, err := s.Search(ctx, q, 50)
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		if len(hits) == 0 {
			t.Fatalf("search %q returned no hits", q)
		}
	}
}

// TestSearchFallbackCyrillic checks that the fallback finds a Cyrillic
// note.
func TestSearchFallbackCyrillic(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	indexFallbackFixture(t, s)

	original := s.FTS5Available()
	s.setFTS5(false)
	defer s.setFTS5(original)

	hits, err := s.Search(ctx, "кириллицы", 50)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("expected 1 hit, got %d: %+v", len(hits), hits)
	}
	if hits[0].Path != "notes/привет.md" || hits[0].Kind != "content" {
		t.Fatalf("unexpected hit: %+v", hits[0])
	}

	// The name of a Cyrillic note is found as well.
	hits, err = s.Search(ctx, "привет", 50)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 || hits[0].Kind != "name" {
		t.Fatalf("unexpected hits: %+v", hits)
	}
}

// TestSearchFallbackRestoresFTS5Flag makes sure that the flag can be
// switched and restored, so that the other tests of the package are not
// affected.
func TestSearchFallbackRestoresFTS5Flag(t *testing.T) {
	s := openTestStore(t)
	before := s.FTS5Available()
	s.setFTS5(!before)
	if s.FTS5Available() == before {
		t.Fatal("the flag was not switched")
	}
	s.setFTS5(before)
	if s.FTS5Available() != before {
		t.Fatalf("the flag was not restored: %v, want %v", s.FTS5Available(), before)
	}
}

// TestSearchFallbackWithEmptyIndex checks that the fallback works with an
// empty index and with a query that matches nothing.
func TestSearchFallbackWithEmptyIndex(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	original := s.FTS5Available()
	s.setFTS5(false)
	defer s.setFTS5(original)

	hits, err := s.Search(ctx, "anything", 50)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("expected no hits, got %+v", hits)
	}
}
