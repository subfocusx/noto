package sqlitestore_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"noto/backend/internal/model"
)

// TestMigrationFillsTheCreationTime makes sure that the notes of a database
// that was written before the creation time was filled get one.
//
// The fill is idempotent: it only touches the rows whose created_at is still
// zero, so opening the database again does not change anything.
func TestMigrationFillsTheCreationTime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "noto.db")
	ctx := context.Background()

	store := openSchemaStore(t, path)

	// A note of the old format: no creation time, a modification time.
	updated := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	if _, err := store.DB().Exec(
		"INSERT INTO notes (path, name, type, parent_path, size, revision, mod_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		"old.md", "old.md", string(model.NodeFile), "", 10, 1, updated.UnixMilli(), 0, updated.UnixMilli(),
	); err != nil {
		t.Fatalf("insert the old note: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close the store: %v", err)
	}

	// Opening the database fills the creation time.
	store = openSchemaStore(t, path)
	defer store.Close()

	node, found, err := store.GetNote(ctx, "old.md")
	if err != nil {
		t.Fatalf("get the note: %v", err)
	}
	if !found {
		t.Fatalf("the note is missing")
	}
	if node.CreatedAt.IsZero() {
		t.Fatalf("the creation time was not filled: %+v", node)
	}
	if !node.CreatedAt.Equal(updated) {
		t.Fatalf("unexpected creation time %v, want %v", node.CreatedAt, updated)
	}

	// The fill is idempotent: the creation time does not change when the
	// database is opened again.
	filled := node.CreatedAt
	if err := store.Close(); err != nil {
		t.Fatalf("close the store: %v", err)
	}
	store = openSchemaStore(t, path)
	defer store.Close()

	node, found, err = store.GetNote(ctx, "old.md")
	if err != nil {
		t.Fatalf("get the note again: %v", err)
	}
	if !found {
		t.Fatalf("the note is missing")
	}
	if !node.CreatedAt.Equal(filled) {
		t.Fatalf("the creation time changed: %v -> %v", filled, node.CreatedAt)
	}
}

// TestUpsertNoteKeepsTheCreationTime makes sure that the creation time of a
// note never changes.
func TestUpsertNoteKeepsTheCreationTime(t *testing.T) {
	ctx := context.Background()
	store := openSchemaStore(t, filepath.Join(t.TempDir(), "noto.db"))
	defer store.Close()

	created := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	node := model.Node{
		Path:      "a.md",
		Name:      "a.md",
		Type:      model.NodeFile,
		Revision:  1,
		CreatedAt: created,
		UpdatedAt: created,
	}
	if err := store.UpsertNote(ctx, node); err != nil {
		t.Fatalf("upsert the note: %v", err)
	}

	// An update that carries no creation time keeps the stored one.
	node.Revision = 2
	node.UpdatedAt = created.Add(time.Hour)
	node.CreatedAt = time.Time{}
	if err := store.UpsertNote(ctx, node); err != nil {
		t.Fatalf("upsert the note again: %v", err)
	}

	stored, found, err := store.GetNote(ctx, "a.md")
	if err != nil {
		t.Fatalf("get the note: %v", err)
	}
	if !found {
		t.Fatalf("the note is missing")
	}
	if !stored.CreatedAt.Equal(created) {
		t.Fatalf("the creation time changed: %v, want %v", stored.CreatedAt, created)
	}
	if stored.Revision != 2 {
		t.Fatalf("unexpected revision %d", stored.Revision)
	}
}

// TestNoteCarriesItsCreationTime checks that the creation time of a note is
// part of the JSON model, so that the interface can show it.
func TestNoteCarriesItsCreationTime(t *testing.T) {
	ctx := context.Background()
	store := openSchemaStore(t, filepath.Join(t.TempDir(), "noto.db"))
	defer store.Close()

	created := time.Date(2026, 5, 6, 7, 8, 9, 0, time.UTC)
	node := model.Node{
		Path:      "a.md",
		Name:      "a.md",
		Type:      model.NodeFile,
		CreatedAt: created,
		UpdatedAt: created,
	}
	if err := store.UpsertNote(ctx, node); err != nil {
		t.Fatalf("upsert the note: %v", err)
	}

	stored, found, err := store.GetNote(ctx, "a.md")
	if err != nil {
		t.Fatalf("get the note: %v", err)
	}
	if !found {
		t.Fatalf("the note is missing")
	}
	if !stored.CreatedAt.Equal(created) {
		t.Fatalf("unexpected creation time %v, want %v", stored.CreatedAt, created)
	}
}
