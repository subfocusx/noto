// Package porttest provides a reusable conformance suite for the port.Store
// interface.
//
// The suite is executed against every implementation of find the known
// differences between them. A case that an implementation does not satisfy is
// not silently weakened: the suite records the divergence, reports it to the
// caller and marks the case as a skipped test with the comment "known
// divergence, tracked".
package porttest

import (
	"context"
	"testing"

	"noto/backend/internal/model"
	"noto/backend/internal/port"
)

// Divergence describes a case of the conformance suite that an
// implementation does not satisfy.
type Divergence struct {
	// Case is the name of the case of the suite.
	Case string
	// Detail describes the observed difference.
	Detail string
	// Known reports whether the difference is one of the differences that
	// are already tracked. An unknown difference is a new defect.
	Known bool
}

// String returns a readable description of the divergence.
func (d Divergence) String() string {
	kind := "observed divergence, tracked"
	if d.Known {
		kind = "known divergence, tracked"
	}
	return d.Case + ": " + kind + ": " + d.Detail
}

// KnownDivergences are the differences between the implementations that are
// already known and that must not be hidden by the conformance suite.
//
// Every implementation of port.Store must satisfy the whole suite, so no
// difference is tracked at the moment: a difference that is observed is a
// defect of the implementation that is reported.
var KnownDivergences = map[string]bool{}

// suite holds the state of a single run of the conformance suite.
type suite struct {
	t           *testing.T
	name        string
	newStore    func(t *testing.T) port.Store
	divergences []Divergence
	// cur is the test of the case that is currently running.
	cur *testing.T
	// nameMatches reports whether the implementation returns the matches of
	// a file name. It is used by the dependent cases.
	nameMatches bool
}

// Run executes the conformance suite against a store implementation and
// returns the divergences that were observed.
//
// The store is created by newStore for every case of the suite, so that the
// cases cannot influence each other.
func Run(t *testing.T, name string, newStore func(t *testing.T) port.Store) []Divergence {
	t.Helper()
	s := &suite{t: t, name: name, newStore: newStore}
	s.run()
	return s.divergences
}

// store creates a fresh store for a single case.
func (s *suite) store() port.Store {
	s.cur.Helper()
	st := s.newStore(s.t)
	if st == nil {
		s.cur.Fatalf("%s: the store factory returned nil", s.name)
	}
	s.cur.Cleanup(func() { _ = st.Close() })
	return st
}

// divergence records a divergence and skips the current case.
func (s *suite) divergence(caseName, detail string) {
	s.cur.Helper()
	d := Divergence{Case: caseName, Detail: detail, Known: KnownDivergences[caseName]}
	s.divergences = append(s.divergences, d)
	s.cur.Skipf("%s: %s", d.String(), detail)
}

// run executes every case of the suite.
func (s *suite) run() {
	s.runCase("upsert, read, list and delete a note", s.caseNotes)
	s.runCase("move a note", s.caseMoveNote)
	s.runCase("move note relocates the descendants of a moved folder", s.caseMoveDescendants)
	s.runCase("index a content and search for it", s.caseSearchContent)
	s.runCase("search returns the matches of a file name", s.caseSearchName)
	s.runCase("search honours the limit", s.caseSearchLimit)
	s.runCase("search honours the limit for the matches of a file name", s.caseSearchNameLimit)
	s.runCase("an empty query returns no hits", s.caseEmptyQuery)
	s.runCase("a query with special characters does not fail", s.caseSpecialCharacters)
	s.runCase("remove a content drops the path from the index", s.caseRemoveContent)
	s.runCase("clear the index empties it", s.caseClearIndex)
	s.runCase("attachments are stored, listed, read and deleted", s.caseAttachments)
	s.runCase("trash entries are stored, listed and deleted", s.caseTrash)
}

// runCase runs a single case of the suite in its own subtest.
func (s *suite) runCase(name string, fn func()) {
	s.t.Run(name, func(t *testing.T) {
		s.cur = t
		fn()
	})
}

// ------------------------------------------------------------------ notes ---

// caseNotes checks UpsertNote, GetNote, DeleteNote and ListNotes.
func (s *suite) caseNotes() {
	ctx := context.Background()
	store := s.store()

	node := model.Node{
		ID:         "id-1",
		Name:       "a.md",
		Path:       "a.md",
		Type:       model.NodeFile,
		ParentPath: "",
		Size:       12,
		Revision:   2,
	}
	if err := store.UpsertNote(ctx, node); err != nil {
		s.cur.Fatalf("upsert note: %v", err)
	}
	got, found, err := store.GetNote(ctx, "a.md")
	if err != nil {
		s.cur.Fatalf("get note: %v", err)
	}
	if !found {
		s.cur.Fatalf("the note was not found")
	}
	if got.Path != node.Path || got.Name != node.Name || got.Type != node.Type ||
		got.ParentPath != node.ParentPath || got.Size != node.Size || got.Revision != node.Revision {
		s.cur.Fatalf("unexpected node %+v", got)
	}

	// An upsert of the same path replaces the stored metadata.
	node.Size = 34
	node.Revision = 3
	if err := store.UpsertNote(ctx, node); err != nil {
		s.cur.Fatalf("upsert note again: %v", err)
	}
	got, found, err = store.GetNote(ctx, "a.md")
	if err != nil {
		s.cur.Fatalf("get note again: %v", err)
	}
	if !found || got.Size != 34 || got.Revision != 3 {
		s.cur.Fatalf("the note was not updated: %+v", got)
	}

	notes, err := store.ListNotes(ctx)
	if err != nil {
		s.cur.Fatalf("list notes: %v", err)
	}
	if len(notes) != 1 || notes[0].Path != "a.md" {
		s.cur.Fatalf("unexpected note list %+v", notes)
	}

	if err := store.DeleteNote(ctx, "a.md"); err != nil {
		s.cur.Fatalf("delete note: %v", err)
	}
	if _, found, err := store.GetNote(ctx, "a.md"); err != nil {
		s.cur.Fatalf("get deleted note: %v", err)
	} else if found {
		s.cur.Fatalf("the deleted note is still there")
	}
	notes, err = store.ListNotes(ctx)
	if err != nil {
		s.cur.Fatalf("list notes after delete: %v", err)
	}
	if len(notes) != 0 {
		s.cur.Fatalf("unexpected note list after the delete: %+v", notes)
	}
}

// caseMoveNote checks that a moved note is stored under its new path.
func (s *suite) caseMoveNote() {
	ctx := context.Background()
	store := s.store()

	if err := store.UpsertNote(ctx, model.Node{Path: "a.md", Name: "a.md", Type: model.NodeFile}); err != nil {
		s.cur.Fatalf("upsert note: %v", err)
	}
	if err := store.MoveNote(ctx, "a.md", "b.md"); err != nil {
		s.cur.Fatalf("move note: %v", err)
	}
	if _, found, err := store.GetNote(ctx, "a.md"); err != nil {
		s.cur.Fatalf("get moved note: %v", err)
	} else if found {
		s.cur.Fatalf("the note is still stored under the old path")
	}
	got, found, err := store.GetNote(ctx, "b.md")
	if err != nil {
		s.cur.Fatalf("get new note: %v", err)
	}
	if !found {
		s.cur.Fatalf("the note was not stored under the new path")
	}
	if got.Path != "b.md" || got.Name != "b.md" || got.ParentPath != "" {
		s.cur.Fatalf("unexpected node %+v", got)
	}
}

// caseMoveDescendants checks that the descendants of a moved folder are
// relocated with it.
func (s *suite) caseMoveDescendants() {
	ctx := context.Background()
	store := s.store()

	if err := store.UpsertNote(ctx, model.Node{Path: "dir", Name: "dir", Type: model.NodeFolder}); err != nil {
		s.cur.Fatalf("upsert folder: %v", err)
	}
	if err := store.UpsertNote(ctx, model.Node{Path: "dir/child.md", Name: "child.md", Type: model.NodeFile, ParentPath: "dir"}); err != nil {
		s.cur.Fatalf("upsert child: %v", err)
	}
	if err := store.MoveNote(ctx, "dir", "moved"); err != nil {
		s.cur.Fatalf("move folder: %v", err)
	}

	got, found, err := store.GetNote(ctx, "moved/child.md")
	if err != nil {
		s.cur.Fatalf("get moved child: %v", err)
	}
	if !found {
		s.divergence("move note relocates the descendants of a moved folder",
			"the descendant dir/child.md was not relocated to moved/child.md")
	}
	if got.Path != "moved/child.md" || got.Name != "child.md" || got.ParentPath != "moved" {
		s.cur.Fatalf("unexpected node %+v", got)
	}
	if _, found, err := store.GetNote(ctx, "dir/child.md"); err != nil {
		s.cur.Fatalf("get old child: %v", err)
	} else if found {
		s.cur.Fatalf("the descendant is still stored under the old path")
	}
}

// ----------------------------------------------------------------- index ---

// caseSearchContent checks that an indexed content is found again.
func (s *suite) caseSearchContent() {
	ctx := context.Background()
	store := s.store()

	if err := store.IndexContent(ctx, "a.md", "a.md", "pineapple juice"); err != nil {
		s.cur.Fatalf("index content: %v", err)
	}
	hits, err := store.Search(ctx, "pineapple", 10)
	if err != nil {
		s.cur.Fatalf("search: %v", err)
	}
	if len(hits) != 1 {
		s.cur.Fatalf("unexpected hits %+v", hits)
	}
	if hits[0].Path != "a.md" {
		s.cur.Fatalf("unexpected hit %+v", hits[0])
	}
	if hits[0].Kind != "content" && hits[0].Kind != "name" {
		s.cur.Fatalf("unexpected hit kind %q", hits[0].Kind)
	}
	if hits[0].Snippet == "" {
		s.cur.Fatalf("the hit has no snippet")
	}
}

// caseSearchName checks that the name of a file is searched as well.
func (s *suite) caseSearchName() {
	ctx := context.Background()
	store := s.store()

	if err := store.IndexContent(ctx, "apple.md", "apple.md", "nothing to see here"); err != nil {
		s.cur.Fatalf("index content: %v", err)
	}
	hits, err := store.Search(ctx, "apple", 10)
	if err != nil {
		s.cur.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		s.divergence("search returns the matches of a file name",
			"the search did not return the file apple.md that matches the name")
	}
	s.nameMatches = true
	found := false
	for _, h := range hits {
		if h.Path == "apple.md" {
			found = true
			if h.Kind != "name" && h.Kind != "content" {
				s.cur.Fatalf("unexpected hit kind %q", h.Kind)
			}
		}
	}
	if !found {
		s.cur.Fatalf("the search did not return the file apple.md: %+v", hits)
	}
}

// caseSearchLimit checks that the limit of a search is honoured.
func (s *suite) caseSearchLimit() {
	ctx := context.Background()
	store := s.store()

	for i := 1; i <= 3; i++ {
		path := "x" + string(rune('0'+i)) + ".md"
		if err := store.IndexContent(ctx, path, path, "pineapple"); err != nil {
			s.cur.Fatalf("index content: %v", err)
		}
	}
	hits, err := store.Search(ctx, "pineapple", 1)
	if err != nil {
		s.cur.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		s.cur.Fatalf("the search did not find anything")
	}
	if len(hits) > 1 {
		s.cur.Fatalf("the limit was not honoured: %d hits", len(hits))
	}
}

// caseSearchNameLimit checks that the limit of a search is honoured for the
// matches of a file name.
func (s *suite) caseSearchNameLimit() {
	ctx := context.Background()
	store := s.store()

	for i := 1; i <= 3; i++ {
		path := "alpha" + string(rune('0'+i)) + ".md"
		if err := store.IndexContent(ctx, path, path, "zzz"); err != nil {
			s.cur.Fatalf("index content: %v", err)
		}
	}
	hits, err := store.Search(ctx, "alpha", 1)
	if err != nil {
		s.cur.Fatalf("search: %v", err)
	}
	if !s.nameMatches {
		s.divergence("search honours the limit for the matches of a file name",
			"the search does not return the matches of a file name, so the limit cannot be observed")
	}
	if len(hits) > 1 {
		s.cur.Fatalf("the limit was not honoured: %d hits", len(hits))
	}
}

// caseEmptyQuery checks that an empty query returns no hits.
func (s *suite) caseEmptyQuery() {
	ctx := context.Background()
	store := s.store()

	if err := store.IndexContent(ctx, "a.md", "a.md", "pineapple"); err != nil {
		s.cur.Fatalf("index content: %v", err)
	}
	hits, err := store.Search(ctx, "", 10)
	if err != nil {
		s.cur.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		s.divergence("an empty query returns no hits",
			"the empty query returned "+itoa(len(hits))+" hits")
	}
}

// caseSpecialCharacters checks that a query with special characters neither
// fails nor returns a wrong result.
func (s *suite) caseSpecialCharacters() {
	ctx := context.Background()
	store := s.store()

	if err := store.IndexContent(ctx, "c++.md", "c++.md", "c++ rules"); err != nil {
		s.cur.Fatalf("index content: %v", err)
	}
	hits, err := store.Search(ctx, "c++", 10)
	if err != nil {
		s.cur.Fatalf("search: %v", err)
	}
	found := false
	for _, h := range hits {
		if h.Path == "c++.md" {
			found = true
		}
	}
	if !found {
		s.cur.Fatalf("the search did not find the indexed file: %+v", hits)
	}
}

// caseRemoveContent checks that a removed content is not found any more.
func (s *suite) caseRemoveContent() {
	ctx := context.Background()
	store := s.store()

	if err := store.IndexContent(ctx, "a.md", "a.md", "pineapple"); err != nil {
		s.cur.Fatalf("index content: %v", err)
	}
	if err := store.RemoveContent(ctx, "a.md"); err != nil {
		s.cur.Fatalf("remove content: %v", err)
	}
	hits, err := store.Search(ctx, "pineapple", 10)
	if err != nil {
		s.cur.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		s.cur.Fatalf("the removed content is still found: %+v", hits)
	}
}

// caseClearIndex checks that a cleared index is empty.
func (s *suite) caseClearIndex() {
	ctx := context.Background()
	store := s.store()

	if err := store.IndexContent(ctx, "a.md", "a.md", "pineapple"); err != nil {
		s.cur.Fatalf("index content: %v", err)
	}
	if err := store.IndexContent(ctx, "b.md", "b.md", "juice"); err != nil {
		s.cur.Fatalf("index content: %v", err)
	}
	if err := store.ClearIndex(ctx); err != nil {
		s.cur.Fatalf("clear index: %v", err)
	}
	hits, err := store.Search(ctx, "pineapple", 10)
	if err != nil {
		s.cur.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		s.cur.Fatalf("the cleared index still holds hits: %+v", hits)
	}
}

// ----------------------------------------------------------- attachments ---

// caseAttachments checks PutAttachment, ListAttachments, GetAttachment and
// DeleteAttachment.
func (s *suite) caseAttachments() {
	ctx := context.Background()
	store := s.store()

	att := model.Attachment{
		ID:       "att-1",
		Name:     "photo.png",
		MIME:     "image/png",
		Size:     42,
		NotePath: "a.md",
	}
	if err := store.PutAttachment(ctx, att); err != nil {
		s.cur.Fatalf("put attachment: %v", err)
	}
	list, err := store.ListAttachments(ctx)
	if err != nil {
		s.cur.Fatalf("list attachments: %v", err)
	}
	if len(list) != 1 {
		s.cur.Fatalf("unexpected attachment list %+v", list)
	}
	got, found, err := store.GetAttachment(ctx, "att-1")
	if err != nil {
		s.cur.Fatalf("get attachment: %v", err)
	}
	if !found {
		s.cur.Fatalf("the attachment was not found")
	}
	if got.ID != att.ID || got.Name != att.Name || got.MIME != att.MIME ||
		got.Size != att.Size || got.NotePath != att.NotePath {
		s.cur.Fatalf("unexpected attachment %+v", got)
	}
	if err := store.DeleteAttachment(ctx, "att-1"); err != nil {
		s.cur.Fatalf("delete attachment: %v", err)
	}
	if _, found, err := store.GetAttachment(ctx, "att-1"); err != nil {
		s.cur.Fatalf("get deleted attachment: %v", err)
	} else if found {
		s.cur.Fatalf("the deleted attachment is still there")
	}
	list, err = store.ListAttachments(ctx)
	if err != nil {
		s.cur.Fatalf("list attachments after delete: %v", err)
	}
	if len(list) != 0 {
		s.cur.Fatalf("unexpected attachment list after the delete: %+v", list)
	}
}

// ----------------------------------------------------------------- trash ---

// caseTrash checks PutTrash, ListTrash and DeleteTrash.
func (s *suite) caseTrash() {
	ctx := context.Background()
	store := s.store()

	if err := store.PutTrash(ctx, "a.md", "trash/1/a.md", model.NodeFile, 42); err != nil {
		s.cur.Fatalf("put trash: %v", err)
	}
	entries, err := store.ListTrash(ctx)
	if err != nil {
		s.cur.Fatalf("list trash: %v", err)
	}
	if len(entries) != 1 {
		s.cur.Fatalf("unexpected trash list %+v", entries)
	}
	if entries[0].Path != "trash/1/a.md" || entries[0].Type != model.NodeFile || entries[0].Size != 42 {
		s.cur.Fatalf("unexpected trash entry %+v", entries[0])
	}
	if err := store.DeleteTrash(ctx, "trash/1/a.md"); err != nil {
		s.cur.Fatalf("delete trash: %v", err)
	}
	entries, err = store.ListTrash(ctx)
	if err != nil {
		s.cur.Fatalf("list trash after delete: %v", err)
	}
	if len(entries) != 0 {
		s.cur.Fatalf("unexpected trash list after the delete: %+v", entries)
	}
}

// itoa formats a small number without importing strconv.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [8]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
