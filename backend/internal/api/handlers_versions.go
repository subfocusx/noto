package api

import (
	"net/http"
	"strconv"
	"strings"

	"noto/backend/internal/audit"
	"noto/backend/internal/notes"
)

// The endpoints of the history of the versions of a note.
//
// The history is append only: every write of a note appends a version, and a
// restore is a new write. The versions of a note that does not exist are
// reported with the code not_found.

// handleListVersions returns the history of a note.
func (s *Server) handleListVersions(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path parameter is required", notes.ErrBadRequest))
		return
	}
	versions, err := s.service().Versions(r.Context(), path)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": versions})
}

// handleVersionDiff returns the difference between two versions of a note.
func (s *Server) handleVersionDiff(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	path := strings.TrimSpace(query.Get("path"))
	if path == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path parameter is required", notes.ErrBadRequest))
		return
	}
	from, err := revisionParameter(query.Get("from"))
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	to, err := revisionParameter(query.Get("to"))
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	diff, err := s.service().DiffVersion(r.Context(), path, from, to)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, diff)
}

// revisionParameter reads a revision from a query parameter. A revision is a
// positive number.
func revisionParameter(raw string) (int64, error) {
	revision, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || revision <= 0 {
		return 0, notes.NewError(notes.CodeBadRequest, "a revision must be a positive number", notes.ErrBadRequest)
	}
	return revision, nil
}

// restoreVersionRequest is the body of the restore of a version.
type restoreVersionRequest struct {
	// Path is the path of the note.
	Path string `json:"path"`
	// Revision is the revision of the version to restore.
	Revision int64 `json:"revision"`
}

// handleRestoreVersion writes the content of a version back into the note.
//
// The restore is a new write: the revision of the note grows and the restored
// text becomes the last version of the history.
func (s *Server) handleRestoreVersion(w http.ResponseWriter, r *http.Request) {
	var req restoreVersionRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path field is required", notes.ErrBadRequest))
		return
	}
	if req.Revision <= 0 {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the revision must be a positive number", notes.ErrBadRequest))
		return
	}
	result, err := s.service().RestoreVersion(r.Context(), req.Path, req.Revision)
	if err != nil {
		s.recordAudit(r, audit.ActionNoteUpdated, req.Path, audit.ResultError)
		writeError(w, s.log, err)
		return
	}
	content, err := s.service().Read(r.Context(), result.Path)
	if err != nil {
		s.recordAudit(r, audit.ActionNoteUpdated, result.Path, audit.ResultError)
		writeError(w, s.log, err)
		return
	}
	s.recordAudit(r, audit.ActionNoteUpdated, result.Path, audit.ResultOK)
	writeJSON(w, http.StatusOK, content)
}
