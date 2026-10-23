package api

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"noto/backend/internal/notes"
)

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
