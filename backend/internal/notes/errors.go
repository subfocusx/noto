package notes

import (
	"errors"
	"fmt"

	"noto/backend/internal/model"
)

// Stable machine readable error codes of the REST API.
const (
	CodeBadRequest       = "bad_request"
	CodeInvalidPath      = "invalid_path"
	CodeInvalidName      = "invalid_name"
	CodeNotFound         = "not_found"
	CodeConflict         = "conflict"
	CodeRevisionConflict = "revision_conflict"
	CodeDuplicateName    = "duplicate_name"
	CodePayloadTooLarge  = "payload_too_large"
	CodeUnsupportedMedia = "unsupported_media_type"
	CodeForbidden        = "forbidden"
	CodeInternal         = "internal"
)

// Sentinel errors. They are wrapped by *Error and can be tested with
// errors.Is.
var (
	ErrBadRequest       = errors.New("bad_request")
	ErrInvalidPath      = errors.New("invalid_path")
	ErrInvalidName      = errors.New("invalid_name")
	ErrNotFound         = errors.New("not_found")
	ErrConflict         = errors.New("conflict")
	ErrRevisionConflict = errors.New("revision_conflict")
	ErrDuplicateName    = errors.New("duplicate_name")
	ErrPayloadTooLarge  = errors.New("payload_too_large")
	ErrUnsupportedMedia = errors.New("unsupported_media_type")
	ErrForbidden        = errors.New("forbidden")
	ErrInternal         = errors.New("internal")
)

// Error is the typed error of the notes package. It carries the stable API
// error code, a human readable message and, for revision conflicts, the
// current server side note content.
type Error struct {
	// Code is the stable machine readable code.
	Code string
	// Message is human readable and never contains absolute server paths.
	Message string
	// Current is set for revision_conflict errors.
	Current *model.NoteContent
	// cause is the matching sentinel error.
	cause error
}

func (e *Error) Error() string {
	if e.Message == "" {
		return e.Code
	}
	return e.Code + ": " + e.Message
}

// Unwrap exposes the sentinel error to errors.Is.
func (e *Error) Unwrap() error { return e.cause }

// newErr builds a typed error for the given sentinel.
func newErr(cause error, format string, args ...any) *Error {
	code := Code(cause)
	msg := format
	if len(args) > 0 {
		msg = fmt.Sprintf(format, args...)
	}
	return &Error{Code: code, Message: msg, cause: cause}
}

// NewError builds a typed error with an explicit code and message.
func NewError(code, message string, cause error) *Error {
	if cause == nil {
		cause = errors.New(code)
	}
	return &Error{Code: code, Message: message, cause: cause}
}

// Code maps any error to a stable API error code. Unknown errors map to
// "internal".
func Code(err error) string {
	if err == nil {
		return ""
	}
	var e *Error
	if errors.As(err, &e) && e.Code != "" {
		return e.Code
	}
	switch {
	case errors.Is(err, ErrInvalidPath):
		return CodeInvalidPath
	case errors.Is(err, ErrInvalidName):
		return CodeInvalidName
	case errors.Is(err, ErrNotFound):
		return CodeNotFound
	case errors.Is(err, ErrConflict):
		return CodeConflict
	case errors.Is(err, ErrRevisionConflict):
		return CodeRevisionConflict
	case errors.Is(err, ErrDuplicateName):
		return CodeDuplicateName
	case errors.Is(err, ErrPayloadTooLarge):
		return CodePayloadTooLarge
	case errors.Is(err, ErrUnsupportedMedia):
		return CodeUnsupportedMedia
	case errors.Is(err, ErrForbidden):
		return CodeForbidden
	case errors.Is(err, ErrBadRequest):
		return CodeBadRequest
	default:
		return CodeInternal
	}
}

// Message returns the human readable message of an error.
func Message(err error) string {
	if err == nil {
		return ""
	}
	var e *Error
	if errors.As(err, &e) {
		return e.Message
	}
	return err.Error()
}

// CurrentContent returns the server side note attached to a revision
// conflict, if any.
func CurrentContent(err error) *model.NoteContent {
	var e *Error
	if errors.As(err, &e) {
		return e.Current
	}
	return nil
}
