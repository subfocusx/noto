// Package backuppkg reads and writes Noto backup archives.
//
// A backup is a ZIP archive that holds a manifest, the Markdown notes, the
// attachments, the trash and a consistent copy of the SQLite database.
//
// The manifest of a modern archive has the version 2 and lists every file of
// the archive together with its size and its SHA-256 checksum. Archives
// written by older versions of Noto have a version 1 manifest without a file
// list; they are still readable, but their integrity cannot be verified.
package backuppkg

import (
	"encoding/json"
	"fmt"
)

const (
	// ManifestName is the name of the manifest inside a backup archive.
	ManifestName = "manifest.json"

	// ManifestVersion is the version of the manifest written by this
	// package. Version 1 manifests carry no file list and therefore no
	// checksums.
	ManifestVersion = 2

	// DatabaseName is the name of the database file inside the archive.
	DatabaseName = "noto.db"

	// NotesDirName is the archive directory that holds the Markdown files.
	NotesDirName = "notes"

	// AttachmentsDirName is the archive directory that holds the uploaded
	// binaries.
	AttachmentsDirName = "attachments"

	// TrashDirName is the archive directory that holds the deleted but
	// still restorable notes.
	TrashDirName = "trash"
)

// FileEntry describes one file of a backup archive.
type FileEntry struct {
	// Path is the slash separated path of the file inside the archive.
	Path string `json:"path"`
	// Size is the size of the file in bytes.
	Size int64 `json:"size"`
	// SHA256 is the lowercase hexadecimal SHA-256 of the file content.
	SHA256 string `json:"sha256"`
}

// Manifest describes the content of a backup archive.
//
// The file list is a pointer so that a manifest without checksums (the
// version 1 format) can be told apart from a version 2 manifest of an
// archive that happens to be empty.
type Manifest struct {
	// Version is the format version of the manifest.
	Version int `json:"version"`
	// CreatedAt is the RFC3339 timestamp of the backup.
	CreatedAt string `json:"createdAt"`
	// NotesDir is the archive directory that holds the Markdown files.
	NotesDir string `json:"notesDir"`
	// AttachDir is the archive directory that holds the attachments.
	AttachDir string `json:"attachDir"`
	// TrashDir is the archive directory that holds the trash.
	TrashDir string `json:"trashDir"`
	// Database is the name of the database file inside the archive.
	Database string `json:"database"`
	// App is the name of the application that wrote the archive.
	App string `json:"app"`
	// ContainsData reports whether the archive holds user data.
	ContainsData bool `json:"containsData"`
	// Files lists every file of the archive except the manifest itself.
	// It is nil for version 1 manifests.
	Files *[]FileEntry `json:"files,omitempty"`
}

// NewManifest returns a manifest with the standard directory layout.
func NewManifest(createdAt string) Manifest {
	return Manifest{
		Version:      ManifestVersion,
		CreatedAt:    createdAt,
		NotesDir:     NotesDirName,
		AttachDir:    AttachmentsDirName,
		TrashDir:     TrashDirName,
		Database:     DatabaseName,
		App:          "noto",
		ContainsData: true,
	}
}

// FileList returns the file list of the manifest or nil when the manifest
// carries no checksums.
func (m Manifest) FileList() []FileEntry {
	if m.Files == nil {
		return nil
	}
	return *m.Files
}

// HasFileList reports whether the manifest lists the files of the archive.
// Version 1 manifests do not, their integrity cannot be verified.
func (m Manifest) HasFileList() bool { return m.Files != nil }

// SetFileList replaces the file list of the manifest.
func (m *Manifest) SetFileList(files []FileEntry) {
	list := append([]FileEntry(nil), files...)
	m.Files = &list
}

// Normalize fills the fields that a legacy manifest may not contain.
func (m *Manifest) Normalize() {
	if m.NotesDir == "" {
		m.NotesDir = NotesDirName
	}
	if m.AttachDir == "" {
		m.AttachDir = AttachmentsDirName
	}
	if m.TrashDir == "" {
		m.TrashDir = TrashDirName
	}
	if m.Database == "" {
		m.Database = DatabaseName
	}
}

// ParseManifest decodes a manifest document. Unknown fields are ignored so
// that archives written by a newer version stay readable.
func ParseManifest(data []byte) (Manifest, error) {
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return Manifest{}, fmt.Errorf("cannot decode the manifest: %w", err)
	}
	m.Normalize()
	return m, nil
}

// Marshal renders the manifest as an indented JSON document.
func (m Manifest) Marshal() ([]byte, error) {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("cannot encode the manifest: %w", err)
	}
	return data, nil
}
