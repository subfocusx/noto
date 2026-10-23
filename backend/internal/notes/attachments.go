package notes

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"noto/backend/internal/model"
)

// allowedAttachmentMIMEs are the content types that may be uploaded.
var allowedAttachmentMIMEs = map[string]bool{
	"image/png":       true,
	"image/jpeg":      true,
	"image/gif":       true,
	"image/webp":      true,
	"image/svg+xml":   true,
	"application/pdf": true,
	"text/plain":      true,
}

// attachmentExtensions maps a content type to the extension of the stored file.
var attachmentExtensions = map[string]string{
	"image/png":       ".png",
	"image/jpeg":      ".jpg",
	"image/gif":       ".gif",
	"image/webp":      ".webp",
	"image/svg+xml":   ".svg",
	"application/pdf": ".pdf",
	"text/plain":      ".txt",
}

// UploadAttachment stores an uploaded binary. The content type is detected on
// the server, the client supplied name and mime type are never trusted.
func (s *Service) UploadAttachment(ctx context.Context, filename string, content []byte, notePath string) (model.Attachment, error) {
	if int64(len(content)) > s.cfg.MaxUploadBytes {
		return model.Attachment{}, newErr(ErrPayloadTooLarge, "the attachment is too large")
	}
	if len(content) == 0 {
		return model.Attachment{}, newErr(ErrBadRequest, "the attachment is empty")
	}
	mime := sniffAttachmentMIME(content)
	if !allowedAttachmentMIMEs[mime] {
		return model.Attachment{}, newErr(ErrUnsupportedMedia, "this file type is not allowed")
	}
	if notePath != "" {
		norm, err := normalizeRel(notePath)
		if err != nil {
			return model.Attachment{}, err
		}
		if _, err := s.resolve(norm); err != nil {
			return model.Attachment{}, err
		}
		notePath = norm
	}
	id := randomID()
	storedName := id + attachmentExtensions[mime]
	target := filepath.Join(s.attachRoot, storedName)
	if err := os.WriteFile(target, content, 0o644); err != nil {
		return model.Attachment{}, newErr(ErrInternal, "cannot store the attachment")
	}
	att := model.Attachment{
		ID:        id,
		Name:      sanitizeUploadName(filename),
		MIME:      mime,
		Size:      int64(len(content)),
		NotePath:  notePath,
		CreatedAt: time.Now().UTC(),
	}
	if att.Name == "" {
		att.Name = storedName
	}
	if err := s.store.PutAttachment(ctx, att); err != nil {
		_ = os.Remove(target)
		return model.Attachment{}, newErr(ErrInternal, "cannot store the attachment metadata")
	}
	return att, nil
}

// sniffAttachmentMIME detects the content type of the given bytes.
func sniffAttachmentMIME(content []byte) string {
	sniff := content
	if len(sniff) > 512 {
		sniff = sniff[:512]
	}
	mime := http.DetectContentType(sniff)
	base := strings.ToLower(strings.TrimSpace(strings.Split(mime, ";")[0]))
	switch base {
	case "text/xml", "application/xml", "text/plain", "text/html":
		lower := bytes.ToLower(content)
		if bytes.Contains(lower, []byte("<svg")) {
			return "image/svg+xml"
		}
	}
	return base
}

// ListAttachments returns every stored attachment.
func (s *Service) ListAttachments(ctx context.Context) ([]model.Attachment, error) {
	list, err := s.store.ListAttachments(ctx)
	if err != nil {
		return nil, newErr(ErrInternal, "cannot read the attachments")
	}
	if list == nil {
		list = []model.Attachment{}
	}
	return list, nil
}

// GetAttachment returns the metadata of a single attachment.
func (s *Service) GetAttachment(ctx context.Context, id string) (model.Attachment, error) {
	if !isHexID(id) {
		return model.Attachment{}, newErr(ErrNotFound, "attachment not found")
	}
	att, found, err := s.store.GetAttachment(ctx, id)
	if err != nil {
		return model.Attachment{}, newErr(ErrInternal, "cannot read the attachment")
	}
	if !found {
		return model.Attachment{}, newErr(ErrNotFound, "attachment not found")
	}
	return att, nil
}

// AttachmentContent returns the metadata and the bytes of an attachment.
func (s *Service) AttachmentContent(ctx context.Context, id string) (model.Attachment, []byte, error) {
	att, err := s.GetAttachment(ctx, id)
	if err != nil {
		return model.Attachment{}, nil, err
	}
	data, err := os.ReadFile(s.attachmentPath(att))
	if err != nil {
		return model.Attachment{}, nil, newErr(ErrNotFound, "attachment not found")
	}
	return att, data, nil
}

// DeleteAttachment removes an attachment and its bytes.
func (s *Service) DeleteAttachment(ctx context.Context, id string) error {
	att, err := s.GetAttachment(ctx, id)
	if err != nil {
		return err
	}
	if err := os.Remove(s.attachmentPath(att)); err != nil && !os.IsNotExist(err) {
		return newErr(ErrInternal, "cannot delete the attachment")
	}
	if err := s.store.DeleteAttachment(ctx, id); err != nil {
		return newErr(ErrInternal, "cannot delete the attachment metadata")
	}
	return nil
}

// attachmentPath returns the path of the stored attachment bytes.
func (s *Service) attachmentPath(att model.Attachment) string {
	return filepath.Join(s.attachRoot, att.ID+attachmentExtensions[att.MIME])
}

// isHexID reports whether the string is a plausible random identifier.
func isHexID(id string) bool {
	if len(id) < 8 || len(id) > 64 {
		return false
	}
	for _, r := range id {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}
