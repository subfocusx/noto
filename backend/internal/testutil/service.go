package testutil

import (
	"path/filepath"
	"testing"

	"noto/backend/internal/config"
	"noto/backend/internal/notes"
)

// NewTestConfig creates a configuration that points into a temporary
// directory. The real user data directory is never touched.
func NewTestConfig(t *testing.T) config.Config {
	t.Helper()
	dir := t.TempDir()
	return config.Config{
		Addr:            "127.0.0.1:0",
		DataDir:         dir,
		NotesDir:        filepath.Join(dir, "notes"),
		AttachmentsDir:  filepath.Join(dir, "attachments"),
		TrashDir:        filepath.Join(dir, "trash"),
		DBPath:          filepath.Join(dir, "noto.db"),
		MaxUploadBytes:  1 << 20,
		MaxArchiveBytes: 8 << 20,
	}
}

// NewTestService creates a service backed by the in-memory store.
func NewTestService(t *testing.T) (*notes.Service, *MemStore, config.Config) {
	t.Helper()
	cfg := NewTestConfig(t)
	if err := cfg.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	store := NewMemStore()
	svc, err := notes.NewService(cfg, store)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return svc, store, cfg
}
