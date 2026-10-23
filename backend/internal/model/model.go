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
