package api

import (
	"net/http"
	"strconv"
)

// handleSearch searches the index.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	hits, err := s.service().Search(r.Context(), q, limit)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hits": hits})
}

// handleReindex rebuilds the search index.
func (s *Server) handleReindex(w http.ResponseWriter, r *http.Request) {
	count, err := s.service().Reindex(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"indexed": count})
}
