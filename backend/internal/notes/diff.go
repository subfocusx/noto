package notes

import "strings"

// DiffOp is the kind of a line of a diff.
type DiffOp string

const (
	// DiffEqual marks a line that is the same in both texts.
	DiffEqual DiffOp = "equal"
	// DiffRemove marks a line that is only in the old text.
	DiffRemove DiffOp = "remove"
	// DiffAdd marks a line that is only in the new text.
	DiffAdd DiffOp = "add"
)

// DiffLine is one line of a diff.
type DiffLine struct {
	// Op is the kind of the line.
	Op DiffOp `json:"op"`
	// Text is the text of the line, without the line break.
	Text string `json:"text"`
}

// maxDiffCells bounds the size of the table of the longest common
// subsequence.
//
// The table holds one cell per pair of lines, so a very long note would need
// a very big table. Above the bound the diff falls back to the positional
// comparison, which is linear and always available.
const maxDiffCells = 2_000_000

// DiffLines computes the line diff of two texts.
//
// The algorithm is the classic longest common subsequence: the lines that
// both texts share keep their order and the other lines are reported as
// removed (old only) and as added (new only). The result is stable and
// deterministic: the same pair of texts always gives the same diff.
//
// The function is pure: it never touches the disk and never looks at the
// store. It is the diff of the versions of a note, but it works with any
// pair of texts.
func DiffLines(oldText, newText string) []DiffLine {
	oldLines := splitLines(oldText)
	newLines := splitLines(newText)

	if len(oldLines)*len(newLines) > maxDiffCells {
		return diffLinesPositional(oldLines, newLines)
	}

	// The table of the lengths of the common subsequences.
	table := make([][]int, len(oldLines)+1)
	for i := range table {
		table[i] = make([]int, len(newLines)+1)
	}
	for i := len(oldLines) - 1; i >= 0; i-- {
		for j := len(newLines) - 1; j >= 0; j-- {
			if oldLines[i] == newLines[j] {
				table[i][j] = table[i+1][j+1] + 1
				continue
			}
			if table[i+1][j] >= table[i][j+1] {
				table[i][j] = table[i+1][j]
			} else {
				table[i][j] = table[i][j+1]
			}
		}
	}

	out := []DiffLine{}
	i, j := 0, 0
	for i < len(oldLines) && j < len(newLines) {
		switch {
		case oldLines[i] == newLines[j]:
			out = append(out, DiffLine{Op: DiffEqual, Text: oldLines[i]})
			i++
			j++
		case table[i+1][j] >= table[i][j+1]:
			out = append(out, DiffLine{Op: DiffRemove, Text: oldLines[i]})
			i++
		default:
			out = append(out, DiffLine{Op: DiffAdd, Text: newLines[j]})
			j++
		}
	}
	for ; i < len(oldLines); i++ {
		out = append(out, DiffLine{Op: DiffRemove, Text: oldLines[i]})
	}
	for ; j < len(newLines); j++ {
		out = append(out, DiffLine{Op: DiffAdd, Text: newLines[j]})
	}
	return out
}

// diffLinesPositional is the fallback of DiffLines for the very long texts.
//
// The lines are compared by their position: a line that is the same is
// equal, a line that changed is removed and added. The result is
// deterministic and linear in the number of the lines.
func diffLinesPositional(oldLines, newLines []string) []DiffLine {
	out := []DiffLine{}
	common := len(oldLines)
	if len(newLines) < common {
		common = len(newLines)
	}
	for i := 0; i < common; i++ {
		if oldLines[i] == newLines[i] {
			out = append(out, DiffLine{Op: DiffEqual, Text: oldLines[i]})
			continue
		}
		out = append(out, DiffLine{Op: DiffRemove, Text: oldLines[i]})
		out = append(out, DiffLine{Op: DiffAdd, Text: newLines[i]})
	}
	for i := common; i < len(oldLines); i++ {
		out = append(out, DiffLine{Op: DiffRemove, Text: oldLines[i]})
	}
	for i := common; i < len(newLines); i++ {
		out = append(out, DiffLine{Op: DiffAdd, Text: newLines[i]})
	}
	return out
}

// splitLines splits a text into its lines. The line breaks are the "\n" and
// the "\r\n"; a trailing line break does not produce an empty last line.
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
