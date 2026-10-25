package api

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"noto/backend/internal/notes"
)

// handleUploadAttachment stores an uploaded binary.
func (s *Server) handleUploadAttachment(w http.ResponseWriter, r *http.Request) {
	if err := s.parseMultipart(w, r); err != nil {
		writeError(w, s.log, multipartError(err))
		return
	}
	files := r.MultipartForm.File["file"]
	if len(files) == 0 {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "no file was uploaded", notes.ErrBadRequest))
		return
	}
	f, err := files[0].Open()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the uploaded file cannot be read", notes.ErrBadRequest))
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, s.cfg.MaxUploadBytes+1))
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the uploaded file cannot be read", notes.ErrBadRequest))
		return
	}
	if int64(len(data)) > s.cfg.MaxUploadBytes {
		writeError(w, s.log, notes.NewError(notes.CodePayloadTooLarge, "the uploaded file is too large", notes.ErrPayloadTooLarge))
		return
	}
	att, err := s.service().UploadAttachment(r.Context(), files[0].Filename, data, r.FormValue("notePath"))
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, att)
}

// handleListAttachments lists the stored attachments.
func (s *Server) handleListAttachments(w http.ResponseWriter, r *http.Request) {
	list, err := s.service().ListAttachments(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"attachments": list})
}

// handleRawAttachment serves the bytes of an attachment.
func (s *Server) handleRawAttachment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	att, data, err := s.service().AttachmentContent(r.Context(), id)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	mime := att.MIME
	if mime == "" {
		mime = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", contentDisposition(att.Name))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// handleDeleteAttachment removes an attachment.
func (s *Server) handleDeleteAttachment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.service().DeleteAttachment(r.Context(), id); err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// contentDisposition builds a safe Content-Disposition header value.
func contentDisposition(name string) string {
	name = strings.ReplaceAll(name, "\"", "")
	name = strings.ReplaceAll(name, "\r", "")
	name = strings.ReplaceAll(name, "\n", "")
	if name == "" {
		name = "download"
	}
	return fmt.Sprintf("attachment; filename=%q", name)
}

// attachmentSearchRequest is the body of the search inside the text of the
// attachments.
type attachmentSearchRequest struct {
	// Query is the text to look for.
	Query string `json:"query"`
	// Limit is the biggest number of the hits (50 by default).
	Limit int `json:"limit"`
}

// handleSearchAttachments searches the text of the attachments.
//
// The search uses the index of the text that was extracted from the
// attachments. An empty query is refused with the code bad_request.
func (s *Server) handleSearchAttachments(w http.ResponseWriter, r *http.Request) {
	var req attachmentSearchRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	hits, err := s.service().SearchAttachments(r.Context(), req.Query, req.Limit)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hits": hits})
}

// handleAttachmentContent serves the bytes of an attachment with the real
// content type of the file.
//
// The bytes are served inline: the interface uses the url as the source of an
// image and as a blob.
func (s *Server) handleAttachmentContent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	att, data, err := s.service().AttachmentContent(r.Context(), id)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	mime := att.MIME
	if mime == "" {
		mime = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", "inline; filename="+strconv.Quote(att.Name))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// handleAttachmentPreview answers with the metadata of the preview of an
// attachment: the content type, the size of the image and the url of the
// bytes.
//
// The size is read from the bytes of the file: a file that is not an image
// has a width and a height of 0.
func (s *Server) handleAttachmentPreview(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	preview, err := s.service().AttachmentPreview(r.Context(), id)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mime":   preview.MIME,
		"width":  preview.Width,
		"height": preview.Height,
		"url":    "/api/attachments/" + url.PathEscape(id) + "/content",
	})
}
