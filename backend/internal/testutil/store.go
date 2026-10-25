// Package testutil provides in-memory helpers for the tests of the backend.
package testutil

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"noto/backend/internal/model"
	"noto/backend/internal/query"
)

// TrashRow is a trashed entry of the memory store.
type TrashRow struct {
	OriginalPath string
	TrashPath    string
	Type         model.NodeType
	Size         int64
	DeletedAt    int64
}

// MemStore is an in-memory implementation of port.Store. It is used by the
// tests so that they never touch a real database.
type MemStore struct {
	mu          sync.RWMutex
	notes       map[string]model.Node
	index       map[string]indexEntry
	attachments map[string]model.Attachment
	trash       map[string]TrashRow
	props       map[string]model.NoteProps
	versions    map[string]model.NoteVersion
	derived     map[string]model.DerivedProps
	attachText  map[string]attachmentText
	closed      bool
}

type indexEntry struct {
	name string
	body string
}

// attachmentText is the text extracted from an attachment.
type attachmentText struct {
	notePath string
	name     string
	body     string
}

// NewMemStore creates an empty in-memory store.
func NewMemStore() *MemStore {
	return &MemStore{
		notes:       map[string]model.Node{},
		index:       map[string]indexEntry{},
		attachments: map[string]model.Attachment{},
		trash:       map[string]TrashRow{},
		props:       map[string]model.NoteProps{},
		versions:    map[string]model.NoteVersion{},
		derived:     map[string]model.DerivedProps{},
		attachText:  map[string]attachmentText{},
	}
}

// UpsertNoteProps implements port.Store.
func (s *MemStore) UpsertNoteProps(_ context.Context, p model.NoteProps) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.props[p.Path] = p
	return nil
}

// GetNoteProps implements port.Store.
func (s *MemStore) GetNoteProps(_ context.Context, path string) (model.NoteProps, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	props, found := s.props[path]
	return props, found, nil
}

// ListNoteProps implements port.Store.
func (s *MemStore) ListNoteProps(_ context.Context) ([]model.NoteProps, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]model.NoteProps, 0, len(s.props))
	for _, props := range s.props {
		out = append(out, props)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// DeleteNoteProps implements port.Store.
func (s *MemStore) DeleteNoteProps(_ context.Context, path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.props, path)
	return nil
}

// QueryNotes implements port.Store.
//
// The memory store evaluates the query with the predicate of the query
// package: the answer must be the same as the one of the SQL store.
func (s *MemStore) QueryNotes(_ context.Context, e query.Expr, limit int) ([]model.SearchHit, error) {
	if e == nil {
		return []model.SearchHit{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	predicate := query.CompilePredicate(e, time.Now())

	s.mu.RLock()
	defer s.mu.RUnlock()

	paths := make([]string, 0, len(s.notes))
	for path := range s.notes {
		paths = append(paths, path)
	}
	sort.Strings(paths)

	hits := []model.SearchHit{}
	for _, path := range paths {
		note, ok := s.queryNote(path)
		if !ok || !predicate(note) {
			continue
		}
		hits = append(hits, model.SearchHit{Path: path, Name: note.Name, Kind: "query"})
		if len(hits) >= limit {
			break
		}
	}
	return hits, nil
}

// queryNote builds the data of a note for the predicate of a query.
func (s *MemStore) queryNote(path string) (query.Note, bool) {
	node, found := s.notes[path]
	if !found {
		return query.Note{}, false
	}
	entry, hasIndex := s.index[path]
	props := s.props[path]
	note := query.Note{
		Path:      node.Path,
		Name:      node.Name,
		Content:   entry.body,
		Title:     props.Title,
		Tags:      props.Tags,
		Folder:    node.ParentPath,
		Ext:       extOf(node.Name),
		CreatedAt: node.CreatedAt.Unix(),
		UpdatedAt: node.UpdatedAt.Unix(),
	}
	if hasIndex {
		note.Name = entry.name
	}
	note.HasTaskList = props.Flags&model.PropHasTaskList != 0
	note.HasIncompleteTasks = props.Flags&model.PropHasIncompleteTasks != 0
	note.HasCode = props.Flags&model.PropHasCode != 0
	note.HasImage = props.Flags&model.PropHasImage != 0
	note.HasLink = props.Flags&model.PropHasLink != 0
	for _, attachment := range s.attachments {
		if attachment.NotePath == path {
			note.HasAttachments = true
			break
		}
	}
	return note, true
}

// extOf returns the extension of a file name, without the dot, lower cased.
func extOf(name string) string {
	at := strings.LastIndex(name, ".")
	if at < 0 || at == len(name)-1 {
		return ""
	}
	return strings.ToLower(name[at+1:])
}

// Close implements port.Store.
func (s *MemStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	return nil
}

// UpsertNote implements port.Store.
func (s *MemStore) UpsertNote(_ context.Context, n model.Node) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.notes[n.Path] = n
	return nil
}

// GetNote implements port.Store.
func (s *MemStore) GetNote(_ context.Context, path string) (model.Node, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n, ok := s.notes[path]
	return n, ok, nil
}

// DeleteNote implements port.Store.
func (s *MemStore) DeleteNote(_ context.Context, path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.notes, path)
	return nil
}

// MoveNote implements port.Store.
//
// The whole subtree of a moved folder is relocated with it and the search index
// rows of the moved paths follow, like the SQLite store does.
func (s *MemStore) MoveNote(_ context.Context, fromPath, toPath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if fromPath == "" || toPath == "" {
		return errors.New("testutil: empty path")
	}
	if fromPath == toPath {
		return nil
	}

	// The moved node itself.
	if n, ok := s.notes[fromPath]; ok {
		delete(s.notes, fromPath)
		s.notes[toPath] = relocated(n, toPath)
	}

	// The descendants of a moved folder.
	prefix := fromPath + "/"
	moved := map[string]string{}
	for p := range s.notes {
		if strings.HasPrefix(p, prefix) {
			moved[p] = toPath + "/" + strings.TrimPrefix(p, prefix)
		}
	}
	for p := range s.index {
		if _, ok := moved[p]; ok || !strings.HasPrefix(p, prefix) {
			continue
		}
		moved[p] = toPath + "/" + strings.TrimPrefix(p, prefix)
	}
	for p, np := range moved {
		if n, ok := s.notes[p]; ok {
			delete(s.notes, p)
			s.notes[np] = relocated(n, np)
		}
		s.moveIndex(p, np)
	}
	s.moveIndex(fromPath, toPath)
	return nil
}

// relocated returns the node with the path, the name and the parent of a new
// location.
func relocated(n model.Node, newPath string) model.Node {
	n.Path = newPath
	n.Name = baseOf(newPath)
	n.ParentPath = parentOf(newPath)
	return n
}

// moveIndex relocates the index row of a single path.
func (s *MemStore) moveIndex(fromPath, toPath string) {
	e, ok := s.index[fromPath]
	if !ok {
		return
	}
	delete(s.index, fromPath)
	e.name = baseOf(toPath)
	s.index[toPath] = e
}

// ListNotes implements port.Store.
func (s *MemStore) ListNotes(_ context.Context) ([]model.Node, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]model.Node, 0, len(s.notes))
	for _, n := range s.notes {
		out = append(out, n)
	}
	return out, nil
}

// IndexContent implements port.Store.
func (s *MemStore) IndexContent(_ context.Context, path, name, content string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.index[path] = indexEntry{name: name, body: content}
	return nil
}

// RemoveContent implements port.Store.
func (s *MemStore) RemoveContent(_ context.Context, path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.index, path)
	return nil
}

// Search implements port.Store.
//
// The file name and the content of a note are searched, like the SQLite store
// does. The matches of the names come first, the matches of the content
// follow. An empty query matches nothing.
func (s *MemStore) Search(_ context.Context, query string, limit int) ([]model.SearchHit, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit <= 0 {
		limit = 50
	}
	tokens := tokenize(query)
	if len(tokens) == 0 {
		return []model.SearchHit{}, nil
	}

	var nameHits, contentHits []model.SearchHit
	for path, e := range s.index {
		if matchesTokens(e.name, tokens) {
			nameHits = append(nameHits, model.SearchHit{
				Path:    path,
				Name:    e.name,
				Kind:    "name",
				Snippet: snippet(e.name, tokens),
			})
		}
		if matchesTokens(e.body, tokens) {
			contentHits = append(contentHits, model.SearchHit{
				Path:    path,
				Name:    e.name,
				Kind:    "content",
				Snippet: snippet(e.body, tokens),
			})
		}
	}
	sort.Slice(nameHits, func(i, j int) bool { return nameHits[i].Path < nameHits[j].Path })
	sort.Slice(contentHits, func(i, j int) bool { return contentHits[i].Path < contentHits[j].Path })

	// The text extracted from the attachments is searched as well, like the
	// SQLite store does.
	attachHits := []model.SearchHit{}
	for _, text := range s.attachText {
		if !matchesTokens(text.body, tokens) && !matchesTokens(text.name, tokens) {
			continue
		}
		attachHits = append(attachHits, model.SearchHit{
			Path:    text.notePath,
			Name:    baseOf(text.notePath),
			Kind:    "content",
			Snippet: text.name + ": " + snippet(text.body, tokens),
		})
	}
	sort.Slice(attachHits, func(i, j int) bool { return attachHits[i].Path < attachHits[j].Path })

	out := []model.SearchHit{}
	seen := map[string]bool{}
	for _, h := range append(append(nameHits, contentHits...), attachHits...) {
		key := h.Path + "\x00" + h.Kind
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, h)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

// ClearIndex implements port.Store.
func (s *MemStore) ClearIndex(_ context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.index = map[string]indexEntry{}
	return nil
}

// PutAttachment implements port.Store.
func (s *MemStore) PutAttachment(_ context.Context, a model.Attachment) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.attachments[a.ID] = a
	return nil
}

// ListAttachments implements port.Store.
func (s *MemStore) ListAttachments(_ context.Context) ([]model.Attachment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]model.Attachment, 0, len(s.attachments))
	for _, a := range s.attachments {
		out = append(out, a)
	}
	return out, nil
}

// GetAttachment implements port.Store.
func (s *MemStore) GetAttachment(_ context.Context, id string) (model.Attachment, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	a, ok := s.attachments[id]
	return a, ok, nil
}

// DeleteAttachment implements port.Store.
//
// The text that was extracted from the attachment is dropped with it.
func (s *MemStore) DeleteAttachment(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.attachments, id)
	delete(s.attachText, id)
	return nil
}

// IndexAttachmentText implements port.Store.
func (s *MemStore) IndexAttachmentText(_ context.Context, id, notePath, name, body string) error {
	if id == "" {
		return errors.New("testutil: empty attachment id")
	}
	if notePath == "" {
		return errors.New("testutil: an indexed attachment needs a note")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.attachText[id] = attachmentText{notePath: notePath, name: name, body: body}
	return nil
}

// PutTrash implements port.Store.
func (s *MemStore) PutTrash(_ context.Context, originalPath, trashPath string, kind model.NodeType, size int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trash[trashPath] = TrashRow{
		OriginalPath: originalPath,
		TrashPath:    trashPath,
		Type:         kind,
		Size:         size,
	}
	return nil
}

// ListTrash implements port.Store.
func (s *MemStore) ListTrash(_ context.Context) ([]model.Node, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]model.Node, 0, len(s.trash))
	for _, t := range s.trash {
		out = append(out, model.Node{
			ID:         t.TrashPath,
			Name:       baseOf(t.TrashPath),
			Path:       t.TrashPath,
			Type:       t.Type,
			ParentPath: parentOf(t.TrashPath),
			Size:       t.Size,
		})
	}
	return out, nil
}

// DeleteTrash implements port.Store.
func (s *MemStore) DeleteTrash(_ context.Context, trashPath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.trash, trashPath)
	return nil
}

// Notes returns a copy of the stored notes.
func (s *MemStore) Notes() map[string]model.Node {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]model.Node{}
	for k, v := range s.notes {
		out[k] = v
	}
	return out
}

// IndexedPaths returns the paths of the search index.
func (s *MemStore) IndexedPaths() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]string, 0, len(s.index))
	for k := range s.index {
		out = append(out, k)
	}
	return out
}

// TrashEntries returns a copy of the trash rows.
func (s *MemStore) TrashEntries() map[string]TrashRow {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]TrashRow{}
	for k, v := range s.trash {
		out[k] = v
	}
	return out
}

func parentOf(rel string) string {
	i := strings.LastIndex(rel, "/")
	if i < 0 {
		return ""
	}
	return rel[:i]
}

func baseOf(rel string) string {
	i := strings.LastIndex(rel, "/")
	if i < 0 {
		return rel
	}
	return rel[i+1:]
}
