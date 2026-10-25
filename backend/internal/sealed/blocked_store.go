package sealed

import (
	"context"
	"errors"

	"noto/backend/internal/model"
	"noto/backend/internal/port"
	"noto/backend/internal/query"
)

// ErrVaultSealed is the sentinel error of the blocked store. It means that
// the vault is sealed and that the open pipeline of the notes must not be
// used at all.
var ErrVaultSealed = errors.New("vault_sealed")

// blockedStore is a port.Store that refuses every operation.
//
// It exists so that the notes service can be built in sealed mode without
// opening the SQLite database. The service is then wired to this store, so
// that an accidental call of the open pipeline fails loudly instead of
// writing a plaintext file or a plaintext row.
//
// The store never touches the disk.
type blockedStore struct{}

// NewBlockedStore creates a store that refuses every operation. It is used
// in sealed mode, where the server stores only ciphertext.
func NewBlockedStore() port.Store { return blockedStore{} }

// UpsertNoteProps refuses to store the properties of a note.
func (b blockedStore) UpsertNoteProps(ctx context.Context, p model.NoteProps) error { return err() }

// GetNoteProps refuses to return the properties of a note.
func (b blockedStore) GetNoteProps(ctx context.Context, path string) (model.NoteProps, bool, error) {
	return model.NoteProps{}, false, err()
}

// ListNoteProps refuses to list the properties of the notes.
func (b blockedStore) ListNoteProps(ctx context.Context) ([]model.NoteProps, error) { return nil, err() }

// DeleteNoteProps refuses to drop the properties of a note.
func (b blockedStore) DeleteNoteProps(ctx context.Context, path string) error { return err() }

// QueryNotes refuses to run a query: the properties of the notes live in the
// browser, not on the server.
func (b blockedStore) QueryNotes(ctx context.Context, e query.Expr, limit int) ([]model.SearchHit, error) {
	return nil, err()
}

// err returns the error of every refused operation.
func err() error { return ErrVaultSealed }

// Close releases the resources of the store. There is nothing to release,
// but the call is refused as well, so that the caller notices that the
// vault is sealed.
func (b blockedStore) Close() error { return err() }

// UpsertNote refuses to store the metadata of a note.
func (b blockedStore) UpsertNote(ctx context.Context, n model.Node) error { return err() }

// GetNote refuses to return the metadata of a note.
func (b blockedStore) GetNote(ctx context.Context, path string) (model.Node, bool, error) {
	return model.Node{}, false, err()
}

// DeleteNote refuses to remove the metadata of a note.
func (b blockedStore) DeleteNote(ctx context.Context, path string) error { return err() }

// MoveNote refuses to move the metadata of a note.
func (b blockedStore) MoveNote(ctx context.Context, fromPath, toPath string) error { return err() }

// ListNotes refuses to list the metadata of the notes.
func (b blockedStore) ListNotes(ctx context.Context) ([]model.Node, error) { return nil, err() }

// ListChildrenPaged refuses to list the children of a folder.
func (b blockedStore) ListChildrenPaged(ctx context.Context, parentPath, cursor string, limit int) (model.NodePage, error) {
	return model.NodePage{}, err()
}

// AppendVersion refuses to append a version of a note.
func (b blockedStore) AppendVersion(ctx context.Context, v model.NoteVersion) error { return err() }

// ListVersions refuses to list the history of a note.
func (b blockedStore) ListVersions(ctx context.Context, path string) ([]model.NoteVersion, error) {
	return nil, err()
}

// GetVersion refuses to return a version of a note.
func (b blockedStore) GetVersion(ctx context.Context, path string, revision int64) (model.NoteVersion, bool, error) {
	return model.NoteVersion{}, false, err()
}

// PutDerivedProps refuses to store the derived properties of a note.
func (b blockedStore) PutDerivedProps(ctx context.Context, d model.DerivedProps) error { return err() }

// GetDerivedProps refuses to return the derived properties of a note.
func (b blockedStore) GetDerivedProps(ctx context.Context, path string) (model.DerivedProps, bool, error) {
	return model.DerivedProps{}, false, err()
}

// MarkDerivedPropsStale refuses to mark the derived properties as stale.
func (b blockedStore) MarkDerivedPropsStale(ctx context.Context, path string) error { return err() }

// DeleteDerivedProps refuses to drop the derived properties of a note.
func (b blockedStore) DeleteDerivedProps(ctx context.Context, path string) error { return err() }

// IndexContent refuses to index the content of a note.
func (b blockedStore) IndexContent(ctx context.Context, path, name, content string) error {
	return err()
}

// RemoveContent refuses to drop a note from the search index.
func (b blockedStore) RemoveContent(ctx context.Context, path string) error { return err() }

// Search refuses to search the index.
func (b blockedStore) Search(ctx context.Context, query string, limit int) ([]model.SearchHit, error) {
	return nil, err()
}

// ClearIndex refuses to clear the search index.
func (b blockedStore) ClearIndex(ctx context.Context) error { return err() }

// PutAttachment refuses to store the metadata of an attachment.
func (b blockedStore) PutAttachment(ctx context.Context, a model.Attachment) error { return err() }

// ListAttachments refuses to list the attachments.
func (b blockedStore) ListAttachments(ctx context.Context) ([]model.Attachment, error) {
	return nil, err()
}

// GetAttachment refuses to return the metadata of an attachment.
func (b blockedStore) GetAttachment(ctx context.Context, id string) (model.Attachment, bool, error) {
	return model.Attachment{}, false, err()
}

// DeleteAttachment refuses to remove the metadata of an attachment.
func (b blockedStore) DeleteAttachment(ctx context.Context, id string) error { return err() }

// IndexAttachmentText refuses to index the text of an attachment.
func (b blockedStore) IndexAttachmentText(ctx context.Context, id, notePath, name, body string) error {
	return err()
}

// PutTrash refuses to record a deleted entry.
func (b blockedStore) PutTrash(ctx context.Context, originalPath, trashPath string, kind model.NodeType, size int64) error {
	return err()
}

// ListTrash refuses to list the trashed entries.
func (b blockedStore) ListTrash(ctx context.Context) ([]model.Node, error) { return nil, err() }

// DeleteTrash refuses to remove a trashed entry.
func (b blockedStore) DeleteTrash(ctx context.Context, trashPath string) error { return err() }
