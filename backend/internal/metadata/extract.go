// Package metadata scans the text of a note and returns its derived
// properties: the tags, the title and the boolean flags.
//
// The properties are a CACHE, not a source of truth: the file on the disk
// stays the truth, and the cache is rebuilt when the note is saved or when
// the index is rebuilt. The rules are the ones of `docs/QUERY_LANGUAGE.md`,
// section 8, and they are covered by the golden vectors of
// `shared/query-vectors.json`.
//
// The scanner of the frontend (`frontend/src/core/metadata/extract.ts`) does
// the same work in the sealed mode, where the text never reaches the server.
// The two implementations are checked against the same vectors, so they cannot
// drift apart.
package metadata

import (
	"regexp"
	"strings"

	"noto/backend/internal/model"
)

// Props are the properties derived from the text of a note.
type Props struct {
	// Tags are the tags of the note, lower cased, in the order of appearance,
	// without duplicates.
	Tags []string
	// Title is the text of the first heading of the note. It is empty when the
	// first heading of the document is not a heading of the first level.
	Title string
	// HasTaskList is true when the note contains a task list.
	HasTaskList bool
	// HasIncompleteTasks is true when the note contains a task that is not
	// done yet.
	HasIncompleteTasks bool
	// HasCode is true when the note contains a code block or inline code.
	HasCode bool
	// HasImage is true when the note contains an image.
	HasImage bool
	// HasLink is true when the note contains a wiki link or a markdown link.
	HasLink bool
}

// A tag is a `#` and a word of letters, digits, `_`, `-` and `/`.
var tagPattern = regexp.MustCompile(`#([\p{L}\p{N}_\-/]+)`)

// An ATX heading: `#`, `##`... and a space.
var headingPattern = regexp.MustCompile(`^(#{1,6})\s+(.*)$`)

// A task of a task list: `- [ ]`, `- [x]`, `* [ ]`, `+ [x]`...
var taskPattern = regexp.MustCompile(`^\s*[-*+]\s+\[([ xX])\]`)

// A fenced code block.
var fencePattern = regexp.MustCompile("^\\s*(```+|~~~+)")

// An inline code span.
var inlineCodePattern = regexp.MustCompile("`[^`]*`")

// The same span, for the global replacement.
var inlineCodeAllPattern = regexp.MustCompile("`[^`]*`")

// A markdown image.
var imagePattern = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)

// A wiki link.
var wikiLinkPattern = regexp.MustCompile(`\[\[[^\]]*\]\]`)

// A markdown link.
var mdLinkPattern = regexp.MustCompile(`\[[^\]]*\]\([^)]*\)`)

// Extract scans the text of a note and returns its derived properties.
func Extract(content string) Props {
	props := Props{Tags: []string{}}
	seen := map[string]bool{}
	titleFound := false
	inFence := false

	for _, line := range strings.Split(content, "\n") {
		if fencePattern.MatchString(line) {
			props.HasCode = true
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}

		if !titleFound {
			if heading := headingPattern.FindStringSubmatch(strings.TrimRight(line, "\r")); heading != nil {
				titleFound = true
				if len(heading[1]) == 1 {
					props.Title = strings.TrimSpace(heading[2])
				}
			}
		}

		if task := taskPattern.FindStringSubmatch(line); task != nil {
			props.HasTaskList = true
			if task[1] == " " {
				props.HasIncompleteTasks = true
			}
		}

		if inlineCodePattern.MatchString(line) {
			props.HasCode = true
		}

		// The tags of a line: the inline code is not a text.
		text := inlineCodeAllPattern.ReplaceAllString(line, " ")
		for _, match := range tagPattern.FindAllStringSubmatch(text, -1) {
			tag := strings.ToLower(match[1])
			if tag == "" || seen[tag] {
				continue
			}
			seen[tag] = true
			props.Tags = append(props.Tags, tag)
		}
	}

	props.HasImage = imagePattern.MatchString(content)
	props.HasLink = wikiLinkPattern.MatchString(content) || hasMarkdownLink(content)
	return props
}

// hasMarkdownLink reports whether the text contains a markdown link that is
// not an image.
func hasMarkdownLink(content string) bool {
	for _, match := range mdLinkPattern.FindAllStringIndex(content, -1) {
		if match[0] > 0 && content[match[0]-1] == '!' {
			continue
		}
		return true
	}
	return false
}

// FlagMask returns the bit of the flag of the field and reports whether the
// field is a boolean flag at all.
//
// The bits are the ones of the model, so the store and the compiler always
// agree on them.
func FlagMask(field string) (uint64, bool) {
	switch field {
	case "has_task_list":
		return uint64(model.PropHasTaskList), true
	case "has_incomplete_tasks":
		return uint64(model.PropHasIncompleteTasks), true
	case "has_code":
		return uint64(model.PropHasCode), true
	case "has_image":
		return uint64(model.PropHasImage), true
	case "has_link":
		return uint64(model.PropHasLink), true
	default:
		return 0, false
	}
}

// Flags returns the bit mask of the boolean properties of a note.
func (p Props) Flags() uint32 {
	var flags uint32
	if p.HasTaskList {
		flags |= model.PropHasTaskList
	}
	if p.HasIncompleteTasks {
		flags |= model.PropHasIncompleteTasks
	}
	if p.HasCode {
		flags |= model.PropHasCode
	}
	if p.HasImage {
		flags |= model.PropHasImage
	}
	if p.HasLink {
		flags |= model.PropHasLink
	}
	return flags
}
