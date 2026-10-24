// Package port defines the interfaces that connect the business logic of the
// application to its infrastructure. The business logic depends only on these
// interfaces so that the storage engine can be implemented, replaced and
// tested independently.
package port

import (
	"context"

	"noto/backend/internal/model"
	"noto/backend/internal/query"
)

// Store persists note metadata, the full text search index, attachments
// metadata and trash entries. Implementations must be safe for concurrent use.
type Store interface {
	// Close releases the underlying resources.
	Close() error

	// UpsertNote inserts or updates the metadata of a note or folder.
	UpsertNote(ctx context.Context, n model.Node) error
	// GetNote returns the metadata of a single path.
	GetNote(ctx context.Context, path string) (model.Node, bool, error)
	// DeleteNote removes the metadata of a path.
	DeleteNote(ctx context.Context, path string) error
	// MoveNote moves the metadata of a path to a new path.
	MoveNote(ctx context.Context, fromPath, toPath string) error
	// ListNotes returns the metadata of every known note and folder.
	ListNotes(ctx context.Context) ([]model.Node, error)

	// IndexContent adds or replaces the searchable text of a path.
	IndexContent(ctx context.Context, path, name, content string) error
	// RemoveContent drops a path from the search index.
	RemoveContent(ctx context.Context, path string) error
	// Search returns ranked matches for a free text query.
	Search(ctx context.Context, query string, limit int) ([]model.SearchHit, error)
	// ClearIndex removes every entry from the search index.
	ClearIndex(ctx context.Context) error

	// PutAttachment stores the metadata of an uploaded attachment.
	PutAttachment(ctx context.Context, a model.Attachment) error
	// ListAttachments returns every known attachment.
	ListAttachments(ctx context.Context) ([]model.Attachment, error)
	// GetAttachment returns the metadata of a single attachment.
	GetAttachment(ctx context.Context, id string) (model.Attachment, bool, error)
	// DeleteAttachment removes the metadata of an attachment.
	DeleteAttachment(ctx context.Context, id string) error

	// PutTrash records a deleted entry so it can be restored.
	PutTrash(ctx context.Context, originalPath, trashPath string, kind model.NodeType, size int64) error
	// ListTrash returns every trashed entry.
	ListTrash(ctx context.Context) ([]model.Node, error)
	// DeleteTrash removes a trash entry.
	DeleteTrash(ctx context.Context, trashPath string) error

	// UpsertNoteProps inserts or replaces the derived properties of a note.
	//
	// The properties are a cache of the text of the note: the file on the disk
	// stays the source of truth.
	UpsertNoteProps(ctx context.Context, p model.NoteProps) error
	// GetNoteProps returns the derived properties of a single path.
	GetNoteProps(ctx context.Context, path string) (model.NoteProps, bool, error)
	// ListNoteProps returns the derived properties of every known note.
	ListNoteProps(ctx context.Context) ([]model.NoteProps, error)
	// DeleteNoteProps drops the derived properties of a path.
	DeleteNoteProps(ctx context.Context, path string) error
	// QueryNotes returns the notes that match a query of the query language.
	//
	// The query is compiled by the implementation: the store decides how the
	// selection is calculated (SQL in the open mode, a predicate over the
	// memory in the tests).
	QueryNotes(ctx context.Context, e query.Expr, limit int) ([]model.SearchHit, error)
}
