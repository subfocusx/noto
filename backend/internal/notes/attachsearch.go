package notes

import (
	"strings"
	"unicode/utf8"
)

// The full text search over the attachments.
//
// The text of an attachment is extracted here, in the domain layer: the store
// keeps the bytes and answers the searches, it never parses a file.
//
// Only the plain text is indexed: a Markdown file and a text file. The other
// kinds of attachment (an image, a PDF) have no text that the server could
// read without a parser, so they are not searchable.

// maxAttachmentTextBytes bounds the size of the text that is extracted from
// an attachment. A bigger text is cut: the search index must stay small.
const maxAttachmentTextBytes = 256 * 1024

// ExtractAttachmentText returns the searchable text of an attachment.
//
// The second result is false when the attachment has no text that the server
// can read: the type is not a text type, or the bytes are not valid UTF-8.
// The name of the file is only a hint: the type of the content decides.
func ExtractAttachmentText(name, mime string, content []byte) (string, bool) {
	if !isTextAttachment(name, mime) {
		return "", false
	}
	if len(content) > maxAttachmentTextBytes {
		content = content[:maxAttachmentTextBytes]
	}
	if !utf8.Valid(content) {
		return "", false
	}
	text := strings.ReplaceAll(string(content), "\x00", " ")
	if strings.TrimSpace(text) == "" {
		return "", false
	}
	return text, true
}

// isTextAttachment reports whether the attachment may carry a text that the
// server can index.
//
// The content types "text/plain" and "text/markdown" are texts, and so are
// the files with the extension ".md" and ".txt".
func isTextAttachment(name, mime string) bool {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "text/plain", "text/markdown":
		return true
	}
	switch strings.ToLower(extensionOf(name)) {
	case "md", "markdown", "txt":
		return true
	}
	return false
}

// extensionOf returns the extension of a file name, without the dot, lower
// cased. It is empty when the name has no extension.
func extensionOf(name string) string {
	at := strings.LastIndex(name, ".")
	if at < 0 || at == len(name)-1 {
		return ""
	}
	return strings.ToLower(name[at+1:])
}
