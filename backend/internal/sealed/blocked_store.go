package sealed

import (
	"context"
	"errors"

	"noto/backend/internal/model"
	"noto/backend/internal/port"
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

// PutTrash refuses to record a deleted entry.
func (b blockedStore) PutTrash(ctx context.Context, originalPath, trashPath string, kind model.NodeType, size int64) error {
	return err()
}

// ListTrash refuses to list the trashed entries.
func (b blockedStore) ListTrash(ctx context.Context) ([]model.Node, error) { return nil, err() }

// DeleteTrash refuses to remove a trashed entry.
func (b blockedStore) DeleteTrash(ctx context.Context, trashPath string) error { return err() }
