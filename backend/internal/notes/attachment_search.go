package notes

import (
	"context"
	"os"
	"strings"
	"unicode"

	"noto/backend/internal/port"
)

// The search inside the text of the attachments.
//
// The text of an attachment is extracted by the domain layer (see
// attachsearch.go) and indexed by the store. The search is answered by the
// index when the store knows how to answer it; a store that does not know is
// answered by reading the files, so that the behaviour does not depend on the
// engine.

// The limits of a search inside the attachments.
const (
	// defaultAttachmentSearchLimit is the number of the hits when the caller
	// does not ask for a specific limit.
	defaultAttachmentSearchLimit = 50
	// maxAttachmentSearchLimit is the biggest number of the hits a search
	// may return.
	maxAttachmentSearchLimit = 200
)

// AttachmentHit is a match of the search inside the text of an attachment.
type AttachmentHit struct {
	// NoteID is the identifier of the note that owns the attachment. It is
	// the path of the note inside the vault.
	NoteID string `json:"noteId"`
	// NotePath is the path of the note that owns the attachment.
	NotePath string `json:"notePath,omitempty"`
	// AttachmentID is the identifier of the attachment that matched.
	AttachmentID string `json:"attachmentId"`
	// Name is the name of the file of the attachment.
	Name string `json:"name"`
	// MIME is the content type of the attachment.
	MIME string `json:"mime"`
	// Snippet is the text around the match.
	Snippet string `json:"snippet"`
}

// attachmentSearcher is the optional capability of a store that can search
// the text of the attachments in its own index.
//
// The capability is optional on purpose: the interface of the store stays
// small, and a store that does not implement it is answered by the domain.
type attachmentSearcher interface {
	SearchAttachments(ctx context.Context, query string, limit int) ([]port.AttachmentSearchHit, error)
}

// SearchAttachments searches the text of the attachments.
//
// An empty query is refused with the code bad_request: a search without a
// term has no meaning.
func (s *Service) SearchAttachments(ctx context.Context, query string, limit int) ([]AttachmentHit, error) {
	term := strings.TrimSpace(query)
	if term == "" {
		return nil, newErr(ErrBadRequest, "the query is required")
	}
	if limit <= 0 {
		limit = defaultAttachmentSearchLimit
	}
	if limit > maxAttachmentSearchLimit {
		limit = maxAttachmentSearchLimit
	}

	if searcher, ok := s.store.(attachmentSearcher); ok {
		hits, err := searcher.SearchAttachments(ctx, term, limit)
		if err != nil {
			return nil, newErr(ErrInternal, "cannot search the attachments")
		}
		out := make([]AttachmentHit, 0, len(hits))
		for _, hit := range hits {
			out = append(out, AttachmentHit{
				NoteID:       hit.NotePath,
				NotePath:     hit.NotePath,
				AttachmentID: hit.AttachmentID,
				Name:         hit.Name,
				MIME:         hit.MIME,
				Snippet:      hit.Snippet,
			})
		}
		return out, nil
	}

	return s.searchAttachmentsOnDisk(ctx, term, limit)
}

// searchAttachmentsOnDisk searches the text of the attachments by reading the
// files. It is the answer of the stores that do not index the text of the
// attachments.
func (s *Service) searchAttachmentsOnDisk(ctx context.Context, query string, limit int) ([]AttachmentHit, error) {
	attachments, err := s.ListAttachments(ctx)
	if err != nil {
		return nil, err
	}
	tokens := attachmentTokens(query)
	if len(tokens) == 0 {
		return []AttachmentHit{}, nil
	}

	out := []AttachmentHit{}
	for _, att := range attachments {
		if len(out) >= limit {
			break
		}
		if att.NotePath == "" {
			// A hit without a note would be useless for the interface.
			continue
		}
		data, err := os.ReadFile(s.attachmentPath(att))
		if err != nil {
			// The bytes of the attachment are gone: the attachment is
			// skipped, the search continues.
			continue
		}
		text, ok := ExtractAttachmentText(att.Name, att.MIME, data)
		if !ok {
			continue
		}
		if !attachmentMatches(text, tokens) {
			continue
		}
		out = append(out, AttachmentHit{
			NoteID:       att.NotePath,
			NotePath:     att.NotePath,
			AttachmentID: att.ID,
			Name:         att.Name,
			MIME:         att.MIME,
			Snippet:      attachmentSnippet(text, tokens),
		})
	}
	return out, nil
}

// attachmentTokens splits a query into the terms of the search. The terms are
// lower cased and only the letters and the digits are kept.
func attachmentTokens(query string) []string {
	var tokens []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			tokens = append(tokens, cur.String())
			cur.Reset()
		}
	}
	for _, r := range query {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			cur.WriteRune(unicode.ToLower(r))
		default:
			flush()
		}
	}
	flush()
	return tokens
}

// attachmentMatches reports whether every term of the search occurs in the
// text.
func attachmentMatches(text string, tokens []string) bool {
	lower := strings.ToLower(text)
	for _, token := range tokens {
		if !strings.Contains(lower, token) {
			return false
		}
	}
	return true
}

// The size of the text around the match of a snippet.
const (
	// attachmentSnippetBefore is the number of the characters that precede
	// the match in a snippet.
	attachmentSnippetBefore = 40
	// attachmentSnippetAfter is the number of the characters that follow the
	// match in a snippet.
	attachmentSnippetAfter = 120
)

// attachmentSnippet builds the text around the first match of the search.
//
// The snippet carries the place of the match: it is cut around the first term
// that occurs in the text.
func attachmentSnippet(text string, tokens []string) string {
	if text == "" {
		return ""
	}
	lower := strings.ToLower(text)
	pos := -1
	for _, token := range tokens {
		if i := strings.Index(lower, token); i >= 0 && (pos < 0 || i < pos) {
			pos = i
		}
	}
	if pos < 0 {
		pos = 0
	}
	start := pos - attachmentSnippetBefore
	if start < 0 {
		start = 0
	}
	end := pos + len(tokens[0]) + attachmentSnippetAfter
	if end > len(text) {
		end = len(text)
	}
	out := text[start:end]
	if start > 0 {
		out = "…" + out
	}
	if end < len(text) {
		out += "…"
	}
	return out
}
