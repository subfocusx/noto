package notes_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// TestReconcileMissingInDB checks that a file that was created outside of the
// application is reported and that the apply run creates its metadata row.
func TestReconcileMissingInDB(t *testing.T) {
	svc, store, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	abs := filepath.Join(cfg.NotesDir, "внешний.md")
	if err := os.WriteFile(abs, []byte("привет"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	report, err := svc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(report.MissingInDB) != 1 || report.MissingInDB[0] != "внешний.md" {
		t.Fatalf("unexpected missing in db: %v", report.MissingInDB)
	}
	if len(report.MissingOnDisk) != 0 {
		t.Fatalf("unexpected missing on disk: %v", report.MissingOnDisk)
	}
	if report.Checked != 1 {
		t.Fatalf("unexpected checked count %d", report.Checked)
	}
	// The report alone must not change anything.
	if _, found, _ := store.GetNote(ctx, "внешний.md"); found {
		t.Fatalf("the report created a metadata row")
	}

	report, err = svc.ReconcileWithOptions(ctx, notes.ReconcileOptions{Apply: true})
	if err != nil {
		t.Fatalf("reconcile apply: %v", err)
	}
	if len(report.Restored) != 1 || report.Restored[0] != "внешний.md" {
		t.Fatalf("unexpected restored list: %v", report.Restored)
	}
	node, found, err := store.GetNote(ctx, "внешний.md")
	if err != nil || !found {
		t.Fatalf("the metadata row was not created: %v", err)
	}
	if node.Revision != 1 {
		t.Fatalf("unexpected revision %d", node.Revision)
	}
	if node.Name != "внешний.md" || node.ParentPath != "" {
		t.Fatalf("unexpected name or parent: %+v", node)
	}
	if node.Size != int64(len("привет")) {
		t.Fatalf("unexpected size %d", node.Size)
	}
	if node.CreatedAt.IsZero() || node.UpdatedAt.IsZero() {
		t.Fatalf("the timestamps are not set: %+v", node)
	}
	if len(report.Indexed) != 1 {
		t.Fatalf("the restored note was not indexed: %v", report.Indexed)
	}

	report, err = svc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("reconcile again: %v", err)
	}
	if len(report.MissingInDB) != 0 || len(report.MissingOnDisk) != 0 {
		t.Fatalf("the library is still inconsistent: %+v", report)
	}
	if len(report.MetadataDrift) != 0 {
		t.Fatalf("unexpected metadata drift: %v", report.MetadataDrift)
	}
}

// TestReconcileGhosts checks that a metadata row without a file is reported
// and that only the explicit flag deletes it.
func TestReconcileGhosts(t *testing.T) {
	svc, store, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "ghost"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if err := os.Remove(filepath.Join(cfg.NotesDir, "ghost.md")); err != nil {
		t.Fatalf("remove file: %v", err)
	}

	report, err := svc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(report.MissingOnDisk) != 1 || report.MissingOnDisk[0] != "ghost.md" {
		t.Fatalf("unexpected missing on disk: %v", report.MissingOnDisk)
	}
	if len(report.MissingInDB) != 0 {
		t.Fatalf("unexpected missing in db: %v", report.MissingInDB)
	}

	// Without the flag nothing is deleted.
	report, err = svc.ReconcileWithOptions(ctx, notes.ReconcileOptions{Apply: true})
	if err != nil {
		t.Fatalf("reconcile apply: %v", err)
	}
	if len(report.Dropped) != 0 {
		t.Fatalf("the ghost row was dropped without the flag: %v", report.Dropped)
	}
	if _, found, _ := store.GetNote(ctx, "ghost.md"); !found {
		t.Fatalf("the ghost row was deleted")
	}

	report, err = svc.ReconcileWithOptions(ctx, notes.ReconcileOptions{DropGhosts: true})
	if err != nil {
		t.Fatalf("reconcile drop: %v", err)
	}
	if len(report.Dropped) != 1 || report.Dropped[0] != "ghost.md" {
		t.Fatalf("unexpected dropped list: %v", report.Dropped)
	}
	if _, found, _ := store.GetNote(ctx, "ghost.md"); found {
		t.Fatalf("the ghost row was not deleted")
	}

	report, err = svc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("reconcile again: %v", err)
	}
	if len(report.MissingOnDisk) != 0 {
		t.Fatalf("the ghost row is still reported: %v", report.MissingOnDisk)
	}
}

// TestReconcileConsistentLibrary checks that a library that was built with
// the application produces an empty report.
func TestReconcileConsistentLibrary(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFolder(ctx, "", "Дневник"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "Дневник", "запись"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Write(ctx, "Дневник/запись.md", "привет мир", 0); err != nil {
		t.Fatalf("write: %v", err)
	}

	report, err := svc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(report.MissingInDB) != 0 || len(report.MissingOnDisk) != 0 || len(report.MetadataDrift) != 0 {
		t.Fatalf("unexpected report: %+v", report)
	}
	if report.Checked != 2 {
		t.Fatalf("unexpected checked count %d", report.Checked)
	}
}

// TestReconcileDoesNotChangeWithoutApply checks that a report never changes
// the data.
func TestReconcileDoesNotChangeWithoutApply(t *testing.T) {
	svc, store, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	abs := filepath.Join(cfg.NotesDir, "note.md")
	if err := os.WriteFile(abs, []byte("x"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	before := len(store.Notes())

	for i := 0; i < 3; i++ {
		if _, err := svc.Reconcile(ctx); err != nil {
			t.Fatalf("reconcile: %v", err)
		}
	}
	if len(store.Notes()) != before {
		t.Fatalf("the report changed the metadata rows")
	}

	// The dry run does not change anything either.
	if _, err := svc.ReconcileWithOptions(ctx, notes.ReconcileOptions{Apply: true, DropGhosts: true, DryRun: true}); err != nil {
		t.Fatalf("reconcile dry run: %v", err)
	}
	if len(store.Notes()) != before {
		t.Fatalf("the dry run changed the metadata rows")
	}
}

// TestReconcileCyrillicAndSubfolders checks the paths of a nested tree with
// cyrillic names.
func TestReconcileCyrillicAndSubfolders(t *testing.T) {
	svc, store, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	dir := filepath.Join(cfg.NotesDir, "Папка", "подпапка")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("create dirs: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "заметка.md"), []byte("текст"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	report, err := svc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	want := []string{"Папка", "Папка/подпапка", "Папка/подпапка/заметка.md"}
	if len(report.MissingInDB) != len(want) {
		t.Fatalf("unexpected missing in db: %v", report.MissingInDB)
	}
	for i, p := range want {
		if report.MissingInDB[i] != p {
			t.Fatalf("unexpected missing in db: %v", report.MissingInDB)
		}
	}
	if report.Checked != 3 {
		t.Fatalf("unexpected checked count %d", report.Checked)
	}

	if _, err := svc.ReconcileWithOptions(ctx, notes.ReconcileOptions{Apply: true}); err != nil {
		t.Fatalf("reconcile apply: %v", err)
	}
	for _, p := range want {
		node, found, err := store.GetNote(ctx, p)
		if err != nil || !found {
			t.Fatalf("the row %q was not created: %v", p, err)
		}
		if node.Name != notes.BaseName(p) {
			t.Fatalf("unexpected name %q for %q", node.Name, p)
		}
	}
	report, err = svc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("reconcile again: %v", err)
	}
	if len(report.MissingInDB) != 0 {
		t.Fatalf("the tree is still inconsistent: %v", report.MissingInDB)
	}
}

// TestReconcileTrashIsNotADifference checks that the trash is not compared
// with the notes directory.
func TestReconcileTrashIsNotADifference(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if err := svc.Delete(ctx, "note.md"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	report, err := svc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(report.MissingInDB) != 0 || len(report.MissingOnDisk) != 0 {
		t.Fatalf("the trash was reported as a difference: %+v", report)
	}
}

