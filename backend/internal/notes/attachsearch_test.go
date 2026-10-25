package notes_test

import (
	"context"
	"strings"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// TestExtractAttachmentText checks the extraction of the searchable text of an
// attachment.
func TestExtractAttachmentText(t *testing.T) {
	cases := []struct {
		name    string
		file    string
		mime    string
		content []byte
		want    bool
	}{
		{"a plain text", "notes.txt", "text/plain", []byte("hello"), true},
		{"a markdown file", "notes.md", "text/plain", []byte("# hello"), true},
		{"a markdown type", "notes.bin", "text/markdown", []byte("# hello"), true},
		{"a markdown extension", "notes.markdown", "application/octet-stream", []byte("hello"), true},
		{"an image", "photo.png", "image/png", []byte("\x89PNG"), false},
		{"a pdf", "doc.pdf", "application/pdf", []byte("%PDF"), false},
		{"bytes that are not text", "notes.txt", "text/plain", []byte{0xff, 0xfe, 0x00}, false},
		{"an empty file", "notes.txt", "text/plain", nil, false},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			text, ok := notes.ExtractAttachmentText(c.file, c.mime, c.content)
			if ok != c.want {
				t.Fatalf("the extraction of %q returned %q (%v), want %v", c.file, text, ok, c.want)
			}
			if ok && !strings.Contains(text, "hello") {
				t.Fatalf("unexpected text %q", text)
			}
		})
	}
}

// TestAttachmentTextIsSearchable checks that the text of an attachment is
// indexed and that the search finds the note of the attachment.
func TestAttachmentTextIsSearchable(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create the file: %v", err)
	}
	if _, err := svc.Write(ctx, "note.md", "the body of the note", 0); err != nil {
		t.Fatalf("write the note: %v", err)
	}

	att, err := svc.UploadAttachment(ctx, "notes.txt", []byte("the pineapple is in the attachment"), "note.md")
	if err != nil {
		t.Fatalf("upload the attachment: %v", err)
	}
	if att.NotePath != "note.md" {
		t.Fatalf("unexpected attachment %+v", att)
	}

	hits, err := svc.Search(ctx, "pineapple", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	found := false
	for _, h := range hits {
		if h.Path == "note.md" {
			found = true
			if !strings.Contains(h.Snippet, "pineapple") {
				t.Fatalf("the snippet does not hold the term: %q", h.Snippet)
			}
		}
	}
	if !found {
		t.Fatalf("the text of the attachment is not searchable: %+v", hits)
	}

	// The bytes of a deleted attachment must not stay searchable.
	if err := svc.DeleteAttachment(ctx, att.ID); err != nil {
		t.Fatalf("delete the attachment: %v", err)
	}
	hits, err = svc.Search(ctx, "pineapple", 10)
	if err != nil {
		t.Fatalf("search again: %v", err)
	}
	for _, h := range hits {
		if h.Path == "note.md" {
			t.Fatalf("the text of the deleted attachment is still searchable: %+v", hits)
		}
	}
}

// TestAttachmentWithoutATextIsNotSearchable checks that an attachment that
// the server cannot read does not break the upload.
func TestAttachmentWithoutATextIsNotSearchable(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note.md"); err != nil {
		t.Fatalf("create the file: %v", err)
	}
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("\x00", 64))
	if _, err := svc.UploadAttachment(ctx, "photo.png", png, "note.md"); err != nil {
		t.Fatalf("upload the attachment: %v", err)
	}
	hits, err := svc.Search(ctx, "png", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	for _, h := range hits {
		if h.Path == "note.md" {
			t.Fatalf("an image was indexed: %+v", hits)
		}
	}
}
