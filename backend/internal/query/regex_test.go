package query_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"noto/backend/internal/query"
)

// The operator of the regular expressions.
//
// The language knows the operator `matches` (the form `field matches "..."`)
// and its prefix form `match:<expression>`. The engine of the backend is
// RE2: the expression is linear, it is bounded in size, and a broken
// expression is a typed error, never a panic.

// noteOf builds the note of the predicate.
func noteOf() query.Note {
	return query.Note{
		Path:    "notes/todo.md",
		Name:    "todo.md",
		Content: "# Todo\n\n#work #urgent\n\n- [ ] a task\n",
		Title:   "Todo",
		Tags:    []string{"work", "urgent"},
		Folder:  "notes",
		Ext:     "md",

		HasTaskList:        true,
		HasIncompleteTasks: true,
	}
}

// matchesOf answers whether the note matches the query.
func matchesOf(t *testing.T, source string, note query.Note) bool {
	t.Helper()
	expr, err := query.Parse(source)
	if err != nil {
		t.Fatalf("parse %q: %v", source, err)
	}
	predicate := query.CompilePredicate(expr, time.Now())
	return predicate(note)
}

func TestMatchesOperator(t *testing.T) {
	note := noteOf()
	cases := []struct {
		source string
		want   bool
	}{
		{"title matches \"^To\"", true},
		{"title matches \"^to\"", false},
		{"title.matches(\"^To\")", true},
		{"content matches \"#work\"", true},
		{"content matches \"^# Todo\"", true},
		{"path matches \"^notes/\"", true},
		{"name matches \"\\.md$\"", true},
		{"folder matches \"^notes$\"", true},
		{"ext matches \"^md$\"", true},
		{"tag matches \"^w\"", true},
		{"tag matches \"^z\"", false},
		{"title matches \"(Todo|Done)\"", true},
		{"!title matches \"^To\"", false},
	}
	for _, c := range cases {
		c := c
		t.Run(c.source, func(t *testing.T) {
			if got := matchesOf(t, c.source, note); got != c.want {
				t.Fatalf("the query %q answered %v, the expected answer is %v", c.source, got, c.want)
			}
		})
	}
}

func TestMatchPrefixForm(t *testing.T) {
	note := noteOf()
	cases := []struct {
		source string
		want   bool
	}{
		// The expression is looked for in the title, in the text, in the path
		// and in the tags.
		{"match:^Todo", true},
		{"match:^todo", false},
		{"match:urgent", true},
		{"match:^notes/", true},
		{"match:pineapple", false},
		// The prefix form and the other operators live together.
		{"match:^Todo && has_task_list", true},
		{"match:^Todo && has_code", false},
		{"match:^Todo || has_code", true},
	}
	for _, c := range cases {
		c := c
		t.Run(c.source, func(t *testing.T) {
			if got := matchesOf(t, c.source, note); got != c.want {
				t.Fatalf("the query %q answered %v, the expected answer is %v", c.source, got, c.want)
			}
		})
	}
}

func TestMatchPrefixFormEndsAtTheFirstSpace(t *testing.T) {
	// The raw expression of the prefix form cannot hold a space: the logical
	// operators are separated from it by a space.
	expr, err := query.Parse(`match:^a && has_code`)
	if err != nil {
		t.Fatalf("parse the query: %v", err)
	}
	canonical, err := query.CanonicalString(expr)
	if err != nil {
		t.Fatalf("the canonical form of the query: %v", err)
	}
	if !strings.Contains(canonical, `"v":"^a"`) {
		t.Fatalf("the expression of the query is not the raw one: %s", canonical)
	}
}

func TestMatchInvalidExpressionIsATypedError(t *testing.T) {
	for _, source := range []string{
		"title matches \"[\"",
		"title matches \"(\"",
		"match:[",
		"match:\"(\"",
	} {
		source := source
		t.Run(source, func(t *testing.T) {
			_, err := query.Parse(source)
			if err == nil {
				t.Fatalf("the query %q was accepted", source)
			}
			var regexErr *query.RegexError
			if !errors.As(err, &regexErr) {
				t.Fatalf("the error of the query %q is not a typed one: %v", source, err)
			}
			if !strings.HasPrefix(err.Error(), "invalid regular expression: ") {
				t.Fatalf("the message of the error is not the one of the specification: %v", err)
			}
		})
	}
}

func TestMatchExpressionIsBounded(t *testing.T) {
	long := strings.Repeat("a", query.MaxRegexBytes+1)
	_, err := query.Parse(`title matches "` + long + `"`)
	if err == nil {
		t.Fatalf("an expression of %d bytes was accepted", len(long))
	}
	var regexErr *query.RegexError
	if !errors.As(err, &regexErr) {
		t.Fatalf("the error is not a typed one: %v", err)
	}
	// The biggest expression is accepted.
	if _, err := query.Parse(`title matches "` + strings.Repeat("a", query.MaxRegexBytes) + `"`); err != nil {
		t.Fatalf("an expression of %d bytes was refused: %v", query.MaxRegexBytes, err)
	}
}

func TestMatchWithABrokenExpressionNeverPanics(t *testing.T) {
	// The predicate is built by hand, without the parser: a broken expression
	// must not panic at the execution of the query.
	expr := query.Cmp{F: "title", Op: query.OpMatches, V: query.Str{V: "["}}
	predicate := query.CompilePredicate(expr, time.Now())
	if predicate(noteOf()) {
		t.Fatalf("a broken expression matched a note")
	}
}

func TestMatchIsRenderedIntoSQL(t *testing.T) {
	expr, err := query.Parse(`title matches "^To"`)
	if err != nil {
		t.Fatalf("parse the query: %v", err)
	}
	where, args, err := query.CompileWhere(expr, time.Now())
	if err != nil {
		t.Fatalf("compile the query: %v", err)
	}
	if !strings.Contains(where, "regexp(?, note_props.title)") {
		t.Fatalf("the SQL of the query does not use the function regexp: %s", where)
	}
	if len(args) != 1 || args[0] != "^To" {
		t.Fatalf("the parameters of the query are not the expression: %v", args)
	}
}

func TestMatchOfTheTagsIsRenderedIntoSQL(t *testing.T) {
	expr, err := query.Parse(`tag matches "^w"`)
	if err != nil {
		t.Fatalf("parse the query: %v", err)
	}
	where, args, err := query.CompileWhere(expr, time.Now())
	if err != nil {
		t.Fatalf("compile the query: %v", err)
	}
	if !strings.Contains(where, "json_each") || !strings.Contains(where, "regexp(?, value)") {
		t.Fatalf("the SQL of the query does not walk the tags: %s", where)
	}
	if len(args) != 1 || args[0] != "^w" {
		t.Fatalf("the parameters of the query are not the expression: %v", args)
	}
}

func TestMatchIsNotAllowedOnEveryField(t *testing.T) {
	for _, source := range []string{
		"created_at matches \"2020\"",
		"has_code matches \"true\"",
		"updated_at matches \"1\"",
	} {
		source := source
		t.Run(source, func(t *testing.T) {
			_, err := query.Parse(source)
			if err == nil {
				t.Fatalf("the query %q was accepted", source)
			}
			if !strings.Contains(err.Error(), "does not fit the field") {
				t.Fatalf("the message of the error is not the one of the specification: %v", err)
			}
		})
	}
}
