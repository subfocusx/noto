package notes

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"noto/backend/internal/model"
)

// Conflict policies of an import operation.
const (
	ConflictSkip      = "skip"
	ConflictRename    = "rename"
	ConflictOverwrite = "overwrite"
)

// maxArchiveEntries caps the number of entries of an imported archive.
const maxArchiveEntries = 10000

// UploadedFile is a single file of an import operation.
type UploadedFile struct {
	// Name is the client supplied file name.
	Name string
	// Content holds the file bytes.
	Content []byte
}

// normalizeConflict validates the conflict policy.
func normalizeConflict(policy string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(policy)) {
	case "":
		return ConflictSkip, nil
	case ConflictSkip:
		return ConflictSkip, nil
	case ConflictRename:
		return ConflictRename, nil
	case ConflictOverwrite:
		return ConflictOverwrite, nil
	default:
		return "", newErr(ErrBadRequest, "unknown conflict policy %q", policy)
	}
}

// ImportFiles imports one or more Markdown files into the target folder.
func (s *Service) ImportFiles(ctx context.Context, files []UploadedFile, targetPath, conflict string) (model.ImportResult, error) {
	policy, err := normalizeConflict(conflict)
	if err != nil {
		return model.ImportResult{}, err
	}
	parent, err := s.prepareParent(ctx, targetPath, true)
	if err != nil {
		return model.ImportResult{}, err
	}
	if parent != "" {
		if _, err := s.ensureFolder(ctx, parent); err != nil {
			return model.ImportResult{}, err
		}
	}
	result := model.ImportResult{Imported: []string{}, Skipped: []string{}, Errors: []string{}}
	for _, f := range files {
		name := sanitizeUploadName(f.Name)
		if name == "" {
			result.Errors = append(result.Errors, "a file has no valid name")
			continue
		}
		if !strings.HasSuffix(strings.ToLower(name), ".md") {
			result.Errors = append(result.Errors, name+": only Markdown files can be imported")
			continue
		}
		rel, err := joinRel(parent, name)
		if err != nil {
			result.Errors = append(result.Errors, name+": "+Message(err))
			continue
		}
		imported, skipped, err := s.importOne(ctx, rel, f.Content, policy)
		if err != nil {
			result.Errors = append(result.Errors, name+": "+Message(err))
			continue
		}
		if skipped {
			result.Skipped = append(result.Skipped, rel)
			continue
		}
		result.Imported = append(result.Imported, imported)
	}
	return result, nil
}

// sanitizeUploadName reduces a client supplied name to a safe base name.
func sanitizeUploadName(name string) string {
	name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	if name == "" || name == "." || name == ".." {
		return ""
	}
	return name
}

// importOne writes a single imported file honouring the conflict policy.
func (s *Service) importOne(ctx context.Context, rel string, content []byte, policy string) (string, bool, error) {
	abs, err := s.resolve(rel)
	if err != nil {
		return "", false, err
	}
	release := s.acquireLocks(lockKeys(rel))
	defer release()
	abs, err = s.resolve(rel)
	if err != nil {
		return "", false, err
	}
	if _, err := os.Lstat(abs); err == nil {
		switch policy {
		case ConflictSkip:
			return "", true, nil
		case ConflictRename:
			rel = s.uniquePath(ctx, rel)
			abs, err = s.resolve(rel)
			if err != nil {
				return "", false, err
			}
		case ConflictOverwrite:
			// fall through and overwrite the file
		}
	}
	if err := writeFileAtomic(abs, content); err != nil {
		return "", false, newErr(ErrInternal, "cannot write the imported file")
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", false, newErr(ErrInternal, "cannot stat the imported file")
	}
	now := info.ModTime().UTC()
	node := model.Node{
		ID:         nodeID(rel),
		Name:       baseOf(rel),
		Path:       rel,
		Type:       model.NodeFile,
		ParentPath: parentOf(rel),
		Size:       info.Size(),
		ModTime:    now,
		Revision:   1,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if stored, found, err := s.store.GetNote(ctx, rel); err == nil && found {
		node.Revision = stored.Revision + 1
		node.CreatedAt = stored.CreatedAt
	}
	if err := s.indexFile(ctx, rel, string(content)); err != nil {
		return "", false, err
	}
	if err := s.store.UpsertNote(ctx, node); err != nil {
		return "", false, newErr(ErrInternal, "cannot persist the imported file")
	}
	return rel, false, nil
}

// uniquePath returns a path that does not exist yet by adding a numeric
// suffix to the base name.
func (s *Service) uniquePath(ctx context.Context, rel string) string {
	dir := parentOf(rel)
	base := baseOf(rel)
	ext := ""
	stem := base
	if i := strings.LastIndex(base, "."); i > 0 {
		stem = base[:i]
		ext = base[i:]
	}
	for i := 1; i < 1000; i++ {
		candidate := stem + "-" + itoa(i) + ext
		full := candidate
		if dir != "" {
			full = dir + "/" + candidate
		}
		abs, err := s.resolve(full)
		if err != nil {
			return rel
		}
		if _, err := os.Lstat(abs); err != nil {
			return full
		}
	}
	return rel
}

// itoa converts a small integer to a string.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [8]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// ImportZip imports a ZIP archive into the target folder, preserving the
// folder hierarchy of the archive.
func (s *Service) ImportZip(ctx context.Context, archive []byte, targetPath, conflict string) (model.ImportResult, error) {
	policy, err := normalizeConflict(conflict)
	if err != nil {
		return model.ImportResult{}, err
	}
	parent, err := s.prepareParent(ctx, targetPath, true)
	if err != nil {
		return model.ImportResult{}, err
	}
	if parent != "" {
		if _, err := s.ensureFolder(ctx, parent); err != nil {
			return model.ImportResult{}, err
		}
	}
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return model.ImportResult{}, newErr(ErrBadRequest, "the uploaded file is not a valid ZIP archive")
	}
	if len(zr.File) > maxArchiveEntries {
		return model.ImportResult{}, newErr(ErrPayloadTooLarge, "the archive contains too many entries")
	}
	var total uint64
	for _, f := range zr.File {
		total += f.UncompressedSize64
		if total > uint64(s.cfg.MaxArchiveBytes) {
			return model.ImportResult{}, newErr(ErrPayloadTooLarge, "the archive is too large")
		}
	}
	result := model.ImportResult{Imported: []string{}, Skipped: []string{}, Errors: []string{}}
	// extracted counts the bytes that were really written, the declared
	// size of an archive entry cannot be trusted.
	var extracted int64
	for _, f := range zr.File {
		name := f.Name
		if err := validateArchiveEntry(name); err != nil {
			return model.ImportResult{}, err
		}
		if f.Mode()&os.ModeSymlink != 0 {
			return model.ImportResult{}, newErr(ErrInvalidPath, "the archive contains a symbolic link")
		}
		clean := strings.TrimSuffix(path.Clean(strings.ReplaceAll(name, "\\", "/")), "/")
		if clean == "." || clean == "" {
			continue
		}
		rel := clean
		if parent != "" {
			rel = parent + "/" + clean
		}
		if f.FileInfo().IsDir() {
			if _, err := s.ensureFolder(ctx, rel); err != nil {
				result.Errors = append(result.Errors, rel+": "+Message(err))
			}
			continue
		}
		if !strings.HasSuffix(strings.ToLower(baseOf(rel)), ".md") {
			result.Errors = append(result.Errors, rel+": only Markdown files can be imported")
			continue
		}
		rc, err := f.Open()
		if err != nil {
			result.Errors = append(result.Errors, rel+": cannot read the archive entry")
			continue
		}
		content, err := io.ReadAll(io.LimitReader(rc, s.cfg.MaxUploadBytes+1))
		rc.Close()
		if err != nil {
			result.Errors = append(result.Errors, rel+": cannot read the archive entry")
			continue
		}
		if int64(len(content)) > s.cfg.MaxUploadBytes {
			return model.ImportResult{}, newErr(ErrPayloadTooLarge, "an archive entry is too large")
		}
		extracted += int64(len(content))
		if extracted > s.cfg.MaxArchiveBytes {
			return model.ImportResult{}, newErr(ErrPayloadTooLarge, "the archive is too large")
		}
		imported, skipped, err := s.importOne(ctx, rel, content, policy)
		if err != nil {
			result.Errors = append(result.Errors, rel+": "+Message(err))
			continue
		}
		if skipped {
			result.Skipped = append(result.Skipped, rel)
			continue
		}
		result.Imported = append(result.Imported, imported)
	}
	return result, nil
}

// validateArchiveEntry rejects unsafe archive entry names.
func validateArchiveEntry(name string) error {
	if name == "" {
		return newErr(ErrInvalidPath, "the archive contains an entry without a name")
	}
	if strings.ContainsRune(name, 0) {
		return newErr(ErrInvalidPath, "the archive contains an invalid entry name")
	}
	if strings.Contains(name, "\\") {
		return newErr(ErrInvalidPath, "the archive contains an invalid entry name")
	}
	if strings.HasPrefix(name, "/") {
		return newErr(ErrInvalidPath, "the archive contains an absolute path")
	}
	if hasDriveLetter(name) {
		return newErr(ErrInvalidPath, "the archive contains an absolute path")
	}
	for _, seg := range strings.Split(name, "/") {
		if seg == ".." {
			return newErr(ErrInvalidPath, "the archive contains a path traversal")
		}
	}
	return nil
}

// ExportNote returns the content of a single note.
func (s *Service) ExportNote(ctx context.Context, rel string) (string, []byte, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return "", nil, err
	}
	if norm == "" {
		return "", nil, newErr(ErrInvalidPath, "a note path is required")
	}
	abs, err := s.resolve(norm)
	if err != nil {
		return "", nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", nil, newErr(ErrNotFound, "note not found")
	}
	if info.IsDir() {
		return "", nil, newErr(ErrBadRequest, "the path is a folder")
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", nil, newErr(ErrInternal, "cannot read the note")
	}
	return baseOf(norm), data, nil
}

// ExportFolder writes a ZIP archive of the folder to w.
func (s *Service) ExportFolder(ctx context.Context, rel string, w io.Writer) error {
	norm, err := normalizeRel(rel)
	if err != nil {
		return err
	}
	if norm == "" {
		return newErr(ErrInvalidPath, "a folder path is required")
	}
	abs, err := s.resolve(norm)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return newErr(ErrNotFound, "folder not found")
	}
	if !info.IsDir() {
		return newErr(ErrBadRequest, "the path is not a folder")
	}
	return s.zipTree(ctx, abs, norm, w)
}

// ExportAll writes a ZIP archive of the whole notes directory to w.
func (s *Service) ExportAll(ctx context.Context, w io.Writer) error {
	return s.zipTree(ctx, s.notesRoot, "", w)
}

// zipTree writes a ZIP archive of a directory tree.
func (s *Service) zipTree(ctx context.Context, abs, prefix string, w io.Writer) error {
	zw := zip.NewWriter(w)
	err := filepath.Walk(abs, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if p == abs {
			return nil
		}
		// A symbolic link or a Windows junction inside the notes root is
		// never exported: it could point outside of the root.
		if _, isLink, err := linkTarget(p); err == nil && isLink {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(abs, p)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rel)
		if prefix != "" {
			name = prefix + "/" + name
		}
		if info.IsDir() {
			_, err := zw.Create(name + "/")
			return err
		}
		if !strings.HasSuffix(strings.ToLower(name), ".md") {
			return nil
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		hdr := &zip.FileHeader{Name: name, Method: zip.Deflate}
		hdr.Modified = info.ModTime()
		fw, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		_, err = fw.Write(data)
		return err
	})
	if err != nil {
		zw.Close()
		return newErr(ErrInternal, "cannot build the archive")
	}
	if err := zw.Close(); err != nil {
		return newErr(ErrInternal, "cannot build the archive")
	}
	return nil
}

// ExportFolderBytes returns a ZIP archive of the folder.
func (s *Service) ExportFolderBytes(ctx context.Context, rel string) ([]byte, error) {
	var buf bytes.Buffer
	if err := s.ExportFolder(ctx, rel, &buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ExportAllBytes returns a ZIP archive of the whole library.
func (s *Service) ExportAllBytes(ctx context.Context) ([]byte, error) {
	var buf bytes.Buffer
	if err := s.ExportAll(ctx, &buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
