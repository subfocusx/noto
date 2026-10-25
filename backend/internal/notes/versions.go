package notes

import (
	"context"
	"log/slog"
	"os"
	"time"

	"noto/backend/internal/metadata"
	"noto/backend/internal/model"
)

// The history of the versions of a note.
//
// Every write of the content of a note appends an immutable version to the
// history: the version holds the text of the note, its title and the moment
// it was written. A version is never modified and never deleted, so the
// history of a note is always complete.
//
// The file on the disk stays the source of truth: the versions are the
// history of the writes that the server performed.

// Versions returns the history of a note, ordered by revision.
//
// The history of a note without a version is empty: it was never written
// through the server (it was imported, for example).
//
// A note that does not exist is reported with the code not_found: there is no
// history of a note that is not there.
func (s *Service) Versions(ctx context.Context, rel string) ([]model.NoteVersion, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return nil, err
	}
	if norm == "" {
		return nil, newErr(ErrInvalidPath, "a note path is required")
	}
	abs, err := s.resolve(norm)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(abs); err != nil {
		return nil, newErr(ErrNotFound, "note not found")
	}
	versions, err := s.store.ListVersions(ctx, norm)
	if err != nil {
		return nil, newErr(ErrInternal, "cannot read the history of the note")
	}
	if versions == nil {
		versions = []model.NoteVersion{}
	}
	return versions, nil
}

// Version returns a single version of a note.
//
// A version that does not exist is reported with the code not_found.
func (s *Service) Version(ctx context.Context, rel string, revision int64) (model.NoteVersion, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return model.NoteVersion{}, err
	}
	if norm == "" {
		return model.NoteVersion{}, newErr(ErrInvalidPath, "a note path is required")
	}
	if revision <= 0 {
		return model.NoteVersion{}, newErr(ErrInvalidPath, "a revision must be positive")
	}
	version, found, err := s.store.GetVersion(ctx, norm, revision)
	if err != nil {
		return model.NoteVersion{}, newErr(ErrInternal, "cannot read the version of the note")
	}
	if !found {
		return model.NoteVersion{}, newErr(ErrNotFound, "the version of the note was not found")
	}
	return version, nil
}

// RestoreVersion writes the content of a version back into the note.
//
// The write goes through the normal write path: the revision of the note
// grows and the restored text becomes a new version of the history, so the
// history stays append only.
func (s *Service) RestoreVersion(ctx context.Context, rel string, revision int64) (WriteResult, error) {
	version, err := s.Version(ctx, rel, revision)
	if err != nil {
		return WriteResult{}, err
	}
	return s.Write(ctx, version.Path, version.Content, 0)
}

// DiffVersions returns the line diff of two versions of a note.
//
// The diff is computed between the content of the two versions: the first
// version is the old text and the second one is the new text.
func (s *Service) DiffVersions(ctx context.Context, rel string, fromRevision, toRevision int64) ([]DiffLine, error) {
	from, err := s.Version(ctx, rel, fromRevision)
	if err != nil {
		return nil, err
	}
	to, err := s.Version(ctx, rel, toRevision)
	if err != nil {
		return nil, err
	}
	return DiffLines(from.Content, to.Content), nil
}

// The kinds of the lines of a difference between two versions.
const (
	// DiffKindContext marks a line that is the same in both versions.
	DiffKindContext = "context"
	// DiffKindAdded marks a line that is only in the new version.
	DiffKindAdded = "added"
	// DiffKindRemoved marks a line that is only in the old version.
	DiffKindRemoved = "removed"
)

// VersionDiff is the difference between two versions of a note.
type VersionDiff struct {
	// Path is the path of the note.
	Path string `json:"path"`
	// From is the revision the difference starts at.
	From int64 `json:"from"`
	// To is the revision the difference ends at.
	To int64 `json:"to"`
	// Lines are the lines of the difference, in the order of the text.
	Lines []VersionDiffLine `json:"lines"`
}

// VersionDiffLine is one line of a difference between two versions.
//
// The numbers of the lines are 1 based. A line that does not exist on a side
// of the difference carries 0 on that side.
type VersionDiffLine struct {
	// Kind is "context", "added" or "removed".
	Kind string `json:"kind"`
	// Text is the text of the line, without the line break.
	Text string `json:"text"`
	// FromLine is the number of the line in the old version.
	FromLine int `json:"fromLine"`
	// ToLine is the number of the line in the new version.
	ToLine int `json:"toLine"`
}

// DiffVersion returns the difference between two versions of a note.
//
// The difference carries the number of the line on each side, so that the
// interface can show the two texts side by side.
//
// A version that does not exist is reported with the code not_found.
func (s *Service) DiffVersion(ctx context.Context, rel string, fromRevision, toRevision int64) (VersionDiff, error) {
	from, err := s.Version(ctx, rel, fromRevision)
	if err != nil {
		return VersionDiff{}, err
	}
	to, err := s.Version(ctx, rel, toRevision)
	if err != nil {
		return VersionDiff{}, err
	}
	diff := VersionDiff{
		Path:  from.Path,
		From:  fromRevision,
		To:    toRevision,
		Lines: []VersionDiffLine{},
	}
	var fromLine, toLine int
	for _, line := range DiffLines(from.Content, to.Content) {
		switch line.Op {
		case DiffEqual:
			fromLine++
			toLine++
			diff.Lines = append(diff.Lines, VersionDiffLine{
				Kind:     DiffKindContext,
				Text:     line.Text,
				FromLine: fromLine,
				ToLine:   toLine,
			})
		case DiffRemove:
			fromLine++
			diff.Lines = append(diff.Lines, VersionDiffLine{
				Kind:     DiffKindRemoved,
				Text:     line.Text,
				FromLine: fromLine,
			})
		case DiffAdd:
			toLine++
			diff.Lines = append(diff.Lines, VersionDiffLine{
				Kind:   DiffKindAdded,
				Text:   line.Text,
				ToLine: toLine,
			})
		}
	}
	return diff, nil
}

// appendVersion records a version of a note in its history.
//
// The version is a cache of the history: a failure to write it does not
// break the write of the note itself, but it is logged, because a lost
// version is a hole in the history.
func (s *Service) appendVersion(ctx context.Context, rel, content string, revision int64, at time.Time) {
	version := model.NoteVersion{
		Path:      rel,
		Revision:  revision,
		Title:     metadata.Extract(content).Title,
		Content:   content,
		CreatedAt: at,
	}
	if err := s.store.AppendVersion(ctx, version); err != nil {
		// The note is written: the history is a cache of the writes and
		// must not break the operation.
		slog.Warn("notes: cannot append the version of a note",
			"path", rel,
			"revision", revision,
			"error", err,
		)
	}
}
