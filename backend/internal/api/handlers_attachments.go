package api

import (
	"fmt"
	"io"
	"net/http"
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
