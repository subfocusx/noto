package sqlitestore_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite" // SQLite driver (pure Go).

	"noto/backend/internal/model"
	"noto/backend/internal/sqlitestore"
)

// schemaUserVersion is the schema version of the current database format.
// A database with a greater version must be rejected.
const schemaUserVersion = 2

// openSchemaStore opens a store in a temporary file.
func openSchemaStore(t *testing.T, path string) *sqlitestore.Store {
	t.Helper()
	store, err := sqlitestore.Open(context.Background(), path)
	if err != nil {
		t.Fatalf("open the store: %v", err)
	}
	return store
}

// readUserVersion reads the user_version pragma of a database.
func readUserVersion(t *testing.T, store *sqlitestore.Store) int {
	t.Helper()
	var version int
	if err := store.DB().QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	return version
}

// schemaObjects returns the sorted names of the tables and the indexes of a
// database.
func schemaObjects(t *testing.T, store *sqlitestore.Store) []string {
	t.Helper()
	rows, err := store.DB().Query("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
	if err != nil {
		t.Fatalf("read sqlite_master: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var typ, name string
		if err := rows.Scan(&typ, &name); err != nil {
			t.Fatalf("scan sqlite_master: %v", err)
		}
		out = append(out, typ+" "+name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate sqlite_master: %v", err)
	}
	return out
}

// seedSchemaData writes a note, an attachment and a trash entry into a store.
func seedSchemaData(t *testing.T, store *sqlitestore.Store) {
	t.Helper()
	ctx := context.Background()
	node := model.Node{
		ID:         "id-1",
		Name:       "a.md",
		Path:       "a.md",
		Type:       model.NodeFile,
		ParentPath: "",
		Size:       5,
		Revision:   2,
	}
	if err := store.UpsertNote(ctx, node); err != nil {
		t.Fatalf("upsert note: %v", err)
	}
	if err := store.IndexContent(ctx, "a.md", "a.md", "pineapple"); err != nil {
		t.Fatalf("index content: %v", err)
	}
	att := model.Attachment{ID: "att-1", Name: "photo.png", MIME: "image/png", Size: 42, NotePath: "a.md"}
	if err := store.PutAttachment(ctx, att); err != nil {
		t.Fatalf("put attachment: %v", err)
	}
	if err := store.PutTrash(ctx, "b.md", "trash/1/b.md", model.NodeFile, 7); err != nil {
		t.Fatalf("put trash: %v", err)
	}
}

// assertSchemaData makes sure that the seeded data is still there.
func assertSchemaData(t *testing.T, store *sqlitestore.Store) {
	t.Helper()
	ctx := context.Background()

	node, found, err := store.GetNote(ctx, "a.md")
	if err != nil {
		t.Fatalf("get note: %v", err)
	}
	if !found {
		t.Fatalf("the note is missing")
	}
	if node.Name != "a.md" || node.Type != model.NodeFile || node.Size != 5 || node.Revision != 2 {
		t.Fatalf("unexpected node %+v", node)
	}

	att, found, err := store.GetAttachment(ctx, "att-1")
	if err != nil {
		t.Fatalf("get attachment: %v", err)
	}
	if !found {
		t.Fatalf("the attachment is missing")
	}
	if att.Name != "photo.png" || att.MIME != "image/png" || att.Size != 42 || att.NotePath != "a.md" {
		t.Fatalf("unexpected attachment %+v", att)
	}

	trash, err := store.ListTrash(ctx)
	if err != nil {
		t.Fatalf("list trash: %v", err)
	}
	if len(trash) != 1 {
		t.Fatalf("unexpected trash list %+v", trash)
	}
	if trash[0].Path != "trash/1/b.md" || trash[0].Type != model.NodeFile || trash[0].Size != 7 {
		t.Fatalf("unexpected trash entry %+v", trash[0])
	}

	hits, err := store.Search(ctx, "pineapple", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatalf("the search index was lost")
	}
}

// TestSchemaCompatibilityKeepsTheData makes sure that a database of the
// current schema keeps its data when it is closed and opened again.
func TestSchemaCompatibilityKeepsTheData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "noto.db")
	ctx := context.Background()

	store := openSchemaStore(t, path)
	if got := readUserVersion(t, store); got != schemaUserVersion {
		t.Fatalf("unexpected user_version %d (want %d)", got, schemaUserVersion)
	}
	seedSchemaData(t, store)
	if err := store.Close(); err != nil {
		t.Fatalf("close the store: %v", err)
	}

	store = openSchemaStore(t, path)
	defer store.Close()
	if got := readUserVersion(t, store); got != schemaUserVersion {
		t.Fatalf("unexpected user_version %d after the reopen (want %d)", got, schemaUserVersion)
	}
	assertSchemaData(t, store)

	// The search index must still be usable after the reopen.
	hits, err := store.Search(ctx, "pineapple", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatalf("the search index was lost")
	}
}

// TestSchemaCompatibilityIsIdempotent makes sure that opening the same
// database again does not change the schema and does not lose the data.
func TestSchemaCompatibilityIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "noto.db")

	store := openSchemaStore(t, path)
	seedSchemaData(t, store)
	before := schemaObjects(t, store)
	if err := store.Close(); err != nil {
		t.Fatalf("close the store: %v", err)
	}

	for round := 1; round <= 3; round++ {
		store = openSchemaStore(t, path)
		if got := readUserVersion(t, store); got != schemaUserVersion {
			t.Fatalf("round %d: unexpected user_version %d (want %d)", round, got, schemaUserVersion)
		}
		after := schemaObjects(t, store)
		if len(after) != len(before) {
			t.Fatalf("round %d: the schema changed: %v -> %v", round, before, after)
		}
		for i := range before {
			if before[i] != after[i] {
				t.Fatalf("round %d: the schema changed: %v -> %v", round, before, after)
			}
		}
		assertSchemaData(t, store)
		if err := store.Close(); err != nil {
			t.Fatalf("round %d: close the store: %v", round, err)
		}
	}
}

// TestSchemaCompatibilityMigratesVersionOne makes sure that a database of the
// schema version 1 is opened, migrated to the current version and keeps its
// data.
//
// The migration is additive: the table of the derived properties is created,
// everything else stays as it was.
func TestSchemaCompatibilityMigratesVersionOne(t *testing.T) {
	path := filepath.Join(t.TempDir(), "noto.db")
	ctx := context.Background()

	// Build a database of the version 1: the current tables, but without the
	// table of the derived properties.
	store := openSchemaStore(t, path)
	seedSchemaData(t, store)
	if _, err := store.DB().Exec("DROP TABLE note_props"); err != nil {
		t.Fatalf("drop the table of the properties: %v", err)
	}
	if _, err := store.DB().Exec("PRAGMA user_version = 1"); err != nil {
		t.Fatalf("set user_version: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close the store: %v", err)
	}

	// Opening the database migrates it.
	store = openSchemaStore(t, path)
	defer store.Close()
	if got := readUserVersion(t, store); got != schemaUserVersion {
		t.Fatalf("unexpected user_version %d after the migration (want %d)", got, schemaUserVersion)
	}
	assertSchemaData(t, store)

	// The table of the derived properties exists and is usable.
	props := model.NoteProps{Path: "a.md", Name: "a.md", Title: "Pineapple", Tags: []string{"work"}}
	if err := store.UpsertNoteProps(ctx, props); err != nil {
		t.Fatalf("upsert the properties: %v", err)
	}
	stored, found, err := store.GetNoteProps(ctx, "a.md")
	if err != nil {
		t.Fatalf("get the properties: %v", err)
	}
	if !found {
		t.Fatalf("the properties are missing")
	}
	if stored.Title != "Pineapple" || len(stored.Tags) != 1 || stored.Tags[0] != "work" {
		t.Fatalf("unexpected properties %+v", stored)
	}
}

// TestSchemaCompatibilityRejectsANewerVersion makes sure that a database of
// a future schema version is rejected with a readable error instead of
// corrupting the data or panicking.
func TestSchemaCompatibilityRejectsANewerVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "noto.db")

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open the database: %v", err)
	}
	if _, err := db.Exec("CREATE TABLE future_schema (id INTEGER PRIMARY KEY)"); err != nil {
		t.Fatalf("create the table: %v", err)
	}
	if _, err := db.Exec("PRAGMA user_version = 999"); err != nil {
		t.Fatalf("set user_version: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close the database: %v", err)
	}

	store, err := sqlitestore.Open(context.Background(), path)
	if err == nil {
		_ = store.Close()
		t.Fatalf("the store accepted a database of a newer schema version")
	}
	if !strings.Contains(err.Error(), "newer than supported version") {
		t.Fatalf("unexpected error %q", err)
	}
	if !strings.Contains(err.Error(), "999") {
		t.Fatalf("the error does not mention the version of the database: %q", err)
	}

	// The database must not have been touched by the failed open.
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open the database again: %v", err)
	}
	defer db.Close()
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != 999 {
		t.Fatalf("the user_version was changed to %d", version)
	}
}
