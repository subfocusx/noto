package notes

import (
	"os"
	"path/filepath"
)

// writeFileAtomic writes data to a temporary file in the same directory and
// renames it over the target. Missing parent directories are created.
func writeFileAtomic(target string, data []byte) error {
	return writeFileAtomicMode(target, data, true)
}

// writeFileAtomicNoMkdir writes data to a temporary file in the same
// directory and renames it over the target. The parent directory must
// already exist, a missing parent is never re-created.
func writeFileAtomicNoMkdir(target string, data []byte) error {
	return writeFileAtomicMode(target, data, false)
}

// writeFileAtomicMode implements the atomic file replacement.
func writeFileAtomicMode(target string, data []byte, createDirs bool) error {
	dir := filepath.Dir(target)
	if createDirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	} else if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		if err == nil {
			err = os.ErrNotExist
		}
		return err
	}
	tmp, err := os.CreateTemp(dir, ".noto-tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}()
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpName, target)
}

// movePath moves a file or directory from src to dst.
func movePath(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	// Fall back to a copy when the trash directory lives on another volume.
	if err := copyPath(src, dst); err != nil {
		return err
	}
	return os.RemoveAll(src)
}

// copyPath recursively copies src to dst.
func copyPath(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		data, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		return os.WriteFile(dst, data, 0o644)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := copyPath(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}
