package api

import (
	"context"
	"net/http"
	"strings"

	"noto/backend/internal/auth"
	"noto/backend/internal/notes"
)

// SessionCookie is the name of the cookie that carries the session of the
// browser. The API clients use the header "Authorization: Bearer <token>".
const SessionCookie = "noto_session"

// LocalUser is the name of the user of the local single user mode. It is the
// user of the requests when the authentication is disabled.
const LocalUser = "local"

// Identity is the user behind a request.
type Identity struct {
	// Name is the name of the account. It is "local" in the single user
	// mode.
	Name string
	// Role is the role of the account.
	Role auth.Role
	// Authenticated reports whether the request carried valid credentials.
	Authenticated bool
}

// IsAdmin reports whether the identity may manage the accounts, read the
// audit log and manage every webhook.
func (i Identity) IsAdmin() bool { return i.Role.IsAdmin() }

// identityKey is the key of the identity in the context of a request.
type identityKey struct{}

// identityFrom returns the identity of a request. It is the local user when
// the request carries none.
func identityFrom(ctx context.Context) Identity {
	if id, ok := ctx.Value(identityKey{}).(Identity); ok {
		return id
	}
	return Identity{Name: LocalUser, Role: auth.RoleAdmin}
}

// localIdentity is the identity of the local single user mode.
func localIdentity() Identity {
	return Identity{Name: LocalUser, Role: auth.RoleAdmin}
}

// requireAuth rejects the requests that carry no valid credentials.
//
// When the authentication is disabled (the default) every request is served
// as the local user: the single user mode of the application keeps working
// exactly as before.
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := s.identify(w, r)
		if !ok {
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), identityKey{}, id)))
	}
}

// identify returns the identity of a request. The second result reports
// whether the request may continue: when it is false the answer was already
// written.
func (s *Server) identify(w http.ResponseWriter, r *http.Request) (Identity, bool) {
	if s.authStore == nil {
		return localIdentity(), true
	}
	token := requestToken(r)
	if token == "" {
		s.log.Warn("rejected a request without credentials", "path", r.URL.Path)
		writeAuthError(w, http.StatusUnauthorized, notes.CodeForbidden,
			"the credentials are required")
		return Identity{}, false
	}
	session, err := s.authStore.Session(r.Context(), token)
	if err != nil {
		s.log.Warn("rejected a request with invalid credentials", "path", r.URL.Path)
		writeAuthError(w, http.StatusUnauthorized, notes.CodeForbidden,
			"the credentials are not valid")
		return Identity{}, false
	}
	return Identity{
		Name:          session.User.Name,
		Role:          session.User.Role,
		Authenticated: true,
	}, true
}

// authGate protects the endpoints of the API.
//
// The health probe and the login are public: they are the way to know that
// the server runs and the way to get a session. Every other endpoint of the
// API needs valid credentials.
func (s *Server) authGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || isPublicRoute(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		s.requireAuth(next.ServeHTTP)(w, r)
	})
}

// isPublicRoute reports whether the route of the API is public.
func isPublicRoute(path string) bool {
	switch path {
	case "/api/health", "/api/auth/login":
		return true
	default:
		return false
	}
}

// requireAdmin rejects the requests of a user that is not an administrator.
//
// The authentication already happened in the gate of the API: the identity
// of the request is known.
func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !identityFrom(r.Context()).IsAdmin() {
			writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
				"the administrator role is required")
			return
		}
		next(w, r)
	}
}

// requestToken returns the token of a request: the header
// "Authorization: Bearer <token>" or the cookie of the browser.
func requestToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if header != "" {
		parts := strings.SplitN(header, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
			return strings.TrimSpace(parts[1])
		}
		return ""
	}
	if cookie, err := r.Cookie(SessionCookie); err == nil {
		return strings.TrimSpace(cookie.Value)
	}
	return ""
}

// authCode maps the error of the auth package to a stable API error code.
//
// The contract of the API does not have a code for the failed authentication:
// the closest existing code is "forbidden".
func authCode(err error) string {
	switch auth.Code(err) {
	case "not_found":
		return notes.CodeNotFound
	case "conflict":
		return notes.CodeConflict
	case "bad_request":
		return notes.CodeBadRequest
	case "last_admin":
		// The contract has no code for it: the closest one is the conflict.
		return notes.CodeConflict
	case "invalid_credentials", "session_expired":
		return notes.CodeForbidden
	default:
		return notes.CodeInternal
	}
}

// writeAuthError writes the error envelope with an explicit status code.
func writeAuthError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{"code": code, "message": message},
	})
}
