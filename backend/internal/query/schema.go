package query

// FieldType is the type of a field of the query language.
type FieldType string

const (
	// TypeString is a textual field.
	TypeString FieldType = "string"
	// TypeList is a field that holds a list of strings (the tags).
	TypeList FieldType = "list"
	// TypeBool is a boolean field.
	TypeBool FieldType = "bool"
	// TypeTimestamp is a field that holds a unix timestamp in seconds.
	TypeTimestamp FieldType = "timestamp"
)

// Field is one field of the query language.
type Field struct {
	// Name is the name of the field as it is written in a query.
	Name string
	// Type is the type of the field.
	Type FieldType
}

// The operators of the language.
const (
	OpEQ          = "=="
	OpNE          = "!="
	OpGT          = ">"
	OpGE          = ">="
	OpLT          = "<"
	OpLE          = "<="
	OpIn          = "in"
	OpContains    = "contains"
	OpStartsWith  = "startsWith"
	OpEndsWith    = "endsWith"
	// OpMatches is the operator of the regular expressions: the text of the
	// field matches the expression.
	OpMatches = "matches"
)

// fields is the schema of the query language (docs/QUERY_LANGUAGE.md, section 2).
var fields = map[string]Field{
	"path":              {Name: "path", Type: TypeString},
	"name":              {Name: "name", Type: TypeString},
	"title":             {Name: "title", Type: TypeString},
	"tag":               {Name: "tag", Type: TypeList},
	"folder":            {Name: "folder", Type: TypeString},
	"ext":               {Name: "ext", Type: TypeString},
	"content":           {Name: "content", Type: TypeString},
	"has_task_list":     {Name: "has_task_list", Type: TypeBool},
	"has_incomplete_tasks": {Name: "has_incomplete_tasks", Type: TypeBool},
	"has_code":          {Name: "has_code", Type: TypeBool},
	"has_image":         {Name: "has_image", Type: TypeBool},
	"has_link":          {Name: "has_link", Type: TypeBool},
	"has_attachments":   {Name: "has_attachments", Type: TypeBool},
	"created_at":        {Name: "created_at", Type: TypeTimestamp},
	"updated_at":        {Name: "updated_at", Type: TypeTimestamp},
}

// fieldOperators lists the operators that fit every field
// (docs/QUERY_LANGUAGE.md, section 3).
var fieldOperators = map[string][]string{
	"path":   {OpEQ, OpNE, OpStartsWith, OpEndsWith, OpMatches},
	"name":   {OpEQ, OpNE, OpContains, OpStartsWith, OpEndsWith, OpMatches},
	"title":  {OpEQ, OpNE, OpStartsWith, OpEndsWith, OpMatches},
	"tag":    {OpEQ, OpNE, OpIn, OpMatches},
	"folder": {OpEQ, OpNE, OpStartsWith, OpEndsWith, OpMatches},
	"ext":    {OpEQ, OpNE, OpMatches},
	"content": {OpEQ, OpNE, OpContains, OpMatches},
	"has_task_list":       {OpEQ, OpNE},
	"has_incomplete_tasks": {OpEQ, OpNE},
	"has_code":            {OpEQ, OpNE},
	"has_image":           {OpEQ, OpNE},
	"has_link":            {OpEQ, OpNE},
	"has_attachments":     {OpEQ, OpNE},
	"created_at":          {OpEQ, OpNE, OpGT, OpGE, OpLT, OpLE},
	"updated_at":          {OpEQ, OpNE, OpGT, OpGE, OpLT, OpLE},
}

// knownOperators is the set of the operators of the language.
var knownOperators = map[string]bool{
	OpEQ:         true,
	OpNE:         true,
	OpGT:         true,
	OpGE:         true,
	OpLT:         true,
	OpLE:         true,
	OpIn:         true,
	OpContains:   true,
	OpStartsWith: true,
	OpEndsWith:   true,
	OpMatches:    true,
}

// LookupField returns the field with the given name.
func LookupField(name string) (Field, bool) {
	f, ok := fields[name]
	return f, ok
}

// FieldNames returns the names of every field of the language, sorted.
func FieldNames() []string {
	out := make([]string, 0, len(fields))
	for name := range fields {
		out = append(out, name)
	}
	sortStrings(out)
	return out
}

// AllowedOperators returns the operators that fit the given field.
func AllowedOperators(f Field) []string {
	ops := fieldOperators[f.Name]
	out := make([]string, len(ops))
	copy(out, ops)
	return out
}

// OperatorAllowed reports whether the operator fits the field.
func OperatorAllowed(field, op string) bool {
	for _, o := range fieldOperators[field] {
		if o == op {
			return true
		}
	}
	return false
}

// IsKnownOperator reports whether the operator exists in the language.
func IsKnownOperator(op string) bool { return knownOperators[op] }

// sortStrings sorts a slice of strings in place (small helper to keep the
// package free of imports in every file).
func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
