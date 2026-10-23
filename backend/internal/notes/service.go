package notes

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"noto/backend/internal/config"
	"noto/backend/internal/model"
	"noto/backend/internal/port"
)

// Service implements the business logic of the notes application on top of a
// port.Store. The filesystem is the source of truth for note content, the
// store holds the metadata and the search index.
type Service struct {
	cfg        config.Config
	store      port.Store
	notesRoot  string
	rootReal   string
	trashRoot  string
	attachRoot string

	mu    sync.Mutex
	locks map[string]*sync.Mutex

	// moved records the paths that were moved away, so that a late write
	// to such a path is reported as a conflict instead of re-creating the
	// note at its old location.
	movedMu sync.Mutex
	moved   map[string]time.Time
}

// NewService creates a service for the given configuration and store.
func NewService(cfg config.Config, store port.Store) (*Service, error) {
	if store == nil {
		return nil, newErr(ErrInternal, "store must not be nil")
	}
	for _, d := range []string{cfg.NotesDir, cfg.TrashDir, cfg.AttachmentsDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, newErr(ErrInternal, "cannot create directory: %v", err)
		}
	}
	root, err := filepath.Abs(cfg.NotesDir)
	if err != nil {
		return nil, newErr(ErrInternal, "cannot resolve notes directory: %v", err)
	}
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	trash, err := filepath.Abs(cfg.TrashDir)
	if err != nil {
		return nil, newErr(ErrInternal, "cannot resolve trash directory: %v", err)
	}
	attach, err := filepath.Abs(cfg.AttachmentsDir)
	if err != nil {
		return nil, newErr(ErrInternal, "cannot resolve attachments directory: %v", err)
	}
	return &Service{
		cfg:        cfg,
		store:      store,
		notesRoot:  root,
		rootReal:   root,
		trashRoot:  trash,
		attachRoot: attach,
		locks:      map[string]*sync.Mutex{},
		moved:      map[string]time.Time{},
	}, nil
}

// Config returns the configuration the service was created with.
func (s *Service) Config() config.Config { return s.cfg }

// Store returns the underlying store.
func (s *Service) Store() port.Store { return s.store }

// pathLock returns the mutex guarding a single path.
func (s *Service) pathLock(rel string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.locks[rel]
	if !ok {
		m = &sync.Mutex{}
		s.locks[rel] = m
	}
	return m
}

// lockKeys returns the hierarchical lock keys of a path: the ancestor
// folders of the path (the root of the subtree first) and the path itself.
//
// Locking the whole chain of a path makes a write inside a folder and a
// rename or move of that folder mutually exclusive.
func lockKeys(rel string) []string {
	if rel == "" {
		return nil
	}
	segments := strings.Split(rel, "/")
	keys := make([]string, 0, len(segments))
	for i := 1; i < len(segments); i++ {
		keys = append(keys, strings.Join(segments[:i], "/"))
	}
	return append(keys, rel)
}

// lockKeyOrder returns the global order of the path locks. The locks are
// always taken from the root of the tree to the leaf, so two operations can
// never deadlock.
func lockKeyOrder(key string) string {
	return fmt.Sprintf("%04d|%s", strings.Count(key, "/"), key)
}

// acquireLocks takes the hierarchical locks of the given path groups in the
// global lock order and returns the function that releases them.
func (s *Service) acquireLocks(groups ...[]string) func() {
	paths := make([]string, 0, len(groups))
	for _, group := range groups {
		paths = append(paths, group...)
	}
	seen := make(map[string]bool, len(paths))
	unique := make([]string, 0, len(paths))
	for _, p := range paths {
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		unique = append(unique, p)
	}
	sort.Slice(unique, func(i, j int) bool {
		return lockKeyOrder(unique[i]) < lockKeyOrder(unique[j])
	})
	held := make([]*sync.Mutex, 0, len(unique))
	for _, p := range unique {
		m := s.pathLock(p)
		m.Lock()
		held = append(held, m)
	}
	return func() {
		for i := len(held) - 1; i >= 0; i-- {
			held[i].Unlock()
		}
	}
}

// markMoved records that the given paths were moved away.
func (s *Service) markMoved(paths ...string) {
	now := time.Now()
	s.movedMu.Lock()
	defer s.movedMu.Unlock()
	if s.moved == nil {
		s.moved = map[string]time.Time{}
	}
	for _, p := range paths {
		if p == "" {
			continue
		}
		s.moved[p] = now
	}
	// The map must not grow without a limit.
	if len(s.moved) > 4096 {
		for p, t := range s.moved {
			if now.Sub(t) > time.Minute {
				delete(s.moved, p)
			}
		}
	}
}

// wasMoved reports whether the path was moved away recently.
func (s *Service) wasMoved(rel string) bool {
	s.movedMu.Lock()
	defer s.movedMu.Unlock()
	t, ok := s.moved[rel]
	if !ok {
		return false
	}
	if time.Since(t) > 5*time.Minute {
		delete(s.moved, rel)
		return false
	}
	return true
}

// nodeID derives a stable identifier from a path.
func nodeID(rel string) string {
	sum := sha256.Sum256([]byte("noto:" + rel))
	return hex.EncodeToString(sum[:8])
}

// randomID returns a random hex identifier.
func randomID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		sum := sha256.Sum256([]byte(time.Now().String()))
		b = sum[:12]
	}
	return hex.EncodeToString(b)
}

// statNode builds a node for an absolute path inside the notes root.
func (s *Service) statNode(abs string, info os.FileInfo) model.Node {
	rel := s.relativeTo(abs)
	typ := model.NodeFile
	if info.IsDir() {
		typ = model.NodeFolder
	}
	now := time.Now().UTC()
	return model.Node{
		ID:         nodeID(rel),
		Name:       filepath.Base(abs),
		Path:       rel,
		Type:       typ,
		ParentPath: parentOf(rel),
		Size:       info.Size(),
		ModTime:    info.ModTime().UTC(),
		Revision:   1,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}

// parentOf returns the parent path of a relative path.
func parentOf(rel string) string {
	if rel == "" {
		return ""
	}
	i := strings.LastIndex(rel, "/")
	if i < 0 {
		return ""
	}
	return rel[:i]
}

// baseOf returns the last segment of a relative path.
func baseOf(rel string) string {
	i := strings.LastIndex(rel, "/")
	if i < 0 {
		return rel
	}
	return rel[i+1:]
}

// mergeStored copies the persisted metadata of a node into a fresh node.
func mergeStored(fresh model.Node, stored model.Node, found bool) model.Node {
	if !found {
		return fresh
	}
	if stored.ID != "" {
		fresh.ID = stored.ID
	}
	fresh.Revision = stored.Revision
	fresh.CreatedAt = stored.CreatedAt
	fresh.UpdatedAt = stored.UpdatedAt
	if stored.ModTime.After(fresh.ModTime) {
		fresh.ModTime = stored.ModTime
	}
	return fresh
}

// syncNode writes the metadata of a node into the store and returns it.
func (s *Service) syncNode(ctx context.Context, n model.Node) (model.Node, error) {
	if err := s.store.UpsertNote(ctx, n); err != nil {
		return n, newErr(ErrInternal, "cannot persist node metadata")
	}
	return n, nil
}

// indexFile stores the searchable content of a note.
func (s *Service) indexFile(ctx context.Context, rel, content string) error {
	if err := s.store.IndexContent(ctx, rel, baseOf(rel), content); err != nil {
		return newErr(ErrInternal, "cannot update the search index")
	}
	return nil
}

// removeFromIndex drops a path from the search index.
func (s *Service) removeFromIndex(ctx context.Context, rel string) {
	_ = s.store.RemoveContent(ctx, rel)
}

// walkNotes walks the notes root and calls fn for every file and folder.
// Folders are visited before their content.
func (s *Service) walkNotes(fn func(rel string, info os.FileInfo, isDir bool) error) error {
	return filepath.Walk(s.notesRoot, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel := s.relativeTo(p)
		if rel == "" {
			return nil
		}
		return fn(rel, info, info.IsDir())
	})
}

// treeEntries is the flat result of a tree listing.
type treeEntries struct {
	Folders []model.Node
	Files   []model.Node
}

// Tree lists every folder and file of the notes root. Trashed entries are
// excluded because they live outside of the notes root.
func (s *Service) Tree(ctx context.Context) ([]model.Node, []model.Node, error) {
	var out treeEntries
	err := s.walkNotes(func(rel string, info os.FileInfo, isDir bool) error {
		node := s.statNode(s.notesRoot, info)
		node.Path = rel
		node.Name = baseOf(rel)
		node.ParentPath = parentOf(rel)
		stored, found, err := s.store.GetNote(ctx, rel)
		if err != nil {
			return newErr(ErrInternal, "cannot read node metadata")
		}
		node = mergeStored(node, stored, found)
		if isDir {
			out.Folders = append(out.Folders, node)
		} else {
			out.Files = append(out.Files, node)
		}
		return nil
	})
	if err != nil {
		return nil, nil, newErr(ErrInternal, "cannot list the notes directory")
	}
	if out.Folders == nil {
		out.Folders = []model.Node{}
	}
	if out.Files == nil {
		out.Files = []model.Node{}
	}
	sort.Slice(out.Folders, func(i, j int) bool { return out.Folders[i].Path < out.Folders[j].Path })
	sort.Slice(out.Files, func(i, j int) bool { return out.Files[i].Path < out.Files[j].Path })
	return out.Folders, out.Files, nil
}

// ensureFolder creates a folder (and all missing parents) on disk.
func (s *Service) ensureFolder(ctx context.Context, rel string) (model.Node, error) {
	abs, err := s.resolve(rel)
	if err != nil {
		return model.Node{}, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return model.Node{}, newErr(ErrInternal, "cannot create the folder")
	}
	info, err := os.Stat(abs)
	if err != nil {
		return model.Node{}, newErr(ErrInternal, "cannot stat the folder")
	}
	node := s.statNode(abs, info)
	stored, found, err := s.store.GetNote(ctx, rel)
	if err != nil {
		return model.Node{}, newErr(ErrInternal, "cannot read node metadata")
	}
	node = mergeStored(node, stored, found)
	return s.syncNode(ctx, node)
}

// writeFileAtomic writes data to a temporary file in the same directory and
// renames it over the target. Missing parent directories are created.
func writeFileAtomic(target string, data []byte) error {
	return writeFileAtomicMode(target, data, true)
}

// writeFileAtomicNoMkdir writes data to a temporary file in the same
// directory and renames it over the target. The parent directory must
// already exist, a missing parent is never re-created.
func writeFileAtomicNoMkdir(target string, data []byte) error {
	return writeFileAtomicMode(target, data, false)
}

// writeFileAtomicMode implements the atomic file replacement.
func writeFileAtomicMode(target string, data []byte, createDirs bool) error {
	dir := filepath.Dir(target)
	if createDirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	} else if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		if err == nil {
			err = os.ErrNotExist
		}
		return err
	}
	tmp, err := os.CreateTemp(dir, ".noto-tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}()
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpName, target)
}

// movePath moves a file or directory from src to dst.
func movePath(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	// Fall back to a copy when the trash directory lives on another volume.
	if err := copyPath(src, dst); err != nil {
		return err
	}
	return os.RemoveAll(src)
}

// copyPath recursively copies src to dst.
func copyPath(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		data, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		return os.WriteFile(dst, data, 0o644)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := copyPath(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}
