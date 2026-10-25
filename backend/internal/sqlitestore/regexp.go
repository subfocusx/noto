package sqlitestore

import (
	"database/sql/driver"
	"log/slog"

	sqlite "modernc.org/sqlite"

	"noto/backend/internal/query"
)

// init registers the SQL function `regexp(pattern, value)`, which the
// operator `matches` of the query language needs.
//
// The function is registered for the driver `sqlite`, so every connection
// opened after this point knows it. The engine is the one of Go (RE2): the
// expression is linear, so it cannot blow up, and it has no back reference.
func init() {
	if err := sqlite.RegisterDeterministicScalarFunction("regexp", 2, sqlRegexp); err != nil {
		slog.Error("sqlitestore: the function regexp cannot be registered", "error", err)
	}
}

// sqlRegexp answers whether the value matches the pattern.
//
// The expression is compiled with the limits of the language: an expression
// that is too long or that the engine refuses matches nothing, and never
// panics.
func sqlRegexp(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
	pattern, ok := args[0].(string)
	if !ok {
		return int64(0), nil
	}
	value, ok := args[1].(string)
	if !ok {
		return int64(0), nil
	}
	re, err := query.CompileRegex(pattern)
	if err != nil {
		return int64(0), nil
	}
	if re.MatchString(value) {
		return int64(1), nil
	}
	return int64(0), nil
}
