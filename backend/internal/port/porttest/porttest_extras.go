package porttest

import (
	"context"

	"noto/backend/internal/model"
)

// The cases of the conformance suite that cover the version history, the cache
// of the derived properties, the paged listing and the text of the
// attachments.

// caseVersions checks AppendVersion, ListVersions and GetVersion.
func (s *suite) caseVersions() {
	ctx := context.Background()
	store := s.store()

	if err := store.AppendVersion(ctx, model.NoteVersion{Path: "a.md", Revision: 1, Title: "One", Content: "first"}); err != nil {
		s.cur.Fatalf("append the version 1: %v", err)
	}
	if err := store.AppendVersion(ctx, model.NoteVersion{Path: "a.md", Revision: 2, Title: "Two", Content: "second"}); err != nil {
		s.cur.Fatalf("append the version 2: %v", err)
	}

	versions, err := store.ListVersions(ctx, "a.md")
	if err != nil {
		s.cur.Fatalf("list the versions: %v", err)
	}
	if len(versions) != 2 {
		s.cur.Fatalf("unexpected version list %+v", versions)
	}
	if versions[0].Revision != 1 || versions[1].Revision != 2 {
		s.cur.Fatalf("the versions are not ordered by revision: %+v", versions)
	}
	if versions[1].Content != "second" || versions[1].Title != "Two" {
		s.cur.Fatalf("unexpected version %+v", versions[1])
	}

	got, found, err := store.GetVersion(ctx, "a.md", 1)
	if err != nil {
		s.cur.Fatalf("get the version: %v", err)
	}
	if !found || got.Content != "first" {
		s.cur.Fatalf("unexpected version %+v", got)
	}

	if _, found, err := store.GetVersion(ctx, "a.md", 99); err != nil {
		s.cur.Fatalf("get a missing version: %v", err)
	} else if found {
		s.cur.Fatalf("a missing version was found")
	}

	// The history of another note is empty.
	versions, err = store.ListVersions(ctx, "b.md")
	if err != nil {
		s.cur.Fatalf("list the versions of another note: %v", err)
	}
	if len(versions) != 0 {
		s.cur.Fatalf("unexpected version list %+v", versions)
	}
}

// caseDerivedProps checks PutDerivedProps, GetDerivedProps,
// MarkDerivedPropsStale and DeleteDerivedProps.
func (s *suite) caseDerivedProps() {
	ctx := context.Background()
	store := s.store()

	row := model.DerivedProps{
		Path:    "a.md",
		Derived: []byte(`{"title":"Alpha"}`),
	}
	if err := store.PutDerivedProps(ctx, row); err != nil {
		s.cur.Fatalf("put the derived properties: %v", err)
	}

	got, found, err := store.GetDerivedProps(ctx, "a.md")
	if err != nil {
		s.cur.Fatalf("get the derived properties: %v", err)
	}
	if !found {
		s.cur.Fatalf("the derived properties were not found")
	}
	if string(got.Derived) != string(row.Derived) {
		s.cur.Fatalf("unexpected derived properties %+v", got)
	}
	if got.Stale {
		s.cur.Fatalf("a fresh row is stale: %+v", got)
	}

	// The invalidation marks the row as stale without touching its content.
	if err := store.MarkDerivedPropsStale(ctx, "a.md"); err != nil {
		s.cur.Fatalf("mark the derived properties as stale: %v", err)
	}
	got, found, err = store.GetDerivedProps(ctx, "a.md")
	if err != nil {
		s.cur.Fatalf("get the derived properties again: %v", err)
	}
	if !found || !got.Stale {
		s.cur.Fatalf("the row was not marked as stale: %+v", got)
	}

	// A recomputation replaces the row and clears the flag.
	row.Derived = []byte(`{"title":"Beta"}`)
	row.Stale = false
	if err := store.PutDerivedProps(ctx, row); err != nil {
		s.cur.Fatalf("put the derived properties again: %v", err)
	}
	got, found, err = store.GetDerivedProps(ctx, "a.md")
	if err != nil {
		s.cur.Fatalf("get the derived properties once more: %v", err)
	}
	if !found || got.Stale || string(got.Derived) != string(row.Derived) {
		s.cur.Fatalf("the row was not refreshed: %+v", got)
	}

	if err := store.DeleteDerivedProps(ctx, "a.md"); err != nil {
		s.cur.Fatalf("delete the derived properties: %v", err)
	}
	if _, found, err := store.GetDerivedProps(ctx, "a.md"); err != nil {
		s.cur.Fatalf("get the deleted derived properties: %v", err)
	} else if found {
		s.cur.Fatalf("the deleted derived properties are still there")
	}
}

// casePagedChildren checks ListChildrenPaged.
func (s *suite) casePagedChildren() {
	ctx := context.Background()
	store := s.store()

	for _, name := range []string{"a.md", "b.md", "c.md", "d.md"} {
		if err := store.UpsertNote(ctx, model.Node{Path: name, Name: name, Type: model.NodeFile}); err != nil {
			s.cur.Fatalf("upsert note %q: %v", name, err)
		}
	}
	if err := store.UpsertNote(ctx, model.Node{Path: "dir/x.md", Name: "x.md", Type: model.NodeFile, ParentPath: "dir"}); err != nil {
		s.cur.Fatalf("upsert the child: %v", err)
	}

	// The first page holds two children and a cursor.
	page, err := store.ListChildrenPaged(ctx, "", "", 2)
	if err != nil {
		s.cur.Fatalf("list the children: %v", err)
	}
	if len(page.Items) != 2 {
		s.cur.Fatalf("unexpected page %+v", page)
	}
	if page.Items[0].Path != "a.md" || page.Items[1].Path != "b.md" {
		s.cur.Fatalf("unexpected page %+v", page)
	}
	if page.NextCursor == "" {
		s.cur.Fatalf("the page has no cursor: %+v", page)
	}

	// The second page continues after the cursor.
	page, err = store.ListChildrenPaged(ctx, "", page.NextCursor, 2)
	if err != nil {
		s.cur.Fatalf("list the children again: %v", err)
	}
	if len(page.Items) != 2 {
		s.cur.Fatalf("unexpected page %+v", page)
	}
	if page.Items[0].Path != "c.md" || page.Items[1].Path != "d.md" {
		s.cur.Fatalf("unexpected page %+v", page)
	}
	if page.NextCursor != "" {
		s.cur.Fatalf("the last page has a cursor: %+v", page)
	}

	// The children of a folder are the notes of the folder.
	page, err = store.ListChildrenPaged(ctx, "dir", "", 10)
	if err != nil {
		s.cur.Fatalf("list the children of the folder: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].Path != "dir/x.md" {
		s.cur.Fatalf("unexpected page %+v", page)
	}
}

// caseAttachmentText checks IndexAttachmentText and the search of the text of
// the attachments.
func (s *suite) caseAttachmentText() {
	ctx := context.Background()
	store := s.store()

	if err := store.UpsertNote(ctx, model.Node{Path: "a.md", Name: "a.md", Type: model.NodeFile}); err != nil {
		s.cur.Fatalf("upsert note: %v", err)
	}
	if err := store.IndexAttachmentText(ctx, "att-1", "a.md", "notes.txt", "the pineapple is in the attachment"); err != nil {
		s.cur.Fatalf("index the text of the attachment: %v", err)
	}

	hits, err := store.Search(ctx, "pineapple", 10)
	if err != nil {
		s.cur.Fatalf("search: %v", err)
	}
	found := false
	for _, h := range hits {
		if h.Path == "a.md" {
			found = true
		}
	}
	if !found {
		s.divergence("the text of the attachments is searchable",
			"the search did not find the note of the attachment that matches")
	}
}
