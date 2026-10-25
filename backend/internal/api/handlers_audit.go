package api

import (
	"net/http"
	"strconv"
	"strings"

	"noto/backend/internal/audit"
	"noto/backend/internal/notes"
)

// recordAudit writes an entry in the audit log.
//
// The entry never carries the content of a note: only the identifier of the
// target and the name of the action.
func (s *Server) recordAudit(r *http.Request, action, target, result string) {
	if s.auditLog == nil {
		return
	}
	id := identityFrom(r.Context())
	user := id.Name
	if strings.TrimSpace(user) == "" {
		user = "anonymous"
	}
	entry := audit.Entry{
		User:   user,
		Action: action,
		Target: target,
		Result: result,
	}
	if err := s.auditLog.Append(r.Context(), entry); err != nil {
		s.log.Warn("cannot write the audit entry", "action", action, "err", err)
	}
}

// handleAuditLog returns the entries of the audit log. Only an administrator
// may read it.
//
// The query parameters are "limit" (the maximum number of the entries, 100
// by default), "action" and "user" (the filters).
func (s *Server) handleAuditLog(w http.ResponseWriter, r *http.Request) {
	if s.auditLog == nil {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the audit log is disabled")
		return
	}
	filter := audit.Filter{
		User:   strings.TrimSpace(r.URL.Query().Get("user")),
		Action: strings.TrimSpace(r.URL.Query().Get("action")),
		Limit:  100,
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			writeAuthError(w, http.StatusBadRequest, notes.CodeBadRequest,
				"the limit parameter is not valid")
			return
		}
		filter.Limit = n
	}
	entries, err := s.auditLog.List(r.Context(), filter)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}
