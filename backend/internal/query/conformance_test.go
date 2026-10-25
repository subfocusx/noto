package query_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"noto/backend/internal/query"
)

// The golden vectors of the query language.
//
// The very same file is read by the test of the frontend
// (`frontend/src/__tests__/query.conformance.test.ts`): the two
// implementations of the language must produce the same IR, and the file is
// what makes it verifiable.
const vectorsPath = "../../../shared/query-vectors.json"

// A vector of the file.
type vectorFile struct {
	Queries []struct {
		Name   string          `json:"name"`
		Source string          `json:"source"`
		AST    json.RawMessage `json:"ast"`
		Error  string          `json:"error"`
	} `json:"queries"`
}

// readVectors reads the golden vectors of the language.
func readVectors(t *testing.T) vectorFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Clean(vectorsPath))
	if err != nil {
		t.Fatalf("read the golden vectors: %v", err)
	}
	var file vectorFile
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatalf("parse the golden vectors: %v", err)
	}
	if len(file.Queries) == 0 {
		t.Fatalf("the golden vectors are empty")
	}
	return file
}

// TestConformanceOfTheQueryLanguage makes sure that the parser of the backend
// produces the IR of the golden vectors, byte for byte in the canonical form.
func TestConformanceOfTheQueryLanguage(t *testing.T) {
	file := readVectors(t)

	for _, vector := range file.Queries {
		vector := vector
		t.Run(vector.Name, func(t *testing.T) {
			expr, err := query.Parse(vector.Source)
			if vector.Error != "" {
				if err == nil {
					t.Fatalf("the query %q was accepted, the expected error is %q", vector.Source, vector.Error)
				}
				if err.Error() != vector.Error {
					t.Fatalf("the query %q failed with %q, the expected error is %q", vector.Source, err.Error(), vector.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("the query %q failed: %v", vector.Source, err)
			}
			got, err := query.Canonical(expr)
			if err != nil {
				t.Fatalf("the canonical form of %q: %v", vector.Source, err)
			}
			var gotValue, wantValue any
			if err := json.Unmarshal(got, &gotValue); err != nil {
				t.Fatalf("the canonical form of %q is not a json: %v", vector.Source, err)
			}
			if err := json.Unmarshal(vector.AST, &wantValue); err != nil {
				t.Fatalf("the expected ast of %q is not a json: %v", vector.Source, err)
			}
			if !reflect.DeepEqual(gotValue, wantValue) {
				t.Fatalf("the query %q parsed into\n%s\nthe expected form is\n%s", vector.Source, got, vector.AST)
			}
		})
	}
}
