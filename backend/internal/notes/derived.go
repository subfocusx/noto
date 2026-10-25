package notes

import (
	"context"
	"encoding/json"
	"time"

	"noto/backend/internal/metadata"
	"noto/backend/internal/model"
)

// The cache of the derived properties of a note.
//
// The derived properties (the title, the tags and the boolean flags) are
// computed from the text of a note. They are a CACHE: the file on the disk
// stays the source of truth.
//
// The rule of the cache is simple: when a note changes, the cached properties
// are marked as stale instead of being recomputed right away. The
// recalculation is a separate, explicit step (RecomputeDerived), so that a
// write never pays for the properties of a note.

// DerivedSummary is the JSON blob of the derived properties of a note.
//
// The blob belongs to the domain layer: the store keeps the bytes without
// knowing their shape.
type DerivedSummary struct {
	// Title is the text of the first heading of the note.
	Title string `json:"title"`
	// Tags are the tags of the note, lower cased, in the order of
	// appearance.
	Tags []string `json:"tags"`
	// Flags is the bit mask of the boolean properties.
	Flags uint32 `json:"flags"`
}

// DerivedProps returns the cache of the derived properties of a note.
//
// The second result is false when the note has no cached properties.
func (s *Service) DerivedProps(ctx context.Context, rel string) (model.DerivedProps, bool, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return model.DerivedProps{}, false, err
	}
	if norm == "" {
		return model.DerivedProps{}, false, newErr(ErrInvalidPath, "a note path is required")
	}
	props, found, err := s.store.GetDerivedProps(ctx, norm)
	if err != nil {
		return model.DerivedProps{}, false, newErr(ErrInternal, "cannot read the derived properties")
	}
	if !found {
		return model.DerivedProps{}, false, nil
	}
	return props, true, nil
}

// RecomputeDerived calculates the derived properties of a note and stores
// them.
//
// The recalculation clears the stale flag: the cache is fresh again. The
// content is the text of the note; an empty content means that the text of
// the note is read from the disk.
func (s *Service) RecomputeDerived(ctx context.Context, rel, content string) (model.DerivedProps, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return model.DerivedProps{}, err
	}
	if norm == "" {
		return model.DerivedProps{}, newErr(ErrInvalidPath, "a note path is required")
	}
	if content == "" {
		current, err := s.Read(ctx, norm)
		if err != nil {
			return model.DerivedProps{}, err
		}
		content = current.Content
	}
	props := metadata.Extract(content)
	summary := DerivedSummary{
		Title: props.Title,
		Tags:  props.Tags,
		Flags: props.Flags(),
	}
	blob, err := json.Marshal(summary)
	if err != nil {
		return model.DerivedProps{}, newErr(ErrInternal, "cannot encode the derived properties")
	}
	row := model.DerivedProps{
		Path:       norm,
		Derived:    blob,
		ComputedAt: time.Now().UTC(),
		Stale:      false,
	}
	if err := s.store.PutDerivedProps(ctx, row); err != nil {
		return model.DerivedProps{}, newErr(ErrInternal, "cannot store the derived properties")
	}
	return row, nil
}

// MarkDerivedStale marks the cached derived properties of a note as stale.
//
// It is the invalidation of the cache: a note that has no cached properties
// is left alone.
func (s *Service) MarkDerivedStale(ctx context.Context, rel string) error {
	norm, err := normalizeRel(rel)
	if err != nil {
		return err
	}
	if norm == "" {
		return newErr(ErrInvalidPath, "a note path is required")
	}
	if err := s.store.MarkDerivedPropsStale(ctx, norm); err != nil {
		return newErr(ErrInternal, "cannot mark the derived properties as stale")
	}
	return nil
}
