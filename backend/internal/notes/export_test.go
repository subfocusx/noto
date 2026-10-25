package notes_test

import (
	"archive/zip"
	"context"
	"math/rand"
	"os"
	"path/filepath"
	"testing"

	"noto/backend/internal/testutil"
)

// The export of a vault must not build the archive in the memory.
//
// The archive is a stream: it is written to the disk (or to the answer of the
// server) by parts, and the size of the memory of the export does not grow
// with the size of the vault.

// countingWriter counts the bytes it receives and remembers the biggest
// write: it is the size of the buffer the export holds at once.
type countingWriter struct {
	total  int64
	max    int
	writes int
}

// Write implements io.Writer.
func (w *countingWriter) Write(p []byte) (int, error) {
	w.total += int64(len(p))
	w.writes++
	if len(p) > w.max {
		w.max = len(p)
	}
	return len(p), nil
}

// bigNote writes a note of the given size whose bytes do not compress, so the
// archive is as big as the note.
func bigNote(t *testing.T, notesDir, name string, size int) {
	t.Helper()
	content := make([]byte, size)
	rand.New(rand.NewSource(42)).Read(content)
	if err := os.WriteFile(filepath.Join(notesDir, name), content, 0o644); err != nil {
		t.Fatalf("write the note %q: %v", name, err)
	}
}

func TestExportAllIsAStream(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()
	bigNote(t, cfg.NotesDir, "big.md", 4<<20)

	w := &countingWriter{}
	if err := svc.ExportAll(ctx, w); err != nil {
		t.Fatalf("export the vault: %v", err)
	}
	if w.total < 3<<20 {
		t.Fatalf("the archive is too small: %d bytes", w.total)
	}
	// The archive is written by parts: the biggest write is much smaller
	// than the archive itself.
	if w.max > 1<<20 {
		t.Fatalf("the archive was written in a buffer of %d bytes", w.max)
	}
	if w.writes < 2 {
		t.Fatalf("the archive was written in one piece: %d write(s)", w.writes)
	}
}

func TestExportAllToFile(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()
	bigNote(t, cfg.NotesDir, "big.md", 4<<20)

	path := filepath.Join(t.TempDir(), "notes.zip")
	if err := svc.ExportAllToFile(ctx, path); err != nil {
		t.Fatalf("export the vault to a file: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("the archive was not written: %v", err)
	}
	if info.Size() < 3<<20 {
		t.Fatalf("the archive is too small: %d bytes", info.Size())
	}

	// The archive is a valid archive, and it holds the note.
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("the archive is not a valid one: %v", err)
	}
	defer reader.Close()
	found := false
	for _, file := range reader.File {
		if file.Name != "big.md" {
			continue
		}
		found = true
		if file.UncompressedSize64 != 4<<20 {
			t.Fatalf("the note of the archive is %d bytes", file.UncompressedSize64)
		}
	}
	if !found {
		t.Fatalf("the archive does not hold the note")
	}
}

func TestExportFolderToFile(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()
	if _, err := svc.CreateFolder(ctx, "", "journal"); err != nil {
		t.Fatalf("create the folder: %v", err)
	}
	bigNote(t, filepath.Join(cfg.NotesDir, "journal"), "entry.md", 2<<20)

	path := filepath.Join(t.TempDir(), "journal.zip")
	if err := svc.ExportFolderToFile(ctx, "journal", path); err != nil {
		t.Fatalf("export the folder to a file: %v", err)
	}

	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("the archive is not a valid one: %v", err)
	}
	defer reader.Close()
	if len(reader.File) != 1 || reader.File[0].Name != "journal/entry.md" {
		names := make([]string, 0, len(reader.File))
		for _, file := range reader.File {
			names = append(names, file.Name)
		}
		t.Fatalf("the archive holds %v", names)
	}
}
