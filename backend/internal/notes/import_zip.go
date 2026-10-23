package notes

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"os"
	"path"
	"strings"

	"noto/backend/internal/model"
)

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
