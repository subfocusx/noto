package notes

import (
	"context"
	"log/slog"
	"time"

	"noto/backend/internal/model"
)

// NoteOp describes the kind of change that happened to a note.
type NoteOp string

const (
	// NoteOpCreated is emitted when a note did not exist before the
	// operation.
	NoteOpCreated NoteOp = "created"
	// NoteOpUpdated is emitted when the content of an existing note
	// changed.
	NoteOpUpdated NoteOp = "updated"
	// NoteOpDeleted is emitted when a note was moved to the trash.
	NoteOpDeleted NoteOp = "deleted"
	// NoteOpRenamed is emitted when a note was renamed. The path of the
	// event is the new path.
	NoteOpRenamed NoteOp = "renamed"
	// NoteOpMoved is emitted when a note was moved into another folder.
	// The path of the event is the new path.
	NoteOpMoved NoteOp = "moved"
	// NoteOpRestored is emitted when a note was restored from the trash.
	// The path of the event is the restored path.
	NoteOpRestored NoteOp = "restored"
)

// NoteEvent describes a completed note operation. It never contains the
// content of the note.
type NoteEvent struct {
	// Path is the path of the note after the operation. It is relative to
	// the notes root and uses forward slashes.
	Path string
	// Revision is the revision of the note after the operation. It is 0
	// when the note no longer exists (a delete).
	Revision int64
	// UpdatedAt is the modification time of the note after the operation.
	UpdatedAt time.Time
	// Op is the kind of the operation.
	Op NoteOp
}

// Hook is called after a note operation was fully completed. The disk, the
// search index and the metadata of the note are consistent when the hook
// runs. A hook must not panic: a panic is recovered and logged, it never
// fails the operation.
type Hook func(ctx context.Context, ev NoteEvent)

// NoteService is the narrow view of the notes service for potential
// consumers (plugins). A plugin can read and write exactly one note. It
// cannot touch the tree, the trash, the attachments, the search index or the
// database directly.
//
// The revision is part of the contract: a plugin must pass the revision it
// has read. A revision of zero forces the write, like the import does.
//
// Example:
//
//	svc := notes.NewPluginService(svc)   // any *notes.Service
//	content, err := svc.Read(ctx, "Journal/2026-10-23.md")
//	if err != nil {
//	    return err
//	}
//	res, err := svc.Write(ctx, content.Path, content.Content+"# done", content.Revision)
//	if err != nil {
//	    if notes.Code(err) == notes.CodeRevisionConflict {
//	        cur := notes.CurrentContent(err) // the current server state
//	        _ = cur
//	    }
//	    return err
//	}
//	fmt.Println(res.Revision)
type NoteService interface {
	// Read returns the content and the revision of a note.
	Read(ctx context.Context, path string) (model.NoteContent, error)
	// Write stores new content for a note. A revision of zero forces the
	// write, a non-zero revision must match the stored revision.
	Write(ctx context.Context, path string, content string, revision int64) (WriteResult, error)
}

// The service implements the narrow plugin interface.
var _ NoteService = (*Service)(nil)

// AddHook registers a hook that is called after every completed note
// operation. It is safe to call it concurrently with the operations and
// with other calls to AddHook.
func (s *Service) AddHook(h Hook) {
	if h == nil {
		return
	}
	s.hooksMu.Lock()
	defer s.hooksMu.Unlock()
	s.hooks = append(s.hooks, h)
}

// fireHooks calls every registered hook with the event. The hooks are called
// synchronously, in the registration order, so that a hook observes a
// consistent state and the caller knows when the notification is done.
//
// A panicking hook is recovered: the panic is logged with slog (without the
// content of the note) and the operation keeps its result.
func (s *Service) fireHooks(ctx context.Context, ev NoteEvent) {
	s.hooksMu.RLock()
	hooks := make([]Hook, len(s.hooks))
	copy(hooks, s.hooks)
	s.hooksMu.RUnlock()
	if len(hooks) == 0 {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	for _, h := range hooks {
		s.callHook(ctx, h, ev)
	}
}

// callHook runs a single hook and recovers from a panic.
func (s *Service) callHook(ctx context.Context, h Hook, ev NoteEvent) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("notes: a note hook panicked",
				"op", string(ev.Op),
				"path", ev.Path,
				"panic", r,
			)
		}
	}()
	h(ctx, ev)
}
