// Package model contains the shared domain types of the Noto notes backend.
// These types are part of the JSON contract of the REST API.
package model

import (
	"encoding/json"
	"time"
)

// NodeType distinguishes files from folders in the notes tree.
type NodeType string

const (
	// NodeFile is a Markdown file.
	NodeFile NodeType = "file"
	// NodeFolder is a directory that may contain files and subfolders.
	NodeFolder NodeType = "folder"
)

// Node is a single entry of the notes tree. Path is a slash separated path
// relative to the notes root and never starts with a slash.
type Node struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	Type       NodeType  `json:"type"`
	ParentPath string    `json:"parentPath"`
	Size       int64     `json:"size"`
	ModTime    time.Time `json:"modTime"`
	Revision   int64     `json:"revision"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// NoteContent is the full body of a Markdown note plus its revision.
type NoteContent struct {
	Path      string    `json:"path"`
	Content   string    `json:"content"`
	Revision  int64     `json:"revision"`
	UpdatedAt time.Time `json:"updatedAt"`
	// Conflict is true when the client sent a stale revision. The server then
	// refuses to overwrite and returns the current server state instead.
	Conflict bool `json:"conflict"`
}

// SearchHit is a single search result.
type SearchHit struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Kind    string `json:"kind"` // "name" or "content"
	Snippet string `json:"snippet"`
}

// The bits of the derived properties of a note.
//
// The properties are derived from the text of the note in one pass (see the
// package `internal/metadata`). They are a CACHE: the file on the disk stays
// the source of truth, and the cache is rebuilt when the note is saved or when
// the index is rebuilt.
const (
	// PropHasTaskList marks a note that contains a task list.
	PropHasTaskList uint32 = 1 << iota
	// PropHasIncompleteTasks marks a note that contains a task that is not
	// done yet.
	PropHasIncompleteTasks
	// PropHasCode marks a note that contains a code block or inline code.
	PropHasCode
	// PropHasImage marks a note that contains an image.
	PropHasImage
	// PropHasLink marks a note that contains a link.
	PropHasLink
	// PropStale marks a note whose properties could not be recalculated.
	// The note itself is intact; the next reindex repairs the row.
	PropStale
)

// NoteProps are the properties derived from the text of a note.
type NoteProps struct {
	// Path is the path of the note relative to the notes root.
	Path string `json:"path"`
	// Name is the file name of the note.
	Name string `json:"name"`
	// Title is the text of the first heading of the note, empty when the note
	// has none.
	Title string `json:"title"`
	// Tags are the tags of the note, lower cased, without the `#`.
	Tags []string `json:"tags"`
	// Flags is the bit mask of the boolean properties.
	Flags uint32 `json:"flags"`
	// UpdatedAt is the moment the properties were calculated.
	UpdatedAt time.Time `json:"updatedAt"`
}

// NoteVersion is an immutable snapshot of the content of a note.
//
// The versions are the history of a note: every write of the content of a note
// appends a new version. A version is never modified and never deleted, so
// the history of a note is always complete.
//
// The path is the identifier of the note inside the store: it is the primary
// key of the metadata and it survives the renames of the note, because the
// history follows the note and not its name.
type NoteVersion struct {
	// Path is the path of the note relative to the notes root.
	Path string `json:"path"`
	// Revision is the revision of the note that this version holds. It is
	// the revision counter of the note, so the versions of a note are
	// numbered without a gap.
	Revision int64 `json:"revision"`
	// Title is the title of the note at the moment of the version. It is
	// empty when the note had no heading.
	Title string `json:"title"`
	// Content is the text of the note at the moment of the version.
	Content string `json:"content"`
	// CreatedAt is the moment the version was written.
	CreatedAt time.Time `json:"createdAt"`
}

// NodePage is a page of the children of a folder.
//
// The page is the answer of the lazy loading of the tree: the interface asks
// for one page at a time and follows the cursor when it needs more.
type NodePage struct {
	// Items are the children of the folder of the page, ordered by path.
	Items []Node `json:"items"`
	// NextCursor is the cursor of the next page. It is empty when the page
	// is the last one.
	NextCursor string `json:"nextCursor,omitempty"`
}

// DerivedProps is the cache of the derived properties of a note.
//
// The properties are derived from the text of a note. They are a CACHE: the
// file on the disk stays the source of truth, and the row is marked as stale
// when the note changes. A stale row is repaired by a recomputation.
type DerivedProps struct {
	// Path is the path of the note relative to the notes root.
	Path string `json:"path"`
	// Derived is the JSON blob of the derived properties. Its shape belongs
	// to the layer that computes it, the store only keeps the bytes.
	Derived json.RawMessage `json:"derived"`
	// ComputedAt is the moment the properties were calculated.
	ComputedAt time.Time `json:"computedAt"`
	// Stale is true when the note changed since the last calculation.
	Stale bool `json:"stale"`
}

// TagCount is a tag of the vault and the number of the notes that carry it.
type TagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

// Attachment is an uploaded binary stored outside of the notes directory.
type Attachment struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	MIME      string    `json:"mime"`
	Size      int64     `json:"size"`
	NotePath  string    `json:"notePath,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// ImportResult summarizes one import operation.
type ImportResult struct {
	Imported []string `json:"imported"`
	Skipped  []string `json:"skipped"`
	Errors   []string `json:"errors"`
}

// APIError is the body of every non-2xx JSON response.
type APIError struct {
	Error ErrorBody `json:"error"`
}

// ErrorBody carries a stable machine readable code and a human readable message.
type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	// Current is set for revision_conflict and contains the server side state.
	Current *NoteContent `json:"current,omitempty"`
}
