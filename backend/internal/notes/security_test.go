package notes_test

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// createJunction creates a Windows mount point (junction) that points to
// target. The test is skipped when the junction cannot be created.
func createJunction(t *testing.T, link, target string) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("junctions only exist on Windows")
	}
	if _, err := os.Lstat(link); err == nil {
		t.Skipf("the link %q already exists", link)
	}
	cmd := exec.Command("cmd", "/c", "mklink", "/J", link, target)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("cannot create the junction: %v (%s)", err, out)
	}
	// The junction is removed before the temporary directories are cleaned
	// up, so that the cleanup never follows the junction.
	t.Cleanup(func() { _ = os.Remove(link) })
}

// TestJunctionEscapeIsRejected makes sure that a Windows junction inside the
// notes root cannot be used to write outside of the notes root.
//
// filepath.EvalSymlinks does not resolve mount points, so the components of
// the path have to be inspected one by one.
func TestJunctionEscapeIsRejected(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	outside := t.TempDir()
	link := filepath.Join(cfg.NotesDir, "link")
	createJunction(t, link, outside)

	t.Run("create file", func(t *testing.T) {
		_, err := svc.CreateFile(ctx, "link", "evil.md")
		if notes.Code(err) != notes.CodeInvalidPath {
			t.Fatalf("expected invalid_path, got %q (%v)", notes.Code(err), err)
		}
		if _, err := os.Stat(filepath.Join(outside, "evil.md")); err == nil {
			t.Fatalf("the file was created outside of the notes root")
		}
	})

	t.Run("create folder", func(t *testing.T) {
		_, err := svc.CreateFolder(ctx, "link", "evil")
		if notes.Code(err) != notes.CodeInvalidPath {
			t.Fatalf("expected invalid_path, got %q (%v)", notes.Code(err), err)
		}
		if _, err := os.Stat(filepath.Join(outside, "evil")); err == nil {
			t.Fatalf("the folder was created outside of the notes root")
		}
	})

	t.Run("read", func(t *testing.T) {
		if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("secret"), 0o644); err != nil {
			t.Fatalf("write secret: %v", err)
		}
		_, err := svc.Read(ctx, "link/secret.md")
		if notes.Code(err) != notes.CodeInvalidPath {
			t.Fatalf("expected invalid_path, got %q (%v)", notes.Code(err), err)
		}
	})

	t.Run("import target", func(t *testing.T) {
		_, err := svc.ImportFiles(ctx, []notes.UploadedFile{{Name: "evil.md", Content: []byte("evil")}}, "link", notes.ConflictSkip)
		if notes.Code(err) != notes.CodeInvalidPath {
			t.Fatalf("expected invalid_path, got %q (%v)", notes.Code(err), err)
		}
		if _, err := os.Stat(filepath.Join(outside, "evil.md")); err == nil {
			t.Fatalf("the file was imported outside of the notes root")
		}
	})

	t.Run("export source", func(t *testing.T) {
		if _, err := svc.ExportFolderBytes(ctx, "link"); notes.Code(err) != notes.CodeInvalidPath {
			t.Fatalf("expected invalid_path, got %q (%v)", notes.Code(err), err)
		}
	})
}

// TestCreateFileRejectsInvalidRawNames makes sure that the name is validated
// before the Markdown suffix is appended.
func TestCreateFileRejectsInvalidRawNames(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	for _, name := range []string{"..", ".", "note.md.", "note.md "} {
		if _, err := svc.CreateFile(ctx, "", name); notes.Code(err) != notes.CodeInvalidName {
			t.Fatalf("expected invalid_name for %q, got %q (%v)", name, notes.Code(err), err)
		}
	}
	// A valid name is still accepted and gets the Markdown suffix.
	node, err := svc.CreateFile(ctx, "", "note")
	if err != nil {
		t.Fatalf("create file: %v", err)
	}
	if node.Path != "note.md" {
		t.Fatalf("unexpected path %q", node.Path)
	}
}

// TestReservedDeviceNamesWithTrailingSpace makes sure that the Windows
// reserved device names are also rejected when they carry a trailing space.
func TestReservedDeviceNamesWithTrailingSpace(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	for _, name := range []string{"CON .md", "COM1 .md", "NUL .md", "con .md", "LPT9 .md"} {
		if _, err := svc.CreateFile(ctx, "", name); notes.Code(err) != notes.CodeInvalidName {
			t.Fatalf("expected invalid_name for %q, got %q (%v)", name, notes.Code(err), err)
		}
	}
}

// TestConcurrentWritesAndRenameDoNotSplitTree makes sure that a write inside
// a folder and a rename of that folder are mutually exclusive. Without the
// hierarchical lock the notes end up in two trees at the same time.
func TestConcurrentWritesAndRenameDoNotSplitTree(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	for round := 0; round < 5; round++ {
		folder := fmt.Sprintf("race%d", round)
		moved := folder + "2"
		if _, err := svc.CreateFolder(ctx, "", folder); err != nil {
			t.Fatalf("create folder: %v", err)
		}
		if _, err := svc.CreateFile(ctx, folder, "n"); err != nil {
			t.Fatalf("create file: %v", err)
		}
		if _, err := svc.Write(ctx, folder+"/n.md", "base", 0); err != nil {
			t.Fatalf("write: %v", err)
		}

		const writers = 40
		start := make(chan struct{})
		var wg sync.WaitGroup
		errs := make(chan error, writers+1)
		for i := 0; i < writers; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				_, err := svc.Write(ctx, folder+"/n.md", fmt.Sprintf("write-%d", i), 0)
				if err != nil {
					errs <- err
				}
			}(i)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := svc.Rename(ctx, folder, moved)
			if err != nil {
				errs <- err
			}
		}()
		close(start)
		wg.Wait()
		close(errs)

		for err := range errs {
			switch notes.Code(err) {
			case notes.CodeConflict, notes.CodeNotFound, notes.CodeRevisionConflict:
			default:
				t.Fatalf("round %d: unexpected error %v (%q)", round, err, notes.Code(err))
			}
		}

		oldPath := filepath.Join(cfg.NotesDir, folder, "n.md")
		newPath := filepath.Join(cfg.NotesDir, moved, "n.md")
		_, oldErr := os.Stat(oldPath)
		_, newErr := os.Stat(newPath)
		switch {
		case oldErr == nil && newErr == nil:
			t.Fatalf("round %d: the note exists in two trees at the same time", round)
		case oldErr != nil && newErr != nil:
			t.Fatalf("round %d: the note was lost", round)
		}
	}
}

// TestWriteDoesNotRecreateAMissingParent makes sure that a write never
// re-creates a folder that was moved away.
func TestWriteDoesNotRecreateAMissingParent(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFolder(ctx, "", "gone"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "gone", "n"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Rename(ctx, "gone", "moved"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	_, err := svc.Write(ctx, "gone/n.md", "content", 0)
	if notes.Code(err) != notes.CodeNotFound {
		t.Fatalf("expected not_found, got %q (%v)", notes.Code(err), err)
	}
	if _, err := os.Stat(filepath.Join(cfg.NotesDir, "gone")); err == nil {
		t.Fatalf("the write re-created the missing folder")
	}
}

// TestWriteAfterMoveIsAConflict makes sure that a write to a note that was
// moved away is a conflict and does not re-create the note.
func TestWriteAfterMoveIsAConflict(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFolder(ctx, "", "dir"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "dir", "n"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Rename(ctx, "dir/n.md", "m.md"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	_, err := svc.Write(ctx, "dir/n.md", "content", 0)
	if notes.Code(err) != notes.CodeConflict {
		t.Fatalf("expected conflict, got %q (%v)", notes.Code(err), err)
	}
	if _, err := os.Stat(filepath.Join(cfg.NotesDir, "dir", "n.md")); err == nil {
		t.Fatalf("the moved note was re-created at its old path")
	}
}

// TestImportZipRejectsEntryLargerThanUploadLimit makes sure that a single
// archive entry cannot be larger than the upload limit.
func TestImportZipRejectsEntryLargerThanUploadLimit(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	limit := svc.Config().MaxUploadBytes
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	f, err := zw.Create("big.md")
	if err != nil {
		t.Fatalf("create zip entry: %v", err)
	}
	if _, err := f.Write(bytes.Repeat([]byte("a"), int(limit)+1024)); err != nil {
		t.Fatalf("write zip entry: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	_, err = svc.ImportZip(ctx, buf.Bytes(), "", notes.ConflictSkip)
	if notes.Code(err) != notes.CodePayloadTooLarge {
		t.Fatalf("expected payload_too_large, got %q (%v)", notes.Code(err), err)
	}
}

// TestImportZipRejectsCumulativeArchiveLimit makes sure that the total of the
// extracted bytes is limited.
func TestImportZipRejectsCumulativeArchiveLimit(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	limit := svc.Config().MaxUploadBytes
	// Every entry is below the upload limit, but together they are above the
	// archive limit.
	entries := int(svc.Config().MaxArchiveBytes/limit) + 3
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for i := 0; i < entries; i++ {
		f, err := zw.Create(fmt.Sprintf("note-%d.md", i))
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := f.Write(bytes.Repeat([]byte("a"), int(limit)-1)); err != nil {
			t.Fatalf("write zip entry: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	_, err := svc.ImportZip(ctx, buf.Bytes(), "", notes.ConflictSkip)
	if notes.Code(err) != notes.CodePayloadTooLarge {
		t.Fatalf("expected payload_too_large, got %q (%v)", notes.Code(err), err)
	}
}
