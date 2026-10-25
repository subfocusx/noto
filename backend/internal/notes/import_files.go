package notes

import (
	"context"
	"os"
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
	// The import is a write of the content of the note: it appends a
	// version to the history, like every other write.
	s.appendVersion(ctx, rel, string(content), node.Revision, node.UpdatedAt)
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
