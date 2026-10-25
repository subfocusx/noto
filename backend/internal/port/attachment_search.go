package port

// AttachmentSearchHit is a match of the full text search inside the text of
// an attachment.
//
// The hit carries the identifiers of the attachment and of the note that owns
// it, so that the interface can open the note and the file. The snippet is the
// text around the match.
type AttachmentSearchHit struct {
	// AttachmentID is the identifier of the attachment that matched.
	AttachmentID string
	// NotePath is the path of the note that owns the attachment. It is empty
	// when the attachment is not attached to a note.
	NotePath string
	// Name is the name of the file of the attachment.
	Name string
	// MIME is the content type of the attachment.
	MIME string
	// Snippet is the text around the match.
	Snippet string
}
