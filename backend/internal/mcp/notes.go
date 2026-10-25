package mcp

import (
	"context"
	"time"
)

// Note is the summary of a note.
type Note struct {
	// Path is the path of the note, relative to the notes root.
	Path string `json:"path"`
	// Name is the name of the file of the note.
	Name string `json:"name"`
	// Revision is the revision of the content of the note.
	Revision int64 `json:"revision"`
	// Size is the size of the file of the note in bytes.
	Size int64 `json:"size"`
	// UpdatedAt is the moment the note was changed.
	UpdatedAt time.Time `json:"updatedAt"`
}

// Content is the content of a note.
type Content struct {
	// Path is the path of the note.
	Path string `json:"path"`
	// Content is the text of the note.
	Content string `json:"content"`
	// Revision is the revision of the content of the note.
	Revision int64 `json:"revision"`
	// UpdatedAt is the moment the note was changed.
	UpdatedAt time.Time `json:"updatedAt"`
}

// Hit is a result of a search.
type Hit struct {
	// Path is the path of the note.
	Path string `json:"path"`
	// Name is the name of the file of the note.
	Name string `json:"name"`
	// Kind is "name" or "content".
	Kind string `json:"kind"`
	// Snippet is the excerpt of the text of the note.
	Snippet string `json:"snippet"`
}

// Notes is the view of the notes that the tools of the protocol use. The
// implementation lives in the API package, so that the protocol never
// depends on the service of the notes.
type Notes interface {
	// List returns the summary of every note of the vault.
	List(ctx context.Context) ([]Note, error)
	// Read returns the content of a note.
	Read(ctx context.Context, path string) (Content, error)
	// Create creates a note and returns its summary.
	Create(ctx context.Context, path, content string) (Note, error)
	// Update writes the content of a note. A revision of zero forces the
	// write.
	Update(ctx context.Context, path, content string, revision int64) (Note, error)
	// Delete moves a note to the trash.
	Delete(ctx context.Context, path string) error
	// Search returns the notes that match a text.
	Search(ctx context.Context, query string, limit int) ([]Hit, error)
}
