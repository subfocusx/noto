package notes_test

import (
	"context"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// TestVersionsAreAppendedOnEveryWrite checks that every write of a note
// appends a version to its history and that the history is never rewritten.
func TestVersionsAreAppendedOnEveryWrite(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create the file: %v", err)
	}
	versions, err := svc.Versions(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the history: %v", err)
	}
	if len(versions) != 1 {
		t.Fatalf("expected 1 version after the creation, got %d", len(versions))
	}
	if versions[0].Content != "" {
		t.Fatalf("the first version is not empty: %+v", versions[0])
	}

	first, err := svc.Write(ctx, "note.md", "# Title\n\nthe first text", 0)
	if err != nil {
		t.Fatalf("write the note: %v", err)
	}
	second, err := svc.Write(ctx, "note.md", "# Title\n\nthe second text", 0)
	if err != nil {
		t.Fatalf("write the note again: %v", err)
	}

	versions, err = svc.Versions(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the history again: %v", err)
	}
	if len(versions) != 3 {
		t.Fatalf("expected 3 versions, got %d: %+v", len(versions), versions)
	}
	// The versions are ordered by revision and every one of them keeps its
	// own text.
	for i, v := range versions {
		if v.Revision != int64(i+1) {
			t.Fatalf("unexpected revision %d at the position %d: %+v", v.Revision, i, v)
		}
	}
	if versions[1].Content != "# Title\n\nthe first text" {
		t.Fatalf("unexpected content of the second version: %q", versions[1].Content)
	}
	if versions[2].Content != "# Title\n\nthe second text" {
		t.Fatalf("unexpected content of the third version: %q", versions[2].Content)
	}
	// The title is derived from the text of the version.
	if versions[2].Title != "Title" {
		t.Fatalf("unexpected title: %q", versions[2].Title)
	}
	// The revision of the last version is the revision of the note.
	if versions[2].Revision != second.Revision {
		t.Fatalf("the last version is %d, the note is at %d", versions[2].Revision, second.Revision)
	}
	// The history is not rewritten: the first write is still there.
	if versions[1].Revision != first.Revision {
		t.Fatalf("the version of the first write was rewritten")
	}
}

// TestVersionOfAMissingRevision checks the error of a version that does not
// exist.
func TestVersionOfAMissingRevision(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create the file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "the text", 0); err != nil {
		t.Fatalf("write the note: %v", err)
	}

	_, err := svc.Version(ctx, "note.md", 99)
	if notes.Code(err) != notes.CodeNotFound {
		t.Fatalf("expected not_found, got %q (%v)", notes.Code(err), err)
	}
	_, err = svc.Version(ctx, "note.md", 0)
	if notes.Code(err) != notes.CodeInvalidPath {
		t.Fatalf("expected invalid_path, got %q (%v)", notes.Code(err), err)
	}
}

// TestRestoreVersion writes the content of a version back into the note.
//
// The restore goes through the normal write path: the history stays append
// only and the restored text becomes the last version.
func TestRestoreVersion(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create the file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "the first text", 0); err != nil {
		t.Fatalf("write the note: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "the second text", 0); err != nil {
		t.Fatalf("write the note again: %v", err)
	}

	// The second version is the one of the first write.
	versions, err := svc.Versions(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the history: %v", err)
	}
	target := versions[1]

	result, err := svc.RestoreVersion(ctx, "note.md", target.Revision)
	if err != nil {
		t.Fatalf("restore the version: %v", err)
	}
	if result.Revision <= target.Revision {
		t.Fatalf("the restore did not grow the revision: %+v", result)
	}

	current, err := svc.Read(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the note: %v", err)
	}
	if current.Content != "the first text" {
		t.Fatalf("unexpected content after the restore: %q", current.Content)
	}

	// The restored text is a new version: the history is append only.
	versions, err = svc.Versions(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the history again: %v", err)
	}
	if len(versions) != 4 {
		t.Fatalf("expected 4 versions, got %d", len(versions))
	}
	if versions[3].Content != "the first text" {
		t.Fatalf("unexpected content of the last version: %q", versions[3].Content)
	}
}

// TestDiffVersions checks the diff of two versions of a note.
func TestDiffVersions(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create the file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "one\ntwo\n", 0); err != nil {
		t.Fatalf("write the note: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "one\nthree\n", 0); err != nil {
		t.Fatalf("write the note again: %v", err)
	}

	diff, err := svc.DiffVersions(ctx, "note.md", 2, 3)
	if err != nil {
		t.Fatalf("diff the versions: %v", err)
	}
	want := []notes.DiffLine{
		{Op: notes.DiffEqual, Text: "one"},
		{Op: notes.DiffRemove, Text: "two"},
		{Op: notes.DiffAdd, Text: "three"},
	}
	if len(diff) != len(want) {
		t.Fatalf("unexpected diff %+v", diff)
	}
	for i := range want {
		if diff[i] != want[i] {
			t.Fatalf("the line %d of the diff is %+v, want %+v", i, diff[i], want[i])
		}
	}
}
