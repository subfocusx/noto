package api

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"noto/backend/internal/model"
	"noto/backend/internal/notes"
	"noto/backend/internal/sealed"
	"noto/backend/internal/vault"
)

// CodeVaultSealed is the stable error code of a request that needs the open
// pipeline of the notes while the vault is sealed. The code is not part of
// the notes package, because the notes package knows nothing about the
// sealed mode.
const CodeVaultSealed = "vault_sealed"

// sealedStatus is the answer of the status endpoint of a sealed vault.
type sealedStatus struct {
	// Mode is the mode of the vault.
	Mode string `json:"mode"`
	// Format is the version of the layout of the vault.
	Format int `json:"format"`
	// ObjectCount is the number of stored objects.
	ObjectCount int `json:"objectCount"`
	// Generations are the generations of the stored manifests.
	Generations []uint64 `json:"generations"`
}

// sealedIDs is the answer of the object listing endpoint.
type sealedIDs struct {
	IDs []string `json:"ids"`
}

// sealedGenerations is the answer of the manifest listing endpoint.
type sealedGenerations struct {
	Generations []uint64 `json:"generations"`
}

// sealedStore returns the blind object store of the vault. The store is
// created over the internal directory of the current vault, so that the
// sealed endpoints always work on the vault the server serves.
func (s *Server) sealedStore() (*sealed.Store, error) {
	s.sealedMu.RLock()
	store := s.sealedStoreRef
	s.sealedMu.RUnlock()
	if store != nil {
		return store, nil
	}
	return sealed.New(s.sealedRoot())
}

// sealedRoot returns the root directory of the sealed store: the internal
// directory of the vault.
func (s *Server) sealedRoot() string {
	path, _ := s.vaultState()
	if path != "" {
		return filepath.Join(path, vault.DataDirName)
	}
	return s.cfg.DataDir
}

// isSealed reports whether the vault is sealed. In sealed mode the open
// endpoints of the notes must not answer any more.
func (s *Server) isSealed() bool {
	s.sealedMu.RLock()
	defer s.sealedMu.RUnlock()
	return s.sealedMode
}

// SetSealedStore sets the blind object store of the server and switches the
// server to the sealed mode. It is used when the server starts in sealed
// mode, so that the open pipeline of the notes is never used.
func (s *Server) SetSealedStore(store *sealed.Store) {
	s.sealedMu.Lock()
	defer s.sealedMu.Unlock()
	s.sealedStoreRef = store
	s.sealedMode = true
}

// SetSealedMode switches the server between the open and the sealed mode.
func (s *Server) SetSealedMode(sealedMode bool) {
	s.sealedMu.Lock()
	defer s.sealedMu.Unlock()
	s.sealedMode = sealedMode
}

// Mode returns the mode of the vault: "sealed" or "open".
func (s *Server) Mode() string {
	if s.isSealed() {
		return sealed.ModeSealed
	}
	return sealed.ModeOpen
}

// openRoute wraps an endpoint of the open pipeline of the notes. In sealed
// mode the endpoint answers with a conflict instead of touching the notes,
// so that the server never writes a plaintext file.
func (s *Server) openRoute(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.isSealed() {
			writeVaultSealedError(w)
			return
		}
		h(w, r)
	}
}

// writeVaultSealedError answers a request that needs the open pipeline of
// the notes while the vault is sealed.
func writeVaultSealedError(w http.ResponseWriter) {
	body := model.APIError{Error: model.ErrorBody{
		Code: CodeVaultSealed,
		Message: "the vault is sealed: the notes are encrypted by the client and the server " +
			"stores only ciphertext",
	}}
	writeJSON(w, http.StatusConflict, body)
}

// writeSealedError maps an error of the sealed store to the error envelope
// of the API.
func writeSealedError(w http.ResponseWriter, log *slog.Logger, err error) {
	switch {
	case errors.Is(err, sealed.ErrInvalidID), errors.Is(err, sealed.ErrInvalidGeneration):
		writeError(w, log, notes.NewError(notes.CodeBadRequest, sealedErrorMessage(err), notes.ErrBadRequest))
	case errors.Is(err, os.ErrNotExist):
		writeError(w, log, notes.NewError(notes.CodeNotFound, "the sealed object does not exist", notes.ErrNotFound))
	case errors.Is(err, sealed.ErrTooLarge):
		writeError(w, log, notes.NewError(notes.CodePayloadTooLarge, "the payload is too large", notes.ErrPayloadTooLarge))
	default:
		writeError(w, log, notes.NewError(notes.CodeInternal, "cannot use the sealed store", notes.ErrInternal))
	}
}

// sealedErrorMessage returns the message of an invalid identifier. The
// message never contains a path of the server.
func sealedErrorMessage(err error) string {
	if errors.Is(err, sealed.ErrInvalidGeneration) {
		return "the generation must be a positive integer"
	}
	return "the identifier must be 32 lowercase hexadecimal characters"
}

// readSealedBody reads a request body with a size limit. A body that is too
// big is reported with the payload_too_large code.
func readSealedBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, notes.NewError(notes.CodePayloadTooLarge, "the request body is too large", notes.ErrPayloadTooLarge)
		}
		return nil, notes.NewError(notes.CodeBadRequest, "the request body cannot be read", notes.ErrBadRequest)
	}
	return data, nil
}

// writeRaw writes a raw payload with the given content type.
func writeRaw(w http.ResponseWriter, status int, contentType string, data []byte) {
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

// handleSealedStatus reports the state of a sealed vault.
func (s *Server) handleSealedStatus(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	mode, err := store.Mode(r.Context())
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "cannot read the mode of the vault", notes.ErrInternal))
		return
	}
	if mode != sealed.ModeSealed && !s.isSealed() {
		writeError(w, s.log, notes.NewError(notes.CodeNotFound, "the vault is not sealed", notes.ErrNotFound))
		return
	}
	ids, err := store.ListObjects(r.Context())
	if err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	gens, err := store.ListManifests(r.Context())
	if err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, sealedStatus{
		Mode:        sealed.ModeSealed,
		Format:      sealed.Format,
		ObjectCount: len(ids),
		Generations: gens,
	})
}

// handleGetSealedKeystore returns the keystore of the client.
func (s *Server) handleGetSealedKeystore(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	data, err := store.GetKeystore(r.Context())
	if err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	writeRaw(w, http.StatusOK, "application/json", data)
}

// handlePutSealedKeystore stores the keystore of the client.
func (s *Server) handlePutSealedKeystore(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	data, err := readSealedBody(w, r, sealed.MaxKeystoreSize)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	if err := store.PutKeystore(r.Context(), data); err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleListSealedObjects lists the identifiers of the stored objects.
func (s *Server) handleListSealedObjects(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	ids, err := store.ListObjects(r.Context())
	if err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, sealedIDs{IDs: ids})
}

// handleGetSealedObject returns an encrypted object.
func (s *Server) handleGetSealedObject(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	data, err := store.GetObject(r.Context(), r.PathValue("id"))
	if err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	writeRaw(w, http.StatusOK, "application/octet-stream", data)
}

// handlePutSealedObject stores an encrypted object.
func (s *Server) handlePutSealedObject(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	data, err := readSealedBody(w, r, sealed.MaxObjectSize)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	if err := store.PutObject(r.Context(), r.PathValue("id"), data); err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteSealedObject removes an encrypted object.
func (s *Server) handleDeleteSealedObject(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	if err := store.DeleteObject(r.Context(), r.PathValue("id")); err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleListSealedManifests lists the generations of the stored manifests.
func (s *Server) handleListSealedManifests(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	gens, err := store.ListManifests(r.Context())
	if err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, sealedGenerations{Generations: gens})
}

// handleGetSealedManifest returns an encrypted manifest.
func (s *Server) handleGetSealedManifest(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	gen, ok := sealedGeneration(w, s.log, r.PathValue("gen"))
	if !ok {
		return
	}
	data, err := store.GetManifest(r.Context(), gen)
	if err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	writeRaw(w, http.StatusOK, "application/octet-stream", data)
}

// handlePutSealedManifest stores an encrypted manifest.
func (s *Server) handlePutSealedManifest(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	gen, ok := sealedGeneration(w, s.log, r.PathValue("gen"))
	if !ok {
		return
	}
	data, err := readSealedBody(w, r, sealed.MaxObjectSize)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	if err := store.PutManifest(r.Context(), gen, data); err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteSealedManifest removes an encrypted manifest.
func (s *Server) handleDeleteSealedManifest(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	gen, ok := sealedGeneration(w, s.log, r.PathValue("gen"))
	if !ok {
		return
	}
	if err := store.DeleteManifest(r.Context(), gen); err != nil {
		writeSealedError(w, s.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// sealedGeneration reads the generation of a manifest from the path of the
// request. The generation must be a positive integer.
func sealedGeneration(w http.ResponseWriter, log *slog.Logger, raw string) (uint64, bool) {
	raw = strings.TrimSpace(raw)
	gen, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || gen == 0 {
		writeError(w, log, notes.NewError(notes.CodeBadRequest,
			"the generation must be a positive integer", notes.ErrBadRequest))
		return 0, false
	}
	return gen, true
}

// handleEnableSealed switches the server to the sealed mode. It writes the
// configuration file of the vault and marks the server as sealed.
//
// It does not delete or move any existing plaintext file: the migration of
// the plaintext is done by the client, which removes it only after its own
// verification.
func (s *Server) handleEnableSealed(w http.ResponseWriter, r *http.Request) {
	store, err := s.sealedStore()
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "the sealed store is not usable", notes.ErrInternal))
		return
	}
	if err := store.EnableSealed(r.Context()); err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal, "cannot store the mode of the vault", notes.ErrInternal))
		return
	}
	s.SetSealedMode(true)
	s.log.Info("the vault was sealed", "root", store.Root())
	w.WriteHeader(http.StatusNoContent)
}
