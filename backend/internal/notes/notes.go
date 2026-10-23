package notes

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	"noto/backend/internal/model"
)

// CreateFolder creates a new folder below parentPath.
func (s *Service) CreateFolder(ctx context.Context, parentPath, name string) (model.Node, error) {
	parent, err := s.prepareParent(ctx, parentPath, false)
	if err != nil {
		return model.Node{}, err
	}
	if err := validateName(name); err != nil {
		return model.Node{}, err
	}
	rel, err := joinRel(parent, name)
	if err != nil {
		return model.Node{}, err
	}
	release := s.acquireLocks(lockKeys(rel))
	defer release()
	abs, err := s.resolve(rel)
	if err != nil {
		return model.Node{}, err
	}
	if _, err := os.Lstat(abs); err == nil {
		return model.Node{}, newErr(ErrDuplicateName, "a folder with this name already exists")
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return model.Node{}, newErr(ErrInternal, "cannot create the folder")
	}
	info, err := os.Stat(abs)
	if err != nil {
		return model.Node{}, newErr(ErrInternal, "cannot stat the folder")
	}
	node := s.statNode(abs, info)
	return s.syncNode(ctx, node)
}

// CreateFile creates a new empty Markdown file below parentPath. The ".md"
// suffix is appended when it is missing.
func (s *Service) CreateFile(ctx context.Context, parentPath, name string) (model.Node, error) {
	parent, err := s.prepareParent(ctx, parentPath, false)
	if err != nil {
		return model.Node{}, err
	}
	// The raw name is validated before the Markdown suffix is appended, so
	// that a name like ".." cannot be turned into a valid name.
	if err := validateName(name); err != nil {
		return model.Node{}, err
	}
	name = ensureMarkdownSuffix(name)
	if err := validateName(name); err != nil {
		return model.Node{}, err
	}
	rel, err := joinRel(parent, name)
	if err != nil {
		return model.Node{}, err
	}
	release := s.acquireLocks(lockKeys(rel))
	released := false
	defer func() {
		if !released {
			release()
		}
	}()
	abs, err := s.resolve(rel)
	if err != nil {
		return model.Node{}, err
	}
	if _, err := os.Lstat(abs); err == nil {
		return model.Node{}, newErr(ErrDuplicateName, "a file with this name already exists")
	}
	if info, err := os.Stat(filepath.Dir(abs)); err != nil || !info.IsDir() {
		return model.Node{}, newErr(ErrNotFound, "the parent folder does not exist")
	}
	if err := writeFileAtomicNoMkdir(abs, nil); err != nil {
		return model.Node{}, newErr(ErrInternal, "cannot create the file")
	}
	info, err := os.Stat(abs)
	if err != nil {
		return model.Node{}, newErr(ErrInternal, "cannot stat the file")
	}
	node := s.statNode(abs, info)
	node.Revision = 1
	if err := s.indexFile(ctx, rel, ""); err != nil {
		return model.Node{}, err
	}
	synced, err := s.syncNode(ctx, node)
	if err != nil {
		return model.Node{}, err
	}
	// The hook runs after the file, the index and the metadata are
	// consistent and after the locks were released.
	release()
	released = true
	s.fireHooks(ctx, NoteEvent{
		Path:      rel,
		Revision:  synced.Revision,
		UpdatedAt: synced.UpdatedAt,
		Op:        NoteOpCreated,
	})
	return synced, nil
}

// ensureMarkdownSuffix appends the ".md" suffix when it is missing.
func ensureMarkdownSuffix(name string) string {
	if name == "" {
		return name
	}
	if strings.HasSuffix(strings.ToLower(name), ".md") {
		return name
	}
	return name + ".md"
}

// prepareParent validates the parent path of a new entry. When create is
// true a missing folder is created instead of reported as an error.
func (s *Service) prepareParent(ctx context.Context, parentPath string, create bool) (string, error) {
	norm, err := normalizeRel(parentPath)
	if err != nil {
		return "", err
	}
	if norm == "" {
		return "", nil
	}
	abs, err := s.resolve(norm)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		if !create {
			return "", newErr(ErrNotFound, "the parent folder does not exist")
		}
		if _, err := s.ensureFolder(ctx, norm); err != nil {
			return "", err
		}
		return norm, nil
	}
	if !info.IsDir() {
		return "", newErr(ErrInvalidPath, "the parent path is not a folder")
	}
	return norm, nil
}

// Read returns the content and the revision of a note.
func (s *Service) Read(ctx context.Context, rel string) (model.NoteContent, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return model.NoteContent{}, err
	}
	if norm == "" {
		return model.NoteContent{}, newErr(ErrInvalidPath, "a note path is required")
	}
	abs, err := s.resolve(norm)
	if err != nil {
		return model.NoteContent{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return model.NoteContent{}, newErr(ErrNotFound, "note not found")
	}
	if info.IsDir() {
		return model.NoteContent{}, newErr(ErrBadRequest, "the path is a folder")
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return model.NoteContent{}, newErr(ErrInternal, "cannot read the note")
	}
	node, found, err := s.store.GetNote(ctx, norm)
	if err != nil {
		return model.NoteContent{}, newErr(ErrInternal, "cannot read the note metadata")
	}
	out := model.NoteContent{
		Path:      norm,
		Content:   string(data),
		Revision:  1,
		UpdatedAt: info.ModTime().UTC(),
	}
	if found {
		out.Revision = node.Revision
		out.UpdatedAt = node.UpdatedAt
	}
	return out, nil
}

// WriteResult is the result of a note write.
type WriteResult struct {
	Path      string    `json:"path"`
	Revision  int64     `json:"revision"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Write stores new content for a note. A revision of zero forces the write,
// a non-zero revision must match the stored revision.
func (s *Service) Write(ctx context.Context, rel, content string, revision int64) (WriteResult, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return WriteResult{}, err
	}
	if norm == "" {
		return WriteResult{}, newErr(ErrInvalidPath, "a note path is required")
	}
	if err := validateName(baseOf(norm)); err != nil {
		return WriteResult{}, err
	}
	if !strings.HasSuffix(strings.ToLower(baseOf(norm)), ".md") {
		return WriteResult{}, newErr(ErrInvalidName, "notes must use the .md extension")
	}
	release := s.acquireLocks(lockKeys(norm))
	released := false
	defer func() {
		if !released {
			release()
		}
	}()

	// The path is resolved after the lock was taken: a concurrent rename or
	// move may have changed it in the meantime.
	abs, err := s.resolve(norm)
	if err != nil {
		return WriteResult{}, err
	}
	parentInfo, err := os.Stat(filepath.Dir(abs))
	if err != nil || !parentInfo.IsDir() {
		// A missing parent folder is never re-created, otherwise a write
		// and a rename of the folder would produce two trees.
		return WriteResult{}, newErr(ErrNotFound, "the parent folder does not exist")
	}
	_, statErr := os.Stat(abs)
	// existed tells whether the note was already on the disk. It decides
	// between the "created" and the "updated" event.
	existed := statErr == nil
	if statErr != nil {
		// The note does not exist any more. A note that is known to the
		// store was moved or deleted, so the write is a conflict.
		if _, found, err := s.store.GetNote(ctx, norm); err == nil && found {
			return WriteResult{}, newErr(ErrConflict, "the note was moved or deleted")
		}
		if s.wasMoved(norm) {
			return WriteResult{}, newErr(ErrConflict, "the note was moved")
		}
	}

	stored, found, err := s.store.GetNote(ctx, norm)
	if err != nil {
		return WriteResult{}, newErr(ErrInternal, "cannot read the note metadata")
	}
	currentRevision := int64(1)
	if found {
		currentRevision = stored.Revision
	}
	if revision != 0 && revision != currentRevision {
		current, rerr := s.readLocked(ctx, norm)
		if rerr != nil {
			return WriteResult{}, rerr
		}
		return WriteResult{}, &Error{
			Code:    CodeRevisionConflict,
			Message: "the note was modified by someone else",
			Current: &current,
			cause:   ErrRevisionConflict,
		}
	}
	if err := writeFileAtomicNoMkdir(abs, []byte(content)); err != nil {
		return WriteResult{}, newErr(ErrInternal, "cannot write the note")
	}
	info, err := os.Stat(abs)
	if err != nil {
		return WriteResult{}, newErr(ErrInternal, "cannot stat the note")
	}
	now := time.Now().UTC()
	node := model.Node{
		ID:         nodeID(norm),
		Name:       baseOf(norm),
		Path:       norm,
		Type:       model.NodeFile,
		ParentPath: parentOf(norm),
		Size:       info.Size(),
		ModTime:    info.ModTime().UTC(),
		Revision:   currentRevision + 1,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if found {
		node.CreatedAt = stored.CreatedAt
	}
	if err := s.indexFile(ctx, norm, content); err != nil {
		return WriteResult{}, err
	}
	if err := s.store.UpsertNote(ctx, node); err != nil {
		return WriteResult{}, newErr(ErrInternal, "cannot persist the note metadata")
	}
	res := WriteResult{Path: norm, Revision: node.Revision, UpdatedAt: node.UpdatedAt}
	op := NoteOpUpdated
	if !existed {
		op = NoteOpCreated
	}
	// The hook is called after the whole sequence (disk, index, metadata)
	// and after the locks were released, so that it always observes a
	// consistent state.
	release()
	released = true
	s.fireHooks(ctx, NoteEvent{
		Path:      norm,
		Revision:  node.Revision,
		UpdatedAt: node.UpdatedAt,
		Op:        op,
	})
	return res, nil
}

// readLocked reads a note without taking the path lock.
func (s *Service) readLocked(ctx context.Context, rel string) (model.NoteContent, error) {
	abs, err := s.resolve(rel)
	if err != nil {
		return model.NoteContent{}, err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return model.NoteContent{}, newErr(ErrNotFound, "note not found")
	}
	node, found, err := s.store.GetNote(ctx, rel)
	if err != nil {
		return model.NoteContent{}, newErr(ErrInternal, "cannot read the note metadata")
	}
	out := model.NoteContent{Path: rel, Content: string(data), Revision: 1}
	if found {
		out.Revision = node.Revision
		out.UpdatedAt = node.UpdatedAt
	}
	return out, nil
}
