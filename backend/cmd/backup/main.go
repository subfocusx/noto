// Command backup creates a consistent backup of the Noto data directory.
//
// The backup contains the Markdown files, the attachments and a consistent
// copy of the SQLite database. The database copy is created with
// "VACUUM INTO" after a WAL checkpoint, so it never contains a torn write.
package main

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"noto/backend/internal/config"
)

func main() {
	out := flag.String("out", "", "path of the backup archive (default: <data dir>/noto-backup-<timestamp>.zip)")
	dataDir := flag.String("data", "", "override the data directory (default: the configured one)")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		fail(err)
	}
	if *dataDir != "" {
		cfg.DataDir = *dataDir
		cfg.NotesDir = filepath.Join(*dataDir, "notes")
		cfg.AttachmentsDir = filepath.Join(*dataDir, "attachments")
		cfg.TrashDir = filepath.Join(*dataDir, "trash")
		cfg.DBPath = filepath.Join(*dataDir, "noto.db")
	}
	path, err := runBackup(cfg, *out)
	if err != nil {
		fail(err)
	}
	fmt.Println("backup written to", path)
}

// fail prints an error and exits with a non zero status code.
func fail(err error) {
	fmt.Fprintln(os.Stderr, "backup:", err)
	os.Exit(1)
}

// runBackup creates the backup archive and returns its path.
func runBackup(cfg config.Config, out string) (string, error) {
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

	manifest := map[string]any{
		"createdAt":    time.Now().UTC().Format(time.RFC3339),
		"notesDir":     "notes",
		"attachDir":    "attachments",
		"trashDir":     "trash",
		"database":     "noto.db",
		"app":          "noto",
		"containsData": true,
	}

	if err := copyTree(cfg.NotesDir, filepath.Join(staging, "notes")); err != nil {
		return "", err
	}
	if err := copyTree(cfg.AttachmentsDir, filepath.Join(staging, "attachments")); err != nil {
		return "", err
	}
	// The trash holds the notes that were deleted but can still be
	// restored, so a backup without it would lose them.
	if err := copyTree(cfg.TrashDir, filepath.Join(staging, "trash")); err != nil {
		return "", err
	}
	if err := copyDatabase(cfg.DBPath, filepath.Join(staging, "noto.db")); err != nil {
		return "", err
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(staging, "manifest.json"), data, 0o644); err != nil {
		return "", err
	}
	if err := zipDir(staging, out); err != nil {
		return "", err
	}
	return out, nil
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

// zipDir writes the content of a directory into a ZIP archive.
func zipDir(dir, out string) error {
	f, err := os.Create(out)
	if err != nil {
		return fmt.Errorf("cannot create the archive: %w", err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	err = filepath.Walk(dir, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		name := filepath.ToSlash(rel)
		if fi.IsDir() {
			_, err := zw.Create(name + "/")
			return err
		}
		if !fi.Mode().IsRegular() {
			return nil
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		hdr := &zip.FileHeader{Name: name, Method: zip.Deflate}
		hdr.Modified = fi.ModTime()
		fw, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		_, err = io.Copy(fw, in)
		return err
	})
	if err != nil {
		zw.Close()
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	return f.Sync()
}
