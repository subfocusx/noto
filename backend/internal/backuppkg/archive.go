package backuppkg

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Archive is an opened backup archive.
type Archive struct {
	path     string
	zr       *zip.ReadCloser
	manifest Manifest
	files    map[string]*zip.File
}

// Open opens the backup archive at path and reads its manifest.
func Open(path string) (*Archive, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("cannot open the backup archive %q: %w", path, err)
	}
	a := &Archive{path: path, zr: zr, files: map[string]*zip.File{}}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		a.files[f.Name] = f
	}
	if _, ok := a.files[ManifestName]; !ok {
		zr.Close()
		return nil, fmt.Errorf("the archive %q does not contain a %s", path, ManifestName)
	}
	data, err := a.ReadFile(ManifestName)
	if err != nil {
		zr.Close()
		return nil, err
	}
	m, err := ParseManifest(data)
	if err != nil {
		zr.Close()
		return nil, fmt.Errorf("the archive %q has an invalid manifest: %w", path, err)
	}
	a.manifest = m
	return a, nil
}

// Close releases the archive.
func (a *Archive) Close() error {
	if a == nil || a.zr == nil {
		return nil
	}
	return a.zr.Close()
}

// Path returns the path of the archive.
func (a *Archive) Path() string { return a.path }

// Manifest returns the manifest of the archive.
func (a *Archive) Manifest() Manifest { return a.manifest }

// ChecksumsAvailable reports whether the manifest lists the files of the
// archive with their checksums. Version 1 manifests do not.
func (a *Archive) ChecksumsAvailable() bool { return a.manifest.HasFileList() }

// Files returns the sorted names of the regular files of the archive.
func (a *Archive) Files() []string {
	names := make([]string, 0, len(a.files))
	for name := range a.files {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Has reports whether the archive contains the given file.
func (a *Archive) Has(name string) bool {
	_, ok := a.files[name]
	return ok
}

// FileSize returns the uncompressed size of a file of the archive.
func (a *Archive) FileSize(name string) (int64, bool) {
	f, ok := a.files[name]
	if !ok {
		return 0, false
	}
	return int64(f.UncompressedSize64), true
}

// ReadFile reads a file of the archive into memory.
func (a *Archive) ReadFile(name string) ([]byte, error) {
	f, ok := a.files[name]
	if !ok {
		return nil, fmt.Errorf("the archive %q does not contain %q", a.path, name)
	}
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("cannot read %q from the archive: %w", name, err)
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		return nil, fmt.Errorf("cannot read %q from the archive: %w", name, err)
	}
	return data, nil
}

// Mismatch describes one file of an archive that does not match the
// manifest.
type Mismatch struct {
	// Path is the path of the file inside the archive.
	Path string
	// Reason explains why the file does not match.
	Reason string
}

// IntegrityError is returned when the content of an archive does not match
// its manifest.
type IntegrityError struct {
	Mismatches []Mismatch
}

// Error implements the error interface.
func (e *IntegrityError) Error() string {
	var b strings.Builder
	fmt.Fprintf(&b, "the archive does not match its manifest (%d problem(s))", len(e.Mismatches))
	for i, m := range e.Mismatches {
		if i >= 20 {
			fmt.Fprintf(&b, "\n  ... and %d more", len(e.Mismatches)-20)
			break
		}
		fmt.Fprintf(&b, "\n  %s: %s", m.Path, m.Reason)
	}
	return b.String()
}

// Verify checks the content of the archive against the checksums of the
// manifest.
//
// Archives without a file list (version 1) are not verified, the caller is
// expected to warn about it. The returned error is an *IntegrityError that
// lists every mismatch.
func (a *Archive) Verify() error {
	if !a.ChecksumsAvailable() {
		return nil
	}
	listed := map[string]FileEntry{}
	for _, e := range a.manifest.FileList() {
		listed[e.Path] = e
	}
	var mismatches []Mismatch
	for _, name := range a.Files() {
		if name == ManifestName {
			continue
		}
		e, ok := listed[name]
		if !ok {
			mismatches = append(mismatches, Mismatch{Path: name, Reason: "the file is not listed in the manifest"})
			continue
		}
		f := a.files[name]
		if int64(f.UncompressedSize64) != e.Size {
			mismatches = append(mismatches, Mismatch{
				Path:   name,
				Reason: fmt.Sprintf("the size differs (manifest %d bytes, archive %d bytes)", e.Size, f.UncompressedSize64),
			})
			continue
		}
		sum, err := hashZipEntry(f)
		if err != nil {
			mismatches = append(mismatches, Mismatch{Path: name, Reason: "the file cannot be read: " + err.Error()})
			continue
		}
		if !strings.EqualFold(sum, e.SHA256) {
			mismatches = append(mismatches, Mismatch{
				Path:   name,
				Reason: fmt.Sprintf("the checksum differs (manifest %s, archive %s)", e.SHA256, sum),
			})
		}
	}
	for _, e := range a.manifest.FileList() {
		if _, ok := a.files[e.Path]; !ok {
			mismatches = append(mismatches, Mismatch{Path: e.Path, Reason: "the file is missing from the archive"})
		}
	}
	if len(mismatches) > 0 {
		return &IntegrityError{Mismatches: mismatches}
	}
	return nil
}

// hashZipEntry returns the lowercase hexadecimal SHA-256 of an archive
// entry.
func hashZipEntry(f *zip.File) (string, error) {
	rc, err := f.Open()
	if err != nil {
		return "", err
	}
	defer rc.Close()
	h := sha256.New()
	if _, err := io.Copy(h, rc); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// ExtractTo writes the files of the archive below the target directory,
// preserving the directory structure. Only the files below one of the given
// prefixes are written; an empty prefix list writes every file.
func (a *Archive) ExtractTo(target string, prefixes []string) error {
	for _, name := range a.Files() {
		if name == ManifestName {
			continue
		}
		if !matchesPrefix(name, prefixes) {
			continue
		}
		if err := a.extractOne(name, target); err != nil {
			return err
		}
	}
	return nil
}

// matchesPrefix reports whether name is below one of the prefixes.
func matchesPrefix(name string, prefixes []string) bool {
	if len(prefixes) == 0 {
		return true
	}
	for _, p := range prefixes {
		if p == "" || name == p || strings.HasPrefix(name, strings.TrimSuffix(p, "/")+"/") {
			return true
		}
	}
	return false
}

// extractOne writes a single archive entry below the target directory.
func (a *Archive) extractOne(name, target string) error {
	clean, err := safeRelPath(name)
	if err != nil {
		return err
	}
	dst := filepath.Join(target, filepath.FromSlash(clean))
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("cannot create %q: %w", filepath.Dir(dst), err)
	}
	rc, err := a.files[name].Open()
	if err != nil {
		return fmt.Errorf("cannot read %q from the archive: %w", name, err)
	}
	defer rc.Close()
	f, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("cannot create %q: %w", dst, err)
	}
	defer f.Close()
	if _, err := io.Copy(f, rc); err != nil {
		return fmt.Errorf("cannot write %q: %w", dst, err)
	}
	return f.Sync()
}

// safeRelPath validates an archive entry name and returns its cleaned
// slash separated form. Absolute paths and path traversals are rejected.
func safeRelPath(name string) (string, error) {
	if name == "" {
		return "", fmt.Errorf("the archive contains an entry without a name")
	}
	if strings.ContainsRune(name, 0) {
		return "", fmt.Errorf("the archive contains an invalid entry name")
	}
	if strings.Contains(name, "\\") {
		return "", fmt.Errorf("the archive contains an invalid entry name")
	}
	if strings.HasPrefix(name, "/") {
		return "", fmt.Errorf("the archive contains the absolute path %q", name)
	}
	if len(name) >= 2 && name[1] == ':' {
		return "", fmt.Errorf("the archive contains the absolute path %q", name)
	}
	for _, seg := range strings.Split(name, "/") {
		if seg == ".." {
			return "", fmt.Errorf("the archive contains the path traversal %q", name)
		}
	}
	clean := path.Clean(name)
	if clean == "." || clean == "" || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("the archive contains the invalid path %q", name)
	}
	return clean, nil
}

// Write writes the content of dir into a ZIP archive at out.
//
// The manifest of the archive is generated from the content of dir: every
// regular file except the manifest itself is listed with its size and its
// SHA-256 checksum. The archive is written to a temporary file next to out
// and renamed into place, so an interrupted backup never leaves a broken
// archive under the final name.
func Write(dir, out string, m Manifest) error {
	files, err := collectFiles(dir)
	if err != nil {
		return err
	}
	m.Version = ManifestVersion
	m.Normalize()
	entries := make([]FileEntry, 0, len(files))
	for _, f := range files {
		sum, err := hashFile(f.abs)
		if err != nil {
			return err
		}
		entries = append(entries, FileEntry{Path: f.rel, Size: f.size, SHA256: sum})
	}
	m.SetFileList(entries)
	data, err := m.Marshal()
	if err != nil {
		return err
	}

	tmp := out + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("cannot create the temporary archive %q: %w", tmp, err)
	}
	committed := false
	defer func() {
		if !committed {
			f.Close()
			os.Remove(tmp)
		}
	}()

	zw := zip.NewWriter(f)
	failed := func(err error) error {
		zw.Close()
		return err
	}
	hdr := &zip.FileHeader{Name: ManifestName, Method: zip.Deflate}
	w, err := zw.CreateHeader(hdr)
	if err != nil {
		return failed(err)
	}
	if _, err := w.Write(data); err != nil {
		return failed(err)
	}
	for _, file := range files {
		hdr := &zip.FileHeader{Name: file.rel, Method: zip.Deflate}
		hdr.Modified = file.modTime
		w, err := zw.CreateHeader(hdr)
		if err != nil {
			return failed(err)
		}
		in, err := os.Open(file.abs)
		if err != nil {
			return failed(fmt.Errorf("cannot read %q: %w", file.rel, err))
		}
		_, err = io.Copy(w, in)
		in.Close()
		if err != nil {
			return failed(fmt.Errorf("cannot write %q into the archive: %w", file.rel, err))
		}
	}
	if err := zw.Close(); err != nil {
		return fmt.Errorf("cannot finish the archive: %w", err)
	}
	if err := f.Sync(); err != nil {
		return fmt.Errorf("cannot flush the archive: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("cannot close the archive: %w", err)
	}
	if err := os.Rename(tmp, out); err != nil {
		return fmt.Errorf("cannot move the archive into place: %w", err)
	}
	committed = true
	return nil
}

// sourceFile is one regular file of the staged backup directory.
type sourceFile struct {
	rel     string
	abs     string
	size    int64
	modTime time.Time
}

// collectFiles lists the regular files of dir with their archive paths. The
// manifest itself is skipped because it is generated by Write.
func collectFiles(dir string) ([]sourceFile, error) {
	var out []sourceFile
	err := filepath.Walk(dir, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if fi.IsDir() || !fi.Mode().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rel)
		if name == ManifestName {
			return nil
		}
		out = append(out, sourceFile{rel: name, abs: p, size: fi.Size(), modTime: fi.ModTime()})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("cannot list %q: %w", dir, err)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].rel < out[j].rel })
	return out, nil
}

// hashFile returns the lowercase hexadecimal SHA-256 of a file.
func hashFile(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", fmt.Errorf("cannot read %q: %w", p, err)
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("cannot read %q: %w", p, err)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
