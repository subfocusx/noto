package api

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"noto/backend/internal/notes"
	"noto/backend/internal/sealed"
)

// handlePurgePlaintext removes the plaintext files of a vault that has just
// been sealed.
//
// The migration of the plaintext is done by the client: it reads every note,
// encrypts it, writes the sealed object and verifies that the object can be
// decrypted again. Only when the verification has succeeded does the client
// ask the server to remove the plaintext that is left on the disk.
//
// The server only deletes the files of the notes directory, and never the
// internal directory of the vault (the sealed objects and the manifests live
// there). It cannot restore what it deletes: the call is the last step of the
// migration and it only happens after the client verified its copy.
func (s *Server) handlePurgePlaintext(w http.ResponseWriter, r *http.Request) {
	if !s.isSealed() {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest,
			"the vault is not sealed: there is nothing to purge", notes.ErrBadRequest))
		return
	}

	// The directory of the notes is the one of the vault the server serves
	// now: the storage can be changed at runtime, and the configuration of the
	// server still holds the directories of the previous storage.
	_, notesDir := s.vaultState()
	// The internal directory of the vault (the sealed objects, the manifests
	// and the keystore) must survive the purge.
	dataDir := s.sealedRoot()
	if strings.TrimSpace(notesDir) == "" {
		writeError(w, s.log, notes.NewError(notes.CodeInternal,
			"the notes directory is unknown", notes.ErrInternal))
		return
	}

	// The database of the open pipeline holds the plaintext of the notes too.
	// The service is released first, so that the file can be removed even on
	// Windows, where an open file cannot be deleted.
	dbPath := s.databasePath()
	if err := s.releaseOpenPipeline(); err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal,
			"cannot release the open pipeline of the notes", notes.ErrInternal))
		return
	}

	deleted, bytes, err := purgePlaintextFiles(notesDir, dataDir)
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal,
			"cannot remove the plaintext files", notes.ErrInternal))
		return
	}

	// The database and the deleted notes of the trash go with the plaintext.
	dbDeleted, dbBytes, err := purgePlaintextDatabase(dbPath, dataDir)
	if err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeInternal,
			"cannot remove the database of the notes", notes.ErrInternal))
		return
	}
	deleted += dbDeleted
	bytes += dbBytes

	s.log.Info("the plaintext files were removed", "deleted", deleted, "bytes", bytes)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted, "bytes": bytes})
}

// databasePath returns the path of the database of the open pipeline.
func (s *Server) databasePath() string {
	if svc := s.service(); svc != nil {
		return svc.Config().DBPath
	}
	return s.cfg.DBPath
}

// releaseOpenPipeline closes the notes service of the open pipeline and
// replaces it with a blocked one.
//
// The server stays in the sealed mode: the open endpoints answer with a
// conflict, and the database of the notes is released, so that it can be
// removed from the disk with the plaintext.
func (s *Server) releaseOpenPipeline() error {
	cfg := s.cfg
	if svc := s.service(); svc != nil {
		cfg = svc.Config()
	}
	// The trash and the attachments of a sealed vault live in the internal
	// directory of the vault: the server must not create a directory that
	// holds plaintext.
	cfg.TrashDir = s.sealedRoot()
	cfg.AttachmentsDir = s.sealedRoot()

	blocked, err := notes.NewService(cfg, sealed.NewBlockedStore())
	if err != nil {
		return err
	}

	s.svcMu.Lock()
	old := s.closeSvc
	s.svc = blocked
	s.closeSvc = nil
	s.svcMu.Unlock()

	if old != nil {
		old()
	}
	return nil
}

// purgePlaintextDatabase removes the database of the open pipeline and the
// deleted notes of the trash.
//
// The database holds the plaintext of every note, and the trash holds the
// notes that were deleted: neither of them can stay on the disk of a sealed
// vault.
func purgePlaintextDatabase(dbPath, dataDir string) (int, int64, error) {
	deleted := 0
	var bytes int64

	for _, path := range []string{dbPath, dbPath + "-wal", dbPath + "-shm"} {
		if strings.TrimSpace(path) == "" {
			continue
		}
		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return deleted, bytes, err
		}
		if err := os.Remove(path); err != nil {
			return deleted, bytes, err
		}
		deleted++
		bytes += info.Size()
	}

	// The trash of the vault: the notes that were deleted are plaintext too.
	trash := filepath.Join(dataDir, "trash")
	if err := os.RemoveAll(trash); err != nil {
		return deleted, bytes, err
	}

	return deleted, bytes, nil
}

// purgePlaintextFiles deletes every regular file under the notes directory,
// except the files that live under the internal directory of the vault.
//
// It returns the number of the deleted files and their total size.
func purgePlaintextFiles(notesDir, dataDir string) (int, int64, error) {
	deleted := 0
	var bytes int64

	// The internal directory of the vault (the sealed objects, the manifests
	// and the keystore) lives inside the notes directory in the layout of a
	// vault. In the default layout the internal directory is a sibling of the
	// notes and nothing has to be spared.
	internal := ""
	if isInside(notesDir, dataDir) {
		internal = dataDir
	}

	err := filepath.WalkDir(notesDir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		// The internal directory of the vault must survive the purge.
		if path != notesDir && internal != "" && isInside(internal, path) {
			return filepath.SkipDir
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, statErr := entry.Info()
		if statErr != nil {
			return statErr
		}
		if removeErr := os.Remove(path); removeErr != nil {
			return removeErr
		}
		deleted++
		bytes += info.Size()
		return nil
	})
	if err != nil {
		return deleted, bytes, err
	}

	// The empty folders of the tree are removed as well: a folder name is a
	// part of the metadata of the storage that must not stay in the clear.
	removeEmptyDirs(notesDir, internal)
	return deleted, bytes, nil
}

// removeEmptyDirs removes the folders that became empty after the purge.
func removeEmptyDirs(notesDir, internal string) {
	entries, err := os.ReadDir(notesDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		path := filepath.Join(notesDir, entry.Name())
		if internal != "" && isInside(internal, path) {
			continue
		}
		removeEmptyDirs(path, internal)
		if remaining, err := os.ReadDir(path); err == nil && len(remaining) == 0 {
			_ = os.Remove(path)
		}
	}
}

// isInside reports whether the path is inside the directory. The comparison
// is done on the cleaned absolute paths, so that a prefix that is not a real
// parent ("/notes" vs "/notes-2") is not mistaken for one.
func isInside(dir, path string) bool {
	if strings.TrimSpace(dir) == "" {
		return false
	}
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return false
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absDir, absPath)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return !strings.HasPrefix(rel, "..")
}
