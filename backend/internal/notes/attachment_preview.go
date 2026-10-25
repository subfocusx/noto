package notes

import (
	"bytes"
	"context"
	"image"

	// The decoders of the standard library register the formats they know,
	// so that image.DecodeConfig can read the size of an image.
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
)

// AttachmentPreview describes the file of an attachment: its content type and
// the size of the image it holds.
//
// The size is read from the bytes of the file, never from the name of the
// file: a file that is not an image the standard library can read has no size
// (0 × 0).
type AttachmentPreview struct {
	// MIME is the content type of the attachment.
	MIME string `json:"mime"`
	// Width is the width of the image in pixels, 0 when the attachment is
	// not an image.
	Width int `json:"width"`
	// Height is the height of the image in pixels, 0 when the attachment is
	// not an image.
	Height int `json:"height"`
}

// AttachmentPreview returns the metadata of the preview of an attachment.
//
// The size of the image is read from the bytes themselves. A file that the
// standard library cannot read (a PDF, a text file, a WebP image) has no
// size: the width and the height are then 0.
func (s *Service) AttachmentPreview(ctx context.Context, id string) (AttachmentPreview, error) {
	att, data, err := s.AttachmentContent(ctx, id)
	if err != nil {
		return AttachmentPreview{}, err
	}
	preview := AttachmentPreview{MIME: att.MIME}
	if preview.MIME == "" {
		preview.MIME = "application/octet-stream"
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		// The file is not an image that the standard library can read: the
		// preview has no size, but the file is there.
		return preview, nil
	}
	preview.Width = config.Width
	preview.Height = config.Height
	return preview, nil
}
