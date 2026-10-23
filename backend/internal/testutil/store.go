// Package testutil provides in-memory helpers for the tests of the backend.
package testutil

import (
	"context"
	"strings"
	"sync"

	"noto/backend/internal/model"
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
	closed      bool
}

type indexEntry struct {
	name string
	body string
}

// NewMemStore creates an empty in-memory store.
func NewMemStore() *MemStore {
	return &MemStore{
		notes:       map[string]model.Node{},
		index:       map[string]indexEntry{},
		attachments: map[string]model.Attachment{},
		trash:       map[string]TrashRow{},
	}
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
func (s *MemStore) MoveNote(_ context.Context, fromPath, toPath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.notes[fromPath]
	if !ok {
		return nil
	}
	delete(s.notes, fromPath)
	n.Path = toPath
	n.ParentPath = parentOf(toPath)
	n.Name = baseOf(toPath)
	s.notes[toPath] = n
	if e, ok := s.index[fromPath]; ok {
		delete(s.index, fromPath)
		e.name = n.Name
		s.index[toPath] = e
	}
	return nil
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

// Search implements port.Store with a simple case insensitive substring scan.
func (s *MemStore) Search(_ context.Context, query string, limit int) ([]model.SearchHit, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit <= 0 {
		limit = 50
	}
	q := strings.ToLower(query)
	var out []model.SearchHit
	for path, e := range s.index {
		if strings.Contains(strings.ToLower(e.body), q) {
			out = append(out, model.SearchHit{
				Path:    path,
				Name:    e.name,
				Kind:    "content",
				Snippet: snippet(e.body, query),
			})
			if len(out) >= limit {
				break
			}
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
func (s *MemStore) DeleteAttachment(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.attachments, id)
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

func snippet(body, query string) string {
	lower := strings.ToLower(body)
	i := strings.Index(lower, strings.ToLower(query))
	if i < 0 {
		if len(body) > 80 {
			return body[:80]
		}
		return body
	}
	start := i - 20
	if start < 0 {
		start = 0
	}
	end := i + 60
	if end > len(body) {
		end = len(body)
	}
	return body[start:end]
}
