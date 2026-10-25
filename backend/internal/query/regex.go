package query

import (
	"fmt"
	"regexp"
	"strings"
)

// MaxRegexBytes is the biggest size, in bytes, of a regular expression of the
// language. The limit keeps the compilation of the expression cheap and the
// memory of the engine bounded.
const MaxRegexBytes = 512

// RegexError is the error of a regular expression that the engine of the
// language refuses. It is typed: the caller never parses the message of the
// error to know what happened.
type RegexError struct {
	// Pattern is the expression that was refused.
	Pattern string
	// Reason is why the expression was refused.
	Reason string
}

// Error implements the error interface.
func (e *RegexError) Error() string {
	return fmt.Sprintf("invalid regular expression: %s", e.Reason)
}

// CompileRegex compiles a regular expression of the query language.
//
// The engine is RE2, the one of Go: the expression is linear, so it cannot
// blow up, and it has no back reference nor look around. The expression is
// bounded in size, and only the answer of the match is ever computed: the
// text of a match is never built, so it cannot grow with the size of the
// vault.
//
// The browser has no RE2: it compiles the expression with the RegExp of
// JavaScript, whose language is close but not the same. The expressions of
// the golden vectors are the ones both engines understand.
func CompileRegex(pattern string) (*regexp.Regexp, error) {
	if len(pattern) > MaxRegexBytes {
		return nil, &RegexError{
			Pattern: pattern,
			Reason:  fmt.Sprintf("the expression is longer than %d bytes", MaxRegexBytes),
		}
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, &RegexError{Pattern: pattern, Reason: reasonOf(err)}
	}
	return re, nil
}

// reasonOf returns the reason of a compilation error, without the prefix of
// the standard library.
func reasonOf(err error) string {
	const prefix = "error parsing regexp: "
	return strings.TrimPrefix(err.Error(), prefix)
}
