package notes_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"noto/backend/internal/notes"
)

// The golden vectors of the line diff.
//
// The file lives in the testdata of the package: it is the reference of the
// behaviour of the diff, so that a change of the algorithm is a visible
// change of the vectors and not a silent difference.
const diffVectorsPath = "testdata/diff_vectors.json"

// A vector of the file.
type diffVectorFile struct {
	Cases []struct {
		Name     string `json:"name"`
		Old      string `json:"old"`
		New      string `json:"new"`
		Expected []struct {
			Op   string `json:"op"`
			Text string `json:"text"`
		} `json:"expected"`
	} `json:"cases"`
}

// readDiffVectors reads the golden vectors of the diff.
func readDiffVectors(t *testing.T) diffVectorFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Clean(diffVectorsPath))
	if err != nil {
		t.Fatalf("read the golden vectors of the diff: %v", err)
	}
	var file diffVectorFile
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatalf("parse the golden vectors of the diff: %v", err)
	}
	if len(file.Cases) == 0 {
		t.Fatalf("the golden vectors of the diff are empty")
	}
	return file
}

// TestDiffLinesConformance makes sure that the diff of the backend produces
// the lines of the golden vectors.
func TestDiffLinesConformance(t *testing.T) {
	file := readDiffVectors(t)

	for _, vector := range file.Cases {
		vector := vector
		t.Run(vector.Name, func(t *testing.T) {
			got := notes.DiffLines(vector.Old, vector.New)
			if len(got) != len(vector.Expected) {
				t.Fatalf("the diff of the vectors has %d lines, want %d: %+v", len(got), len(vector.Expected), got)
			}
			for i, want := range vector.Expected {
				if string(got[i].Op) != want.Op || got[i].Text != want.Text {
					t.Fatalf("the line %d of the diff is %+v, want %+v", i, got[i], want)
				}
			}
		})
	}
}

// splitLines splits a text into its lines, the way the diff does.
func splitLines(text string) []string {
	if text == "" {
		return nil
	}
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// isSubsequenceOf reports whether the first sequence is a subsequence of the
// second one.
func isSubsequenceOf(first, second []string) bool {
	i := 0
	for _, value := range second {
		if i < len(first) && first[i] == value {
			i++
		}
	}
	return i == len(first)
}

// TestDiffLinesOfAVeryLongText checks that the diff of a very long text does
// not need a huge table: above the bound the diff falls back to the
// positional comparison.
func TestDiffLinesOfAVeryLongText(t *testing.T) {
	lines := 2000
	oldLines := make([]string, lines)
	newLines := make([]string, lines)
	for i := 0; i < lines; i++ {
		oldLines[i] = "the line " + strings.Repeat("x", 8)
		newLines[i] = oldLines[i]
	}
	// One line differs in the middle.
	newLines[lines/2] = "the changed line"

	diff := notes.DiffLines(strings.Join(oldLines, "\n"), strings.Join(newLines, "\n"))
	if len(diff) != lines+1 {
		t.Fatalf("the diff of a very long text has %d lines, want %d", len(diff), lines+1)
	}
	removed, added := 0, 0
	for _, line := range diff {
		switch line.Op {
		case notes.DiffRemove:
			removed++
		case notes.DiffAdd:
			added++
		}
	}
	if removed != 1 || added != 1 {
		t.Fatalf("unexpected diff: %d removed, %d added", removed, added)
	}
}

// TestDiffLinesProperties checks the properties that every diff must have.
//
// The table is the behaviour that the golden vectors pin down: a diff is
// never empty when the texts differ, the equal lines keep their order and
// the same pair of texts always gives the same diff.
func TestDiffLinesProperties(t *testing.T) {
	cases := []struct {
		name string
		old  string
		new  string
	}{
		{"two empty texts", "", ""},
		{"an empty old text", "", "one\n"},
		{"an empty new text", "one\n", ""},
		{"the same text", "one\ntwo\n", "one\ntwo\n"},
		{"a changed line", "one\ntwo\n", "one\nthree\n"},
		{"a line of windows", "one\r\n", "one\n"},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			diff := notes.DiffLines(c.old, c.new)
			again := notes.DiffLines(c.old, c.new)
			if len(diff) != len(again) {
				t.Fatalf("the diff is not deterministic: %+v and %+v", diff, again)
			}
			for i := range diff {
				if diff[i] != again[i] {
					t.Fatalf("the diff is not deterministic: %+v and %+v", diff, again)
				}
			}
			// The diff of two empty texts is empty.
			if c.old == "" && c.new == "" && len(diff) != 0 {
				t.Fatalf("the diff of two empty texts is not empty: %+v", diff)
			}
			// The equal lines of the old text keep their order.
			equal := []string{}
			for _, line := range diff {
				if line.Op == notes.DiffEqual {
					equal = append(equal, line.Text)
				}
			}
			if !isSubsequenceOf(equal, splitLines(c.old)) {
				t.Fatalf("the equal lines %v are not in the order of the old text", equal)
			}
			if !isSubsequenceOf(equal, splitLines(c.new)) {
				t.Fatalf("the equal lines %v are not in the order of the new text", equal)
			}
			// The diff never mixes the operations: a line is either equal,
			// removed or added.
			for _, line := range diff {
				switch line.Op {
				case notes.DiffEqual, notes.DiffRemove, notes.DiffAdd:
				default:
					t.Fatalf("unexpected operation %q", line.Op)
				}
			}
		})
	}
}
