package sqlitestore

import (
	"context"
	"testing"
)

// This file holds the shared corpus of the search: the very same table of
// cases is run against the FTS5 branch and against the LIKE fallback.
//
// The corpus is the proof that the fallback is honest: it finds the same
// notes as the FTS5 branch, for the names, for the contents and for the text
// of the attachments.
//
// The cases are single word queries on purpose. The two branches do not
// tokenize the query the same way (the FTS5 branch matches a prefix of a
// word, the fallback matches a substring) and the FTS5 branch scopes the
// tokens to a single column. Those differences are documented in
// search_fallback_test.go; the corpus stays inside the common ground.

// searchCorpusNote is a note of the corpus.
type searchCorpusNote struct {
	path string
	name string
	body string
}

// searchCorpusAttachment is an attachment of the corpus.
type searchCorpusAttachment struct {
	id       string
	notePath string
	name     string
	body     string
}

// searchCorpusNotes are the notes of the corpus.
var searchCorpusNotes = []searchCorpusNote{
	{"notes/alpha.md", "alpha.md", "the quick brown fox jumps"},
	{"notes/beta.md", "beta.md", "nothing to see here"},
	{"notes/dup.md", "dup.md", "dup content"},
	{"notes/привет.md", "привет.md", "тест кириллицы"},
}

// searchCorpusAttachments are the attachments of the corpus.
var searchCorpusAttachments = []searchCorpusAttachment{
	{"att-1", "notes/alpha.md", "recipe.txt", "the pineapple belongs in the salad"},
	{"att-2", "notes/beta.md", "readme.md", "a markdown attachment"},
}

// searchCorpusCase is a case of the shared corpus.
type searchCorpusCase struct {
	name  string
	query string
	want  []string
}

// searchCorpus is the shared table of the cases of the search. It is run
// against the FTS5 branch and against the LIKE fallback.
var searchCorpus = []searchCorpusCase{
	{"a word of the content", "brown", []string{"notes/alpha.md"}},
	{"another word of the content", "quick", []string{"notes/alpha.md"}},
	{"a word of the name", "alpha", []string{"notes/alpha.md"}},
	{"a word of the name and of the content", "dup", []string{"notes/dup.md"}},
	{"a cyrillic word of the content", "кириллицы", []string{"notes/привет.md"}},
	{"a cyrillic word of the name", "привет", []string{"notes/привет.md"}},
	{"the case does not matter", "BROWN", []string{"notes/alpha.md"}},
	{"a word of the text of an attachment", "pineapple", []string{"notes/alpha.md"}},
	{"another word of the text of an attachment", "salad", []string{"notes/alpha.md"}},
	{"a word of the name of an attachment", "recipe", []string{"notes/alpha.md"}},
	{"a word of the content of an attachment", "markdown", []string{"notes/beta.md"}},
	{"a word that matches nothing", "elephant", nil},
}

// indexSearchCorpus fills the search index with the corpus.
func indexSearchCorpus(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	for _, note := range searchCorpusNotes {
		if err := s.IndexContent(ctx, note.path, note.name, note.body); err != nil {
			t.Fatalf("index %q: %v", note.path, err)
		}
	}
	for _, att := range searchCorpusAttachments {
		if err := s.IndexAttachmentText(ctx, att.id, att.notePath, att.name, att.body); err != nil {
			t.Fatalf("index the attachment %q: %v", att.id, err)
		}
	}
}

// TestSearchCorpusRunsOnBothPaths runs the shared table of the cases against
// the FTS5 branch and against the LIKE fallback.
//
// Both branches must find the same notes, and those notes must be the ones
// the corpus expects.
func TestSearchCorpusRunsOnBothPaths(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	indexSearchCorpus(t, s)

	if !s.FTS5Available() {
		t.Skip("fts5 unavailable in this build")
	}
	original := s.FTS5Available()
	defer s.setFTS5(original)

	for _, c := range searchCorpus {
		c := c
		t.Run(c.name, func(t *testing.T) {
			ftsHits, err := s.Search(ctx, c.query, 50)
			if err != nil {
				t.Fatalf("fts5 search %q: %v", c.query, err)
			}

			s.setFTS5(false)
			likeHits, err := s.Search(ctx, c.query, 50)
			s.setFTS5(original)
			if err != nil {
				t.Fatalf("fallback search %q: %v", c.query, err)
			}

			if !samePaths(uniquePaths(ftsHits), uniquePaths(likeHits)) {
				t.Fatalf("query %q: fts5 = %+v, fallback = %+v", c.query, ftsHits, likeHits)
			}
			if !samePaths(uniquePaths(ftsHits), c.want) {
				t.Fatalf("query %q: the hits are %+v, want %+v", c.query, uniquePaths(ftsHits), c.want)
			}
		})
	}
}

// TestSearchCorpusFindsTheTextOfTheAttachments checks that the text of the
// attachments is searchable and that the hit points at the note of the
// attachment.
func TestSearchCorpusFindsTheTextOfTheAttachments(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	indexSearchCorpus(t, s)

	hits, err := s.Search(ctx, "pineapple", 50)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("expected 1 hit, got %d: %+v", len(hits), hits)
	}
	if hits[0].Path != "notes/alpha.md" {
		t.Fatalf("the hit does not point at the note of the attachment: %+v", hits[0])
	}
	if hits[0].Kind != "content" {
		t.Fatalf("unexpected kind: %+v", hits[0])
	}
	if hits[0].Name != "alpha.md" {
		t.Fatalf("unexpected name: %+v", hits[0])
	}
}

// TestSearchCorpusDropsTheTextOfADeletedAttachment checks that the bytes of a
// deleted attachment do not stay searchable.
func TestSearchCorpusDropsTheTextOfADeletedAttachment(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	indexSearchCorpus(t, s)

	if err := s.DeleteAttachment(ctx, "att-1"); err != nil {
		t.Fatalf("delete the attachment: %v", err)
	}
	hits, err := s.Search(ctx, "pineapple", 50)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("the text of the deleted attachment is still searchable: %+v", hits)
	}

	// The fallback agrees.
	original := s.FTS5Available()
	s.setFTS5(false)
	defer s.setFTS5(original)
	hits, err = s.Search(ctx, "pineapple", 50)
	if err != nil {
		t.Fatalf("fallback search: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("the text of the deleted attachment is still searchable: %+v", hits)
	}
}
