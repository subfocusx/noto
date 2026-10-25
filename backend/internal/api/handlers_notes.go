package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"noto/backend/internal/audit"
	"noto/backend/internal/model"
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

// treeFolder is a folder of the tree listing. It carries the counters of the
// notes and of the subfolders below the folder.
type treeFolder struct {
	model.Node
	// NoteCount is the number of notes under the folder, recursively.
	NoteCount int `json:"noteCount"`
	// FolderCount is the number of the direct child folders.
	FolderCount int `json:"folderCount"`
}

// handleTree returns the flat folder and file lists.
func (s *Server) handleTree(w http.ResponseWriter, r *http.Request) {
	folders, files, err := s.service().Tree(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	out := make([]treeFolder, 0, len(folders))
	for _, f := range folders {
		out = append(out, treeFolder{Node: f})
	}
	// The counters are computed from the lists of the listing, so that the
	// tree does not need an extra query and no column is needed.
	notesByFolder := map[string]int{}
	foldersByParent := map[string]int{}
	for _, f := range files {
		for parent := f.ParentPath; parent != ""; parent = parentOfPath(parent) {
			notesByFolder[parent]++
		}
	}
	for _, f := range out {
		foldersByParent[f.ParentPath]++
	}
	for i := range out {
		out[i].NoteCount = notesByFolder[out[i].Path]
		out[i].FolderCount = foldersByParent[out[i].Path]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"folders":     out,
		"files":       files,
		"noteTotal":   len(files),
		"folderTotal": len(folders),
	})
}

// handleTreePage serves one page of the children of a folder.
//
// The tree of the interface is loaded lazily: the client asks for the
// children of a folder and follows the cursor of the answer. Without the
// parameters the whole tree is returned (the answer of `GET /api/tree`).
//
//	GET /api/tree/children?parent=<path>&cursor=<path>&limit=<n>
//
// The answer is `{"items":[Node],"nextCursor":"<path>"}`; the cursor is empty
// when the page is the last one.
func (s *Server) handleTreePage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := 0
	if raw := q.Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the limit must be a positive number", notes.ErrBadRequest))
			return
		}
		limit = parsed
	}
	page, err := s.service().Children(r.Context(), q.Get("parent"), q.Get("cursor"), limit)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":      page.Items,
		"nextCursor": page.NextCursor,
	})
}

// parentOfPath returns the parent path of a slash separated relative path.
func parentOfPath(rel string) string {	i := strings.LastIndex(rel, "/")
	if i < 0 {
		return ""
	}
	return rel[:i]
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
	node, err := s.service().CreateFolder(r.Context(), req.ParentPath, req.Name)
	if err != nil {
		s.recordAudit(r, audit.ActionFolderCreated, req.Name, audit.ResultError)
		writeError(w, s.log, err)
		return
	}
	s.recordAudit(r, audit.ActionFolderCreated, node.Path, audit.ResultOK)
	writeJSON(w, http.StatusOK, node)
}

// handleCreateFile creates an empty Markdown file.
func (s *Server) handleCreateFile(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	node, err := s.service().CreateFile(r.Context(), req.ParentPath, req.Name)
	if err != nil {
		s.recordAudit(r, audit.ActionFileCreated, req.Name, audit.ResultError)
		writeError(w, s.log, err)
		return
	}
	s.recordAudit(r, audit.ActionFileCreated, node.Path, audit.ResultOK)
	writeJSON(w, http.StatusOK, node)
}

// handleGetNote returns the content of a note.
func (s *Server) handleGetNote(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if strings.TrimSpace(p) == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path parameter is required", notes.ErrBadRequest))
		return
	}
	content, err := s.service().Read(r.Context(), p)
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
	res, err := s.service().Write(r.Context(), req.Path, req.Content, req.Revision)
	if err != nil {
		s.recordAudit(r, audit.ActionNoteUpdated, req.Path, audit.ResultError)
		writeError(w, s.log, err)
		return
	}
	s.recordAudit(r, audit.ActionNoteUpdated, res.Path, audit.ResultOK)
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
	node, err := s.service().Rename(r.Context(), req.Path, req.NewName)
	if err != nil {
		s.recordAudit(r, audit.ActionNoteRenamed, req.Path, audit.ResultError)
		writeError(w, s.log, err)
		return
	}
	s.recordAudit(r, audit.ActionNoteRenamed, node.Path, audit.ResultOK)
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
	node, err := s.service().Move(r.Context(), req.Path, req.NewParentPath)
	if err != nil {
		s.recordAudit(r, audit.ActionNoteMoved, req.Path, audit.ResultError)
		writeError(w, s.log, err)
		return
	}
	s.recordAudit(r, audit.ActionNoteMoved, node.Path, audit.ResultOK)
	writeJSON(w, http.StatusOK, node)
}

// handleDelete moves a note or folder to the trash.
func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if strings.TrimSpace(p) == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path parameter is required", notes.ErrBadRequest))
		return
	}
	if err := s.service().Delete(r.Context(), p); err != nil {
		s.recordAudit(r, audit.ActionNoteDeleted, p, audit.ResultError)
		writeError(w, s.log, err)
		return
	}
	s.recordAudit(r, audit.ActionNoteDeleted, p, audit.ResultOK)
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
	node, err := s.service().Restore(r.Context(), req.TrashPath)
	if err != nil {
		s.recordAudit(r, audit.ActionNoteRestored, req.TrashPath, audit.ResultError)
		writeError(w, s.log, err)
		return
	}
	s.recordAudit(r, audit.ActionNoteRestored, node.Path, audit.ResultOK)
	writeJSON(w, http.StatusOK, node)
}

// duplicateRequest is the body of the duplicate endpoint.
type duplicateRequest struct {
	// Path is the relative path of the note that is copied.
	Path string `json:"path"`
}

// handleDuplicate copies a note next to the original and answers with the
// node of the copy. The content of the note is never written to the logs.
func (s *Server) handleDuplicate(w http.ResponseWriter, r *http.Request) {
	var req duplicateRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path field is required", notes.ErrBadRequest))
		return
	}
	node, err := s.service().Duplicate(r.Context(), req.Path)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, node)
}

// handleTrash lists the trashed entries.
func (s *Server) handleTrash(w http.ResponseWriter, r *http.Request) {
	entries, err := s.service().Trash(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}
