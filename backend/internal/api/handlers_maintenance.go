package api

import (
	"net/http"
	"os"
	"strconv"
	"strings"

	"noto/backend/internal/notes"
)

// MaintenanceEnabledEnv is the environment variable that enables the
// maintenance endpoints of the API.
//
// The endpoints are off by default: they change the database and they are
// meant for the recovery of a damaged library, not for the normal use of the
// application. The variable is read from the environment instead of the
// configuration, so that the endpoint stays out of a normal build and out of
// the route contract of the API.
const MaintenanceEnabledEnv = "NOTO_MAINTENANCE"

// maintenanceEnabled reports whether the maintenance endpoints are enabled.
func maintenanceEnabled() bool {
	v := strings.TrimSpace(os.Getenv(MaintenanceEnabledEnv))
	if v == "" {
		return false
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false
	}
	return b
}

// reconcileRequest is the body of a reconcile request.
type reconcileRequest struct {
	// Apply creates the metadata rows of the files without a row.
	Apply bool `json:"apply"`
	// DropGhosts deletes the metadata rows without a file.
	DropGhosts bool `json:"dropGhosts"`
}

// handleReconcile compares the notes directory with the database and returns
// the report.
//
// The request body is optional. An empty body only produces the report. The
// body {"apply": true} creates the missing metadata rows and the body
// {"apply": true, "dropGhosts": true} also deletes the rows without a file.
func (s *Server) handleReconcile(w http.ResponseWriter, r *http.Request) {
	req := reconcileRequest{}
	if r.Body != nil && r.ContentLength != 0 {
		if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
			writeError(w, s.log, err)
			return
		}
	}
	report, err := s.svc.ReconcileWithOptions(r.Context(), notes.ReconcileOptions{
		Apply:      req.Apply,
		DropGhosts: req.DropGhosts,
		DryRun:     !req.Apply && !req.DropGhosts,
	})
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, report)
}
