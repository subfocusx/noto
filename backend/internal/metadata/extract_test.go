package metadata_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"noto/backend/internal/metadata"
)

// The golden vectors of the derived properties.
//
// The very same file is read by the test of the frontend
// (`frontend/src/__tests__/metadata.test.ts`): the scanner of the backend and
// the scanner of the browser must agree on every note.
const vectorsPath = "../../../shared/query-vectors.json"

// The expected properties of one vector.
type expectedProps struct {
	Tags               []string `json:"tags"`
	Title              string   `json:"title"`
	HasTaskList        bool     `json:"has_task_list"`
	HasIncompleteTasks bool     `json:"has_incomplete_tasks"`
	HasCode            bool     `json:"has_code"`
	HasImage           bool     `json:"has_image"`
	HasLink            bool     `json:"has_link"`
}

// readVectors reads the golden vectors of the properties.
func readVectors(t *testing.T) []struct {
	Name     string        `json:"name"`
	Markdown string        `json:"markdown"`
	Props    expectedProps `json:"props"`
} {
	t.Helper()
	data, err := os.ReadFile(filepath.Clean(vectorsPath))
	if err != nil {
		t.Fatalf("read the golden vectors: %v", err)
	}
	var file struct {
		Metadata []struct {
			Name     string        `json:"name"`
			Markdown string        `json:"markdown"`
			Props    expectedProps `json:"props"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatalf("parse the golden vectors: %v", err)
	}
	if len(file.Metadata) == 0 {
		t.Fatalf("the golden vectors are empty")
	}
	return file.Metadata
}

// TestConformanceOfTheDerivedProperties makes sure that the scanner of the
// backend agrees with the golden vectors on every note.
func TestConformanceOfTheDerivedProperties(t *testing.T) {
	for _, vector := range readVectors(t) {
		vector := vector
		t.Run(vector.Name, func(t *testing.T) {
			got := metadata.Extract(vector.Markdown)
			want := vector.Props
			if !reflect.DeepEqual(got.Tags, want.Tags) {
				t.Fatalf("the tags are %v, the expected tags are %v", got.Tags, want.Tags)
			}
			if got.Title != want.Title {
				t.Fatalf("the title is %q, the expected title is %q", got.Title, want.Title)
			}
			if got.HasTaskList != want.HasTaskList ||
				got.HasIncompleteTasks != want.HasIncompleteTasks ||
				got.HasCode != want.HasCode ||
				got.HasImage != want.HasImage ||
				got.HasLink != want.HasLink {
				t.Fatalf("the properties are %+v, the expected properties are %+v", got, want)
			}
		})
	}
}
