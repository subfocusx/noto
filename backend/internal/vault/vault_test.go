package vault_test

import (
	"os"
	"path/filepath"
	"testing"

	"noto/backend/internal/vault"
)

// configFile points the vault configuration into a temporary directory.
func configFile(t *testing.T) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), "vault.json")
	t.Setenv(vault.EnvFile, file)
	return file
}

func TestWriteReadRoundTrip(t *testing.T) {
	configFile(t)
	dir := t.TempDir()

	written, err := vault.Write(dir)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if !filepath.IsAbs(written.Path) {
		t.Fatalf("the stored path is not absolute: %q", written.Path)
	}

	read, ok, err := vault.Read()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !ok {
		t.Fatal("the vault configuration was not found")
	}
	if read.Path != written.Path {
		t.Fatalf("the path was not preserved: got %q, want %q", read.Path, written.Path)
	}
}

func TestReadWithoutConfiguration(t *testing.T) {
	configFile(t)
	_, ok, err := vault.Read()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if ok {
		t.Fatal("a vault is configured, but no configuration file exists")
	}
}

func TestClearRemovesTheConfiguration(t *testing.T) {
	file := configFile(t)
	dir := t.TempDir()
	if _, err := vault.Write(dir); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := vault.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("the configuration file was not removed")
	}
	if _, ok, err := vault.Read(); err != nil || ok {
		t.Fatalf("the vault is still configured: ok=%v err=%v", ok, err)
	}
}

func TestValidateRejectsAMissingDirectory(t *testing.T) {
	configFile(t)
	missing := filepath.Join(t.TempDir(), "missing")
	if err := vault.Validate(missing); err == nil {
		t.Fatal("a missing directory was accepted")
	}
}

func TestValidateRejectsAFile(t *testing.T) {
	configFile(t)
	file := filepath.Join(t.TempDir(), "note.md")
	if err := os.WriteFile(file, []byte("hello"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if err := vault.Validate(file); err == nil {
		t.Fatal("a file was accepted as a vault")
	}
	if _, err := vault.Write(file); err == nil {
		t.Fatal("a file was stored as a vault")
	}
}

func TestResolveBuildsTheLayout(t *testing.T) {
	configFile(t)
	dir := t.TempDir()
	layout, err := vault.Resolve(dir)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if layout.VaultPath != filepath.Clean(dir) {
		t.Fatalf("unexpected vault path: %q", layout.VaultPath)
	}
	if layout.NotesDir != layout.VaultPath {
		t.Fatalf("the notes are not stored in the vault: %q", layout.NotesDir)
	}
	want := filepath.Join(layout.VaultPath, ".noto", "noto.db")
	if layout.DBPath != want {
		t.Fatalf("unexpected database path: got %q, want %q", layout.DBPath, want)
	}
}

func TestBrowseListsTheVisibleDirectories(t *testing.T) {
	configFile(t)
	dir := t.TempDir()
	for _, name := range []string{"beta", "alpha"} {
		if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, ".hidden"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "note.md"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	res, err := vault.Browse(dir)
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if res.Path != filepath.Clean(dir) {
		t.Fatalf("unexpected path: %q", res.Path)
	}
	if len(res.Dirs) != 2 {
		t.Fatalf("unexpected number of directories: %d (%+v)", len(res.Dirs), res.Dirs)
	}
	if res.Dirs[0].Name != "alpha" || res.Dirs[1].Name != "beta" {
		t.Fatalf("the directories are not sorted by name: %+v", res.Dirs)
	}
	if res.Parent != filepath.Dir(filepath.Clean(dir)) {
		t.Fatalf("unexpected parent: %q", res.Parent)
	}
}

func TestBrowseRejectsAMissingDirectoryAndAFile(t *testing.T) {
	configFile(t)
	dir := t.TempDir()
	if _, err := vault.Browse(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("a missing directory was listed")
	}
	file := filepath.Join(dir, "note.md")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if _, err := vault.Browse(file); err == nil {
		t.Fatal("a file was listed as a directory")
	}
}

func TestBrowseWithoutAPathListsTheRoot(t *testing.T) {
	configFile(t)
	res, err := vault.Browse("")
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if res.Path == "" {
		t.Fatal("the root path is empty")
	}
	if res.Dirs == nil {
		t.Fatal("the directory list is nil")
	}
}
