package backuppkg

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite" // SQLite driver (pure Go).

	"noto/backend/internal/config"
)

// Create writes a consistent backup of the data directory into the archive
// at out and returns the path of the archive.
//
// The archive holds the Markdown files, the attachments, the trash and a
// consistent copy of the SQLite database. The database copy is created with
// "VACUUM INTO" after a WAL checkpoint, so it never contains a torn write.
// The archive itself is written to a temporary file and renamed into place,
// so a failed backup never leaves a broken archive under the final name.
func Create(cfg config.Config, out string) (string, error) {
	if out == "" {
		out = filepath.Join(cfg.DataDir, fmt.Sprintf("noto-backup-%s.zip", time.Now().Format("20060102-150405")))
	}
	if fi, err := os.Stat(out); err == nil && fi.IsDir() {
		return "", fmt.Errorf("the output path %q is a directory", out)
	}
	if dir := filepath.Dir(out); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", fmt.Errorf("cannot create the output directory: %w", err)
		}
	}
	staging, err := os.MkdirTemp("", "noto-backup-*")
	if err != nil {
		return "", fmt.Errorf("cannot create the staging directory: %w", err)
	}
	defer os.RemoveAll(staging)

	if err := copyTree(cfg.NotesDir, filepath.Join(staging, NotesDirName)); err != nil {
		return "", err
	}
	if err := copyTree(cfg.AttachmentsDir, filepath.Join(staging, AttachmentsDirName)); err != nil {
		return "", err
	}
	// The trash holds the notes that were deleted but can still be
	// restored, so a backup without it would lose them.
	if err := copyTree(cfg.TrashDir, filepath.Join(staging, TrashDirName)); err != nil {
		return "", err
	}
	if err := copyDatabase(cfg.DBPath, filepath.Join(staging, DatabaseName)); err != nil {
		return "", err
	}

	m := NewManifest(time.Now().UTC().Format(time.RFC3339))
	if err := Write(staging, out, m); err != nil {
		return "", err
	}
	return out, nil
}

// Snapshot writes a consistent copy of the SQLite database at src to dst.
//
// The write ahead log is checkpointed into the main database file first, so
// the copy contains every committed transaction.
func Snapshot(src, dst string) error {
	return copyDatabase(src, dst)
}

// copyTree copies a directory tree recursively.
func copyTree(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("cannot read %q: %w", filepath.Base(src), err)
	}
	if !info.IsDir() {
		return fmt.Errorf("%q is not a directory", filepath.Base(src))
	}
	return filepath.Walk(src, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if fi.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if !fi.Mode().IsRegular() {
			return nil
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return copyFile(p, target)
	})
}

// copyFile copies a single file.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

// copyDatabase creates a consistent copy of the SQLite database.
func copyDatabase(src, dst string) error {
	if _, err := os.Stat(src); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if _, err := os.Stat(dst); err == nil {
		if err := os.Remove(dst); err != nil {
			return err
		}
	}
	db, err := sql.Open("sqlite", src)
	if err != nil {
		return fmt.Errorf("cannot open the database: %w", err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// Move the write ahead log into the main database file first.
	if _, err := db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		return fmt.Errorf("cannot checkpoint the database: %w", err)
	}
	stmt := fmt.Sprintf("VACUUM INTO %s", quoteSQLString(dst))
	if _, err := db.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("cannot copy the database: %w", err)
	}
	return nil
}

// quoteSQLString quotes a path for a SQL statement.
func quoteSQLString(p string) string {
	return "'" + strings.ReplaceAll(p, "'", "''") + "'"
}
