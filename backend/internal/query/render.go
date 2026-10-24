package query

import (
	"fmt"
	"strings"
	"time"

	"noto/backend/internal/metadata"
)

// The SQL fragments used by the compiler.
const (
	// FromClause is the FROM clause of a compiled query.
	FromClause = "FROM notes " +
		"LEFT JOIN note_props ON note_props.path = notes.path " +
		"LEFT JOIN notes_fts ON notes_fts.path = notes.path"

	// SelectClause is the projection of a compiled query.
	SelectClause = "SELECT notes.path, notes.name"
)

// The columns of the fields.
const (
	colPath      = "notes.path"
	colName      = "notes.name"
	colTitle     = "note_props.title"
	colTags      = "note_props.tags"
	colFolder    = "notes.parent_path"
	colContent   = "notes_fts.body"
	colCreatedAt = "notes.created_at"
	colUpdatedAt = "notes.updated_at"

	// colExt is the extension of the file name, lower cased and without the dot.
	colExt = "(CASE WHEN instr(notes.name, '.') > 0 " +
		"THEN lower(substr(notes.name, instr(notes.name, '.') + 1)) ELSE '' END)"

	// hasAttachmentsSQL is the subquery that checks the attachments of a note.
	hasAttachmentsSQL = "EXISTS (SELECT 1 FROM attachments WHERE note_path = notes.path)"
)

// renderer turns an Expr into SQL with parameters.
type renderer struct {
	now  time.Time
	args []any
}

// Compile compiles an expression into a SQL statement and the list of its
// parameters. The values are always parameters: a query can never inject SQL.
//
// The moment of the execution is frozen in now and is used by the values now,
// today and the relative ones.
func Compile(e Expr, now time.Time) (string, []any, error) {
	r := &renderer{now: now}
	cond, err := r.render(e)
	if err != nil {
		return "", nil, err
	}
	sql := SelectClause + " " + FromClause + " WHERE " + cond
	return sql, r.args, nil
}

// CompileWhere compiles an expression into a WHERE fragment and the list of
// its parameters.
func CompileWhere(e Expr, now time.Time) (string, []any, error) {
	r := &renderer{now: now}
	cond, err := r.render(e)
	if err != nil {
		return "", nil, err
	}
	return cond, r.args, nil
}

// render renders an expression into a SQL condition.
func (r *renderer) render(e Expr) (string, error) {
	switch n := e.(type) {
	case nil:
		return "0", nil
	case And:
		l, err := r.render(n.L)
		if err != nil {
			return "", err
		}
		rr, err := r.render(n.R)
		if err != nil {
			return "", err
		}
		return "(" + l + " AND " + rr + ")", nil
	case Or:
		l, err := r.render(n.L)
		if err != nil {
			return "", err
		}
		rr, err := r.render(n.R)
		if err != nil {
			return "", err
		}
		return "(" + l + " OR " + rr + ")", nil
	case Not:
		sub, err := r.render(n.E)
		if err != nil {
			return "", err
		}
		return "(NOT " + sub + ")", nil
	case Truthy:
		return r.renderTruthy(n.F)
	case Cmp:
		return r.renderCmp(n)
	}
	return "", fmt.Errorf("query: unknown node %T", e)
}

// renderTruthy renders a boolean field used on its own.
func (r *renderer) renderTruthy(field string) (string, error) {
	if field == "has_attachments" {
		return "(" + hasAttachmentsSQL + ")", nil
	}
	mask, ok := metadata.FlagMask(field)
	if !ok {
		return "", fmt.Errorf("query: the field %s is not a boolean field", field)
	}
	return r.renderFlag(mask, true), nil
}

// renderFlag renders a test on the bits of note_props.flags.
func (r *renderer) renderFlag(mask uint64, want bool) string {
	if want {
		return fmt.Sprintf("((note_props.flags & %d) <> 0)", mask)
	}
	return fmt.Sprintf("((note_props.flags & %d) = 0)", mask)
}

// renderCmp renders a comparison.
func (r *renderer) renderCmp(c Cmp) (string, error) {
	switch c.F {
	case "created_at", "updated_at":
		return r.renderTimestamp(c)
	case "has_task_list", "has_incomplete_tasks", "has_code", "has_image", "has_link":
		return r.renderFlagCompare(c)
	case "has_attachments":
		return r.renderAttachmentsCompare(c)
	case "tag":
		return r.renderTag(c)
	}
	return r.renderString(c)
}

// renderTimestamp renders the comparison of a timestamp field.
func (r *renderer) renderTimestamp(c Cmp) (string, error) {
	sec, err := r.seconds(c.V)
	if err != nil {
		return "", err
	}
	col := colCreatedAt
	if c.F == "updated_at" {
		col = colUpdatedAt
	}
	op, ok := sqlOperator(c.Op)
	if !ok {
		return "", fmt.Errorf("query: the operator %s does not fit the field %s", c.Op, c.F)
	}
	// The moments are stored in milliseconds in the database, and the values
	// of the language are in seconds: the comparison is made in the unit of
	// the column, so that the two implementations of the language agree.
	r.args = append(r.args, sec*1000)
	return "(" + col + " " + op + " ?)", nil
}

// renderFlagCompare renders the comparison of a flag with a boolean.
func (r *renderer) renderFlagCompare(c Cmp) (string, error) {
	b, ok := c.V.(Bool)
	if !ok {
		return "", fmt.Errorf("query: the field %s does not accept the value %s", c.F, describeValue(c.V))
	}
	mask, ok := metadata.FlagMask(c.F)
	if !ok {
		return "", fmt.Errorf("query: the field %s is not a boolean field", c.F)
	}
	if c.Op == OpEQ {
		return r.renderFlag(mask, b.V), nil
	}
	return r.renderFlag(mask, !b.V), nil
}

// renderAttachmentsCompare renders the comparison of the flag
// has_attachments with a boolean.
func (r *renderer) renderAttachmentsCompare(c Cmp) (string, error) {
	b, ok := c.V.(Bool)
	if !ok {
		return "", fmt.Errorf("query: the field %s does not accept the value %s", c.F, describeValue(c.V))
	}
	if c.Op == OpEQ {
		if b.V {
			return "(" + hasAttachmentsSQL + ")", nil
		}
		return "(NOT " + hasAttachmentsSQL + ")", nil
	}
	if b.V {
		return "(NOT " + hasAttachmentsSQL + ")", nil
	}
	return "(" + hasAttachmentsSQL + ")", nil
}

// renderTag renders the comparison of the list of tags.
func (r *renderer) renderTag(c Cmp) (string, error) {
	switch c.Op {
	case OpEQ, OpNE:
		s, ok := c.V.(Str)
		if !ok {
			return "", fmt.Errorf("query: the field tag does not accept the value %s", describeValue(c.V))
		}
		cond := r.tagLike(s.V)
		if c.Op == OpNE {
			return "(NOT " + cond + ")", nil
		}
		return cond, nil
	case OpIn:
		list, ok := c.V.(List)
		if !ok {
			return "", fmt.Errorf("query: the field tag does not accept the value %s", describeValue(c.V))
		}
		if len(list.Items) == 0 {
			return "0", nil
		}
		parts := make([]string, 0, len(list.Items))
		for _, item := range list.Items {
			s, ok := item.(Str)
			if !ok {
				return "", fmt.Errorf("query: the field tag does not accept the value %s", describeValue(item))
			}
			parts = append(parts, r.tagLike(s.V))
		}
		return "(" + strings.Join(parts, " OR ") + ")", nil
	}
	return "", fmt.Errorf("query: the operator %s does not fit the field tag", c.Op)
}

// tagLike builds the condition that the list of tags contains a tag. The
// tags are stored as a JSON array of strings, so the tag is searched as a
// quoted word.
func (r *renderer) tagLike(tag string) string {
	pattern := "%" + escapeLike(`"`+tag+`"`) + "%"
	r.args = append(r.args, pattern)
	return "(" + colTags + " LIKE ? ESCAPE '\\')"
}

// renderString renders the comparison of a textual field.
func (r *renderer) renderString(c Cmp) (string, error) {
	s, ok := c.V.(Str)
	if !ok {
		return "", fmt.Errorf("query: the field %s does not accept the value %s", c.F, describeValue(c.V))
	}
	col, ok := stringColumn(c.F)
	if !ok {
		return "", fmt.Errorf("query: unknown field: %s", c.F)
	}
	switch c.Op {
	case OpEQ, OpNE:
		op := "="
		if c.Op == OpNE {
			op = "<>"
		}
		left := col
		right := "?"
		if c.F == "name" || c.F == "content" {
			left = "lower(" + col + ")"
			right = "lower(?)"
		}
		r.args = append(r.args, s.V)
		return "(" + left + " " + op + " " + right + ")", nil
	case OpContains:
		r.args = append(r.args, "%"+escapeLike(s.V)+"%")
		return "(lower(" + col + ") LIKE ? ESCAPE '\\')", nil
	case OpStartsWith:
		r.args = append(r.args, escapeLike(s.V)+"%")
		return "(lower(" + col + ") LIKE ? ESCAPE '\\')", nil
	case OpEndsWith:
		r.args = append(r.args, "%"+escapeLike(s.V))
		return "(lower(" + col + ") LIKE ? ESCAPE '\\')", nil
	}
	return "", fmt.Errorf("query: the operator %s does not fit the field %s", c.Op, c.F)
}

// stringColumn returns the SQL expression of a textual field.
func stringColumn(field string) (string, bool) {
	switch field {
	case "path":
		return colPath, true
	case "name":
		return colName, true
	case "title":
		return colTitle, true
	case "folder":
		return colFolder, true
	case "ext":
		return colExt, true
	case "content":
		return colContent, true
	}
	return "", false
}

// seconds converts a value into a unix timestamp in seconds.
func (r *renderer) seconds(v Value) (int64, error) {
	switch n := v.(type) {
	case Now:
		return r.now.Unix(), nil
	case Today:
		y, m, d := r.now.Date()
		midnight := time.Date(y, m, d, 0, 0, 0, 0, r.now.Location())
		return midnight.Unix(), nil
	case Rel:
		var base int64
		switch n.Base {
		case "now":
			base = r.now.Unix()
		case "today":
			y, m, d := r.now.Date()
			base = time.Date(y, m, d, 0, 0, 0, 0, r.now.Location()).Unix()
		default:
			return 0, fmt.Errorf("query: unknown base of the relative value: %s", n.Base)
		}
		return base + n.Off, nil
	case Num:
		return int64(n.V), nil
	}
	return 0, fmt.Errorf("query: the value %s is not a timestamp", describeValue(v))
}

// sqlOperator maps an operator of the language onto a SQL operator.
func sqlOperator(op string) (string, bool) {
	switch op {
	case OpEQ:
		return "=", true
	case OpNE:
		return "<>", true
	case OpGT:
		return ">", true
	case OpGE:
		return ">=", true
	case OpLT:
		return "<", true
	case OpLE:
		return "<=", true
	}
	return "", false
}

// escapeLike escapes the wildcards of a LIKE pattern. The escape character is
// the backslash, as in the other parts of the backend.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// describeValue returns a readable form of a value, used in the errors.
func describeValue(v Value) string {
	switch n := v.(type) {
	case Str:
		return n.V
	case Num:
		return fmt.Sprintf("%v", n.V)
	case Bool:
		return fmt.Sprintf("%v", n.V)
	case List:
		return "list"
	case Now:
		return "now"
	case Today:
		return "today"
	case Rel:
		return fmt.Sprintf("%s%+d", n.Base, n.Off)
	}
	return fmt.Sprintf("%v", v)
}
