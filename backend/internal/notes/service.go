package notes

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
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

	// hooks holds the registered note hooks. It has its own lock so that
	// the registration never interferes with the locks of the notes tree.
	hooksMu sync.RWMutex
	hooks   []Hook
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
	// The properties of the note are derived from its text: they are
	// recalculated with the index, so that they never lag behind the file.
	s.refreshNoteProps(ctx, rel, baseOf(rel), content)
	return nil
}

// removeFromIndex drops a path from the search index.
func (s *Service) removeFromIndex(ctx context.Context, rel string) {
	_ = s.store.RemoveContent(ctx, rel)
	_ = s.store.DeleteNoteProps(ctx, rel)
}

// walkNotes walks the notes root and calls fn for every file and folder.
// Folders are visited before their content.
//
// Paths with a hidden segment, a segment whose name starts with a dot, are
// skipped. The internal directory of a vault lives in such a directory, so it
// must not show up in the tree of the notes.
func (s *Service) walkNotes(fn func(rel string, info os.FileInfo, isDir bool) error) error {
	return filepath.Walk(s.notesRoot, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel := s.relativeTo(p)
		if rel == "" {
			return nil
		}
		if hasHiddenSegment(rel) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		return fn(rel, info, info.IsDir())
	})
}

// hasHiddenSegment reports whether one of the segments of a slash separated
// relative path starts with a dot.
func hasHiddenSegment(rel string) bool {
	for _, seg := range strings.Split(rel, "/") {
		if seg == "" {
			continue
		}
		if strings.HasPrefix(seg, ".") {
			return true
		}
	}
	return false
}

// treeEntries is the flat result of a tree listing.
type treeEntries struct {
	Folders []model.Node
	Files   []model.Node
}

// Tree lists every folder and file of the notes root. Trashed entries are
// excluded because they live outside of the notes root.
//
// The metadata of every node is read with a single store.ListNotes call and
// is then distributed by path, so that the cost of the listing does not grow
// with the number of the notes.
func (s *Service) Tree(ctx context.Context) ([]model.Node, []model.Node, error) {
	stored, err := s.store.ListNotes(ctx)
	if err != nil {
		return nil, nil, newErr(ErrInternal, "cannot read node metadata")
	}
	byPath := make(map[string]model.Node, len(stored))
	for _, n := range stored {
		byPath[n.Path] = n
	}
	var out treeEntries
	err = s.walkNotes(func(rel string, info os.FileInfo, isDir bool) error {
		node := s.statNode(s.notesRoot, info)
		node.Path = rel
		node.Name = baseOf(rel)
		node.ParentPath = parentOf(rel)
		persisted, found := byPath[rel]
		node = mergeStored(node, persisted, found)
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
