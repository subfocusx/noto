package auth_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"noto/backend/internal/auth"
)

// newStore opens a store in a temporary directory.
func newStore(t *testing.T) *auth.Store {
	t.Helper()
	store, err := auth.Open(filepath.Join(t.TempDir(), "credentials.db"))
	if err != nil {
		t.Fatalf("open the store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

// TestHashPasswordAndVerify makes sure that a password is stored hashed and
// that only the right password is accepted.
func TestHashPasswordAndVerify(t *testing.T) {
	hash, err := auth.HashPassword("correct horse")
	if err != nil {
		t.Fatalf("hash the password: %v", err)
	}
	if hash == "correct horse" {
		t.Fatalf("the password is stored in clear")
	}
	if !auth.VerifyPassword(hash, "correct horse") {
		t.Fatalf("the right password is refused")
	}
	if auth.VerifyPassword(hash, "wrong horse") {
		t.Fatalf("the wrong password is accepted")
	}
	if auth.VerifyPassword("not a hash", "correct horse") {
		t.Fatalf("a malformed hash is accepted")
	}
	// Two hashes of the same password are different: the salt is random.
	other, err := auth.HashPassword("correct horse")
	if err != nil {
		t.Fatalf("hash the password: %v", err)
	}
	if other == hash {
		t.Fatalf("the hashes of two passwords are equal")
	}
}

// TestCreateUserAndAuthenticate makes sure that an account can be created and
// that the credentials are checked.
func TestCreateUserAndAuthenticate(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	user, err := store.CreateUser(ctx, "alice", "secret", auth.RoleUser)
	if err != nil {
		t.Fatalf("create the user: %v", err)
	}
	if user.Name != "alice" || user.Role != auth.RoleUser || user.ID == "" {
		t.Fatalf("unexpected user %+v", user)
	}
	if user.CreatedAt.IsZero() {
		t.Fatalf("the creation time is missing")
	}

	if _, err := store.CreateUser(ctx, "alice", "other", auth.RoleUser); err == nil {
		t.Fatalf("the same name was accepted twice")
	}

	if _, err := store.Authenticate(ctx, "alice", "secret"); err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if _, err := store.Authenticate(ctx, "alice", "wrong"); err == nil {
		t.Fatalf("the wrong password was accepted")
	}
	if _, err := store.Authenticate(ctx, "nobody", "secret"); err == nil {
		t.Fatalf("an unknown user was accepted")
	}
}

// TestSessionExpires makes sure that a session stops being valid when its
// lifetime is over.
func TestSessionExpires(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	if _, err := store.CreateUser(ctx, "alice", "secret", auth.RoleUser); err != nil {
		t.Fatalf("create the user: %v", err)
	}
	session, err := store.Login(ctx, "alice", "secret", time.Second)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if session.Token == "" {
		t.Fatalf("the session has no token")
	}
	got, err := store.Session(ctx, session.Token)
	if err != nil {
		t.Fatalf("session: %v", err)
	}
	if got.User.Name != "alice" {
		t.Fatalf("unexpected user %+v", got.User)
	}

	time.Sleep(1100 * time.Millisecond)
	if _, err := store.Session(ctx, session.Token); err == nil {
		t.Fatalf("the expired session is still valid")
	}
}

// TestLogoutRemovesTheSession makes sure that a session cannot be used after
// the logout.
func TestLogoutRemovesTheSession(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	if _, err := store.CreateUser(ctx, "alice", "secret", auth.RoleUser); err != nil {
		t.Fatalf("create the user: %v", err)
	}
	session, err := store.Login(ctx, "alice", "secret", time.Hour)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if err := store.Logout(ctx, session.Token); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := store.Session(ctx, session.Token); err == nil {
		t.Fatalf("the session is still valid after the logout")
	}
}

// TestTheLastAdminCannotBeRemoved makes sure that the server always keeps an
// administrator.
func TestTheLastAdminCannotBeRemoved(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	admin, err := store.CreateUser(ctx, "admin", "secret", auth.RoleAdmin)
	if err != nil {
		t.Fatalf("create the administrator: %v", err)
	}
	if err := store.DeleteUser(ctx, admin.ID); err == nil {
		t.Fatalf("the last administrator was removed")
	}
	if _, err := store.SetRole(ctx, admin.ID, auth.RoleUser); err == nil {
		t.Fatalf("the last administrator was demoted")
	}

	other, err := store.CreateUser(ctx, "bob", "secret", auth.RoleAdmin)
	if err != nil {
		t.Fatalf("create the second administrator: %v", err)
	}
	if err := store.DeleteUser(ctx, admin.ID); err != nil {
		t.Fatalf("the administrator was not removed: %v", err)
	}
	if err := store.DeleteUser(ctx, other.ID); err == nil {
		t.Fatalf("the last administrator was removed")
	}
}

// TestDeleteUserRemovesTheSessions makes sure that the sessions of a removed
// account die with it.
func TestDeleteUserRemovesTheSessions(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	user, err := store.CreateUser(ctx, "alice", "secret", auth.RoleUser)
	if err != nil {
		t.Fatalf("create the user: %v", err)
	}
	session, err := store.Login(ctx, "alice", "secret", time.Hour)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if err := store.DeleteUser(ctx, user.ID); err != nil {
		t.Fatalf("delete the user: %v", err)
	}
	if _, err := store.Session(ctx, session.Token); err == nil {
		t.Fatalf("the session of a removed user is still valid")
	}
}

// TestUsersAreListed makes sure that the accounts are listed.
func TestUsersAreListed(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	if _, err := store.CreateUser(ctx, "bob", "secret", auth.RoleUser); err != nil {
		t.Fatalf("create the user: %v", err)
	}
	if _, err := store.CreateUser(ctx, "alice", "secret", auth.RoleAdmin); err != nil {
		t.Fatalf("create the user: %v", err)
	}
	users, err := store.Users(ctx)
	if err != nil {
		t.Fatalf("list the users: %v", err)
	}
	if len(users) != 2 {
		t.Fatalf("unexpected number of the users: %d", len(users))
	}
	if users[0].Name != "alice" || users[1].Name != "bob" {
		t.Fatalf("the users are not sorted by name: %+v", users)
	}
	admins, err := store.CountAdmins(ctx)
	if err != nil {
		t.Fatalf("count the administrators: %v", err)
	}
	if admins != 1 {
		t.Fatalf("unexpected number of the administrators: %d", admins)
	}
}
