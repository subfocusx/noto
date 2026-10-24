// Package model contains the shared domain types of the Noto notes backend.
// These types are part of the JSON contract of the REST API.
package model

import "time"

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
