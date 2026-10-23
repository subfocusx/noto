// Command backup creates a consistent backup of the Noto data directory.
//
// The backup contains the Markdown files, the attachments and a consistent
// copy of the SQLite database. The database copy is created with
// "VACUUM INTO" after a WAL checkpoint, so it never contains a torn write.
//
// The archive is written to a temporary file and renamed into place, so a
// failed backup never leaves a broken archive under the final name. The
// manifest of the archive lists every file with its SHA-256 checksum.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"noto/backend/internal/backuppkg"
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
	return backuppkg.Create(cfg, out)
}
