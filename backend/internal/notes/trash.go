package notes

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"noto/backend/internal/model"
)

// TrashPathPrefix is the prefix of every trash path.
const TrashPathPrefix = "trash/"

// Delete moves a file or folder to the trash directory. The original path is
// recorded so that the entry can be restored.
func (s *Service) Delete(ctx context.Context, rel string) error {
	norm, err := normalizeRel(rel)
	if err != nil {
		return err
	}
	if norm == "" {
		return newErr(ErrInvalidPath, "a note path is required")
	}
	release := s.acquireLocks(lockKeys(norm))
	defer release()
	abs, err := s.resolve(norm)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return newErr(ErrNotFound, "note not found")
	}
	_ = info

	trashID := randomID()
	dest := filepath.Join(s.trashRoot, trashID, filepath.FromSlash(norm))
	if err := movePath(abs, dest); err != nil {
		return newErr(ErrInternal, "cannot move the entry to the trash")
	}
	entries, err := s.collectTrashEntries(trashID, norm)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := s.store.PutTrash(ctx, e.originalPath, e.trashPath, e.kind, e.size); err != nil {
			return newErr(ErrInternal, "cannot record the trash entry")
		}
		_ = s.store.DeleteNote(ctx, e.originalPath)
		s.removeFromIndex(ctx, e.originalPath)
	}
	return nil
}

// trashEntry describes a single trashed node.
type trashEntry struct {
	originalPath string
	trashPath    string
	kind         model.NodeType
	size         int64
}

// collectTrashEntries builds the trash records of a deleted subtree.
func (s *Service) collectTrashEntries(trashID, originalRel string) ([]trashEntry, error) {
	dest := filepath.Join(s.trashRoot, trashID, filepath.FromSlash(originalRel))
	var out []trashEntry
	err := filepath.Walk(dest, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(s.trashRoot, p)
		if err != nil {
			return err
		}
		rel = TrashPathPrefix + filepath.ToSlash(rel)
		suffix, err := filepath.Rel(dest, p)
		if err != nil {
			return err
		}
		suffix = filepath.ToSlash(suffix)
		original := originalRel
		if suffix != "." {
			original = originalRel + "/" + suffix
		}
		kind := model.NodeFile
		if info.IsDir() {
			kind = model.NodeFolder
		}
		out = append(out, trashEntry{
			originalPath: original,
			trashPath:    rel,
			kind:         kind,
			size:         info.Size(),
		})
		return nil
	})
	if err != nil {
		return nil, newErr(ErrInternal, "cannot read the trash directory")
	}
	return out, nil
}

// Trash lists every trashed entry.
func (s *Service) Trash(ctx context.Context) ([]model.Node, error) {
	entries, err := s.store.ListTrash(ctx)
	if err != nil {
		return nil, newErr(ErrInternal, "cannot read the trash entries")
	}
	out := make([]model.Node, 0, len(entries))
	for _, e := range entries {
		node := e
		if node.Path == "" {
			continue
		}
		if node.Name == "" {
			node.Name = baseOf(node.Path)
		}
		if node.ParentPath == "" {
			node.ParentPath = parentOf(node.Path)
		}
		out = append(out, node)
	}
	return out, nil
}

// Restore moves a trashed entry back to its original location.
func (s *Service) Restore(ctx context.Context, trashPath string) (model.Node, error) {
	norm, err := normalizeRel(trashPath)
	if err != nil {
		return model.Node{}, err
	}
	if !strings.HasPrefix(norm, TrashPathPrefix) {
		return model.Node{}, newErr(ErrInvalidPath, "invalid trash path")
	}
	rest := strings.TrimPrefix(norm, TrashPathPrefix)
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return model.Node{}, newErr(ErrInvalidPath, "invalid trash path")
	}
	trashID, originalRel := parts[0], parts[1]
	src := filepath.Join(s.trashRoot, trashID, filepath.FromSlash(originalRel))
	if _, err := os.Lstat(src); err != nil {
		return model.Node{}, newErr(ErrNotFound, "the trash entry does not exist")
	}
	release := s.acquireLocks(lockKeys(originalRel))
	defer release()
	dst, err := s.resolve(originalRel)
	if err != nil {
		return model.Node{}, err
	}
	if _, err := os.Lstat(dst); err == nil {
		return model.Node{}, newErr(ErrConflict, "an entry with this name already exists")
	}
	if err := movePath(src, dst); err != nil {
		return model.Node{}, newErr(ErrInternal, "cannot restore the entry")
	}
	descendants, err := s.collectSubtree(originalRel)
	if err != nil {
		return model.Node{}, err
	}
	for _, d := range descendants {
		abs, err := s.resolve(d)
		if err != nil {
			return model.Node{}, err
		}
		info, err := os.Stat(abs)
		if err != nil {
			continue
		}
		node := s.statNode(abs, info)
		node.Path = d
		node.Name = baseOf(d)
		node.ParentPath = parentOf(d)
		if _, err := s.syncNode(ctx, node); err != nil {
			return model.Node{}, err
		}
		if node.Type == model.NodeFile {
			data, err := os.ReadFile(abs)
			if err != nil {
				return model.Node{}, newErr(ErrInternal, "cannot read the restored file")
			}
			if err := s.indexFile(ctx, d, string(data)); err != nil {
				return model.Node{}, err
			}
		}
	}
	if err := s.cleanupTrashID(ctx, trashID); err != nil {
		return model.Node{}, err
	}
	return s.nodeFor(ctx, originalRel)
}

// cleanupTrashID removes the trash records of a restore operation and the
// empty trash directory.
func (s *Service) cleanupTrashID(ctx context.Context, trashID string) error {
	entries, err := s.store.ListTrash(ctx)
	if err != nil {
		return newErr(ErrInternal, "cannot read the trash entries")
	}
	prefix := TrashPathPrefix + trashID + "/"
	for _, e := range entries {
		if strings.HasPrefix(e.Path, prefix) {
			_ = s.store.DeleteTrash(ctx, e.Path)
		}
	}
	_ = os.Remove(filepath.Join(s.trashRoot, trashID))
	return nil
}
