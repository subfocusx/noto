package notes_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// TestDuplicateCreatesACopyNextToTheOriginal makes sure that a duplicated
// note is created next to the original, with the same content, and that the
// original stays untouched.
func TestDuplicateCreatesACopyNextToTheOriginal(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "# hello\n", 0); err != nil {
		t.Fatalf("write note: %v", err)
	}

	node, err := svc.Duplicate(ctx, "note.md")
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	if node.Path != "note copy.md" {
		t.Fatalf("unexpected path of the copy: %q", node.Path)
	}
	if node.Type != "file" {
		t.Fatalf("the copy is not a file: %+v", node)
	}

	// The copy has the same content as the original.
	copyContent, err := svc.Read(ctx, "note copy.md")
	if err != nil {
		t.Fatalf("read the copy: %v", err)
	}
	if copyContent.Content != "# hello\n" {
		t.Fatalf("unexpected content of the copy: %q", copyContent.Content)
	}

	// The original is unchanged.
	original, err := svc.Read(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the original: %v", err)
	}
	if original.Content != "# hello\n" {
		t.Fatalf("the original was changed: %q", original.Content)
	}

	// The copy is a real file next to the original.
	if _, err := os.Stat(filepath.Join(cfg.NotesDir, "note copy.md")); err != nil {
		t.Fatalf("the copy is not on the disk: %v", err)
	}
}

// TestDuplicateUsesAFreeName makes sure that the second duplication does not
// overwrite the first copy.
func TestDuplicateUsesAFreeName(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "hello", 0); err != nil {
		t.Fatalf("write note: %v", err)
	}

	first, err := svc.Duplicate(ctx, "note.md")
	if err != nil {
		t.Fatalf("first duplicate: %v", err)
	}
	if first.Path != "note copy.md" {
		t.Fatalf("unexpected path of the first copy: %q", first.Path)
	}

	second, err := svc.Duplicate(ctx, "note.md")
	if err != nil {
		t.Fatalf("second duplicate: %v", err)
	}
	if second.Path != "note copy 2.md" {
		t.Fatalf("unexpected path of the second copy: %q", second.Path)
	}

	third, err := svc.Duplicate(ctx, "note.md")
	if err != nil {
		t.Fatalf("third duplicate: %v", err)
	}
	if third.Path != "note copy 3.md" {
		t.Fatalf("unexpected path of the third copy: %q", third.Path)
	}

	// Every copy has its own content.
	for _, path := range []string{"note copy.md", "note copy 2.md", "note copy 3.md"} {
		content, err := svc.Read(ctx, path)
		if err != nil {
			t.Fatalf("read %q: %v", path, err)
		}
		if content.Content != "hello" {
			t.Fatalf("unexpected content of %q: %q", path, content.Content)
		}
	}
}

// TestDuplicateOfACopyKeepsTheNameOfTheOriginal makes sure that the copy of a
// copy is numbered instead of getting a second suffix.
func TestDuplicateOfACopyKeepsTheNameOfTheOriginal(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "hello", 0); err != nil {
		t.Fatalf("write note: %v", err)
	}

	if _, err := svc.Duplicate(ctx, "note.md"); err != nil {
		t.Fatalf("first duplicate: %v", err)
	}

	// The copy of the copy is numbered: "note copy 2.md", not
	// "note copy copy.md".
	second, err := svc.Duplicate(ctx, "note copy.md")
	if err != nil {
		t.Fatalf("duplicate of the copy: %v", err)
	}
	if second.Path != "note copy 2.md" {
		t.Fatalf("unexpected path of the copy of the copy: %q", second.Path)
	}

	content, err := svc.Read(ctx, "note copy 2.md")
	if err != nil {
		t.Fatalf("read the copy of the copy: %v", err)
	}
	if content.Content != "hello" {
		t.Fatalf("unexpected content of the copy of the copy: %q", content.Content)
	}
}

// TestDuplicateInsideAFolder makes sure that the copy is created next to the
// original, also inside a folder.
func TestDuplicateInsideAFolder(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFolder(ctx, "", "Docs"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "Docs", "note.md"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Write(ctx, "Docs/note.md", "hello", 0); err != nil {
		t.Fatalf("write note: %v", err)
	}

	node, err := svc.Duplicate(ctx, "Docs/note.md")
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	if node.Path != "Docs/note copy.md" {
		t.Fatalf("unexpected path of the copy: %q", node.Path)
	}
}

// TestDuplicateOfAMissingNote makes sure that a missing path is reported as
// not found and that a folder is refused.
func TestDuplicateOfAMissingNote(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	_, err := svc.Duplicate(ctx, "missing.md")
	if notes.Code(err) != notes.CodeNotFound {
		t.Fatalf("unexpected error for a missing note: %v (code %q)", err, notes.Code(err))
	}

	if _, err := svc.CreateFolder(ctx, "", "Docs"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	_, err = svc.Duplicate(ctx, "Docs")
	if notes.Code(err) != notes.CodeInvalidPath {
		t.Fatalf("unexpected error for a folder: %v (code %q)", err, notes.Code(err))
	}

	_, err = svc.Duplicate(ctx, "../secret.md")
	if notes.Code(err) != notes.CodeInvalidPath {
		t.Fatalf("unexpected error for an invalid path: %v (code %q)", err, notes.Code(err))
	}
}
