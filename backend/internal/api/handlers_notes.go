package api

import (
	"net/http"
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
