package notes

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

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
