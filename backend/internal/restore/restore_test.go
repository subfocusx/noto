package restore

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"noto/backend/internal/backuppkg"
	"noto/backend/internal/config"
	"noto/backend/internal/notes"
	"noto/backend/internal/sqlitestore"
)

// testConfig returns a configuration that points into the given directory.
func testConfig(dir string) config.Config {
	return config.Config{
		DataDir:        dir,
		NotesDir:       filepath.Join(dir, "notes"),
		AttachmentsDir: filepath.Join(dir, "attachments"),
		TrashDir:       filepath.Join(dir, "trash"),
		DBPath:         filepath.Join(dir, "noto.db"),
	}
}

// noteContent is the content of the test note, it contains Cyrillic text.
const noteContent = "# Заметка\n\nПривет, мир! Ĝojaŭ ñ\n"

// seedData creates a data directory with a note and a database.
func seedData(t *testing.T, cfg config.Config) {
	t.Helper()
	ctx := context.Background()
	if err := cfg.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	store, err := sqlitestore.Open(ctx, cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	svc, err := notes.NewService(cfg, store)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	if _, err := svc.CreateFolder(ctx, "", "Дневник"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.Write(ctx, "Дневник/заметка.md", noteContent, 0); err != nil {
		t.Fatalf("write note: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.AttachmentsDir, "image.png"), []byte("png"), 0o644); err != nil {
		t.Fatalf("write attachment: %v", err)
	}
}

// createBackup creates a backup of the data directory.
func createBackup(t *testing.T, cfg config.Config) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "backup.zip")
	if _, err := backuppkg.Create(cfg, out); err != nil {
		t.Fatalf("backup: %v", err)
	}
	return out
}

// TestRestoreRoundTrip creates data, backs it up, restores it into another
// directory and reads the note back.
func TestRestoreRoundTrip(t *testing.T) {
	ctx := context.Background()
	src := testConfig(t.TempDir())
	seedData(t, src)
	archive := createBackup(t, src)

	dst := testConfig(filepath.Join(t.TempDir(), "restored"))
	report, err := Run(ctx, dst, Options{ArchivePath: archive})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !report.Verified {
		t.Fatalf("the archive was not verified")
	}
	if report.Files == 0 {
		t.Fatalf("the report lists no files")
	}

	// The note is on the disk again.
	onDisk, err := os.ReadFile(filepath.Join(dst.NotesDir, "Дневник", "заметка.md"))
	if err != nil {
		t.Fatalf("read the restored note: %v", err)
	}
	if string(onDisk) != noteContent {
		t.Fatalf("the restored note is %q, want %q", string(onDisk), noteContent)
	}
	if _, err := os.Stat(filepath.Join(dst.AttachmentsDir, "image.png")); err != nil {
		t.Fatalf("the attachment was not restored: %v", err)
	}

	// The database is restored and the note is known to the store.
	store, err := sqlitestore.Open(ctx, dst.DBPath)
	if err != nil {
		t.Fatalf("open the restored store: %v", err)
	}
	defer store.Close()
	if _, found, err := store.GetNote(ctx, "Дневник/заметка.md"); err != nil || !found {
		t.Fatalf("the restored database does not know the note: %v", err)
	}
	svc, err := notes.NewService(dst, store)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	got, err := svc.Read(ctx, "Дневник/заметка.md")
	if err != nil {
		t.Fatalf("read the note: %v", err)
	}
	if got.Content != noteContent {
		t.Fatalf("the note is %q, want %q", got.Content, noteContent)
	}
}

// TestRestoreDryRunChangesNothing makes sure that a dry run only reports
// and never touches the target directory.
func TestRestoreDryRunChangesNothing(t *testing.T) {
	ctx := context.Background()
	src := testConfig(t.TempDir())
	seedData(t, src)
	archive := createBackup(t, src)

	dst := testConfig(t.TempDir())
	before := snapshot(t, dst.DataDir)
	report, err := Run(ctx, dst, Options{ArchivePath: archive, DryRun: true})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !report.DryRun {
		t.Fatalf("the report is not a dry run")
	}
	if report.Files == 0 {
		t.Fatalf("the report lists no files")
	}
	after := snapshot(t, dst.DataDir)
	if !equalSnapshot(before, after) {
		t.Fatalf("the dry run changed the target directory:\n%v\n%v", before, after)
	}
}

// TestRestoreRefusesANonEmptyTarget makes sure that an existing data
// directory is not overwritten without --force.
func TestRestoreRefusesANonEmptyTarget(t *testing.T) {
	ctx := context.Background()
	src := testConfig(t.TempDir())
	seedData(t, src)
	archive := createBackup(t, src)

	dst := testConfig(t.TempDir())
	if err := dst.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	existing := filepath.Join(dst.NotesDir, "existing.md")
	if err := os.WriteFile(existing, []byte("keep me"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	before := snapshot(t, dst.DataDir)

	_, err := Run(ctx, dst, Options{ArchivePath: archive})
	if err == nil {
		t.Fatalf("the restore overwrote an existing data directory")
	}
	if !strings.Contains(err.Error(), "already contains data") {
		t.Fatalf("unexpected error: %v", err)
	}
	data, err := os.ReadFile(existing)
	if err != nil {
		t.Fatalf("the existing note was removed: %v", err)
	}
	if string(data) != "keep me" {
		t.Fatalf("the existing note was changed: %q", string(data))
	}
	if after := snapshot(t, dst.DataDir); !equalSnapshot(before, after) {
		t.Fatalf("the refused restore changed the target directory")
	}
}

// TestRestoreRejectsACorruptedArchive makes sure that a damaged archive is
// refused and that the existing data stays untouched.
func TestRestoreRejectsACorruptedArchive(t *testing.T) {
	ctx := context.Background()
	src := testConfig(t.TempDir())
	seedData(t, src)
	archive := createBackup(t, src)
	// The content of a file is changed behind the back of the manifest.
	tamperArchive(t, archive, "notes/Дневник/заметка.md", "# tampered\n")

	dst := testConfig(t.TempDir())
	if err := dst.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	existing := filepath.Join(dst.NotesDir, "existing.md")
	if err := os.WriteFile(existing, []byte("keep me"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	before := snapshot(t, dst.DataDir)

	_, err := Run(ctx, dst, Options{ArchivePath: archive, Force: true})
	if err == nil {
		t.Fatalf("the corrupted archive was restored")
	}
	if !strings.Contains(err.Error(), "notes/Дневник/заметка.md") {
		t.Fatalf("the error does not mention the damaged file: %v", err)
	}
	if after := snapshot(t, dst.DataDir); !equalSnapshot(before, after) {
		t.Fatalf("the refused restore changed the target directory")
	}
}

// TestRestoreAcceptsALegacyArchive makes sure that an archive without a
// file list is still restored.
func TestRestoreAcceptsALegacyArchive(t *testing.T) {
	ctx := context.Background()
	out := filepath.Join(t.TempDir(), "legacy.zip")
	writeLegacyArchive(t, out, map[string]string{
		backuppkg.ManifestName: `{"createdAt":"2024-01-01T00:00:00Z","notesDir":"notes","attachDir":"attachments","trashDir":"trash","database":"noto.db","app":"noto","containsData":true}`,
		"notes/a.md":           "# a",
	})

	dst := testConfig(t.TempDir())
	report, err := Run(ctx, dst, Options{ArchivePath: out})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if report.Verified {
		t.Fatalf("the legacy archive must not be reported as verified")
	}
	data, err := os.ReadFile(filepath.Join(dst.NotesDir, "a.md"))
	if err != nil {
		t.Fatalf("the note was not restored: %v", err)
	}
	if string(data) != "# a" {
		t.Fatalf("the note is %q", string(data))
	}
}

// TestRestoreKeepsTheCurrentDatabase makes sure that the database of the
// target directory is kept next to the restored one.
func TestRestoreKeepsTheCurrentDatabase(t *testing.T) {
	ctx := context.Background()
	src := testConfig(t.TempDir())
	seedData(t, src)
	archive := createBackup(t, src)

	dst := testConfig(t.TempDir())
	if err := dst.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	store, err := sqlitestore.Open(ctx, dst.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	store.Close()

	report, err := Run(ctx, dst, Options{ArchivePath: archive, Force: true})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if report.PreRestore == "" {
		t.Fatalf("the previous database was not kept")
	}
	if _, err := os.Stat(report.PreRestore); err != nil {
		t.Fatalf("the kept database is missing: %v", err)
	}
	if !strings.Contains(report.PreRestore, ".pre-restore-") {
		t.Fatalf("unexpected name of the kept database: %q", report.PreRestore)
	}
}

// TestRestoreRejectsAMissingArchive makes sure that a missing archive is
// reported.
func TestRestoreRejectsAMissingArchive(t *testing.T) {
	ctx := context.Background()
	dst := testConfig(t.TempDir())
	if _, err := Run(ctx, dst, Options{ArchivePath: filepath.Join(t.TempDir(), "missing.zip")}); err == nil {
		t.Fatalf("the missing archive was accepted")
	}
}

// TestRestoreRejectsAnArchiveWithoutAManifest makes sure that a ZIP archive
// without a manifest is refused.
func TestRestoreRejectsAnArchiveWithoutAManifest(t *testing.T) {
	ctx := context.Background()
	out := filepath.Join(t.TempDir(), "broken.zip")
	writeLegacyArchive(t, out, map[string]string{"notes/a.md": "# a"})
	// Remove the manifest from the archive.
	entries := readZip(t, out)
	delete(entries, backuppkg.ManifestName)
	writeLegacyArchive(t, out, entries)

	dst := testConfig(t.TempDir())
	if _, err := Run(ctx, dst, Options{ArchivePath: out}); err == nil {
		t.Fatalf("the archive without a manifest was accepted")
	}
}

// TestRestoreRequiresAnArchive makes sure that the archive path is required.
func TestRestoreRequiresAnArchive(t *testing.T) {
	ctx := context.Background()
	dst := testConfig(t.TempDir())
	if _, err := Run(ctx, dst, Options{}); err == nil {
		t.Fatalf("the restore without an archive was accepted")
	} else if !strings.Contains(err.Error(), "-in") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestRestoreOverridesTheDataDirectory makes sure that the data directory of
// the options wins over the one of the configuration.
func TestRestoreOverridesTheDataDirectory(t *testing.T) {
	ctx := context.Background()
	src := testConfig(t.TempDir())
	seedData(t, src)
	archive := createBackup(t, src)

	cfg := testConfig(t.TempDir())
	target := filepath.Join(t.TempDir(), "other")
	report, err := Run(ctx, cfg, Options{ArchivePath: archive, DataDir: target})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if report.DataDir != target {
		t.Fatalf("the report names %q, want %q", report.DataDir, target)
	}
	if _, err := os.Stat(filepath.Join(target, "notes", "Дневник", "заметка.md")); err != nil {
		t.Fatalf("the note was not restored into the target directory: %v", err)
	}
}

// snapshot returns the files of a directory with their checksums.
func snapshot(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.Walk(dir, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if fi.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		out[filepath.ToSlash(rel)] = hex.EncodeToString(sum[:])
		return nil
	})
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	return out
}

// equalSnapshot compares two snapshots.
func equalSnapshot(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// tamperArchive rewrites an archive with a new content of one entry.
func tamperArchive(t *testing.T, path, name, content string) {
	t.Helper()
	entries := readZip(t, path)
	if _, ok := entries[name]; !ok {
		t.Fatalf("the archive does not contain %q", name)
	}
	entries[name] = content
	writeLegacyArchive(t, path, entries)
}

// readZip reads every file of an archive into memory.
func readZip(t *testing.T, path string) map[string]string {
	t.Helper()
	zr, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer zr.Close()
	out := map[string]string{}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open entry: %v", err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read entry: %v", err)
		}
		out[f.Name] = string(data)
	}
	return out
}

// writeLegacyArchive writes a ZIP archive with the given files.
func writeLegacyArchive(t *testing.T, path string, files map[string]string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	zw := zip.NewWriter(f)
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create entry: %v", err)
		}
		if _, err := w.Write([]byte(files[name])); err != nil {
			t.Fatalf("write entry: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
}
