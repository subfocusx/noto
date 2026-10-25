package api_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"noto/backend/internal/api"
	"noto/backend/internal/audit"
	"noto/backend/internal/auth"
	"noto/backend/internal/config"
	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
	"noto/backend/internal/webhooks"
)

// authEnv holds the server of a test and the stores of the server.
type authEnv struct {
	server  *httptest.Server
	auth    *auth.Store
	audit   *audit.Log
	hooks   *webhooks.Store
	config  config.Config
	adminID string
}

// newAuthEnv starts a server with the accounts, the audit log and the
// webhooks. When withAuth is false the authentication is disabled: the
// server works in the local single user mode.
func newAuthEnv(t *testing.T, withAuth bool) *authEnv {
	t.Helper()
	cfg := testutil.NewTestConfig(t)
	dir := t.TempDir()
	cfg.CredentialsPath = filepath.Join(dir, "credentials.db")
	cfg.AuditPath = filepath.Join(dir, "audit.db")
	cfg.WebhooksPath = filepath.Join(dir, "webhooks.db")
	cfg.SessionTTL = time.Hour
	if err := cfg.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}

	store := testutil.NewMemStore()
	svc, err := notes.NewService(cfg, store)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	auditLog, err := audit.Open(cfg.AuditPath)
	if err != nil {
		t.Fatalf("open the audit log: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })

	hookStore, err := webhooks.Open(cfg.WebhooksPath)
	if err != nil {
		t.Fatalf("open the webhooks: %v", err)
	}
	t.Cleanup(func() { _ = hookStore.Close() })

	services := api.Services{Audit: auditLog, Webhooks: hookStore}
	env := &authEnv{audit: auditLog, hooks: hookStore, config: cfg}

	if withAuth {
		authStore, err := auth.Open(cfg.CredentialsPath)
		if err != nil {
			t.Fatalf("open the credentials: %v", err)
		}
		t.Cleanup(func() { _ = authStore.Close() })
		services.Auth = authStore
		env.auth = authStore
		admin, err := authStore.CreateUser(context.Background(), "admin", "secret", auth.RoleAdmin)
		if err != nil {
			t.Fatalf("create the administrator: %v", err)
		}
		env.adminID = admin.ID
	}

	srv, err := api.NewWithServices(cfg, svc, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, services)
	if err != nil {
		t.Fatalf("new api: %v", err)
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	env.server = ts
	return env
}

// do performs a request and returns the response.
func (e *authEnv) do(t *testing.T, method, path, body, token string) *http.Response {
	t.Helper()
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, e.server.URL+path, rdr)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	return res
}

// login opens a session and returns its token.
func (e *authEnv) login(t *testing.T, name, password string) string {
	t.Helper()
	res := e.do(t, http.MethodPost, "/api/auth/login",
		`{"name":"`+name+`","password":"`+password+`"}`, "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("login: unexpected status %d: %s", res.StatusCode, body)
	}
	var obj struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&obj); err != nil {
		t.Fatalf("decode the answer of the login: %v", err)
	}
	if obj.Token == "" {
		t.Fatalf("the login returned no token")
	}
	return obj.Token
}

// errorCode reads the code of the error envelope of a response.
func errorCode(t *testing.T, res *http.Response) string {
	t.Helper()
	defer res.Body.Close()
	var obj struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&obj); err != nil {
		t.Fatalf("decode the error envelope: %v", err)
	}
	return obj.Error.Code
}

// TestTheSingleUserModeKeepsWorking makes sure that the server without the
// authentication serves the notes as before.
func TestTheSingleUserModeKeepsWorking(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodGet, "/api/tree", "", "")
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	res = env.do(t, http.MethodPost, "/api/files", `{"parentPath":"","name":"a"}`, "")
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	res = env.do(t, http.MethodGet, "/api/auth/me", "", "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	var obj struct {
		User struct {
			Name string `json:"name"`
			Role string `json:"role"`
		} `json:"user"`
		Authenticated bool `json:"authenticated"`
	}
	if err := json.NewDecoder(res.Body).Decode(&obj); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	if obj.User.Name != "local" || obj.User.Role != "admin" {
		t.Fatalf("unexpected identity: %+v", obj.User)
	}
	if obj.Authenticated {
		t.Fatalf("the local user must not be authenticated")
	}
}

// TestTheMiddlewareRejectsTheMissingToken makes sure that a request without
// credentials is refused when the authentication is enabled.
func TestTheMiddlewareRejectsTheMissingToken(t *testing.T) {
	env := newAuthEnv(t, true)

	res := env.do(t, http.MethodGet, "/api/tree", "", "")
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if code := errorCode(t, res); code != notes.CodeForbidden {
		t.Fatalf("unexpected error code %q", code)
	}
}

// TestTheMiddlewareRejectsTheWrongToken makes sure that a wrong token is
// refused.
func TestTheMiddlewareRejectsTheWrongToken(t *testing.T) {
	env := newAuthEnv(t, true)

	res := env.do(t, http.MethodGet, "/api/tree", "", "not-a-token")
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if code := errorCode(t, res); code != notes.CodeForbidden {
		t.Fatalf("unexpected error code %q", code)
	}
}

// TestTheMiddlewareAcceptsTheValidToken makes sure that a session opens the
// protected routes.
func TestTheMiddlewareAcceptsTheValidToken(t *testing.T) {
	env := newAuthEnv(t, true)
	token := env.login(t, "admin", "secret")

	res := env.do(t, http.MethodGet, "/api/tree", "", token)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	// The cookie of the browser works too.
	res = env.do(t, http.MethodGet, "/api/tree", "", "")
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("the request without a token must be refused")
	}
}

// TestTheSessionExpires makes sure that a session stops being valid when its
// lifetime is over.
func TestTheSessionExpires(t *testing.T) {
	env := newAuthEnv(t, true)

	// A short session: the store is opened again with the short lifetime.
	store, err := auth.Open(env.config.CredentialsPath)
	if err != nil {
		t.Fatalf("open the credentials: %v", err)
	}
	defer store.Close()
	session, err := store.Login(context.Background(), "admin", "secret", time.Second)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	time.Sleep(1100 * time.Millisecond)

	res := env.do(t, http.MethodGet, "/api/tree", "", session.Token)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if code := errorCode(t, res); code != notes.CodeForbidden {
		t.Fatalf("unexpected error code %q", code)
	}
}

// TestTheLogoutRemovesTheSession makes sure that a session dies with the
// logout.
func TestTheLogoutRemovesTheSession(t *testing.T) {
	env := newAuthEnv(t, true)
	token := env.login(t, "admin", "secret")

	res := env.do(t, http.MethodPost, "/api/auth/logout", "", token)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	res = env.do(t, http.MethodGet, "/api/tree", "", token)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("the session is still valid after the logout")
	}
	res.Body.Close()
}

// TestTheWrongPasswordIsRefused makes sure that the login refuses a wrong
// password.
func TestTheWrongPasswordIsRefused(t *testing.T) {
	env := newAuthEnv(t, true)

	res := env.do(t, http.MethodPost, "/api/auth/login", `{"name":"admin","password":"wrong"}`, "")
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if code := errorCode(t, res); code != notes.CodeForbidden {
		t.Fatalf("unexpected error code %q", code)
	}
}

// TestTheAdminManagesTheUsers makes sure that the routes of the accounts work
// for an administrator.
func TestTheAdminManagesTheUsers(t *testing.T) {
	env := newAuthEnv(t, true)
	token := env.login(t, "admin", "secret")

	res := env.do(t, http.MethodPost, "/api/users",
		`{"name":"alice","password":"secret","role":"user"}`, token)
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
	}
	var alice struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Role string `json:"role"`
	}
	if err := json.NewDecoder(res.Body).Decode(&alice); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	res.Body.Close()
	if alice.ID == "" || alice.Role != "user" {
		t.Fatalf("unexpected user: %+v", alice)
	}

	res = env.do(t, http.MethodGet, "/api/users", "", token)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	var list struct {
		Users []struct {
			Name string `json:"name"`
		} `json:"users"`
	}
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	res.Body.Close()
	if len(list.Users) != 2 {
		t.Fatalf("unexpected number of the users: %d", len(list.Users))
	}

	res = env.do(t, http.MethodPost, "/api/users/"+alice.ID+"/role", `{"role":"admin"}`, token)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	res.Body.Close()

	res = env.do(t, http.MethodDelete, "/api/users/"+alice.ID, "", token)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	res.Body.Close()
}

// TestTheAdminCannotDeleteTheLastAdmin makes sure that the server always
// keeps an administrator.
func TestTheAdminCannotDeleteTheLastAdmin(t *testing.T) {
	env := newAuthEnv(t, true)
	token := env.login(t, "admin", "secret")

	res := env.do(t, http.MethodDelete, "/api/users/"+env.adminID, "", token)
	if res.StatusCode != http.StatusConflict {
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
	}
	if code := errorCode(t, res); code != notes.CodeConflict {
		t.Fatalf("unexpected error code %q", code)
	}
}

// TestThePlainUserCannotManageTheUsers makes sure that the routes of the
// accounts are closed to a plain user.
func TestThePlainUserCannotManageTheUsers(t *testing.T) {
	env := newAuthEnv(t, true)
	if _, err := env.auth.CreateUser(context.Background(), "alice", "secret", auth.RoleUser); err != nil {
		t.Fatalf("create the user: %v", err)
	}
	token := env.login(t, "alice", "secret")

	res := env.do(t, http.MethodGet, "/api/users", "", token)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if code := errorCode(t, res); code != notes.CodeForbidden {
		t.Fatalf("unexpected error code %q", code)
	}
}
