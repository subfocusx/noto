package notes

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"noto/backend/internal/model"
)

// Rename renames a file or folder.
func (s *Service) Rename(ctx context.Context, rel, newName string) (model.Node, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return model.Node{}, err
	}
	if norm == "" {
		return model.Node{}, newErr(ErrInvalidPath, "a note path is required")
	}
	// The NUL bytes of a name are stripped, the other control characters
	// are rejected.
	newName = stripNUL(newName)
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
	return s.relocate(ctx, norm, newRel, abs, info.IsDir(), NoteOpRenamed)
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
	return s.relocate(ctx, norm, newRel, abs, info.IsDir(), NoteOpMoved)
}

// relocate moves an entry on disk and updates every database row and index
// entry of the affected subtree.
//
// The event is fired for the root of the moved node only. A moved folder
// produces a single event for its new path and not one event per
// descendant: a plugin that watches the tree can react to the move of the
// folder instead of to every file below it.
func (s *Service) relocate(ctx context.Context, fromRel, toRel string, abs string, isDir bool, op NoteOp) (model.Node, error) {
	// The lock of the whole chain of the source and of the target is taken
	// first, so that a concurrent write inside the folder cannot split the
	// tree in two.
	release := s.acquireLocks(lockKeys(fromRel), lockKeys(toRel), lockKeys(parentOf(toRel)), lockKeys(parentOf(fromRel)))
	released := false
	defer func() {
		if !released {
			release()
		}
	}()

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
	node, err := s.nodeFor(ctx, toRel)
	if err != nil {
		return model.Node{}, err
	}
	// The hook runs after the disk, the index and the metadata of the whole
	// subtree are consistent and after the locks were released.
	release()
	released = true
	s.fireHooks(ctx, NoteEvent{
		Path:      toRel,
		Revision:  node.Revision,
		UpdatedAt: node.UpdatedAt,
		Op:        op,
	})
	return node, nil
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
		return model.Node{}, newErr(ErrInternal, "cannot read node metadata")
	}
	return mergeStored(node, stored, found), nil
}
