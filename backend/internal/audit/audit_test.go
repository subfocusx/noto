package audit_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"noto/backend/internal/audit"
)

// newLog opens a log in a temporary directory.
func newLog(t *testing.T) *audit.Log {
	t.Helper()
	log, err := audit.Open(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("open the log: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })
	return log
}

// TestAppendAndList makes sure that the entries are written and that the
// filters work.
func TestAppendAndList(t *testing.T) {
	ctx := context.Background()
	log := newLog(t)

	base := time.Now().UTC()
	entries := []audit.Entry{
		{Time: base, User: "alice", Action: audit.ActionNoteCreated, Target: "a.md", Result: audit.ResultOK},
		{Time: base.Add(time.Second), User: "alice", Action: audit.ActionNoteUpdated, Target: "a.md", Result: audit.ResultOK},
		{Time: base.Add(2 * time.Second), User: "bob", Action: audit.ActionNoteDeleted, Target: "b.md", Result: audit.ResultError},
	}
	for _, e := range entries {
		if err := log.Append(ctx, e); err != nil {
			t.Fatalf("append the entry: %v", err)
		}
	}

	all, err := log.List(ctx, audit.Filter{})
	if err != nil {
		t.Fatalf("list the entries: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("unexpected number of the entries: %d", len(all))
	}
	// The newest entry comes first.
	if all[0].Action != audit.ActionNoteDeleted {
		t.Fatalf("the entries are not sorted: %+v", all)
	}

	byUser, err := log.List(ctx, audit.Filter{User: "alice"})
	if err != nil {
		t.Fatalf("list the entries: %v", err)
	}
	if len(byUser) != 2 {
		t.Fatalf("unexpected number of the entries: %d", len(byUser))
	}

	byAction, err := log.List(ctx, audit.Filter{Action: audit.ActionNoteUpdated})
	if err != nil {
		t.Fatalf("list the entries: %v", err)
	}
	if len(byAction) != 1 || byAction[0].Target != "a.md" {
		t.Fatalf("unexpected entries: %+v", byAction)
	}

	limited, err := log.List(ctx, audit.Filter{Limit: 2})
	if err != nil {
		t.Fatalf("list the entries: %v", err)
	}
	if len(limited) != 2 {
		t.Fatalf("the limit is not applied: %d", len(limited))
	}

	since, err := log.List(ctx, audit.Filter{Since: base.Add(time.Second)})
	if err != nil {
		t.Fatalf("list the entries: %v", err)
	}
	if len(since) != 2 {
		t.Fatalf("the filter on the time is not applied: %d", len(since))
	}
}

// TestTheLogNeverHoldsTheContentOfANote makes sure that the entries only
// carry the identifiers.
func TestTheLogNeverHoldsTheContentOfANote(t *testing.T) {
	ctx := context.Background()
	log := newLog(t)

	if err := log.Append(ctx, audit.Entry{
		User:   "alice",
		Action: audit.ActionNoteUpdated,
		Target: "a.md",
	}); err != nil {
		t.Fatalf("append the entry: %v", err)
	}
	entries, err := log.List(ctx, audit.Filter{})
	if err != nil {
		t.Fatalf("list the entries: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("unexpected number of the entries: %d", len(entries))
	}
	if entries[0].User != "alice" || entries[0].Target != "a.md" {
		t.Fatalf("unexpected entry: %+v", entries[0])
	}
	if entries[0].Result != audit.ResultOK {
		t.Fatalf("unexpected result: %q", entries[0].Result)
	}
	if entries[0].Time.IsZero() {
		t.Fatalf("the entry has no time")
	}
}

// TestTheUserIsAnonymousWhenItIsEmpty makes sure that an operation without a
// user is recorded as anonymous.
func TestTheUserIsAnonymousWhenItIsEmpty(t *testing.T) {
	ctx := context.Background()
	log := newLog(t)
	if err := log.Append(ctx, audit.Entry{Action: audit.ActionNoteCreated, Target: "a.md"}); err != nil {
		t.Fatalf("append the entry: %v", err)
	}
	entries, err := log.List(ctx, audit.Filter{})
	if err != nil {
		t.Fatalf("list the entries: %v", err)
	}
	if entries[0].User != "anonymous" {
		t.Fatalf("unexpected user: %q", entries[0].User)
	}
}

// TestTheLogSurvivesTheReopening makes sure that the log is persistent.
func TestTheLogSurvivesTheReopening(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "audit.db")

	log, err := audit.Open(path)
	if err != nil {
		t.Fatalf("open the log: %v", err)
	}
	if err := log.Append(ctx, audit.Entry{User: "alice", Action: audit.ActionNoteCreated, Target: "a.md"}); err != nil {
		t.Fatalf("append the entry: %v", err)
	}
	if err := log.Close(); err != nil {
		t.Fatalf("close the log: %v", err)
	}

	again, err := audit.Open(path)
	if err != nil {
		t.Fatalf("reopen the log: %v", err)
	}
	defer again.Close()
	entries, err := again.List(ctx, audit.Filter{})
	if err != nil {
		t.Fatalf("list the entries: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("unexpected number of the entries: %d", len(entries))
	}
	if !strings.Contains(entries[0].Target, "a.md") {
		t.Fatalf("unexpected target: %q", entries[0].Target)
	}
}
