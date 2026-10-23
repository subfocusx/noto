package api

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"noto/backend/internal/notes"
)

// stateChangingMethods are the HTTP methods that may change data.
var stateChangingMethods = map[string]bool{
	http.MethodPost:   true,
	http.MethodPut:    true,
	http.MethodPatch:  true,
	http.MethodDelete: true,
}

// recoverer turns a panic into a JSON error response.
func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				s.log.Error("panic while handling the request", "path", r.URL.Path, "panic", rec)
				writeError(w, s.log, notes.NewError(notes.CodeInternal, "internal server error", notes.ErrInternal))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// securityHeaders adds the security headers to every response.
func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'")
		next.ServeHTTP(w, r)
	})
}

// hostCheck rejects requests with a foreign Host header.
func (s *Server) hostCheck(next http.Handler) http.Handler {
	allowed := s.allowedHosts()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if host == "" {
			next.ServeHTTP(w, r)
			return
		}
		name := host
		if h, _, err := net.SplitHostPort(host); err == nil {
			name = h
		}
		name = strings.ToLower(strings.Trim(name, "[]"))
		if !allowed[name] {
			s.log.Warn("rejected a request with a foreign host", "host", r.Host, "path", r.URL.Path)
			writeError(w, s.log, notes.NewError(notes.CodeForbidden, "the host is not allowed", notes.ErrForbidden))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// originCheck implements the CORS allow list and the CSRF protection.
//
// A request that carries the origin of the server itself is a same origin
// request and is always allowed: the browser adds the Origin header to every
// state changing request, so rejecting it would make the application
// unusable. A missing Origin header means a client that is not a browser and
// is allowed as well.
func (s *Server) originCheck(next http.Handler) http.Handler {
	allowed := s.allowedOrigins()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}
		if sameOrigin(r) {
			// A same origin request does not need a CORS header.
			next.ServeHTTP(w, r)
			return
		}
		if !allowed[strings.ToLower(origin)] {
			if stateChangingMethods[r.Method] {
				s.log.Warn("rejected a cross origin request", "origin", origin, "method", r.Method, "path", r.URL.Path)
				writeError(w, s.log, notes.NewError(notes.CodeForbidden, "the origin is not allowed", notes.ErrForbidden))
				return
			}
			// No CORS header is added for foreign origins.
			next.ServeHTTP(w, r)
			return
		}
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// sameOrigin reports whether the Origin header of the request points to the
// same host and port as the Host header of the request. The comparison is
// case insensitive and the default ports of the scheme are normalised.
//
// A Host header without a port belongs to the default port of the scheme of
// the origin, which keeps the check working behind a reverse proxy that
// terminates the TLS connection.
func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || r.Host == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	originHost := strings.ToLower(strings.Trim(u.Hostname(), "[]"))
	requestHost := strings.ToLower(strings.Trim(requestHostname(r.Host), "[]"))
	if originHost == "" || originHost != requestHost {
		return false
	}
	originPort := u.Port()
	requestPort := requestPort(r.Host)
	if requestPort != "" {
		return originPort == requestPort
	}
	// The Host header has no port, so the origin must use the default port
	// of its scheme.
	if originPort == "" {
		originPort = defaultPort(u.Scheme)
	}
	return originPort == defaultPort(u.Scheme)
}

// defaultPort returns the default port of a URL scheme.
func defaultPort(scheme string) string {
	switch strings.ToLower(scheme) {
	case "https":
		return "443"
	default:
		return "80"
	}
}

// requestHostname returns the host part of the Host header.
func requestHostname(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return strings.Trim(host, "[]")
}

// requestPort returns the port part of the Host header.
func requestPort(host string) string {
	if _, p, err := net.SplitHostPort(host); err == nil {
		return p
	}
	return ""
}

// statusRecorder remembers the status code of a response.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(code int) {
	if r.status == 0 {
		r.status = code
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

// logger writes a structured log line for every request. Note contents are
// never logged.
func (s *Server) logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		s.log.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"bytes", rec.bytes,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}
