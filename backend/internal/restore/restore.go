// Package restore restores a Noto backup archive into a data directory.
//
// The archive is opened and checked against the manifest before anything is
// written. When the manifest lists the files with their checksums, every file
// is verified and a mismatch aborts the restore. The current database is kept
// next to the restored one as "noto.db.pre-restore-<timestamp>", so a failed
// restore never destroys the existing data.
package restore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"noto/backend/internal/backuppkg"
	"noto/backend/internal/config"
	"noto/backend/internal/sqlitestore"
)

// Options holds the parameters of a restore.
type Options struct {
	// ArchivePath is the path of the backup archive to restore.
	ArchivePath string
	// DataDir overrides the data directory of the configuration. When it is
	// empty the configured directory is used.
	DataDir string
	// DryRun reports what would be restored without changing anything.
	DryRun bool
	// Force restores even when the target directory already contains data.
	Force bool
}

// Group describes one part of the archive.
type Group struct {
	Name  string
	Files int
	Size  int64
}

// Report describes what a restore does or did.
type Report struct {
	// Archive is the path of the restored archive.
	Archive string
	// Version is the version of the manifest.
	Version int
	// CreatedAt is the creation time of the archive.
	CreatedAt string
	// Verified reports whether the checksums of the archive were verified.
	Verified bool
	// Database is the name of the database file inside the archive.
	Database string
	// DatabaseSize is the size of the database file in bytes.
	DatabaseSize int64
	// Files is the number of files in the archive.
	Files int
	// Size is the total size of the files in the archive.
	Size int64
	// Groups lists the parts of the archive.
	Groups []Group
	// DryRun reports whether the restore only printed a report.
	DryRun bool
	// DataDir is the directory the data was restored into.
	DataDir string
	// PreRestore is the path of the kept copy of the previous database.
	PreRestore string
}

// Run restores the archive of opts into the data directory of cfg and returns
// a report of the operation.
func Run(ctx context.Context, cfg config.Config, opts Options) (*Report, error) {
	if strings.TrimSpace(opts.ArchivePath) == "" {
		return nil, errors.New("the -in flag is required")
	}
	if opts.DataDir != "" {
		cfg.DataDir = opts.DataDir
		cfg.NotesDir = filepath.Join(opts.DataDir, "notes")
		cfg.AttachmentsDir = filepath.Join(opts.DataDir, "attachments")
		cfg.TrashDir = filepath.Join(opts.DataDir, "trash")
		cfg.DBPath = filepath.Join(opts.DataDir, "noto.db")
	}
	return runRestore(ctx, cfg, opts.ArchivePath, opts.DryRun, opts.Force)
}

// runRestore restores the archive at archivePath into the data directory of
// cfg and returns a report of the operation.
func runRestore(ctx context.Context, cfg config.Config, archivePath string, dryRun, force bool) (*Report, error) {
	a, err := backuppkg.Open(archivePath)
	if err != nil {
		return nil, err
	}
	defer a.Close()

	m := a.Manifest()
	if err := checkStructure(a, m); err != nil {
		return nil, err
	}
	if err := a.Verify(); err != nil {
		return nil, err
	}
	if !a.ChecksumsAvailable() {
		slog.Warn("the archive has no checksums, its integrity cannot be verified", "archive", archivePath)
	}

	report := buildReport(a, m)
	report.DataDir = cfg.DataDir
	report.DryRun = dryRun
	if dryRun {
		return report, nil
	}

	if !force {
		if reason, ok := targetHasData(cfg); ok {
			return nil, fmt.Errorf("the target directory %q already contains data (%s); use -force to overwrite it", cfg.DataDir, reason)
		}
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("cannot create the data directory: %w", err)
	}
	staging, err := os.MkdirTemp(cfg.DataDir, ".restore-*")
	if err != nil {
		return nil, fmt.Errorf("cannot create the staging directory: %w", err)
	}
	defer os.RemoveAll(staging)

	dbName := m.Database
	prefixes := []string{
		backuppkg.NotesDirName + "/",
		backuppkg.AttachmentsDirName + "/",
		backuppkg.TrashDirName + "/",
		dbName,
	}
	if err := a.ExtractTo(staging, prefixes); err != nil {
		return nil, err
	}

	undo := &undoPlan{dbPath: cfg.DBPath}
	committed := false
	defer func() {
		if committed {
			return
		}
		if err := undo.run(); err != nil {
			slog.Error("cannot roll back the restore", "error", err)
		}
	}()

	ts := time.Now().Format("20060102-150405")

	// Keep a consistent copy of the current database next to it.
	if _, err := os.Stat(cfg.DBPath); err == nil {
		preRestore := cfg.DBPath + ".pre-restore-" + ts
		if err := backuppkg.Snapshot(cfg.DBPath, preRestore); err != nil {
			slog.Warn("cannot create a consistent copy of the current database, copying the file instead", "error", err)
			if err := copyFile(cfg.DBPath, preRestore); err != nil {
				return nil, fmt.Errorf("cannot keep a copy of the current database: %w", err)
			}
		}
		if _, err := os.Stat(preRestore); err != nil {
			if err := copyFile(cfg.DBPath, preRestore); err != nil {
				return nil, fmt.Errorf("cannot keep a copy of the current database: %w", err)
			}
		}
		report.PreRestore = preRestore
		undo.dbBackup = preRestore
		undo.dbExisted = true
		slog.Info("the current database was kept", "path", preRestore)
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("cannot read the current database: %w", err)
	}

	// Replace the content directories.
	dirs := []struct {
		name   string
		target string
	}{
		{backuppkg.NotesDirName, cfg.NotesDir},
		{backuppkg.AttachmentsDirName, cfg.AttachmentsDir},
		{backuppkg.TrashDirName, cfg.TrashDir},
	}
	for _, d := range dirs {
		staged := filepath.Join(staging, d.name)
		if fi, err := os.Stat(staged); err != nil || !fi.IsDir() {
			continue
		}
		entry := undoDir{original: d.target}
		if _, err := os.Stat(d.target); err == nil {
			entry.aside = d.target + ".pre-restore-" + ts
			if err := os.Rename(d.target, entry.aside); err != nil {
				return nil, fmt.Errorf("cannot move the current %q aside: %w", d.target, err)
			}
			slog.Info("the current directory was kept", "path", entry.aside)
		}
		if err := os.Rename(staged, d.target); err != nil {
			return nil, fmt.Errorf("cannot install %q: %w", d.target, err)
		}
		entry.installed = true
		undo.dirs = append(undo.dirs, entry)
	}

	// Replace the database atomically.
	stagedDB := filepath.Join(staging, dbName)
	if fi, err := os.Stat(stagedDB); err == nil && fi.Mode().IsRegular() {
		if err := os.Rename(stagedDB, cfg.DBPath); err != nil {
			return nil, fmt.Errorf("cannot install the database: %w", err)
		}
		undo.dbInstalled = true
	} else {
		slog.Warn("the archive does not contain a database, the current one is kept")
	}
	removeSideFiles(cfg.DBPath)

	// The database is opened through the store: this applies the schema and
	// therefore validates the restored database.
	if _, err := os.Stat(cfg.DBPath); err == nil {
		store, err := sqlitestore.Open(ctx, cfg.DBPath)
		if err != nil {
			return nil, fmt.Errorf("the restored database is not usable, the restore was rolled back: %w", err)
		}
		store.Close()
		removeSideFiles(cfg.DBPath)
	}

	if err := cfg.EnsureDirs(); err != nil {
		return nil, err
	}
	committed = true
	slog.Info("the backup was restored", "archive", archivePath, "data", cfg.DataDir)
	return report, nil
}

// checkStructure verifies that the archive has the expected layout.
func checkStructure(a *backuppkg.Archive, m backuppkg.Manifest) error {
	if m.App != "" && m.App != "noto" {
		slog.Warn("the archive was not written by Noto", "app", m.App)
	}
	if len(a.Files()) <= 1 {
		return errors.New("the archive does not contain any data")
	}
	return nil
}

// buildReport collects the sizes of the archive content.
func buildReport(a *backuppkg.Archive, m backuppkg.Manifest) *Report {
	rep := &Report{
		Archive:   a.Path(),
		Version:   m.Version,
		CreatedAt: m.CreatedAt,
		Verified:  a.ChecksumsAvailable(),
		Database:  m.Database,
	}
	counts := map[string]*Group{}
	for _, name := range a.Files() {
		if name == backuppkg.ManifestName {
			continue
		}
		size, _ := a.FileSize(name)
		rep.Files++
		rep.Size += size
		key := groupOf(name)
		g := counts[key]
		if g == nil {
			g = &Group{Name: key}
			counts[key] = g
		}
		g.Files++
		g.Size += size
		if key == "database" {
			rep.DatabaseSize = size
		}
	}
	for _, key := range []string{backuppkg.NotesDirName, backuppkg.AttachmentsDirName, backuppkg.TrashDirName, "database"} {
		if g := counts[key]; g != nil {
			rep.Groups = append(rep.Groups, *g)
		}
	}
	return rep
}

// groupOf returns the name of the group a file belongs to.
func groupOf(name string) string {
	switch {
	case strings.HasPrefix(name, backuppkg.NotesDirName+"/"):
		return backuppkg.NotesDirName
	case strings.HasPrefix(name, backuppkg.AttachmentsDirName+"/"):
		return backuppkg.AttachmentsDirName
	case strings.HasPrefix(name, backuppkg.TrashDirName+"/"):
		return backuppkg.TrashDirName
	default:
		return "database"
	}
}

// targetHasData reports whether the data directory already holds data.
func targetHasData(cfg config.Config) (string, bool) {
	if fi, err := os.Stat(cfg.DBPath); err == nil && fi.Mode().IsRegular() && fi.Size() > 0 {
		return fmt.Sprintf("the database %q", cfg.DBPath), true
	}
	for _, dir := range []string{cfg.NotesDir, cfg.AttachmentsDir, cfg.TrashDir} {
		entries, err := os.ReadDir(dir)
		if err == nil && len(entries) > 0 {
			return fmt.Sprintf("the directory %q", dir), true
		}
	}
	return "", false
}

// removeSideFiles deletes the write ahead log files of a database.
func removeSideFiles(dbPath string) {
	for _, suffix := range []string{"-wal", "-shm"} {
		p := dbPath + suffix
		if err := os.Remove(p); err == nil {
			slog.Info("removed the stale side file", "path", p)
		}
	}
}

// undoPlan describes the steps that have to be undone when a restore fails.
type undoPlan struct {
	dirs        []undoDir
	dbPath      string
	dbInstalled bool
	dbExisted   bool
	dbBackup    string
}

// undoDir describes one content directory of the restore.
type undoDir struct {
	original  string
	aside     string
	installed bool
}

// run undoes the changes of a failed restore.
func (u *undoPlan) run() error {
	var firstErr error
	keep := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	for _, d := range u.dirs {
		if !d.installed {
			continue
		}
		if err := os.RemoveAll(d.original); err != nil {
			keep(err)
		}
	}
	for _, d := range u.dirs {
		if d.aside == "" {
			continue
		}
		if err := os.Rename(d.aside, d.original); err != nil {
			keep(err)
		}
	}
	if u.dbInstalled {
		if u.dbExisted && u.dbBackup != "" {
			if err := os.Rename(u.dbBackup, u.dbPath); err != nil {
				keep(err)
			}
		} else if err := os.Remove(u.dbPath); err != nil && !os.IsNotExist(err) {
			keep(err)
		}
	}
	return firstErr
}

// copyFile copies a single file.
func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0o644)
}

// PrintReport prints the report of the restore.
func PrintReport(w io.Writer, rep *Report) {
	fmt.Fprintf(w, "backup archive: %s\n", rep.Archive)
	version := "version 1 (no checksums)"
	if rep.Version >= backuppkg.ManifestVersion {
		version = fmt.Sprintf("version %d (checksums verified)", rep.Version)
	}
	fmt.Fprintf(w, "manifest:       %s, created %s\n", version, orDash(rep.CreatedAt))
	fmt.Fprintf(w, "database:       %s (%s)\n", rep.Database, formatBytes(rep.DatabaseSize))
	fmt.Fprintf(w, "files:          %d (%s)\n", rep.Files, formatBytes(rep.Size))
	for _, g := range rep.Groups {
		fmt.Fprintf(w, "  %-13s %d file(s) (%s)\n", g.Name, g.Files, formatBytes(g.Size))
	}
	if rep.DryRun {
		fmt.Fprintln(w, "dry run:        nothing was changed")
		return
	}
	if rep.PreRestore != "" {
		fmt.Fprintf(w, "kept database:  %s\n", rep.PreRestore)
	}
	fmt.Fprintf(w, "restored into:  %s\n", rep.DataDir)
}

// orDash returns a dash for an empty string.
func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}

// formatBytes renders a byte count in a human readable form.
func formatBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for v := n / unit; v >= unit && exp < 4; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTP"[exp])
}
