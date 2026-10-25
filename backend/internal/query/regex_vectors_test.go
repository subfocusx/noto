package query_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"noto/backend/internal/query"
)

// The golden vectors of the regular expressions of the language.
//
// The very same file is read by the test of the frontend
// (`frontend/src/__tests__/query.regex.test.ts`): the two implementations of
// the operator must produce the same IR, and the file is what makes it
// verifiable.
const regexVectorsPath = "../../../shared/vectors/regex.json"

// A vector of the file.
type regexVectorFile struct {
	Queries []struct {
		Name   string          `json:"name"`
		Source string          `json:"source"`
		AST    json.RawMessage `json:"ast"`
		Error  string          `json:"error"`
	} `json:"queries"`
}

// readRegexVectors reads the golden vectors of the operator.
func readRegexVectors(t *testing.T) regexVectorFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Clean(regexVectorsPath))
	if err != nil {
		t.Fatalf("read the golden vectors of the regular expressions: %v", err)
	}
	var file regexVectorFile
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatalf("parse the golden vectors of the regular expressions: %v", err)
	}
	if len(file.Queries) == 0 {
		t.Fatalf("the golden vectors of the regular expressions are empty")
	}
	return file
}

// TestConformanceOfTheRegularExpressions makes sure that the parser of the
// backend produces the IR of the golden vectors of the operator.
func TestConformanceOfTheRegularExpressions(t *testing.T) {
	file := readRegexVectors(t)

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
