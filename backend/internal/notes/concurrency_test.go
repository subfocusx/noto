package notes_test

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// This file contains the concurrency tests of the notes service. The tests
// use only the exported API, so they live in the package "notes_test" and
// reuse the test service of internal/testutil.
//
// The tests must be stable under "go test -race": no test relies on the
// order of the goroutines, on a sleep or on a timeout. Every goroutine is
// released by a barrier (a closed channel), every result is collected in a
// slice that is written by exactly one goroutine and every expectation is
// a set membership instead of a fixed order.

// TestConcurrentWritesToTheSamePath starts N writers on the same path.
//
// Exactly one of them must succeed and all the others must get a revision
// conflict, because the writers all use the revision of the note as it was
// before the race. The file on the disk must hold exactly one of the
// written versions, never a mixture of two of them.
func TestConcurrentWritesToTheSamePath(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	base, err := svc.Write(ctx, "note.md", "base", 0)
	if err != nil {
		t.Fatalf("write base: %v", err)
	}

	const n = 50
	contents := make([]string, n)
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		contents[i] = "version-" + strconv.Itoa(i)
	}

	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, errs[i] = svc.Write(ctx, "note.md", contents[i], base.Revision)
		}(i)
	}
	close(start)
	wg.Wait()

	ok := 0
	conflicts := 0
	for i, err := range errs {
		switch notes.Code(err) {
		case "":
			ok++
		case notes.CodeRevisionConflict:
			conflicts++
		default:
			t.Errorf("writer %d failed with %q (%v), want a revision conflict", i, notes.Code(err), err)
		}
	}
	if ok != 1 {
		t.Fatalf("expected exactly one successful write, got %d", ok)
	}
	if conflicts != n-1 {
		t.Fatalf("expected %d revision conflicts, got %d", n-1, conflicts)
	}

	// The file must hold one of the written versions and nothing else.
	data, err := os.ReadFile(filepath.Join(cfg.NotesDir, "note.md"))
	if err != nil {
		t.Fatalf("read the file: %v", err)
	}
	found := false
	for _, c := range contents {
		if string(data) == c {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("the file holds %q, want one of the %d written versions", string(data), n)
	}

	// The revision was increased exactly once.
	content, err := svc.Read(ctx, "note.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if content.Revision != base.Revision+1 {
		t.Fatalf("revision = %d, want %d", content.Revision, base.Revision+1)
	}
	if content.Content != string(data) {
		t.Fatalf("the content of the note differs from the content of the file")
	}
}

// TestConcurrentMoveAndWrite moves a folder while a note inside it is
// written and read.
//
// The move and the write take the same hierarchical lock, so they are
// serialised: the write either happens before the move (the note is moved
// together with its content) or after it (the write is rejected with a
// conflict or with a not_found error, because the old parent folder is
// gone). The test checks that the service never panics, that it never
// returns an unexpected error code and that the note exists at exactly one
// of the two locations with a consistent content.
func TestConcurrentMoveAndWrite(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFolder(ctx, "", "src"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFolder(ctx, "", "dst"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "src", "a"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Write(ctx, "src/a.md", "original", 0); err != nil {
		t.Fatalf("write: %v", err)
	}

	const written = "written"
	var (
		wg       sync.WaitGroup
		start    = make(chan struct{})
		done     = make(chan struct{})
		moveErr  error
		writeErr error
		readErr  error
	)

	wg.Add(3)
	// The mover.
	go func() {
		defer wg.Done()
		defer close(done)
		<-start
		_, moveErr = svc.Move(ctx, "src", "dst")
	}()
	// The writer.
	go func() {
		defer wg.Done()
		<-start
		_, writeErr = svc.Write(ctx, "src/a.md", written, 0)
	}()
	// The reader of the moved path.
	go func() {
		defer wg.Done()
		<-start
		for {
			select {
			case <-done:
				return
			default:
			}
			_, err := svc.Read(ctx, "dst/src/a.md")
			if err != nil && notes.Code(err) != notes.CodeNotFound {
				readErr = err
				return
			}
		}
	}()
	close(start)
	wg.Wait()

	if moveErr != nil {
		switch notes.Code(moveErr) {
		case notes.CodeConflict, notes.CodeNotFound, notes.CodeDuplicateName, notes.CodeInvalidPath:
		default:
			t.Fatalf("move failed with %q (%v)", notes.Code(moveErr), moveErr)
		}
	}
	if writeErr != nil {
		switch notes.Code(writeErr) {
		case notes.CodeConflict, notes.CodeRevisionConflict, notes.CodeNotFound:
		default:
			t.Fatalf("write failed with %q (%v)", notes.Code(writeErr), writeErr)
		}
	}
	if readErr != nil {
		t.Fatalf("read failed with %q (%v)", notes.Code(readErr), readErr)
	}

	// The note exists at exactly one of the two locations.
	oldPath := filepath.Join(cfg.NotesDir, "src", "a.md")
	newPath := filepath.Join(cfg.NotesDir, "dst", "src", "a.md")
	_, oldErr := os.Stat(oldPath)
	_, newErr := os.Stat(newPath)
	oldExists := oldErr == nil
	newExists := newErr == nil
	if oldExists == newExists {
		t.Fatalf("the note exists at %d of the two locations (old=%v, new=%v)", boolToInt(oldExists)+boolToInt(newExists), oldErr, newErr)
	}

	// The content is one of the two versions, never a mixture.
	path := oldPath
	if newExists {
		path = newPath
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the file: %v", err)
	}
	if string(data) != "original" && string(data) != written {
		t.Fatalf("the file holds %q, want %q or %q", string(data), "original", written)
	}

	// The content that the service reports is the content of the file.
	rel := "src/a.md"
	if newExists {
		rel = "dst/src/a.md"
	}
	content, err := svc.Read(ctx, rel)
	if err != nil {
		t.Fatalf("read %q: %v", rel, err)
	}
	if content.Content != string(data) {
		t.Fatalf("the service reports %q, the file holds %q", content.Content, string(data))
	}
}

// boolToInt converts a bool into 0 or 1.
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
