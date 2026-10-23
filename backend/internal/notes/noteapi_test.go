package notes_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// recorder collects the events of the hooks of a service.
type recorder struct {
	mu     sync.Mutex
	events []notes.NoteEvent
}

func (r *recorder) hook(ctx context.Context, ev notes.NoteEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, ev)
}

func (r *recorder) snapshot() []notes.NoteEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]notes.NoteEvent, len(r.events))
	copy(out, r.events)
	return out
}

// last returns the last recorded event.
func (r *recorder) last(t *testing.T) notes.NoteEvent {
	t.Helper()
	events := r.snapshot()
	if len(events) == 0 {
		t.Fatalf("no event was fired")
	}
	return events[len(events)-1]
}

func TestNoteServiceInterfaceIsImplemented(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	// The service is usable through the narrow plugin interface.
	var api notes.NoteService = svc
	if _, err := api.Write(ctx, "note.md", "hello", 0); err != nil {
		t.Fatalf("write through the interface: %v", err)
	}
	content, err := api.Read(ctx, "note.md")
	if err != nil {
		t.Fatalf("read through the interface: %v", err)
	}
	if content.Content != "hello" {
		t.Fatalf("unexpected content %q", content.Content)
	}
	if content.Revision != 2 {
		t.Fatalf("unexpected revision %d", content.Revision)
	}
}

func TestHookFiresAfterSuccessfulWrite(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()
	rec := &recorder{}
	svc.AddHook(rec.hook)

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	res, err := svc.Write(ctx, "note.md", "hello", 0)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	ev := rec.last(t)
	if ev.Op != notes.NoteOpUpdated {
		t.Fatalf("expected updated, got %q", ev.Op)
	}
	if ev.Path != "note.md" {
		t.Fatalf("unexpected path %q", ev.Path)
	}
	if ev.Revision != res.Revision {
		t.Fatalf("expected revision %d, got %d", res.Revision, ev.Revision)
	}
	if ev.UpdatedAt.IsZero() {
		t.Fatalf("the event has no update time")
	}
	// The hook must observe the committed state of the disk.
	data, err := os.ReadFile(filepath.Join(cfg.NotesDir, "note.md"))
	if err != nil {
		t.Fatalf("read the file: %v", err)
	}
	if string(data) != "hello" {
		t.Fatalf("the disk holds %q", string(data))
	}
}

func TestHookFiresAfterCreateDeleteRenameMoveRestore(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()
	rec := &recorder{}
	svc.AddHook(rec.hook)

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if ev := rec.last(t); ev.Op != notes.NoteOpCreated || ev.Path != "note.md" {
		t.Fatalf("unexpected create event: %+v", ev)
	}

	if _, err := svc.Rename(ctx, "note.md", "renamed.md"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if ev := rec.last(t); ev.Op != notes.NoteOpRenamed || ev.Path != "renamed.md" {
		t.Fatalf("unexpected rename event: %+v", ev)
	}

	if _, err := svc.CreateFolder(ctx, "", "dst"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.Move(ctx, "renamed.md", "dst"); err != nil {
		t.Fatalf("move: %v", err)
	}
	if ev := rec.last(t); ev.Op != notes.NoteOpMoved || ev.Path != "dst/renamed.md" {
		t.Fatalf("unexpected move event: %+v", ev)
	}

	if err := svc.Delete(ctx, "dst/renamed.md"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if ev := rec.last(t); ev.Op != notes.NoteOpDeleted || ev.Path != "dst/renamed.md" {
		t.Fatalf("unexpected delete event: %+v", ev)
	}

	entries, err := svc.Trash(ctx)
	if err != nil {
		t.Fatalf("trash: %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("the trash is empty")
	}
	if _, err := svc.Restore(ctx, entries[0].Path); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if ev := rec.last(t); ev.Op != notes.NoteOpRestored || ev.Path != "dst/renamed.md" {
		t.Fatalf("unexpected restore event: %+v", ev)
	}
}

func TestHookFiresOnceForMovedFolder(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()
	rec := &recorder{}
	svc.AddHook(rec.hook)

	if _, err := svc.CreateFolder(ctx, "", "src"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "src", "a"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "src", "b"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.CreateFolder(ctx, "", "dst"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	before := len(rec.snapshot())
	if _, err := svc.Move(ctx, "src", "dst"); err != nil {
		t.Fatalf("move: %v", err)
	}
	events := rec.snapshot()[before:]
	if len(events) != 1 {
		t.Fatalf("expected exactly one event for the moved folder, got %d: %+v", len(events), events)
	}
	if events[0].Op != notes.NoteOpMoved || events[0].Path != "dst/src" {
		t.Fatalf("unexpected move event: %+v", events[0])
	}
}

func TestHookIsNotFiredOnError(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()
	rec := &recorder{}
	svc.AddHook(rec.hook)

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "hello", 0); err != nil {
		t.Fatalf("write: %v", err)
	}
	before := len(rec.snapshot())

	// A stale revision must not fire a hook.
	_, err := svc.Write(ctx, "note.md", "other", 1)
	if notes.Code(err) != notes.CodeRevisionConflict {
		t.Fatalf("expected revision_conflict, got %q", err)
	}
	if cur := notes.CurrentContent(err); cur == nil || cur.Content != "hello" {
		t.Fatalf("the conflict does not carry the current content: %+v", cur)
	}
	if after := len(rec.snapshot()); after != before {
		t.Fatalf("the hook fired %d times on a failed write", after-before)
	}

	// A missing parent folder must not fire a hook either.
	if _, err := svc.Write(ctx, "missing/child.md", "text", 0); notes.Code(err) != notes.CodeNotFound {
		t.Fatalf("expected not_found, got %q", err)
	}
	if after := len(rec.snapshot()); after != before {
		t.Fatalf("the hook fired %d times on a failed write", after-before)
	}
}

func TestPanickingHookDoesNotBreakTheService(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	svc.AddHook(func(ctx context.Context, ev notes.NoteEvent) {
		panic("the hook is broken")
	})
	rec := &recorder{}
	svc.AddHook(rec.hook)

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	res, err := svc.Write(ctx, "note.md", "hello", 0)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if res.Revision != 2 {
		t.Fatalf("unexpected revision %d", res.Revision)
	}
	// The second hook still runs and the service keeps working.
	ev := rec.last(t)
	if ev.Op != notes.NoteOpUpdated {
		t.Fatalf("unexpected event: %+v", ev)
	}
	content, err := svc.Read(ctx, "note.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if content.Content != "hello" {
		t.Fatalf("unexpected content %q", content.Content)
	}
}

func TestConcurrentHookRegistrationAndWrites(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rec := &recorder{}
			svc.AddHook(rec.hook)
		}()
	}
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			// Every writer uses its own file to avoid revision conflicts.
			name := "n" + string(rune('a'+i)) + ".md"
			if _, err := svc.CreateFile(ctx, "", name); err != nil {
				t.Errorf("create file: %v", err)
				return
			}
			if _, err := svc.Write(ctx, name, "content", 0); err != nil {
				t.Errorf("write: %v", err)
			}
		}(i)
	}
	wg.Wait()
}

func TestHookSeesTheCompletedState(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	var mu sync.Mutex
	var seen []string
	svc.AddHook(func(ctx context.Context, ev notes.NoteEvent) {
		// The hook reads the file from the disk: the content must already
		// be the new one, the operation is fully finished.
		data, err := os.ReadFile(filepath.Join(cfg.NotesDir, filepath.FromSlash(ev.Path)))
		if err != nil {
			mu.Lock()
			seen = append(seen, "error: "+err.Error())
			mu.Unlock()
			return
		}
		mu.Lock()
		seen = append(seen, string(data))
		mu.Unlock()
	})

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "first", 0); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "second", 0); err != nil {
		t.Fatalf("write: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(seen) != 3 {
		t.Fatalf("expected three observations, got %d: %+v", len(seen), seen)
	}
	if seen[0] != "" {
		t.Fatalf("the create hook saw %q", seen[0])
	}
	if seen[1] != "first" {
		t.Fatalf("the write hook saw %q", seen[1])
	}
	if seen[2] != "second" {
		t.Fatalf("the write hook saw %q", seen[2])
	}
}

func TestHookDoesNotSeeTheNoteContent(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()
	rec := &recorder{}
	svc.AddHook(rec.hook)

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "a secret", 0); err != nil {
		t.Fatalf("write: %v", err)
	}
	for _, ev := range rec.snapshot() {
		if strings.Contains(ev.Path, "secret") {
			t.Fatalf("the event carries the content of the note: %+v", ev)
		}
	}
}
