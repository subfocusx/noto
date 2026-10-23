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
	defer release()
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
	return s.syncNode(ctx, node)
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
	defer release()

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
	return WriteResult{Path: norm, Revision: node.Revision, UpdatedAt: node.UpdatedAt}, nil
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

// Rename renames a file or folder.
func (s *Service) Rename(ctx context.Context, rel, newName string) (model.Node, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return model.Node{}, err
	}
	if norm == "" {
		return model.Node{}, newErr(ErrInvalidPath, "a note path is required")
	}
	if err := validateName(newName); err != nil {
		return model.Node{}, err
	}
	abs, err := s.resolve(norm)
	if err != nil {
		return model.Node{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return model.Node{}, newErr(ErrNotFound, "note not found")
	}
	newRel, err := joinRel(parentOf(norm), newName)
	if err != nil {
		return model.Node{}, err
	}
	if newRel == norm {
		return s.nodeFor(ctx, norm)
	}
	return s.relocate(ctx, norm, newRel, abs, info.IsDir())
}

// Move moves a file or folder into another folder.
func (s *Service) Move(ctx context.Context, rel, newParentPath string) (model.Node, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return model.Node{}, err
	}
	if norm == "" {
		return model.Node{}, newErr(ErrInvalidPath, "a note path is required")
	}
	abs, err := s.resolve(norm)
	if err != nil {
		return model.Node{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return model.Node{}, newErr(ErrNotFound, "note not found")
	}
	parent, err := s.prepareParent(ctx, newParentPath, true)
	if err != nil {
		return model.Node{}, err
	}
	newRel, err := joinRel(parent, baseOf(norm))
	if err != nil {
		return model.Node{}, err
	}
	if newRel == norm {
		return s.nodeFor(ctx, norm)
	}
	if info.IsDir() {
		if parent == norm || strings.HasPrefix(parent, norm+"/") {
			return model.Node{}, newErr(ErrInvalidPath, "a folder cannot be moved into itself")
		}
	}
	return s.relocate(ctx, norm, newRel, abs, info.IsDir())
}

// relocate moves an entry on disk and updates every database row and index
// entry of the affected subtree.
func (s *Service) relocate(ctx context.Context, fromRel, toRel string, abs string, isDir bool) (model.Node, error) {
	// The lock of the whole chain of the source and of the target is taken
	// first, so that a concurrent write inside the folder cannot split the
	// tree in two.
	release := s.acquireLocks(lockKeys(fromRel), lockKeys(toRel), lockKeys(parentOf(toRel)), lockKeys(parentOf(fromRel)))
	defer release()

	// Both paths are resolved again after the lock was taken.
	fromAbs, err := s.resolve(fromRel)
	if err != nil {
		return model.Node{}, err
	}
	if _, err := os.Lstat(fromAbs); err != nil {
		return model.Node{}, newErr(ErrNotFound, "note not found")
	}
	toAbs, err := s.resolve(toRel)
	if err != nil {
		return model.Node{}, err
	}
	if _, err := os.Lstat(toAbs); err == nil {
		return model.Node{}, newErr(ErrDuplicateName, "an entry with this name already exists")
	}
	descendants, err := s.collectSubtree(fromRel)
	if err != nil {
		return model.Node{}, err
	}
	if err := movePath(fromAbs, toAbs); err != nil {
		return model.Node{}, newErr(ErrInternal, "cannot move the entry")
	}
	// The old paths must not be re-created by a late write.
	movedPaths := make([]string, 0, len(descendants))
	for _, d := range descendants {
		movedPaths = append(movedPaths, d)
	}
	s.markMoved(movedPaths...)
	for _, d := range descendants {
		suffix := strings.TrimPrefix(d, fromRel)
		newPath := toRel + suffix
		if err := s.rekey(ctx, d, newPath); err != nil {
			return model.Node{}, err
		}
	}
	return s.nodeFor(ctx, toRel)
}

// collectSubtree returns the relative paths of the entry and all of its
// descendants, parents before children.
func (s *Service) collectSubtree(rel string) ([]string, error) {
	abs, err := s.resolve(rel)
	if err != nil {
		return nil, err
	}
	var out []string
	err = filepath.Walk(abs, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		r := s.relativeTo(p)
		if r == "" {
			return nil
		}
		out = append(out, r)
		return nil
	})
	if err != nil {
		return nil, newErr(ErrInternal, "cannot read the notes directory")
	}
	return out, nil
}

// rekey updates the database row and the index entry of a moved path.
func (s *Service) rekey(ctx context.Context, oldPath, newPath string) error {
	_ = s.store.MoveNote(ctx, oldPath, newPath)
	if _, found, err := s.store.GetNote(ctx, oldPath); err == nil && found {
		_ = s.store.DeleteNote(ctx, oldPath)
	}
	abs, err := s.resolve(newPath)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return newErr(ErrInternal, "cannot stat the moved entry")
	}
	node := s.statNode(abs, info)
	node.Path = newPath
	node.Name = baseOf(newPath)
	node.ParentPath = parentOf(newPath)
	if stored, found, err := s.store.GetNote(ctx, newPath); err == nil && found {
		node = mergeStored(node, stored, true)
	}
	s.removeFromIndex(ctx, oldPath)
	if node.Type == model.NodeFile {
		data, err := os.ReadFile(abs)
		if err != nil {
			return newErr(ErrInternal, "cannot read the moved file")
		}
		if err := s.indexFile(ctx, newPath, string(data)); err != nil {
			return err
		}
	}
	if _, err := s.syncNode(ctx, node); err != nil {
		return err
	}
	return nil
}

// nodeFor returns the node of an existing path.
func (s *Service) nodeFor(ctx context.Context, rel string) (model.Node, error) {
	abs, err := s.resolve(rel)
	if err != nil {
		return model.Node{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return model.Node{}, newErr(ErrNotFound, "note not found")
	}
	node := s.statNode(abs, info)
	stored, found, err := s.store.GetNote(ctx, rel)
	if err != nil {
		return model.Node{}, newErr(ErrInternal, "cannot read the node metadata")
	}
	return mergeStored(node, stored, found), nil
}
