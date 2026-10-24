package sealed

import (
	"context"
	"errors"
	"os"
	"testing"

	"noto/backend/internal/model"
)

// TestBlockedStoreRefusesEveryOperation calls every method of the store and
// checks that it fails with the sentinel error of the sealed mode.
func TestBlockedStoreRefusesEveryOperation(t *testing.T) {
	ctx := context.Background()
	store := NewBlockedStore()

	if err := store.Close(); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("Close: unexpected error %v", err)
	}
	if err := store.UpsertNote(ctx, model.Node{Path: "a.md"}); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("UpsertNote: unexpected error %v", err)
	}
	if _, _, err := store.GetNote(ctx, "a.md"); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("GetNote: unexpected error %v", err)
	}
	if err := store.DeleteNote(ctx, "a.md"); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("DeleteNote: unexpected error %v", err)
	}
	if err := store.MoveNote(ctx, "a.md", "b.md"); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("MoveNote: unexpected error %v", err)
	}
	if _, err := store.ListNotes(ctx); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("ListNotes: unexpected error %v", err)
	}
	if err := store.IndexContent(ctx, "a.md", "a", "hello"); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("IndexContent: unexpected error %v", err)
	}
	if err := store.RemoveContent(ctx, "a.md"); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("RemoveContent: unexpected error %v", err)
	}
	if _, err := store.Search(ctx, "hello", 10); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("Search: unexpected error %v", err)
	}
	if err := store.ClearIndex(ctx); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("ClearIndex: unexpected error %v", err)
	}
	if err := store.PutAttachment(ctx, model.Attachment{ID: "id"}); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("PutAttachment: unexpected error %v", err)
	}
	if _, err := store.ListAttachments(ctx); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("ListAttachments: unexpected error %v", err)
	}
	if _, _, err := store.GetAttachment(ctx, "id"); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("GetAttachment: unexpected error %v", err)
	}
	if err := store.DeleteAttachment(ctx, "id"); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("DeleteAttachment: unexpected error %v", err)
	}
	if err := store.PutTrash(ctx, "a.md", "trash/a.md", model.NodeFile, 10); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("PutTrash: unexpected error %v", err)
	}
	if _, err := store.ListTrash(ctx); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("ListTrash: unexpected error %v", err)
	}
	if err := store.DeleteTrash(ctx, "trash/a.md"); !errors.Is(err, ErrVaultSealed) {
		t.Errorf("DeleteTrash: unexpected error %v", err)
	}
}

// TestBlockedStoreDoesNotTouchTheDisk checks that the blocked store does not
// create any file, not even in the working directory of the test.
func TestBlockedStoreDoesNotTouchTheDisk(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	before, err := os.ReadDir(wd)
	if err != nil {
		t.Fatalf("read the working directory: %v", err)
	}

	store := NewBlockedStore()
	_ = store.UpsertNote(ctx, model.Node{Path: "a.md"})
	_ = store.IndexContent(ctx, "a.md", "a", "hello")
	_ = store.PutAttachment(ctx, model.Attachment{ID: "id"})
	_ = store.PutTrash(ctx, "a.md", "trash/a.md", model.NodeFile, 10)
	_ = store.Close()

	after, err := os.ReadDir(wd)
	if err != nil {
		t.Fatalf("read the working directory: %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("the store created a file in the working directory")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read the temporary directory: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("the store created a file in the temporary directory")
	}
}
