package notes_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"noto/backend/internal/testutil"
)

// TestTreeSkipsHiddenDirectories makes sure that the internal directory of a
// vault and every other hidden directory stay out of the tree of the notes.
func TestTreeSkipsHiddenDirectories(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	dirs := []string{
		filepath.Join(cfg.NotesDir, ".noto"),
		filepath.Join(cfg.NotesDir, ".hidden"),
		filepath.Join(cfg.NotesDir, "visible"),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	files := []string{
		filepath.Join(cfg.NotesDir, "visible", "note.md"),
		filepath.Join(cfg.NotesDir, ".noto", "noto.md"),
		filepath.Join(cfg.NotesDir, ".hidden", "secret.md"),
	}
	for _, file := range files {
		if err := os.WriteFile(file, []byte("hello"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	folders, files2, err := svc.Tree(ctx)
	if err != nil {
		t.Fatalf("tree: %v", err)
	}
	for _, f := range folders {
		if f.Path == ".noto" || f.Path == ".hidden" {
			t.Fatalf("the hidden directory %q is in the tree", f.Path)
		}
	}
	for _, f := range files2 {
		if len(f.Path) > 0 && f.Path[0] == '.' {
			t.Fatalf("the hidden file %q is in the tree", f.Path)
		}
	}
	var found bool
	for _, f := range files2 {
		if f.Path == "visible/note.md" {
			found = true
		}
	}
	if !found {
		t.Fatalf("the visible note is missing in the tree: %+v", files2)
	}
}
