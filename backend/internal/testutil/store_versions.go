package testutil

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"noto/backend/internal/model"
)

// The in-memory implementation of the parts of port.Store that the version
// history, the cache of the derived properties and the paged listing need.
//
// The behaviour is the one of the SQLite store, so that the tests of the
// domain layer do not depend on the engine.

// -------------------------------------------------------------- versions ---

// AppendVersion implements port.Store.
func (s *MemStore) AppendVersion(_ context.Context, v model.NoteVersion) error {
	if v.Path == "" {
		return errors.New("testutil: empty path")
	}
	if v.Revision <= 0 {
		return errors.New("testutil: a version needs a positive revision")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	key := versionKey(v.Path, v.Revision)
	if _, exists := s.versions[key]; exists {
		return errors.New("testutil: the version already exists")
	}
	s.versions[key] = v
	return nil
}

// ListVersions implements port.Store.
func (s *MemStore) ListVersions(_ context.Context, path string) ([]model.NoteVersion, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []model.NoteVersion{}
	for _, v := range s.versions {
		if v.Path == path {
			out = append(out, v)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Revision < out[j].Revision })
	return out, nil
}

// GetVersion implements port.Store.
func (s *MemStore) GetVersion(_ context.Context, path string, revision int64) (model.NoteVersion, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, found := s.versions[versionKey(path, revision)]
	return v, found, nil
}

// versionKey builds the key of a version inside the map of the versions.
func versionKey(path string, revision int64) string {
	return fmt.Sprintf("%s\x00%d", path, revision)
}

// -------------------------------------------------------------- derived ---

// PutDerivedProps implements port.Store.
func (s *MemStore) PutDerivedProps(_ context.Context, d model.DerivedProps) error {
	if d.Path == "" {
		return errors.New("testutil: empty path")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.derived[d.Path] = d
	return nil
}

// GetDerivedProps implements port.Store.
func (s *MemStore) GetDerivedProps(_ context.Context, path string) (model.DerivedProps, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	d, found := s.derived[path]
	return d, found, nil
}

// MarkDerivedPropsStale implements port.Store.
func (s *MemStore) MarkDerivedPropsStale(_ context.Context, path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if d, found := s.derived[path]; found {
		d.Stale = true
		s.derived[path] = d
	}
	return nil
}

// DeleteDerivedProps implements port.Store.
func (s *MemStore) DeleteDerivedProps(_ context.Context, path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.derived, path)
	return nil
}

// ----------------------------------------------------------------- pages ---

// ListChildrenPaged implements port.Store.
func (s *MemStore) ListChildrenPaged(_ context.Context, parentPath, cursor string, limit int) (model.NodePage, error) {
	if limit <= 0 {
		limit = 100
	}
	s.mu.RLock()
	defer s.mu.RUnlock()

	children := []model.Node{}
	for path, n := range s.notes {
		if n.ParentPath != parentPath || path <= cursor {
			continue
		}
		children = append(children, n)
	}
	sort.Slice(children, func(i, j int) bool { return children[i].Path < children[j].Path })

	page := model.NodePage{Items: []model.Node{}}
	if len(children) > limit {
		children = children[:limit]
		page.NextCursor = children[len(children)-1].Path
	}
	page.Items = children
	return page, nil
}
