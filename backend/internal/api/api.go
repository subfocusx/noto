package api

import (
	"log/slog"
	"net/http"
	"strings"

	"noto/backend/internal/config"
	"noto/backend/internal/notes"
	"noto/backend/internal/web"
)

// Version is the version of the API reported by the health endpoint.
const Version = "0.1.0"

// maxJSONBody is the maximum size of a JSON request body.
const maxJSONBody = 4 << 20

// Server exposes the notes service over HTTP.
type Server struct {
	cfg config.Config
	svc *notes.Service
	log *slog.Logger
	mux *http.ServeMux
}

// New creates the HTTP server of the application.
func New(cfg config.Config, svc *notes.Service, logger *slog.Logger) (*Server, error) {
	if svc == nil {
		return nil, notes.NewError(notes.CodeInternal, "the notes service is required", notes.ErrInternal)
	}
	if logger == nil {
		logger = slog.Default()
	}
	s := &Server{cfg: cfg, svc: svc, log: logger, mux: http.NewServeMux()}
	s.routes()
	return s, nil
}

// Handler returns the fully wrapped HTTP handler.
func (s *Server) Handler() http.Handler {
	return s.middleware(s.mux)
}

// routes registers every endpoint of the REST API.
func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/tree", s.handleTree)
	s.mux.HandleFunc("POST /api/folders", s.handleCreateFolder)
	s.mux.HandleFunc("POST /api/files", s.handleCreateFile)
	s.mux.HandleFunc("GET /api/notes", s.handleGetNote)
	s.mux.HandleFunc("PUT /api/notes", s.handlePutNote)
	s.mux.HandleFunc("POST /api/notes/rename", s.handleRename)
	s.mux.HandleFunc("POST /api/notes/move", s.handleMove)
	s.mux.HandleFunc("DELETE /api/notes", s.handleDelete)
	s.mux.HandleFunc("POST /api/notes/restore", s.handleRestore)
	s.mux.HandleFunc("GET /api/trash", s.handleTrash)
	s.mux.HandleFunc("GET /api/search", s.handleSearch)
	s.mux.HandleFunc("POST /api/search/reindex", s.handleReindex)
	s.mux.HandleFunc("POST /api/import/files", s.handleImportFiles)
	s.mux.HandleFunc("POST /api/import/zip", s.handleImportZip)
	s.mux.HandleFunc("GET /api/export/note", s.handleExportNote)
	s.mux.HandleFunc("GET /api/export/folder", s.handleExportFolder)
	s.mux.HandleFunc("GET /api/export/all", s.handleExportAll)
	s.mux.HandleFunc("POST /api/attachments", s.handleUploadAttachment)
	s.mux.HandleFunc("GET /api/attachments", s.handleListAttachments)
	s.mux.HandleFunc("GET /api/attachments/{id}/raw", s.handleRawAttachment)
	s.mux.HandleFunc("DELETE /api/attachments/{id}", s.handleDeleteAttachment)

	// Unknown API routes return the JSON error envelope.
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, s.log, notes.NewError(notes.CodeNotFound, "unknown endpoint", notes.ErrNotFound))
	})
	// The single page application is served for every other route.
	spa, err := web.Handler(s.cfg.StaticDir)
	if err != nil {
		s.log.Warn("the static directory is not usable, falling back to the embedded frontend", "err", err)
		spa, err = web.Handler("")
		if err != nil {
			s.log.Error("cannot initialise the web handler", "err", err)
			spa = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				writeError(w, s.log, notes.NewError(notes.CodeInternal, "the frontend is not available", notes.ErrInternal))
			})
		}
	}
	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") {
			writeError(w, s.log, notes.NewError(notes.CodeNotFound, "unknown endpoint", notes.ErrNotFound))
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, s.log, notes.NewError(notes.CodeBadRequest, "the method is not allowed for this route", notes.ErrBadRequest))
			return
		}
		spa.ServeHTTP(w, r)
	})
}

// middleware wraps the router with the security and logging middleware.
func (s *Server) middleware(next http.Handler) http.Handler {
	return s.recoverer(s.securityHeaders(s.hostCheck(s.originCheck(s.logger(next)))))
}

// allowedOrigins returns the set of allowed CORS origins.
func (s *Server) allowedOrigins() map[string]bool {
	out := map[string]bool{}
	for _, o := range s.cfg.AllowedOrigins {
		o = strings.TrimSpace(o)
		if o != "" {
			out[strings.ToLower(o)] = true
		}
	}
	return out
}

// allowedHosts returns the set of accepted Host header values.
func (s *Server) allowedHosts() map[string]bool {
	out := map[string]bool{
		"localhost": true,
		"127.0.0.1": true,
		"::1":       true,
		"[::1]":     true,
	}
	host := s.cfg.Addr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		host = host[:i]
	}
	host = strings.Trim(host, "[]")
	if host != "" {
		out[strings.ToLower(host)] = true
	}
	// The hosts of the allowed origins are accepted as well.
	for origin := range s.allowedOrigins() {
		h := origin
		if i := strings.Index(h, "://"); i >= 0 {
			h = h[i+3:]
		}
		if i := strings.Index(h, "/"); i >= 0 {
			h = h[:i]
		}
		if h != "" {
			out[strings.ToLower(h)] = true
		}
	}
	return out
}
