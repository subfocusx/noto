package backuppkg

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
)

// stageDir creates a directory with the given files.
func stageDir(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", filepath.Dir(p), err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return dir
}

// TestWriteCreatesManifestWithChecksums makes sure that the manifest of a
// new archive lists every file with its size and its SHA-256 checksum.
func TestWriteCreatesManifestWithChecksums(t *testing.T) {
	dir := stageDir(t, map[string]string{
		"notes/заметка.md":    "# заметка\n\nПривет\n",
		"notes/journal/a.md":  "# a",
		"attachments/img.png": "png-bytes",
		"trash/abc/a.md":      "# deleted",
		"noto.db":             "db-bytes",
	})
	out := filepath.Join(t.TempDir(), "backup.zip")
	m := NewManifest("2026-10-23T07:19:00Z")
	if err := Write(dir, out, m); err != nil {
		t.Fatalf("write: %v", err)
	}

	a, err := Open(out)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer a.Close()

	got := a.Manifest()
	if got.Version != ManifestVersion {
		t.Fatalf("unexpected manifest version %d", got.Version)
	}
	if !a.ChecksumsAvailable() {
		t.Fatalf("the manifest has no file list")
	}
	if got.NotesDir != "notes" || got.AttachDir != "attachments" || got.TrashDir != "trash" || got.Database != "noto.db" {
		t.Fatalf("unexpected manifest layout: %+v", got)
	}

	// Every file of the archive has to be listed.
	want := map[string]string{
		"notes/заметка.md":    "# заметка\n\nПривет\n",
		"notes/journal/a.md":  "# a",
		"attachments/img.png": "png-bytes",
		"trash/abc/a.md":      "# deleted",
		"noto.db":             "db-bytes",
	}
	list := a.Manifest().FileList()
	if len(list) != len(want) {
		t.Fatalf("the manifest lists %d files, want %d: %+v", len(list), len(want), list)
	}
	for _, e := range list {
		content, ok := want[e.Path]
		if !ok {
			t.Fatalf("the manifest lists the unexpected file %q", e.Path)
		}
		sum := sha256.Sum256([]byte(content))
		if e.SHA256 != hex.EncodeToString(sum[:]) {
			t.Fatalf("the checksum of %q is %q, want %q", e.Path, e.SHA256, hex.EncodeToString(sum[:]))
		}
		if e.Size != int64(len(content)) {
			t.Fatalf("the size of %q is %d, want %d", e.Path, e.Size, len(content))
		}
	}
	// The manifest itself is not listed.
	for _, e := range list {
		if e.Path == ManifestName {
			t.Fatalf("the manifest lists itself")
		}
	}
	if err := a.Verify(); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

// TestWriteChecksumsMatchTheArchive recomputes the checksums of the files
// of the archive and compares them with the manifest.
func TestWriteChecksumsMatchTheArchive(t *testing.T) {
	dir := stageDir(t, map[string]string{
		"notes/a.md": "alpha",
		"noto.db":    "beta",
	})
	out := filepath.Join(t.TempDir(), "backup.zip")
	if err := Write(dir, out, NewManifest("2026-10-23T07:19:00Z")); err != nil {
		t.Fatalf("write: %v", err)
	}
	a, err := Open(out)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer a.Close()
	for _, e := range a.Manifest().FileList() {
		data, err := a.ReadFile(e.Path)
		if err != nil {
			t.Fatalf("read %s: %v", e.Path, err)
		}
		sum := sha256.Sum256(data)
		if got := hex.EncodeToString(sum[:]); got != e.SHA256 {
			t.Fatalf("the checksum of %q is %q, the manifest says %q", e.Path, got, e.SHA256)
		}
		if int64(len(data)) != e.Size {
			t.Fatalf("the size of %q is %d, the manifest says %d", e.Path, len(data), e.Size)
		}
	}
}

// TestWriteLeavesNoTemporaryFile makes sure that the archive is renamed
// into place and that no temporary file is left behind.
func TestWriteLeavesNoTemporaryFile(t *testing.T) {
	dir := stageDir(t, map[string]string{"notes/a.md": "alpha"})
	out := filepath.Join(t.TempDir(), "backup.zip")
	// An old archive must be replaced by the new one.
	if err := os.WriteFile(out, []byte("old"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := Write(dir, out, NewManifest("2026-10-23T07:19:00Z")); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := os.Stat(out + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("the temporary archive was left behind")
	}
	a, err := Open(out)
	if err != nil {
		t.Fatalf("the archive was not replaced: %v", err)
	}
	a.Close()
}

// TestOpenLegacyArchive makes sure that an archive without a file list is
// still readable and that it is not verified.
func TestOpenLegacyArchive(t *testing.T) {
	out := filepath.Join(t.TempDir(), "legacy.zip")
	writeZip(t, out, map[string]string{
		ManifestName: `{"createdAt":"2024-01-01T00:00:00Z","notesDir":"notes","attachDir":"attachments","trashDir":"trash","database":"noto.db","app":"noto","containsData":true}`,
		"notes/a.md": "# a",
		"noto.db":    "db",
	})
	a, err := Open(out)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer a.Close()
	if a.ChecksumsAvailable() {
		t.Fatalf("the legacy archive reports checksums")
	}
	if err := a.Verify(); err != nil {
		t.Fatalf("the legacy archive must not be rejected: %v", err)
	}
	m := a.Manifest()
	if m.NotesDir != "notes" || m.Database != "noto.db" {
		t.Fatalf("unexpected manifest: %+v", m)
	}
	if len(a.Files()) != 3 {
		t.Fatalf("unexpected files: %v", a.Files())
	}
}

// TestParseManifestFillsTheDefaults makes sure that a manifest without the
// directory names is completed with the standard layout.
func TestParseManifestFillsTheDefaults(t *testing.T) {
	m, err := ParseManifest([]byte(`{"createdAt":"2024-01-01T00:00:00Z","app":"noto"}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if m.NotesDir != "notes" || m.AttachDir != "attachments" || m.TrashDir != "trash" || m.Database != "noto.db" {
		t.Fatalf("unexpected manifest: %+v", m)
	}
	if m.HasFileList() {
		t.Fatalf("the manifest must not have a file list")
	}
}

// TestVerifyDetectsATamperedFile makes sure that a modified file is
// detected by the checksum of the manifest.
func TestVerifyDetectsATamperedFile(t *testing.T) {
	dir := stageDir(t, map[string]string{
		"notes/a.md": "# a",
		"noto.db":    "db",
	})
	out := filepath.Join(t.TempDir(), "backup.zip")
	if err := Write(dir, out, NewManifest("2026-10-23T07:19:00Z")); err != nil {
		t.Fatalf("write: %v", err)
	}
	replaceEntry(t, out, "notes/a.md", "# tampered")

	a, err := Open(out)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer a.Close()
	err = a.Verify()
	if err == nil {
		t.Fatalf("the tampered archive was accepted")
	}
	integ, ok := err.(*IntegrityError)
	if !ok {
		t.Fatalf("unexpected error %T: %v", err, err)
	}
	if len(integ.Mismatches) == 0 {
		t.Fatalf("the error lists no mismatch")
	}
	found := false
	for _, m := range integ.Mismatches {
		if m.Path == "notes/a.md" {
			found = true
		}
	}
	if !found {
		t.Fatalf("the mismatch does not mention the tampered file: %v", integ.Mismatches)
	}
}

// TestVerifyDetectsAMissingFile makes sure that a file that is listed in
// the manifest but missing from the archive is detected.
func TestVerifyDetectsAMissingFile(t *testing.T) {
	dir := stageDir(t, map[string]string{
		"notes/a.md": "# a",
		"noto.db":    "db",
	})
	out := filepath.Join(t.TempDir(), "backup.zip")
	if err := Write(dir, out, NewManifest("2026-10-23T07:19:00Z")); err != nil {
		t.Fatalf("write: %v", err)
	}
	dropEntry(t, out, "notes/a.md")

	a, err := Open(out)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer a.Close()
	err = a.Verify()
	if err == nil {
		t.Fatalf("the incomplete archive was accepted")
	}
	integ, ok := err.(*IntegrityError)
	if !ok {
		t.Fatalf("unexpected error %T: %v", err, err)
	}
	if integ.Mismatches[0].Path != "notes/a.md" {
		t.Fatalf("the mismatch does not mention the missing file: %v", integ.Mismatches)
	}
}

// TestExtractToPreservesTheStructure makes sure that the files are written
// below the target directory with their structure.
func TestExtractToPreservesTheStructure(t *testing.T) {
	dir := stageDir(t, map[string]string{
		"notes/journal/a.md":  "# a",
		"attachments/img.png": "png",
		"noto.db":             "db",
	})
	out := filepath.Join(t.TempDir(), "backup.zip")
	if err := Write(dir, out, NewManifest("2026-10-23T07:19:00Z")); err != nil {
		t.Fatalf("write: %v", err)
	}
	a, err := Open(out)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer a.Close()
	target := t.TempDir()
	if err := a.ExtractTo(target, []string{"notes/", "attachments/", "noto.db"}); err != nil {
		t.Fatalf("extract: %v", err)
	}
	for _, name := range []string{"notes/journal/a.md", "attachments/img.png", "noto.db"} {
		if _, err := os.Stat(filepath.Join(target, filepath.FromSlash(name))); err != nil {
			t.Fatalf("the file %q was not extracted: %v", name, err)
		}
	}
}

// TestExtractToRejectsPathTraversal makes sure that an archive cannot write
// outside of the target directory.
func TestExtractToRejectsPathTraversal(t *testing.T) {
	out := filepath.Join(t.TempDir(), "evil.zip")
	writeZip(t, out, map[string]string{
		ManifestName:         `{"createdAt":"2024-01-01T00:00:00Z","app":"noto"}`,
		"notes/../escape.md": "escaped",
	})
	a, err := Open(out)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer a.Close()
	target := t.TempDir()
	if err := a.ExtractTo(target, nil); err == nil {
		t.Fatalf("the path traversal was accepted")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(target), "escape.md")); err == nil {
		t.Fatalf("the file was written outside of the target directory")
	}
}

// TestManifestJSONIsStable checks the shape of the manifest document.
func TestManifestJSONIsStable(t *testing.T) {
	m := NewManifest("2026-10-23T07:19:00Z")
	m.SetFileList([]FileEntry{{Path: "notes/a.md", Size: 3, SHA256: "abc"}})
	data, err := m.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if raw["version"] != float64(2) {
		t.Fatalf("unexpected version: %v", raw["version"])
	}
	files, ok := raw["files"].([]any)
	if !ok || len(files) != 1 {
		t.Fatalf("unexpected file list: %v", raw["files"])
	}
	entry := files[0].(map[string]any)
	if entry["path"] != "notes/a.md" || entry["size"] != float64(3) || entry["sha256"] != "abc" {
		t.Fatalf("unexpected file entry: %v", entry)
	}
}

// writeZip writes a ZIP archive with the given files.
func writeZip(t *testing.T, path string, files map[string]string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	zw := zip.NewWriter(f)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create entry: %v", err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
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

// replaceEntry rewrites an archive with a new content of one entry.
func replaceEntry(t *testing.T, path, name, content string) {
	t.Helper()
	entries := readZip(t, path)
	entries[name] = content
	writeZip(t, path, entries)
}

// dropEntry rewrites an archive without one entry.
func dropEntry(t *testing.T, path, name string) {
	t.Helper()
	entries := readZip(t, path)
	delete(entries, name)
	writeZip(t, path, entries)
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
