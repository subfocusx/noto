package notes_test

import (
	"context"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// TestChildrenAreListedPageByPage checks the paged listing of the children of
// a folder: the pages follow each other and the last one has no cursor.
func TestChildrenAreListedPageByPage(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFolder(ctx, "", "Journal"); err != nil {
		t.Fatalf("create the folder: %v", err)
	}
	for _, name := range []string{"a", "b", "c", "d", "e"} {
		if _, err := svc.CreateFile(ctx, "Journal", name); err != nil {
			t.Fatalf("create the file %q: %v", name, err)
		}
	}

	// The first page holds two children and a cursor.
	page, err := svc.Children(ctx, "Journal", "", 2)
	if err != nil {
		t.Fatalf("list the children: %v", err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("unexpected page %+v", page)
	}
	if page.Items[0].Path != "Journal/a.md" || page.Items[1].Path != "Journal/b.md" {
		t.Fatalf("unexpected page %+v", page)
	}
	if page.NextCursor == "" {
		t.Fatalf("the page has no cursor: %+v", page)
	}

	// The second page continues after the cursor.
	page, err = svc.Children(ctx, "Journal", page.NextCursor, 2)
	if err != nil {
		t.Fatalf("list the children again: %v", err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("unexpected page %+v", page)
	}
	if page.Items[0].Path != "Journal/c.md" || page.Items[1].Path != "Journal/d.md" {
		t.Fatalf("unexpected page %+v", page)
	}
	if page.NextCursor == "" {
		t.Fatalf("the page has no cursor: %+v", page)
	}

	// The last page holds the rest and has no cursor.
	page, err = svc.Children(ctx, "Journal", page.NextCursor, 2)
	if err != nil {
		t.Fatalf("list the last page: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].Path != "Journal/e.md" {
		t.Fatalf("unexpected page %+v", page)
	}
	if page.NextCursor != "" {
		t.Fatalf("the last page has a cursor: %+v", page)
	}

	// A limit of zero means the default limit, never an empty page.
	page, err = svc.Children(ctx, "Journal", "", 0)
	if err != nil {
		t.Fatalf("list the children without a limit: %v", err)
	}
	if len(page.Items) != 5 {
		t.Fatalf("unexpected page %+v", page)
	}
}

// TestChildrenOfTheRoot checks that the root of the notes is a folder like
// any other one.
func TestChildrenOfTheRoot(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create the file: %v", err)
	}
	if _, err := svc.CreateFolder(ctx, "", "Journal"); err != nil {
		t.Fatalf("create the folder: %v", err)
	}

	page, err := svc.Children(ctx, "", "", 10)
	if err != nil {
		t.Fatalf("list the children of the root: %v", err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("unexpected page %+v", page)
	}
	if page.Items[0].Path != "Journal" || page.Items[1].Path != "note.md" {
		t.Fatalf("unexpected page %+v", page)
	}
}

// TestChildrenOfAnInvalidFolder checks the error of a parent that is not a
// path of the notes.
func TestChildrenOfAnInvalidFolder(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.Children(ctx, "../escape", "", 10); notes.Code(err) != notes.CodeInvalidPath {
		t.Fatalf("expected invalid_path, got %q (%v)", notes.Code(err), err)
	}
}
