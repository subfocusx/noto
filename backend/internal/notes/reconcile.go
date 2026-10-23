package notes

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"noto/backend/internal/model"
)

// ReconcileReport is the result of a comparison between the notes directory
// and the metadata rows of the database.
//
// The three difference lists use the normalised path of the entry, exactly as
// it is stored in the notes table (model.Node.Path): a slash separated path
// relative to the notes root.
type ReconcileReport struct {
	// MissingInDB holds the paths that exist on the disk but have no row in
	// the notes table. They are files that were created outside of the
	// application (or rows that were lost).
	MissingInDB []string `json:"missingInDB"`
	// MissingOnDisk holds the paths of the notes table without a file on the
	// disk. They are the "ghost" rows that survive a manual deletion.
	MissingOnDisk []string `json:"missingOnDisk"`
	// MetadataDrift holds the descriptions of the metadata that differs
	// between the disk and the database. Every entry starts with the path
	// and is followed by the name of the field and the two values.
	MetadataDrift []string `json:"metadataDrift"`
	// Checked is the number of the entries of the notes directory that were
	// compared with the database.
	Checked int `json:"checked"`

	// Restored holds the paths whose metadata row was created.
	Restored []string `json:"restored"`
	// Dropped holds the paths whose metadata row was deleted.
	Dropped []string `json:"dropped"`
	// Indexed holds the paths whose content was added to the search index.
	Indexed []string `json:"indexed"`
	// Notes holds the human readable remarks of the run.
	Notes []string `json:"notes"`
}

// ReconcileOptions controls what a reconciliation run is allowed to change.
//
// The defaults are the safe ones: nothing is written, nothing is deleted.
type ReconcileOptions struct {
	// Apply creates the metadata rows of the files that have no row.
	Apply bool
	// DropGhosts deletes the metadata rows that have no file. It is never
	// done without this explicit flag.
	DropGhosts bool
	// DryRun reports the differences and changes nothing, whatever the
	// other flags say.
	DryRun bool
}

// reconcileEntry is a single entry of the notes directory.
type reconcileEntry struct {
	rel   string
	info  os.FileInfo
	isDir bool
}

// Reconcile compares the notes directory with the metadata rows of the
// database and returns the report. It never changes anything.
func (s *Service) Reconcile(ctx context.Context) (ReconcileReport, error) {
	return s.ReconcileWithOptions(ctx, ReconcileOptions{})
}

// ReconcileWithOptions compares the notes directory with the metadata rows of
// the database and, depending on the options, repairs the differences.
//
// The comparison works like this:
//
//  1. The notes directory is walked with the same traversal that the tree
//     listing and the re-index use, so the paths are the same normalised
//     relative paths that the database stores. A symbolic link or a Windows
//     junction inside the notes root is skipped: it could point outside of
//     the root and it is never a note of the library.
//  2. Every entry of the disk is looked up in the notes table by its exact
//     path. On a case insensitive file system the lookup falls back to a case
//     insensitive comparison, so that a renamed file is not reported twice.
//  3. An entry without a row is reported in MissingInDB, a row without an
//     entry is reported in MissingOnDisk.
//  4. An entry with a row is compared field by field. The compared fields are
//     the name, the parent path, the type, the size (files only), the
//     revision, the creation time and the modification time.
//
// The trash is not part of the comparison: it lives outside of the notes root
// and its rows are kept in the trash table, not in the notes table. A trashed
// entry is therefore never a difference.
func (s *Service) ReconcileWithOptions(ctx context.Context, opts ReconcileOptions) (ReconcileReport, error) {
	report := ReconcileReport{
		MissingInDB:   []string{},
		MissingOnDisk: []string{},
		MetadataDrift: []string{},
		Restored:      []string{},
		Dropped:       []string{},
		Indexed:       []string{},
		Notes:         []string{},
	}

	stored, err := s.store.ListNotes(ctx)
	if err != nil {
		return ReconcileReport{}, newErr(ErrInternal, "cannot read the note metadata")
	}
	byPath := make(map[string]model.Node, len(stored))
	byLower := make(map[string]string, len(stored))
	for _, n := range stored {
		byPath[n.Path] = n
		if n.Path != "" {
			byLower[strings.ToLower(n.Path)] = n.Path
		}
	}

	entries, err := s.reconcileEntries()
	if err != nil {
		return ReconcileReport{}, err
	}

	seen := make(map[string]bool, len(entries))
	for _, e := range entries {
		report.Checked++
		key, found := byPath[e.rel]
		if !found {
			if alt, ok := byLower[strings.ToLower(e.rel)]; ok {
				key, found = byPath[alt], true
				report.MetadataDrift = append(report.MetadataDrift,
					fmt.Sprintf("%s: the path of the database differs in case (db=%s)", e.rel, key.Path))
			}
		}
		if !found {
			report.MissingInDB = append(report.MissingInDB, e.rel)
			continue
		}
		seen[key.Path] = true
		report.MetadataDrift = append(report.MetadataDrift, reconcileDrift(key, e)...)
	}

	for _, n := range stored {
		if n.Path == "" || seen[n.Path] {
			continue
		}
		if strings.HasPrefix(n.Path, TrashPathPrefix) {
			// A trashed entry is not a difference.
			continue
		}
		report.MissingOnDisk = append(report.MissingOnDisk, n.Path)
	}

	sort.Strings(report.MissingInDB)
	sort.Strings(report.MissingOnDisk)
	sort.Strings(report.MetadataDrift)

	if opts.DryRun {
		report.Notes = append(report.Notes, "dry run: nothing was changed")
		return report, nil
	}

	if opts.Apply {
		if err := s.reconcileApply(ctx, &report, entries); err != nil {
			return ReconcileReport{}, err
		}
	}
	if opts.DropGhosts {
		if err := s.reconcileDrop(ctx, &report); err != nil {
			return ReconcileReport{}, err
		}
	}
	return report, nil
}

// reconcileEntries walks the notes directory and returns the entries that are
// real notes. The traversal is the one of the service, so the paths are the
// normalised relative paths of the database.
func (s *Service) reconcileEntries() ([]reconcileEntry, error) {
	out := []reconcileEntry{}
	err := s.walkNotes(func(rel string, info os.FileInfo, isDir bool) error {
		abs := filepath.Join(s.notesRoot, filepath.FromSlash(rel))
		// A symbolic link or a Windows junction is never a note of the
		// library: it could point outside of the notes root.
		if _, isLink, err := linkTarget(abs); err == nil && isLink {
			if isDir {
				return filepath.SkipDir
			}
			return nil
		}
		out = append(out, reconcileEntry{rel: rel, info: info, isDir: isDir})
		return nil
	})
	if err != nil {
		return nil, newErr(ErrInternal, "cannot list the notes directory")
	}
	return out, nil
}

// reconcileDrift compares the metadata of a single entry with the row of the
// database and returns the descriptions of the differences.
//
// The compared fields are the name, the parent path, the type, the size of
// the files, the revision, the creation time and the modification time.
func reconcileDrift(stored model.Node, e reconcileEntry) []string {
	out := []string{}
	typ := model.NodeFile
	if e.isDir {
		typ = model.NodeFolder
	}
	if stored.Name != baseOf(e.rel) {
		out = append(out, fmt.Sprintf("%s: name differs (db=%q, disk=%q)", e.rel, stored.Name, baseOf(e.rel)))
	}
	if stored.ParentPath != parentOf(e.rel) {
		out = append(out, fmt.Sprintf("%s: parent path differs (db=%q, disk=%q)", e.rel, stored.ParentPath, parentOf(e.rel)))
	}
	if stored.Type != typ {
		out = append(out, fmt.Sprintf("%s: type differs (db=%q, disk=%q)", e.rel, stored.Type, typ))
	}
	if !e.isDir && stored.Size != e.info.Size() {
		out = append(out, fmt.Sprintf("%s: size differs (db=%d, disk=%d)", e.rel, stored.Size, e.info.Size()))
	}
	if stored.Revision < 1 {
		out = append(out, fmt.Sprintf("%s: revision is not set (db=%d)", e.rel, stored.Revision))
	}
	if stored.CreatedAt.IsZero() {
		out = append(out, fmt.Sprintf("%s: creation time is not set", e.rel))
	}
	if !e.isDir {
		// The database keeps the times with a millisecond precision.
		dbTime := stored.ModTime.UTC().Truncate(time.Millisecond)
		diskTime := e.info.ModTime().UTC().Truncate(time.Millisecond)
		if !dbTime.Equal(diskTime) {
			out = append(out, fmt.Sprintf("%s: modification time differs (db=%s, disk=%s)",
				e.rel, dbTime.Format(time.RFC3339Nano), diskTime.Format(time.RFC3339Nano)))
		}
	}
	return out
}

// reconcileApply creates the metadata rows of the entries that have no row.
//
// The row is rebuilt from the path and from the file itself: the revision is
// one, the creation and the update time are the modification time of the
// file, the size is the real size of the file. The creation time is therefore
// only an approximation, because the real creation time is unknown.
//
// The content of the restored files is added to the search index, so the
// restored notes are found by the search right away.
func (s *Service) reconcileApply(ctx context.Context, report *ReconcileReport, entries []reconcileEntry) error {
	restored := map[string]bool{}
	for _, rel := range report.MissingInDB {
		restored[rel] = true
	}
	if len(restored) == 0 {
		return nil
	}
	for _, e := range entries {
		if !restored[e.rel] {
			continue
		}
		release := s.acquireLocks(lockKeys(e.rel))
		node := model.Node{
			ID:         nodeID(e.rel),
			Name:       baseOf(e.rel),
			Path:       e.rel,
			Type:       model.NodeFile,
			ParentPath: parentOf(e.rel),
			Size:       e.info.Size(),
			ModTime:    e.info.ModTime().UTC(),
			Revision:   1,
			CreatedAt:  e.info.ModTime().UTC(),
			UpdatedAt:  e.info.ModTime().UTC(),
		}
		if e.isDir {
			node.Type = model.NodeFolder
		}
		if err := s.store.UpsertNote(ctx, node); err != nil {
			release()
			return newErr(ErrInternal, "cannot persist the node metadata")
		}
		if !e.isDir {
			abs := filepath.Join(s.notesRoot, filepath.FromSlash(e.rel))
			indexed := false
			if data, err := os.ReadFile(abs); err == nil {
				if err := s.store.IndexContent(ctx, e.rel, baseOf(e.rel), string(data)); err == nil {
					indexed = true
					report.Indexed = append(report.Indexed, e.rel)
				}
			}
			if !indexed {
				report.Notes = append(report.Notes,
					fmt.Sprintf("%s: the search index was not updated, the note is indexed by the next re-index", e.rel))
			}
		}
		release()
		report.Restored = append(report.Restored, e.rel)
	}
	if len(report.Restored) > 0 {
		report.Notes = append(report.Notes,
			"the restored rows are approximate: the creation time is the modification time of the file")
	}
	return nil
}

// reconcileDrop deletes the metadata rows without a file and cleans the
// search index.
func (s *Service) reconcileDrop(ctx context.Context, report *ReconcileReport) error {
	for _, rel := range report.MissingOnDisk {
		release := s.acquireLocks(lockKeys(rel))
		if err := s.store.DeleteNote(ctx, rel); err != nil {
			release()
			return newErr(ErrInternal, "cannot delete the node metadata")
		}
		_ = s.store.RemoveContent(ctx, rel)
		release()
		report.Dropped = append(report.Dropped, rel)
	}
	return nil
}
