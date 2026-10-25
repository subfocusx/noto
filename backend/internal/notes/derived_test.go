package notes_test

import (
	"context"
	"encoding/json"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// TestDerivedPropsAreMarkedStaleOnAChange checks the rule of the cache of the
// derived properties: a note that changes has its cached properties marked
// as stale, they are not recomputed right away.
func TestDerivedPropsAreMarkedStaleOnAChange(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create the file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "# Title\n\n#work\n", 0); err != nil {
		t.Fatalf("write the note: %v", err)
	}

	// The first computation fills the cache.
	row, err := svc.RecomputeDerived(ctx, "note.md", "# Title\n\n#work\n")
	if err != nil {
		t.Fatalf("recompute the derived properties: %v", err)
	}
	if row.Stale {
		t.Fatalf("a fresh row is stale: %+v", row)
	}

	var summary notes.DerivedSummary
	if err := json.Unmarshal(row.Derived, &summary); err != nil {
		t.Fatalf("decode the derived properties: %v", err)
	}
	if summary.Title != "Title" {
		t.Fatalf("unexpected title %q", summary.Title)
	}
	if len(summary.Tags) != 1 || summary.Tags[0] != "work" {
		t.Fatalf("unexpected tags %+v", summary.Tags)
	}

	// A write of the note marks the cache as stale.
	if _, err := svc.Write(ctx, "note.md", "# Title\n\n#home\n", 0); err != nil {
		t.Fatalf("write the note again: %v", err)
	}
	stored, found, err := svc.DerivedProps(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the derived properties: %v", err)
	}
	if !found {
		t.Fatalf("the derived properties were not found")
	}
	if !stored.Stale {
		t.Fatalf("the cache was not marked as stale: %+v", stored)
	}
	// The content of the cache is the one of the last computation: the
	// properties are not recomputed by the write.
	var stale notes.DerivedSummary
	if err := json.Unmarshal(stored.Derived, &stale); err != nil {
		t.Fatalf("decode the stale properties: %v", err)
	}
	if len(stale.Tags) != 1 || stale.Tags[0] != "work" {
		t.Fatalf("the cache was recomputed by the write: %+v", stale.Tags)
	}

	// The recomputation clears the flag.
	row, err = svc.RecomputeDerived(ctx, "note.md", "# Title\n\n#home\n")
	if err != nil {
		t.Fatalf("recompute the derived properties again: %v", err)
	}
	if row.Stale {
		t.Fatalf("the recomputation did not clear the flag: %+v", row)
	}
	if err := json.Unmarshal(row.Derived, &summary); err != nil {
		t.Fatalf("decode the derived properties: %v", err)
	}
	if len(summary.Tags) != 1 || summary.Tags[0] != "home" {
		t.Fatalf("unexpected tags %+v", summary.Tags)
	}
}

// TestMarkDerivedStale checks the invalidation of the cache of the derived
// properties.
func TestMarkDerivedStale(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create the file: %v", err)
	}
	if _, err := svc.RecomputeDerived(ctx, "note.md", "# Title\n"); err != nil {
		t.Fatalf("recompute the derived properties: %v", err)
	}
	if err := svc.MarkDerivedStale(ctx, "note.md"); err != nil {
		t.Fatalf("mark the derived properties as stale: %v", err)
	}
	stored, found, err := svc.DerivedProps(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the derived properties: %v", err)
	}
	if !found || !stored.Stale {
		t.Fatalf("the cache was not marked as stale: %+v", stored)
	}
}

// TestDerivedPropsOfAMissingNote checks the answer of the cache for a note
// that has none.
func TestDerivedPropsOfAMissingNote(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	_, found, err := svc.DerivedProps(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the derived properties: %v", err)
	}
	if found {
		t.Fatalf("a note without a cache was found")
	}
	if _, _, err := svc.DerivedProps(ctx, ""); notes.Code(err) != notes.CodeInvalidPath {
		t.Fatalf("expected invalid_path, got %q (%v)", notes.Code(err), err)
	}
}

// TestReindexRepairsTheDerivedProps checks that the rebuild of the index
// recomputes the cache of the derived properties.
func TestReindexRepairsTheDerivedProps(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create the file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "# Title\n\n#work\n", 0); err != nil {
		t.Fatalf("write the note: %v", err)
	}
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("reindex: %v", err)
	}

	stored, found, err := svc.DerivedProps(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the derived properties: %v", err)
	}
	if !found {
		t.Fatalf("the derived properties were not found")
	}
	if stored.Stale {
		t.Fatalf("the reindex did not repair the cache: %+v", stored)
	}
}
