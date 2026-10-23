package api

import (
	"errors"
	"net/http"
	"strings"

	"noto/backend/internal/model"
	"noto/backend/internal/notes"
	"noto/backend/internal/vault"
)

// vaultStatus is the answer of the vault status endpoint.
type vaultStatus struct {
	// Configured reports whether a vault is in use.
	Configured bool `json:"configured"`
	// Path is the absolute path of the vault.
	Path string `json:"path"`
	// NotesDir is the directory that holds the Markdown notes.
	NotesDir string `json:"notesDir"`
	// Fixed reports whether the storage was fixed by the environment. Such a
	// storage cannot be changed at runtime.
	Fixed bool `json:"fixed"`
}

// vaultRequest is the body of the vault selection endpoint.
type vaultRequest struct {
	// Path is the absolute path of the vault directory.
	Path string `json:"path"`
}

// vaultResult is the answer of a successful vault selection.
type vaultResult struct {
	OK bool `json:"ok"`
	// Path is the absolute path of the selected vault.
	Path string `json:"path"`
}

// handleGetVault reports the vault the server is currently serving.
func (s *Server) handleGetVault(w http.ResponseWriter, r *http.Request) {
	path, notesDir := s.vaultState()
	writeJSON(w, http.StatusOK, vaultStatus{
		Configured: path != "",
		Path:       path,
		NotesDir:   notesDir,
		Fixed:      s.vaultIsFixed(),
	})
}

// writeVaultFixedError answers a request that tried to change a storage that
// was fixed by the environment. The fixed storage is a normal state and not
// an internal error, so the dedicated code is used.
func writeVaultFixedError(w http.ResponseWriter) {
	body := model.APIError{Error: model.ErrorBody{
		Code:    notes.CodeVaultFixed,
		Message: "the storage is fixed by the environment",
	}}
	writeJSON(w, http.StatusBadRequest, body)
}

// handleSetVault selects a new vault and switches the service to it.
func (s *Server) handleSetVault(w http.ResponseWriter, r *http.Request) {
	// The fixed storage is checked before the body, so that the answer is
	// always the same, whatever the body is.
	if s.vaultIsFixed() {
		writeVaultFixedError(w)
		return
	}
	var req vaultRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the path field is required", notes.ErrBadRequest))
		return
	}
	layout, err := vault.Resolve(req.Path)
	if err != nil {
		writeError(w, s.log, vaultError(err))
		return
	}
	if s.factory == nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the vault cannot be changed at runtime", notes.ErrInternal))
		return
	}
	prev, hadPrev, err := vault.Read()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "cannot read the vault configuration", notes.ErrInternal))
		return
	}
	if _, err := vault.Write(layout.VaultPath); err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "cannot store the vault configuration", notes.ErrInternal))
		return
	}
	svc, closer, err := s.factory(layout.VaultPath)
	if err != nil {
		// The configuration is restored, so that a failed switch does not
		// change the vault of the next start.
		if hadPrev {
			_, _ = vault.Write(prev.Path)
		} else {
			_ = vault.Clear()
		}
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "cannot open the vault", notes.ErrInternal))
		return
	}
	s.setService(svc, closer)
	s.SetVaultPath(layout.VaultPath)
	s.log.Info("the vault was changed", "vault", layout.VaultPath)
	writeJSON(w, http.StatusOK, vaultResult{OK: true, Path: layout.VaultPath})
}

// handleDeleteVault removes the vault configuration and switches the service
// back to the default layout.
func (s *Server) handleDeleteVault(w http.ResponseWriter, r *http.Request) {
	if s.vaultIsFixed() {
		writeVaultFixedError(w)
		return
	}
	if s.factory == nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the vault cannot be changed at runtime", notes.ErrInternal))
		return
	}
	if err := vault.Clear(); err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "cannot remove the vault configuration", notes.ErrInternal))
		return
	}
	svc, closer, err := s.factory("")
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "cannot open the default directory", notes.ErrInternal))
		return
	}
	s.setService(svc, closer)
	s.SetVaultPath("")
	writeJSON(w, http.StatusOK, vaultResult{OK: true})
}

// handleBrowseVault lists the visible subdirectories of a directory. The
// listing is read only and never returns the content of a file.
func (s *Server) handleBrowseVault(w http.ResponseWriter, r *http.Request) {
	res, err := vault.Browse(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the directory cannot be listed", notes.ErrBadRequest))
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// vaultError maps an error of the vault package to an API error. The
// messages never contain the absolute path of the server.
func vaultError(err error) error {
	switch {
	case errors.Is(err, vault.ErrNotFound):
		return notes.NewError(notes.CodeBadRequest, "the vault directory does not exist", notes.ErrBadRequest)
	case errors.Is(err, vault.ErrInvalidPath):
		return notes.NewError(notes.CodeInvalidPath, "the vault path is not a usable directory", notes.ErrInvalidPath)
	default:
		return notes.NewError(notes.CodeInternal, "cannot use the vault path", notes.ErrInternal)
	}
}
