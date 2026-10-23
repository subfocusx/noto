package main

import (
	"archive/zip"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"

	"noto/backend/internal/config"
)

// newTestConfig creates a configuration that points into a temporary
// directory.
func newTestConfig(t *testing.T) config.Config {
	t.Helper()
	dir := t.TempDir()
	return config.Config{
		DataDir:        dir,
		NotesDir:       filepath.Join(dir, "notes"),
		AttachmentsDir: filepath.Join(dir, "attachments"),
		TrashDir:       filepath.Join(dir, "trash"),
		DBPath:         filepath.Join(dir, "noto.db"),
	}
}

func TestRunBackupCreatesArchive(t *testing.T) {
	cfg := newTestConfig(t)
	if err := cfg.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	notesDir := filepath.Join(cfg.NotesDir, "journal")
	if err := os.MkdirAll(notesDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(notesDir, "a.md"), []byte("# a"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.AttachmentsDir, "image.png"), []byte("png"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	out := filepath.Join(t.TempDir(), "backup.zip")
	path, err := runBackup(cfg, out)
	if err != nil {
		t.Fatalf("backup: %v", err)
	}
	if path != out {
		t.Fatalf("unexpected path %q", path)
	}
	zr, err := zip.OpenReader(out)
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	defer zr.Close()
	found := map[string]bool{}
	for _, f := range zr.File {
		found[f.Name] = true
	}
	for _, want := range []string{"notes/journal/a.md", "attachments/image.png", "manifest.json"} {
		if !found[want] {
			t.Fatalf("the archive does not contain %q: %v", want, found)
		}
	}
}

// TestRunBackupContainsTheTrash makes sure that the deleted but still
// restorable notes are part of the backup.
func TestRunBackupContainsTheTrash(t *testing.T) {
	cfg := newTestConfig(t)
	if err := cfg.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	trashDir := filepath.Join(cfg.TrashDir, "abc123", "journal")
	if err := os.MkdirAll(trashDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(trashDir, "deleted.md"), []byte("# deleted"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	out := filepath.Join(t.TempDir(), "backup.zip")
	path, err := runBackup(cfg, out)
	if err != nil {
		t.Fatalf("backup: %v", err)
	}
	zr, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	defer zr.Close()
	found := map[string]bool{}
	for _, f := range zr.File {
		found[f.Name] = true
	}
	if !found["trash/abc123/journal/deleted.md"] {
		t.Fatalf("the archive does not contain the trash: %v", found)
	}

	// The manifest announces the trash directory.
	for _, f := range zr.File {
		if f.Name != "manifest.json" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open manifest: %v", err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read manifest: %v", err)
		}
		var manifest map[string]any
		if err := json.Unmarshal(data, &manifest); err != nil {
			t.Fatalf("decode manifest: %v", err)
		}
		if manifest["trashDir"] != "trash" {
			t.Fatalf("the manifest does not mention the trash directory: %v", manifest)
		}
		return
	}
	t.Fatalf("the archive does not contain a manifest")
}
