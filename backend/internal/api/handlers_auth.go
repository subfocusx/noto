package api

import (
	"net/http"
	"strings"
	"time"

	"noto/backend/internal/auth"
	"noto/backend/internal/notes"
)

// loginRequest is the body of the login endpoint.
type loginRequest struct {
	// Name is the name of the account.
	Name string `json:"name"`
	// Password is the password of the account.
	Password string `json:"password"`
}

// handleLogin opens a session for an account.
//
// The endpoint is public: it is the only way to get a token. When the
// authentication is disabled the endpoint answers with a conflict: there is
// no account to log in with.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.authStore == nil {
		writeAuthError(w, http.StatusConflict, notes.CodeConflict,
			"the authentication is disabled")
		return
	}
	var req loginRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	session, err := s.authStore.Login(r.Context(), req.Name, req.Password, s.cfg.SessionTTL)
	if err != nil {
		writeAuthError(w, http.StatusUnauthorized, notes.CodeForbidden,
			"the name or the password is wrong")
		return
	}
	s.setSessionCookie(w, session)
	writeJSON(w, http.StatusOK, map[string]any{
		"token":     session.Token,
		"user":      session.User,
		"expiresAt": session.ExpiresAt,
	})
}

// handleLogout removes the session of the request.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if s.authStore != nil {
		if token := requestToken(r); token != "" {
			if err := s.authStore.Logout(r.Context(), token); err != nil {
				writeError(w, s.log, err)
				return
			}
		}
	}
	s.clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleMe answers with the identity of the request.
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	id := identityFrom(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":   "",
			"name": id.Name,
			"role": string(id.Role),
		},
		"authenticated": id.Authenticated,
	})
}

// setSessionCookie writes the cookie of the session of the browser.
func (s *Server) setSessionCookie(w http.ResponseWriter, session auth.Session) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookie,
		Value:    session.Token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  session.ExpiresAt,
	})
}

// clearSessionCookie removes the cookie of the session of the browser.
func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

// userRequest is the body of the creation of an account.
type userRequest struct {
	// Name is the name of the new account.
	Name string `json:"name"`
	// Password is the password of the new account.
	Password string `json:"password"`
	// Role is the role of the new account ("admin" or "user").
	Role string `json:"role"`
}

// handleListUsers lists the accounts. Only an administrator may call it.
func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if s.authStore == nil {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the authentication is disabled")
		return
	}
	users, err := s.authStore.Users(r.Context())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

// handleCreateUser creates an account.
func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if s.authStore == nil {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the authentication is disabled")
		return
	}
	var req userRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	role := auth.Role(strings.TrimSpace(req.Role))
	if role == "" {
		role = auth.RoleUser
	}
	user, err := s.authStore.CreateUser(r.Context(), req.Name, req.Password, role)
	if err != nil {
		writeAuthError(w, authStatus(err), authCode(err), auth.Message(err))
		return
	}
	writeJSON(w, http.StatusOK, user)
}

// handleDeleteUser removes an account.
func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	if s.authStore == nil {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the authentication is disabled")
		return
	}
	id := r.PathValue("id")
	if err := s.authStore.DeleteUser(r.Context(), id); err != nil {
		writeAuthError(w, authStatus(err), authCode(err), auth.Message(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// roleRequest is the body of the change of the role of an account.
type roleRequest struct {
	// Role is the new role of the account.
	Role string `json:"role"`
}

// handleSetUserRole changes the role of an account.
func (s *Server) handleSetUserRole(w http.ResponseWriter, r *http.Request) {
	if s.authStore == nil {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the authentication is disabled")
		return
	}
	var req roleRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	role := auth.Role(strings.TrimSpace(req.Role))
	user, err := s.authStore.SetRole(r.Context(), r.PathValue("id"), role)
	if err != nil {
		writeAuthError(w, authStatus(err), authCode(err), auth.Message(err))
		return
	}
	writeJSON(w, http.StatusOK, user)
}

// authStatus returns the HTTP status of an error of the auth package.
func authStatus(err error) int {
	switch auth.Code(err) {
	case "not_found":
		return http.StatusNotFound
	case "conflict", "last_admin":
		return http.StatusConflict
	case "bad_request":
		return http.StatusBadRequest
	case "invalid_credentials", "session_expired":
		return http.StatusUnauthorized
	default:
		return http.StatusInternalServerError
	}
}
