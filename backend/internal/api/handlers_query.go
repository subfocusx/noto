package api

import (
	"encoding/json"
	"net/http"

	"noto/backend/internal/notes"
)

// The body of a query.
type queryRequest struct {
	// Query is the text of the query of the query language.
	Query string `json:"query"`
	// Limit is the biggest number of the notes of the answer.
	Limit int `json:"limit"`
}

// handleQuery runs a query of the query language and answers with the notes
// that match it.
//
// The query is parsed by the service, so a broken query is answered with
// 400 and the message of the parser.
func (s *Server) handleQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "only POST is allowed", notes.ErrBadRequest))
		return
	}
	var body queryRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody)).Decode(&body); err != nil {
		writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the body is not a valid json", notes.ErrBadRequest))
		return
	}
	limit := body.Limit
	if limit <= 0 {
		limit = 50
	}
	result, err := s.service().Query(r.Context(), body.Query, limit)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// handleTags answers with the tags of the vault and the number of the notes
// that carry every one of them.
func (s *Server) handleTags(w http.ResponseWriter, r *http.Request) {
	counts, err := s.service().TagCounts(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": counts})
}
