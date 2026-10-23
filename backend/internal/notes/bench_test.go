package notes_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite" // SQLite driver (pure Go).

	"noto/backend/internal/config"
	"noto/backend/internal/notes"
	"noto/backend/internal/sqlitestore"
)

// benchEnv is a ready to use notes service with a real SQLite store and a
// populated notes directory. The benchmarks use it so that the measured
// numbers include the real cost of the database round trips.
type benchEnv struct {
	svc   *notes.Service
	store *sqlitestore.Store
	cfg   config.Config
}

// benchFolders is the number of folders the generated notes are spread over.
const benchFolders = 20

// newBenchEnv creates a service with noteCount notes on disk and fills the
// store with their metadata and their search index.
func newBenchEnv(b *testing.B, noteCount int) *benchEnv {
	b.Helper()
	dir := b.TempDir()
	cfg := config.Config{
		DataDir:        dir,
		NotesDir:       filepath.Join(dir, "notes"),
		AttachmentsDir: filepath.Join(dir, "attachments"),
		TrashDir:       filepath.Join(dir, "trash"),
		DBPath:         filepath.Join(dir, "noto.db"),
	}
	if err := cfg.EnsureDirs(); err != nil {
		b.Fatalf("ensure dirs: %v", err)
	}
	ctx := context.Background()
	db, err := sql.Open("sqlite", cfg.DBPath)
	if err != nil {
		b.Fatalf("open database: %v", err)
	}
	store, err := sqlitestore.New(ctx, db)
	if err != nil {
		b.Fatalf("open store: %v", err)
	}
	svc, err := notes.NewService(cfg, store)
	if err != nil {
		b.Fatalf("new service: %v", err)
	}
	writeBenchNotes(b, cfg.NotesDir, noteCount)
	if n, err := svc.Reindex(ctx); err != nil {
		b.Fatalf("reindex: %v", err)
	} else if n != noteCount {
		b.Fatalf("reindexed %d notes, want %d", n, noteCount)
	}
	b.Cleanup(func() { _ = store.Close() })
	return &benchEnv{svc: svc, store: store, cfg: cfg}
}

// writeBenchNotes creates noteCount Markdown files spread over the folders.
func writeBenchNotes(b *testing.B, notesDir string, noteCount int) {
	b.Helper()
	body := []byte("# Bench\n\nlorem ipsum dolor sit amet, consectetur adipiscing elit.\n")
	for i := 0; i < noteCount; i++ {
		folder := filepath.Join(notesDir, fmt.Sprintf("folder-%02d", i%benchFolders))
		if err := os.MkdirAll(folder, 0o755); err != nil {
			b.Fatalf("create folder: %v", err)
		}
		path := filepath.Join(folder, fmt.Sprintf("note-%05d.md", i))
		if err := os.WriteFile(path, body, 0o644); err != nil {
			b.Fatalf("write note: %v", err)
		}
	}
}
