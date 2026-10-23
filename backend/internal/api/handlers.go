package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"noto/backend/internal/notes"
)

// handleHealth answers the health probe.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": Version,
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

// handleTree returns the flat folder and file lists.
func (s *Server) handleTree(w http.ResponseWriter, r *http.Request) {
	folders, files, err := s.svc.Tree(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"folders": folders,
		"files":   files,
	})
}

// createRequest is the body of the folder and file creation endpoints.
type createRequest struct {
	ParentPath string `json:"parentPath"`
	Name       string `json:"name"`
}

// handleCreateFolder creates a folder.
func (s *Server) handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	node, err := s.svc.CreateFolder(r.Context(), req.ParentPath, req.Name)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, node)
}

// handleCreateFile creates an empty Markdown file.
func (s *Server) handleCreateFile(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	node, err := s.svc.CreateFile(r.Context(), req.ParentPath, req.Name)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, node)
}

// handleGetNote returns the content of a note.
func (s *Server) handleGetNote(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if strings.TrimSpace(p) == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path parameter is required", notes.ErrBadRequest))
		return
	}
	content, err := s.svc.Read(r.Context(), p)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, content)
}

// writeRequest is the body of the note write endpoint.
type writeRequest struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Revision int64  `json:"revision"`
}

// handlePutNote writes a note.
func (s *Server) handlePutNote(w http.ResponseWriter, r *http.Request) {
	var req writeRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path field is required", notes.ErrBadRequest))
		return
	}
	res, err := s.svc.Write(r.Context(), req.Path, req.Content, req.Revision)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// renameRequest is the body of the rename endpoint.
type renameRequest struct {
	Path    string `json:"path"`
	NewName string `json:"newName"`
}

// handleRename renames a file or folder.
func (s *Server) handleRename(w http.ResponseWriter, r *http.Request) {
	var req renameRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	node, err := s.svc.Rename(r.Context(), req.Path, req.NewName)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, node)
}

// moveRequest is the body of the move endpoint.
type moveRequest struct {
	Path          string `json:"path"`
	NewParentPath string `json:"newParentPath"`
}

// handleMove moves a file or folder.
func (s *Server) handleMove(w http.ResponseWriter, r *http.Request) {
	var req moveRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	node, err := s.svc.Move(r.Context(), req.Path, req.NewParentPath)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, node)
}

// handleDelete moves a note or folder to the trash.
func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if strings.TrimSpace(p) == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path parameter is required", notes.ErrBadRequest))
		return
	}
	if err := s.svc.Delete(r.Context(), p); err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// restoreRequest is the body of the restore endpoint.
type restoreRequest struct {
	TrashPath string `json:"trashPath"`
}

// handleRestore restores a trashed entry.
func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	var req restoreRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	node, err := s.svc.Restore(r.Context(), req.TrashPath)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, node)
}

// handleTrash lists the trashed entries.
func (s *Server) handleTrash(w http.ResponseWriter, r *http.Request) {
	entries, err := s.svc.Trash(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

// handleSearch searches the index.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	hits, err := s.svc.Search(r.Context(), q, limit)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hits": hits})
}

// handleReindex rebuilds the search index.
func (s *Server) handleReindex(w http.ResponseWriter, r *http.Request) {
	count, err := s.svc.Reindex(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"indexed": count})
}

// handleImportFiles imports uploaded Markdown files.
func (s *Server) handleImportFiles(w http.ResponseWriter, r *http.Request) {
	if err := s.parseMultipart(w, r); err != nil {
		writeError(w, s.log, multipartError(err))
		return
	}
	target := r.FormValue("targetPath")
	conflict := r.FormValue("conflict")
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "no files were uploaded", notes.ErrBadRequest))
		return
	}
	var uploads []notes.UploadedFile
	for _, fh := range files {
		f, err := fh.Open()
		if err != nil {
			writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the uploaded file cannot be read", notes.ErrBadRequest))
			return
		}
		data, err := io.ReadAll(io.LimitReader(f, s.cfg.MaxUploadBytes+1))
		f.Close()
		if err != nil {
			writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the uploaded file cannot be read", notes.ErrBadRequest))
			return
		}
		if int64(len(data)) > s.cfg.MaxUploadBytes {
			writeError(w, s.log, notes.NewError(notes.CodePayloadTooLarge, "the uploaded file is too large", notes.ErrPayloadTooLarge))
			return
		}
		uploads = append(uploads, notes.UploadedFile{Name: fh.Filename, Content: data})
	}
	result, err := s.svc.ImportFiles(r.Context(), uploads, target, conflict)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// handleImportZip imports a ZIP archive.
func (s *Server) handleImportZip(w http.ResponseWriter, r *http.Request) {
	if err := s.parseMultipart(w, r); err != nil {
		writeError(w, s.log, multipartError(err))
		return
	}
	target := r.FormValue("targetPath")
	conflict := r.FormValue("conflict")
	files := r.MultipartForm.File["file"]
	if len(files) == 0 {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "no archive was uploaded", notes.ErrBadRequest))
		return
	}
	f, err := files[0].Open()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the uploaded archive cannot be read", notes.ErrBadRequest))
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, s.cfg.MaxUploadBytes+1))
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the uploaded archive cannot be read", notes.ErrBadRequest))
		return
	}
	if int64(len(data)) > s.cfg.MaxUploadBytes {
		writeError(w, s.log, notes.NewError(notes.CodePayloadTooLarge, "the uploaded archive is too large", notes.ErrPayloadTooLarge))
		return
	}
	result, err := s.svc.ImportZip(r.Context(), data, target, conflict)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// parseMultipart parses a multipart upload body. The whole request body is
// limited to cfg.MaxUploadBytes, so a body that exceeds the limit is
// rejected instead of being spooled to disk.
func (s *Server) parseMultipart(w http.ResponseWriter, r *http.Request) error {
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes)
	return r.ParseMultipartForm(s.cfg.MaxUploadBytes)
}

// multipartError maps a multipart parsing error to an API error.
func multipartError(err error) error {
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		return notes.NewError(notes.CodePayloadTooLarge, "the upload is too large", notes.ErrPayloadTooLarge)
	}
	return notes.NewError(notes.CodeBadRequest, "the upload cannot be read", notes.ErrBadRequest)
}

// handleExportNote serves a single note as a Markdown download.
func (s *Server) handleExportNote(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	name, data, err := s.svc.ExportNote(r.Context(), p)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", contentDisposition(name))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// handleExportFolder serves a folder as a ZIP download.
func (s *Server) handleExportFolder(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if strings.TrimSpace(p) == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path parameter is required", notes.ErrBadRequest))
		return
	}
	// The archive is built before the status code is written, so that a
	// failure is reported with the proper error code instead of an empty
	// download.
	data, err := s.svc.ExportFolderBytes(r.Context(), p)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	name := notes.BaseName(p) + ".zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", contentDisposition(name))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// handleExportAll serves the whole library as a ZIP download.
func (s *Server) handleExportAll(w http.ResponseWriter, r *http.Request) {
	data, err := s.svc.ExportAllBytes(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", contentDisposition("notes.zip"))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

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
	att, err := s.svc.UploadAttachment(r.Context(), files[0].Filename, data, r.FormValue("notePath"))
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, att)
}

// handleListAttachments lists the stored attachments.
func (s *Server) handleListAttachments(w http.ResponseWriter, r *http.Request) {
	list, err := s.svc.ListAttachments(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"attachments": list})
}

// handleRawAttachment serves the bytes of an attachment.
func (s *Server) handleRawAttachment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	att, data, err := s.svc.AttachmentContent(r.Context(), id)
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
	if err := s.svc.DeleteAttachment(r.Context(), id); err != nil {
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
