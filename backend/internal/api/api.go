package api

import (
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"noto/backend/internal/config"
	"noto/backend/internal/notes"
	"noto/backend/internal/sealed"
	"noto/backend/internal/web"
)

// Version is the version of the API reported by the health endpoint.
const Version = "0.1.0"

// maxJSONBody is the maximum size of a JSON request body.
const maxJSONBody = 4 << 20

// ServiceFactory creates a notes service for a vault directory. An empty
// directory means the default layout of the server. The returned function
// releases the resources of the created service.
type ServiceFactory func(vaultPath string) (*notes.Service, func(), error)

// closeGrace is the time the resources of a replaced service stay open, so
// that the requests that are still running can finish.
const closeGrace = 5 * time.Second

// Server exposes the notes service over HTTP.
type Server struct {
	cfg config.Config

	// svcMu guards the notes service, because the vault of the notes can be
	// changed while the server is running.
	svcMu sync.RWMutex
	svc   *notes.Service
	// closeSvc releases the resources of the current service.
	closeSvc func()
	// factory creates a new service for another vault.
	factory ServiceFactory

	// vaultMu guards the current vault.
	vaultMu    sync.RWMutex
	vaultPath  string
	vaultNotes string
	// vaultFixed reports that the storage was fixed by the environment (the
	// variable NOTO_VAULT_FIXED enables it). Such a storage cannot be
	// changed at runtime, but it is a storage, so the application does not
	// ask the user for a folder.
	vaultFixed bool

	// sealedMu guards the sealed store and the mode of the vault.
	sealedMu sync.RWMutex
	// sealedStoreRef is the blind object store of a sealed vault. It is nil
	// when the server was not started in the sealed mode; the store is then
	// created over the internal directory of the current vault.
	sealedStoreRef *sealed.Store
	// sealedMode reports that the vault is sealed. In sealed mode the open
	// endpoints of the notes answer with a conflict, because the server
	// stores only ciphertext.
	sealedMode bool

	log *slog.Logger
	mux *http.ServeMux
}

// New creates the HTTP server of the application.
func New(cfg config.Config, svc *notes.Service, logger *slog.Logger) (*Server, error) {
	return NewWithFactory(cfg, svc, logger, nil)
}

// NewWithFactory creates the HTTP server of the application with a factory
// that can build a service for another vault.
func NewWithFactory(cfg config.Config, svc *notes.Service, logger *slog.Logger, factory ServiceFactory) (*Server, error) {
	if svc == nil {
		return nil, notes.NewError(notes.CodeInternal, "the notes service is required", notes.ErrInternal)
	}
	if logger == nil {
		logger = slog.Default()
	}
	s := &Server{cfg: cfg, svc: svc, factory: factory, log: logger, mux: http.NewServeMux()}
	s.routes()
	return s, nil
}

// service returns the current notes service.
func (s *Server) service() *notes.Service {
	s.svcMu.RLock()
	defer s.svcMu.RUnlock()
	return s.svc
}

// setService replaces the current notes service. The resources of the
// previous service are released after a short grace period, so that the
// running requests are not interrupted.
func (s *Server) setService(svc *notes.Service, closer func()) {
	s.svcMu.Lock()
	old := s.closeSvc
	s.svc = svc
	s.closeSvc = closer
	s.svcMu.Unlock()
	if old != nil {
		time.AfterFunc(closeGrace, old)
	}
}

// SetVaultPath remembers the vault the server is currently serving. An empty
// path means that no vault is configured.
func (s *Server) SetVaultPath(path string) {
	s.vaultMu.Lock()
	defer s.vaultMu.Unlock()
	s.vaultPath = strings.TrimSpace(path)
	if svc := s.service(); svc != nil {
		s.vaultNotes = svc.Config().NotesDir
	}
}

// SetVaultFixed reports that the storage of the notes was fixed by the
// environment (the variable NOTO_VAULT_FIXED enables it). A fixed storage
// cannot be changed at runtime, but the application treats it as a chosen
// one: the user is not asked for a folder.
func (s *Server) SetVaultFixed(fixed bool) {
	s.vaultMu.Lock()
	defer s.vaultMu.Unlock()
	s.vaultFixed = fixed
}

// SetServiceCloser registers the function that releases the resources of the
// current service when it is replaced by another one.
func (s *Server) SetServiceCloser(closer func()) {
	s.svcMu.Lock()
	defer s.svcMu.Unlock()
	s.closeSvc = closer
}

// Close releases the resources of the current notes service.
func (s *Server) Close() {
	s.svcMu.Lock()
	closer := s.closeSvc
	s.closeSvc = nil
	s.svcMu.Unlock()
	if closer != nil {
		closer()
	}
}

// vaultState returns the current vault and the directory of the notes.
// The first result is the path of the vault; it is empty when the default
// layout is used and the storage was not fixed by the environment.
func (s *Server) vaultState() (string, string) {
	s.vaultMu.RLock()
	path := s.vaultPath
	notesDir := s.vaultNotes
	fixed := s.vaultFixed
	s.vaultMu.RUnlock()
	if notesDir == "" {
		if svc := s.service(); svc != nil {
			notesDir = svc.Config().NotesDir
		}
	}
	if path == "" && fixed {
		path = notesDir
	}
	return path, notesDir
}

// vaultIsFixed reports whether the storage of the notes was fixed by the
// environment.
func (s *Server) vaultIsFixed() bool {
	s.vaultMu.RLock()
	defer s.vaultMu.RUnlock()
	return s.vaultFixed
}

// Handler returns the fully wrapped HTTP handler.
func (s *Server) Handler() http.Handler {
	return s.middleware(s.mux)
}

// routes registers every endpoint of the REST API.
func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)

	// The endpoints of the open pipeline of the notes are wrapped, so that
	// they answer with a conflict when the vault is sealed. The server
	// stores only ciphertext in the sealed mode and must never write a
	// plaintext file.
	s.mux.HandleFunc("GET /api/tree", s.openRoute(s.handleTree))
	s.mux.HandleFunc("POST /api/folders", s.openRoute(s.handleCreateFolder))
	s.mux.HandleFunc("POST /api/files", s.openRoute(s.handleCreateFile))
	s.mux.HandleFunc("GET /api/notes", s.openRoute(s.handleGetNote))
	s.mux.HandleFunc("PUT /api/notes", s.openRoute(s.handlePutNote))
	s.mux.HandleFunc("POST /api/notes/rename", s.openRoute(s.handleRename))
	s.mux.HandleFunc("POST /api/notes/move", s.openRoute(s.handleMove))
	s.mux.HandleFunc("POST /api/notes/duplicate", s.openRoute(s.handleDuplicate))
	s.mux.HandleFunc("DELETE /api/notes", s.openRoute(s.handleDelete))
	s.mux.HandleFunc("POST /api/notes/restore", s.openRoute(s.handleRestore))
	s.mux.HandleFunc("GET /api/trash", s.openRoute(s.handleTrash))
	s.mux.HandleFunc("GET /api/search", s.openRoute(s.handleSearch))
	s.mux.HandleFunc("POST /api/search/reindex", s.openRoute(s.handleReindex))
	s.mux.HandleFunc("POST /api/query", s.openRoute(s.handleQuery))
	s.mux.HandleFunc("GET /api/tags", s.openRoute(s.handleTags))
	s.mux.HandleFunc("POST /api/import/files", s.openRoute(s.handleImportFiles))
	s.mux.HandleFunc("POST /api/import/zip", s.openRoute(s.handleImportZip))
	s.mux.HandleFunc("GET /api/export/note", s.openRoute(s.handleExportNote))
	s.mux.HandleFunc("GET /api/export/folder", s.openRoute(s.handleExportFolder))
	s.mux.HandleFunc("GET /api/export/all", s.openRoute(s.handleExportAll))
	s.mux.HandleFunc("POST /api/attachments", s.openRoute(s.handleUploadAttachment))
	s.mux.HandleFunc("GET /api/attachments", s.openRoute(s.handleListAttachments))
	s.mux.HandleFunc("GET /api/attachments/{id}/raw", s.openRoute(s.handleRawAttachment))
	s.mux.HandleFunc("DELETE /api/attachments/{id}", s.openRoute(s.handleDeleteAttachment))
	s.mux.HandleFunc("GET /api/vault", s.handleGetVault)
	// The vault cannot be changed while it is sealed: a new vault would
	// need the open pipeline of the notes.
	s.mux.HandleFunc("POST /api/vault", s.openRoute(s.handleSetVault))
	s.mux.HandleFunc("DELETE /api/vault", s.openRoute(s.handleDeleteVault))
	s.mux.HandleFunc("GET /api/vault/browse", s.handleBrowseVault)

	// The endpoints of the sealed mode serve the ciphertext of the vault.
	// The client encrypts everything before it writes it, so the server
	// never sees a plaintext.
	s.mux.HandleFunc("GET /api/vault/sealed/status", s.handleSealedStatus)
	s.mux.HandleFunc("GET /api/vault/sealed/keystore", s.handleGetSealedKeystore)
	s.mux.HandleFunc("PUT /api/vault/sealed/keystore", s.handlePutSealedKeystore)
	s.mux.HandleFunc("GET /api/vault/sealed/objects", s.handleListSealedObjects)
	s.mux.HandleFunc("GET /api/vault/sealed/objects/{id}", s.handleGetSealedObject)
	s.mux.HandleFunc("PUT /api/vault/sealed/objects/{id}", s.handlePutSealedObject)
	s.mux.HandleFunc("DELETE /api/vault/sealed/objects/{id}", s.handleDeleteSealedObject)
	s.mux.HandleFunc("GET /api/vault/sealed/manifests", s.handleListSealedManifests)
	s.mux.HandleFunc("GET /api/vault/sealed/manifests/{gen}", s.handleGetSealedManifest)
	s.mux.HandleFunc("PUT /api/vault/sealed/manifests/{gen}", s.handlePutSealedManifest)
	s.mux.HandleFunc("DELETE /api/vault/sealed/manifests/{gen}", s.handleDeleteSealedManifest)
	s.mux.HandleFunc("POST /api/vault/sealed/enable", s.handleEnableSealed)
	s.mux.HandleFunc("POST /api/vault/sealed/purge-plaintext", s.handlePurgePlaintext)

	// The maintenance endpoints are only registered when they are enabled
	// explicitly, so that they stay out of the route contract of a normal
	// build.
	if maintenanceEnabled() {
		s.mux.HandleFunc("POST /api/maintenance/reconcile", s.handleReconcile)
	}

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
