package query

import (
	"strings"
	"time"
)

// Note is the data of a note the predicate works with.
//
// It carries the same fields as the note of the tree, plus the derived
// properties and the text of the note.
type Note struct {
	// Path is the path of the note, relative to the root of the vault.
	Path string
	// Name is the file name of the note, with the extension.
	Name string
	// Content is the whole text of the note.
	Content string
	// Title is the text of the first heading of the note.
	Title string
	// Tags are the tags of the note, without the `#`.
	Tags []string
	// Folder is the directory of the note, relative to the root of the vault.
	Folder string
	// Ext is the extension of the file name, without the dot.
	Ext string
	// CreatedAt is the moment of the creation of the note, in unix seconds.
	CreatedAt int64
	// UpdatedAt is the moment of the last change of the note, in unix seconds.
	UpdatedAt int64
	// HasTaskList is true when the note contains a task list.
	HasTaskList bool
	// HasIncompleteTasks is true when the note contains a task that is not
	// done yet.
	HasIncompleteTasks bool
	// HasCode is true when the note contains a code block or inline code.
	HasCode bool
	// HasImage is true when the note contains an image.
	HasImage bool
	// HasLink is true when the note contains a link.
	HasLink bool
	// HasAttachments is true when the note has at least one attachment.
	HasAttachments bool
}

// A predicate over the notes of the vault.
type Predicate func(Note) bool

// caseInsensitiveFields are the fields that are compared without the case.
var caseInsensitiveFields = map[string]bool{
	"content": true,
	"name":    true,
}

// startOfDay returns the midnight of the day of the moment, in the local time.
func startOfDay(now time.Time) time.Time {
	year, month, day := now.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, now.Location())
}

// valueSeconds returns the moment a value points at. The second result is
// false when the value is not a moment.
func valueSeconds(v Value, now time.Time) (int64, bool) {
	switch value := v.(type) {
	case Num:
		return int64(value.V), true
	case Now:
		return now.Unix(), true
	case Today:
		return startOfDay(now).Unix(), true
	case Rel:
		base := now
		if value.Base == "today" {
			base = startOfDay(now)
		}
		return base.Unix() + value.Off, true
	default:
		return 0, false
	}
}

// CompilePredicate compiles an expression into a predicate over the notes.
//
// The moment of the execution is frozen for the whole query: it is given
// once, at the compilation, and never changes.
func CompilePredicate(e Expr, now time.Time) Predicate {
	if e == nil {
		return func(Note) bool { return false }
	}
	return func(note Note) bool {
		return evaluate(e, note, now)
	}
}

// evaluate applies one node of the IR to a note.
func evaluate(e Expr, note Note, now time.Time) bool {
	switch node := e.(type) {
	case And:
		return evaluate(node.L, note, now) && evaluate(node.R, note, now)
	case Or:
		return evaluate(node.L, note, now) || evaluate(node.R, note, now)
	case Not:
		return !evaluate(node.E, note, now)
	case Truthy:
		return flagOf(note, node.F)
	case Cmp:
		return compare(node, note, now)
	default:
		return false
	}
}

// flagOf returns the value of a boolean field of a note.
func flagOf(note Note, field string) bool {
	switch field {
	case "has_task_list":
		return note.HasTaskList
	case "has_incomplete_tasks":
		return note.HasIncompleteTasks
	case "has_code":
		return note.HasCode
	case "has_image":
		return note.HasImage
	case "has_link":
		return note.HasLink
	case "has_attachments":
		return note.HasAttachments
	default:
		return false
	}
}

// textOf returns the value of a text field of a note.
func textOf(note Note, field string) string {
	switch field {
	case "path":
		return note.Path
	case "name":
		return note.Name
	case "title":
		return note.Title
	case "folder":
		return note.Folder
	case "ext":
		return note.Ext
	case "content":
		return note.Content
	default:
		return ""
	}
}

// compare applies a comparison to a note.
func compare(c Cmp, note Note, now time.Time) bool {
	if c.F == "tag" {
		return compareTag(c, note)
	}
	if c.F == "created_at" || c.F == "updated_at" {
		return compareTimestamp(c, note, now)
	}
	if isFlagField(c.F) {
		return compareFlag(c, note)
	}
	return compareText(c, note)
}

// compareTag compares the tags of a note.
func compareTag(c Cmp, note Note) bool {
	tags := make([]string, 0, len(note.Tags))
	for _, tag := range note.Tags {
		tags = append(tags, strings.ToLower(tag))
	}
	if c.Op == "in" {
		list, ok := c.V.(List)
		if !ok {
			return false
		}
		for _, item := range list.Items {
			str, ok := item.(Str)
			if !ok {
				continue
			}
			for _, tag := range tags {
				if tag == strings.ToLower(str.V) {
					return true
				}
			}
		}
		return false
	}
	str, ok := c.V.(Str)
	if !ok {
		return false
	}
	found := false
	for _, tag := range tags {
		if tag == strings.ToLower(str.V) {
			found = true
			break
		}
	}
	if c.Op == "==" {
		return found
	}
	return !found
}

// compareTimestamp compares a moment of a note with a moment of the query.
func compareTimestamp(c Cmp, note Note, now time.Time) bool {
	actual := note.CreatedAt
	if c.F == "updated_at" {
		actual = note.UpdatedAt
	}
	expected, ok := valueSeconds(c.V, now)
	if !ok {
		return false
	}
	switch c.Op {
	case "==":
		return actual == expected
	case "!=":
		return actual != expected
	case ">":
		return actual > expected
	case ">=":
		return actual >= expected
	case "<":
		return actual < expected
	case "<=":
		return actual <= expected
	default:
		return false
	}
}

// compareFlag compares a boolean field of a note with a value.
func compareFlag(c Cmp, note Note) bool {
	actual := flagOf(note, c.F)
	switch value := c.V.(type) {
	case Bool:
		if c.Op == "==" {
			return actual == value.V
		}
		return actual != value.V
	case Str:
		if value.V != "true" && value.V != "false" {
			return false
		}
		expected := value.V == "true"
		if c.Op == "==" {
			return actual == expected
		}
		return actual != expected
	default:
		return false
	}
}

// compareText compares a text field of a note with a value.
func compareText(c Cmp, note Note) bool {
	actual := textOf(note, c.F)
	switch c.Op {
	case "contains":
		str, ok := c.V.(Str)
		if !ok {
			return false
		}
		return strings.Contains(strings.ToLower(actual), strings.ToLower(str.V))
	case "startsWith":
		str, ok := c.V.(Str)
		if !ok {
			return false
		}
		return strings.HasPrefix(strings.ToLower(actual), strings.ToLower(str.V))
	case "endsWith":
		str, ok := c.V.(Str)
		if !ok {
			return false
		}
		return strings.HasSuffix(strings.ToLower(actual), strings.ToLower(str.V))
	}
	str, ok := c.V.(Str)
	if !ok {
		return false
	}
	equal := actual == str.V
	if caseInsensitiveFields[c.F] {
		equal = strings.EqualFold(actual, str.V)
	}
	if c.Op == "==" {
		return equal
	}
	return !equal
}

// isFlagField reports whether the field is a boolean field of a note.
func isFlagField(field string) bool {
	switch field {
	case "has_task_list", "has_incomplete_tasks", "has_code", "has_image", "has_link", "has_attachments":
		return true
	default:
		return false
	}
}
