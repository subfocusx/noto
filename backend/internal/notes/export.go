package notes

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
)

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
