package sqlitestore

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"noto/backend/internal/model"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	s, err := Open(context.Background(), filepath.Join(dir, "noto.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func node(path, name string, typ model.NodeType) model.Node {
	now := time.Now()
	return model.Node{
		Path:       path,
		Name:       name,
		Type:       typ,
		ParentPath: parentPath(path),
		Size:       int64(len(name)),
		Revision:   1,
		ModTime:    now,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}

func TestOpenCreatesSchema(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	for _, table := range []string{"notes", "notes_fts", "attachments", "trash"} {
		var name string
		err := s.DB().QueryRowContext(ctx,
			"SELECT name FROM sqlite_master WHERE name = ?", table).Scan(&name)
		if err != nil {
			t.Fatalf("table %s missing: %v", table, err)
		}
	}
	// The FTS5 virtual table only exists when the driver supports FTS5.
	var ftsTable string
	err := s.DB().QueryRowContext(ctx,
		"SELECT name FROM sqlite_master WHERE name = 'notes_fts_v'").Scan(&ftsTable)
	switch {
	case s.FTS5Available() && err != nil:
		t.Fatalf("fts5 reported as available but the virtual table is missing: %v", err)
	case !s.FTS5Available() && err == nil:
		t.Fatalf("fts5 reported as unavailable but the virtual table exists")
	}
	var version int
	if err := s.DB().QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		t.Fatalf("user_version: %v", err)
	}
	if version != schemaVersion {
		t.Fatalf("user_version = %d, want %d", version, schemaVersion)
	}
	var journal string
	if err := s.DB().QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journal); err != nil {
		t.Fatalf("journal_mode: %v", err)
	}
	if !strings.EqualFold(journal, "wal") {
		t.Fatalf("journal_mode = %q, want wal", journal)
	}
}

func TestOpenIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "noto.db")
	ctx := context.Background()

	s1, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	if err := s1.UpsertNote(ctx, node("a.md", "a.md", model.NodeFile)); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := s1.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// Re-opening must apply the migrations again without failing and must
	// keep the data.
	for i := 0; i < 2; i++ {
		s2, err := Open(ctx, path)
		if err != nil {
			t.Fatalf("re-open %d: %v", i, err)
		}
		if _, ok, err := s2.GetNote(ctx, "a.md"); err != nil || !ok {
			t.Fatalf("re-open %d lost data: ok=%v err=%v", i, ok, err)
		}
		if err := s2.Close(); err != nil {
			t.Fatalf("close %d: %v", i, err)
		}
	}
}

func TestOpenCreatesParentDirectory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "deeper", "noto.db")
	s, err := Open(context.Background(), path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("database file missing: %v", err)
	}
}

func TestNewWithInMemoryDB(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	db.SetMaxOpenConns(1)
	defer db.Close()
	s, err := New(context.Background(), db)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx := context.Background()
	if err := s.UpsertNote(ctx, node("mem.md", "mem.md", model.NodeFile)); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if _, ok, err := s.GetNote(ctx, "mem.md"); err != nil || !ok {
		t.Fatalf("get note: ok=%v err=%v", ok, err)
	}
}

func TestUpsertGetDeleteNote(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	n := node("journal/a.md", "a.md", model.NodeFile)
	n.Size = 42
	if err := s.UpsertNote(ctx, n); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	got, ok, err := s.GetNote(ctx, "journal/a.md")
	if err != nil || !ok {
		t.Fatalf("get: ok=%v err=%v", ok, err)
	}
	if got.Name != "a.md" || got.Type != model.NodeFile || got.ParentPath != "journal" || got.Size != 42 {
		t.Fatalf("unexpected node: %+v", got)
	}
	if got.CreatedAt.IsZero() || got.UpdatedAt.IsZero() {
		t.Fatalf("timestamps not set: %+v", got)
	}
	if got.CreatedAt.UnixMilli() != got.CreatedAt.UTC().UnixMilli() {
		t.Fatalf("timestamp is not unix milliseconds: %v", got.CreatedAt)
	}

	// Upsert replaces the row.
	n.Size = 43
	n.Revision = 2
	if err := s.UpsertNote(ctx, n); err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	got, _, err = s.GetNote(ctx, "journal/a.md")
	if err != nil {
		t.Fatalf("get after update: %v", err)
	}
	if got.Size != 43 || got.Revision != 2 {
		t.Fatalf("upsert did not update: %+v", got)
	}

	if err := s.DeleteNote(ctx, "journal/a.md"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, ok, err := s.GetNote(ctx, "journal/a.md"); err != nil || ok {
		t.Fatalf("note still present: ok=%v err=%v", ok, err)
	}
}

func TestListNotes(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	for _, p := range []string{"a.md", "journal/b.md", "journal/2026/c.md"} {
		if err := s.UpsertNote(ctx, node(p, baseName(p), model.NodeFile)); err != nil {
			t.Fatalf("upsert %s: %v", p, err)
		}
	}
	if err := s.UpsertNote(ctx, node("journal", "journal", model.NodeFolder)); err != nil {
		t.Fatalf("upsert folder: %v", err)
	}
	list, err := s.ListNotes(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 4 {
		t.Fatalf("len(list) = %d, want 4: %+v", len(list), list)
	}
	found := false
	for _, n := range list {
		if n.Path == "journal/2026/c.md" && n.Type == model.NodeFile {
			found = true
		}
	}
	if !found {
		t.Fatalf("nested note missing from list: %+v", list)
	}
}

func TestMoveNote(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	if err := s.UpsertNote(ctx, node("journal/a.md", "a.md", model.NodeFile)); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := s.IndexContent(ctx, "journal/a.md", "a.md", "content of a"); err != nil {
		t.Fatalf("index: %v", err)
	}
	if err := s.MoveNote(ctx, "journal/a.md", "archive/a.md"); err != nil {
		t.Fatalf("move: %v", err)
	}
	if _, ok, _ := s.GetNote(ctx, "journal/a.md"); ok {
		t.Fatal("old path still present")
	}
	got, ok, err := s.GetNote(ctx, "archive/a.md")
	if err != nil || !ok {
		t.Fatalf("new path missing: ok=%v err=%v", ok, err)
	}
	if got.ParentPath != "archive" || got.Name != "a.md" {
		t.Fatalf("unexpected node after move: %+v", got)
	}
	// The index row moved as well.
	hits, err := s.Search(ctx, "content", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 || hits[0].Path != "archive/a.md" {
		t.Fatalf("index not moved: %+v", hits)
	}
}

func TestMoveFolderMovesDescendants(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	files := []string{"journal/a.md", "journal/2026/b.md", "journal/2026/c.md"}
	for _, p := range files {
		if err := s.UpsertNote(ctx, node(p, baseName(p), model.NodeFile)); err != nil {
			t.Fatalf("upsert %s: %v", p, err)
		}
		if err := s.IndexContent(ctx, p, baseName(p), "body of "+p); err != nil {
			t.Fatalf("index %s: %v", p, err)
		}
	}
	if err := s.UpsertNote(ctx, node("journal", "journal", model.NodeFolder)); err != nil {
		t.Fatalf("upsert folder: %v", err)
	}
	if err := s.MoveNote(ctx, "journal", "archive/journal"); err != nil {
		t.Fatalf("move folder: %v", err)
	}
	list, err := s.ListNotes(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, n := range list {
		if strings.HasPrefix(n.Path, "journal") {
			t.Fatalf("old subtree still present: %+v", n)
		}
	}
	if len(list) != 4 {
		t.Fatalf("len(list) = %d, want 4: %+v", len(list), list)
	}
	for _, want := range []string{"archive/journal/a.md", "archive/journal/2026/b.md", "archive/journal/2026/c.md"} {
		if _, ok, err := s.GetNote(ctx, want); err != nil || !ok {
			t.Fatalf("missing %s: ok=%v err=%v", want, ok, err)
		}
	}
	// Index rows moved too.
	hits, err := s.Search(ctx, "body", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 3 {
		t.Fatalf("expected 3 hits, got %d: %+v", len(hits), hits)
	}
	for _, h := range hits {
		if !strings.HasPrefix(h.Path, "archive/journal/") {
			t.Fatalf("index row not moved: %+v", h)
		}
	}
}

func TestSearchByName(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	if err := s.IndexContent(ctx, "notes/idea.md", "idea.md", "some body text"); err != nil {
		t.Fatalf("index: %v", err)
	}
	hits, err := s.Search(ctx, "idea", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatal("no hits")
	}
	if hits[0].Kind != "name" {
		t.Fatalf("kind = %q, want name", hits[0].Kind)
	}
	if hits[0].Path != "notes/idea.md" {
		t.Fatalf("path = %q", hits[0].Path)
	}
	if hits[0].Snippet == "" {
		t.Fatal("snippet is empty")
	}
	if !strings.Contains(hits[0].Snippet, "idea") {
		t.Fatalf("snippet does not contain the term: %q", hits[0].Snippet)
	}
}

func TestSearchByContent(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	body := "The quick brown fox jumps over the lazy dog and keeps running for a very long time indeed."
	if err := s.IndexContent(ctx, "notes/other.md", "other.md", body); err != nil {
		t.Fatalf("index: %v", err)
	}
	hits, err := s.Search(ctx, "brown fox", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("expected 1 hit, got %d: %+v", len(hits), hits)
	}
	if hits[0].Kind != "content" {
		t.Fatalf("kind = %q, want content", hits[0].Kind)
	}
	if !strings.Contains(hits[0].Snippet, "brown") {
		t.Fatalf("snippet missing term: %q", hits[0].Snippet)
	}
	if len(hits[0].Snippet) > maxSnippetLen+16 {
		t.Fatalf("snippet too long (%d): %q", len(hits[0].Snippet), hits[0].Snippet)
	}
}

func TestSearchEmptyQuery(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	if err := s.IndexContent(ctx, "a.md", "a.md", "hello world"); err != nil {
		t.Fatalf("index: %v", err)
	}
	for _, q := range []string{"", "   ", "*", "-", "\""} {
		hits, err := s.Search(ctx, q, 10)
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		if len(hits) != 0 {
			t.Fatalf("search %q returned %d hits", q, len(hits))
		}
	}
}

func TestSearchSpecialCharacters(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	if err := s.IndexContent(ctx, "a.md", "a.md", "alpha beta gamma"); err != nil {
		t.Fatalf("index: %v", err)
	}
	queries := []string{
		`"`, `*`, `-`, `NEAR`, `OR`, `AND`, `alpha OR beta`, `alpha NEAR beta`,
		`"alpha`, `beta*`, `alpha OR`, `()`, `a AND b OR c`, `^`, `:`, `*:*`,
	}
	for _, q := range queries {
		hits, err := s.Search(ctx, q, 10)
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		if q == "alpha OR beta" {
			if len(hits) == 0 {
				t.Fatalf("search %q returned no hits", q)
			}
		}
	}
	// A query that must not match anything but must not fail either.
	hits, err := s.Search(ctx, "zzz", 10)
	if err != nil {
		t.Fatalf("search zzz: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("expected no hits, got %+v", hits)
	}
}

func TestRemoveContentRemovesFromIndex(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	if err := s.IndexContent(ctx, "a.md", "a.md", "searchable text"); err != nil {
		t.Fatalf("index: %v", err)
	}
	if hits, _ := s.Search(ctx, "searchable", 10); len(hits) != 1 {
		t.Fatalf("expected 1 hit before removal, got %d", len(hits))
	}
	if err := s.RemoveContent(ctx, "a.md"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if hits, _ := s.Search(ctx, "searchable", 10); len(hits) != 0 {
		t.Fatalf("expected 0 hits after removal, got %d", len(hits))
	}
	// The row must be gone from the plain table as well.
	var count int
	if err := s.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM notes_fts WHERE path = ?", "a.md").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("notes_fts still holds %d rows", count)
	}
}

func TestClearIndex(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	if err := s.IndexContent(ctx, "a.md", "a.md", "one two three"); err != nil {
		t.Fatalf("index: %v", err)
	}
	if err := s.ClearIndex(ctx); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if hits, _ := s.Search(ctx, "three", 10); len(hits) != 0 {
		t.Fatalf("expected no hits after clear, got %d", len(hits))
	}
}

func TestAttachmentsCRUD(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	now := time.Now()
	a := model.Attachment{
		ID:        "abc123",
		Name:      "picture.png",
		MIME:      "image/png",
		Size:      2048,
		NotePath:  "a.md",
		CreatedAt: now,
	}
	if err := s.PutAttachment(ctx, a); err != nil {
		t.Fatalf("put: %v", err)
	}
	got, ok, err := s.GetAttachment(ctx, "abc123")
	if err != nil || !ok {
		t.Fatalf("get: ok=%v err=%v", ok, err)
	}
	if got.Name != a.Name || got.MIME != a.MIME || got.Size != a.Size || got.NotePath != a.NotePath {
		t.Fatalf("unexpected attachment: %+v", got)
	}
	if got.CreatedAt.UnixMilli() != now.UTC().UnixMilli() {
		t.Fatalf("created_at mismatch: %v vs %v", got.CreatedAt, now)
	}

	// Upsert.
	a.Size = 4096
	if err := s.PutAttachment(ctx, a); err != nil {
		t.Fatalf("put again: %v", err)
	}
	got, _, _ = s.GetAttachment(ctx, "abc123")
	if got.Size != 4096 {
		t.Fatalf("size not updated: %+v", got)
	}

	list, err := s.ListAttachments(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("len(list) = %d, want 1", len(list))
	}

	if err := s.DeleteAttachment(ctx, "abc123"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, ok, _ := s.GetAttachment(ctx, "abc123"); ok {
		t.Fatal("attachment still present")
	}
	list, _ = s.ListAttachments(ctx)
	if len(list) != 0 {
		t.Fatalf("expected empty list, got %d", len(list))
	}
}

func TestTrashCRUD(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	if err := s.PutTrash(ctx, "journal/a.md", "trash/1/journal/a.md", model.NodeFile, 12); err != nil {
		t.Fatalf("put trash: %v", err)
	}
	list, err := s.ListTrash(ctx)
	if err != nil {
		t.Fatalf("list trash: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("len(list) = %d, want 1", len(list))
	}
	e := list[0]
	if e.Path != "trash/1/journal/a.md" {
		t.Fatalf("path = %q", e.Path)
	}
	if e.Name != "a.md" {
		t.Fatalf("name = %q", e.Name)
	}
	if e.Type != model.NodeFile {
		t.Fatalf("type = %q", e.Type)
	}
	if e.Size != 12 {
		t.Fatalf("size = %d", e.Size)
	}

	if err := s.DeleteTrash(ctx, "trash/1/journal/a.md"); err != nil {
		t.Fatalf("delete trash: %v", err)
	}
	list, _ = s.ListTrash(ctx)
	if len(list) != 0 {
		t.Fatalf("expected empty trash, got %d", len(list))
	}
}

func TestClose(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(context.Background(), filepath.Join(dir, "noto.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	// Operations after Close must fail, not panic.
	if _, err := s.ListNotes(context.Background()); err == nil {
		t.Fatal("expected error after close")
	}
	// Closing twice must not panic.
	if err := s.Close(); err != nil && err != sql.ErrConnDone {
		t.Logf("second close returned: %v", err)
	}
}

func TestFTS5AvailableFlag(t *testing.T) {
	s := openTestStore(t)
	// The modernc.org/sqlite driver ships FTS5; the flag must be reported
	// consistently and the search must work either way.
	t.Logf("fts5 available: %v", s.FTS5Available())
	if !s.FTS5Available() {
		t.Skip("fts5 unavailable in this build")
	}
}

func TestConcurrentUse(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	done := make(chan error, 16)
	for i := 0; i < 8; i++ {
		go func(i int) {
			p := "note" + string(rune('a'+i)) + ".md"
			if err := s.UpsertNote(ctx, node(p, p, model.NodeFile)); err != nil {
				done <- err
				return
			}
			if err := s.IndexContent(ctx, p, p, "shared content "+p); err != nil {
				done <- err
				return
			}
			if _, err := s.Search(ctx, "shared", 20); err != nil {
				done <- err
				return
			}
			if _, err := s.ListNotes(ctx); err != nil {
				done <- err
				return
			}
			done <- nil
		}(i)
	}
	for i := 0; i < 8; i++ {
		if err := <-done; err != nil {
			t.Fatalf("concurrent use: %v", err)
		}
	}
}
