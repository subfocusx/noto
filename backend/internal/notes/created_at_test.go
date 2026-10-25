package notes_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"noto/backend/internal/model"
	"noto/backend/internal/testutil"
)

// TestCreatedAtNeverChanges checks that the creation time of a note is
// written once and never changes afterwards.
func TestCreatedAtNeverChanges(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	created, err := svc.CreateFile(ctx, "", "note.md")
	if err != nil {
		t.Fatalf("create the file: %v", err)
	}
	if created.CreatedAt.IsZero() {
		t.Fatalf("the note has no creation time: %+v", created)
	}

	// A write of the note does not change the creation time.
	before := created.CreatedAt
	time.Sleep(2 * time.Millisecond)
	if _, err := svc.Write(ctx, "note.md", "the text of the note", 0); err != nil {
		t.Fatalf("write the note: %v", err)
	}

	node, found, err := svc.Store().GetNote(ctx, "note.md")
	if err != nil {
		t.Fatalf("read the note: %v", err)
	}
	if !found {
		t.Fatalf("the note is missing")
	}
	if !node.CreatedAt.Equal(before) {
		t.Fatalf("the creation time changed: %v -> %v", before, node.CreatedAt)
	}
	if !node.UpdatedAt.After(before) {
		t.Fatalf("the modification time did not move: %v", node.UpdatedAt)
	}
}

// TestCreatedAtIsInTheJSONModel checks that the creation time is part of the
// JSON model, so that the interface can show it.
func TestCreatedAtIsInTheJSONModel(t *testing.T) {
	node := model.Node{
		Path:      "a.md",
		Name:      "a.md",
		Type:      model.NodeFile,
		CreatedAt: time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC),
		UpdatedAt: time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC),
	}
	data, err := json.Marshal(node)
	if err != nil {
		t.Fatalf("encode the node: %v", err)
	}
	if !strings.Contains(string(data), `"createdAt"`) {
		t.Fatalf("the JSON of the note does not hold the creation time: %s", data)
	}
}
