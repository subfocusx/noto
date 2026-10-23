// Package api implements the HTTP layer of the Noto backend.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"noto/backend/internal/model"
	"noto/backend/internal/notes"
)

// statusFor maps a stable error code to an HTTP status code.
func statusFor(code string) int {
	switch code {
	case notes.CodeBadRequest:
		return http.StatusBadRequest
	case notes.CodeInvalidPath, notes.CodeInvalidName:
		return http.StatusBadRequest
	case notes.CodeNotFound:
		return http.StatusNotFound
	case notes.CodeConflict, notes.CodeRevisionConflict, notes.CodeDuplicateName:
		return http.StatusConflict
	case notes.CodePayloadTooLarge:
		return http.StatusRequestEntityTooLarge
	case notes.CodeUnsupportedMedia:
		return http.StatusUnsupportedMediaType
	case notes.CodeForbidden:
		return http.StatusForbidden
	default:
		return http.StatusInternalServerError
	}
}

// writeJSON writes a JSON response.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

// writeError writes the error envelope of a failed request.
func writeError(w http.ResponseWriter, log *slog.Logger, err error) {
	code := notes.Code(err)
	message := notes.Message(err)
	if code == notes.CodeInternal {
		if log != nil {
			log.Error("request failed", "code", code, "err", err)
		}
		message = "internal server error"
	}
	body := model.APIError{Error: model.ErrorBody{Code: code, Message: message}}
	if cur := notes.CurrentContent(err); cur != nil {
		body.Error.Current = cur
	}
	writeJSON(w, statusFor(code), body)
}

// decodeJSON reads a JSON body with a size limit.
func decodeJSON(w http.ResponseWriter, r *http.Request, limit int64, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return notes.NewError(notes.CodePayloadTooLarge, "the request body is too large", notes.ErrPayloadTooLarge)
		}
		return notes.NewError(notes.CodeBadRequest, "the request body is not valid JSON", notes.ErrBadRequest)
	}
	return nil
}
