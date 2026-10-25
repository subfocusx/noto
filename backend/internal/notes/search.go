package notes

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"noto/backend/internal/model"
)

// Search returns matching notes. The store provides the content matches, the
// service adds the matches on the file name.
func (s *Service) Search(ctx context.Context, query string, limit int) ([]model.SearchHit, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []model.SearchHit{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	hits, err := s.store.Search(ctx, query, limit)
	if err != nil {
		return nil, newErr(ErrInternal, "cannot search the index")
	}
	lower := strings.ToLower(query)
	seen := map[string]bool{}
	out := make([]model.SearchHit, 0, len(hits))
	for _, h := range hits {
		key := h.Path + "\x00" + h.Kind
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, h)
	}
	notes, err := s.store.ListNotes(ctx)
	if err != nil {
		return nil, newErr(ErrInternal, "cannot read the note metadata")
	}
	for _, n := range notes {
		if !strings.Contains(strings.ToLower(n.Name), lower) {
			continue
		}
		key := n.Path + "\x00name"
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, model.SearchHit{
			Path:    n.Path,
			Name:    n.Name,
			Kind:    "name",
			Snippet: n.Name,
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// Reindex rebuilds the search index and the metadata from the notes root.
func (s *Service) Reindex(ctx context.Context) (int, error) {
	if err := s.store.ClearIndex(ctx); err != nil {
		return 0, newErr(ErrInternal, "cannot clear the search index")
	}
	count := 0
	err := s.walkNotes(func(rel string, info os.FileInfo, isDir bool) error {
		if isDir {
			return nil
		}
		data, err := os.ReadFile(filepath.Join(s.notesRoot, filepath.FromSlash(rel)))
		if err != nil {
			return nil
		}
		node := s.statNode(filepath.Join(s.notesRoot, filepath.FromSlash(rel)), info)
		node.Path = rel
		node.Name = baseOf(rel)
		node.ParentPath = parentOf(rel)
		if stored, found, err := s.store.GetNote(ctx, rel); err == nil && found {
			node = mergeStored(node, stored, true)
		}
		if err := s.store.UpsertNote(ctx, node); err != nil {
			return err
		}
		if err := s.indexFile(ctx, rel, string(data)); err != nil {
			return err
		}
		// The rebuild of the index repairs the cache of the derived
		// properties: the notes are read from the disk, so their
		// properties are known again.
		if _, err := s.RecomputeDerived(ctx, rel, string(data)); err != nil {
			return err
		}
		count++
		return nil
	})
	if err != nil {
		return count, newErr(ErrInternal, "cannot rebuild the search index")
	}
	return count, nil
}
