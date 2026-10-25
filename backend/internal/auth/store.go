// Package auth stores the accounts of the users and the sessions of the
// server.
//
// The store keeps its own SQLite file inside the data directory of the vault.
// It is deliberately independent from the database of the notes: the accounts
// are not part of the content of the notes, and the notes must stay readable
// when the credentials are moved or lost.
package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite" // SQLite driver (pure Go).
)

// Role is the role of an account.
type Role string

const (
	// RoleAdmin is the role of an administrator: it may manage the accounts,
	// read the audit log and manage every webhook.
	RoleAdmin Role = "admin"
	// RoleUser is the role of a plain user: it may manage its own webhooks
	// and read and write the notes.
	RoleUser Role = "user"
)

// Valid reports whether the role is one of the known roles.
func (r Role) Valid() bool { return r == RoleAdmin || r == RoleUser }

// IsAdmin reports whether the role is the role of an administrator.
func (r Role) IsAdmin() bool { return r == RoleAdmin }

// The errors of the package. They are wrapped by the typed error of the
// package and can be tested with errors.Is.
var (
	// ErrNotFound reports that the account or the session does not exist.
	ErrNotFound = errors.New("auth: not found")
	// ErrConflict reports that the name of an account is already taken.
	ErrConflict = errors.New("auth: already exists")
	// ErrInvalidCredentials reports a wrong name or a wrong password.
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	// ErrSessionExpired reports that the session is no longer valid.
	ErrSessionExpired = errors.New("auth: the session has expired")
	// ErrLastAdmin reports that the operation would leave the server
	// without an administrator.
	ErrLastAdmin = errors.New("auth: the last administrator cannot be removed")
	// ErrInvalid reports an invalid argument (an empty name, a bad role...).
	ErrInvalid = errors.New("auth: invalid argument")
)

// Error is the typed error of the package.
type Error struct {
	// Code is the stable machine readable code.
	Code string
	// Message is human readable and never contains a secret.
	Message string
	// cause is the matching sentinel error.
	cause error
}

func (e *Error) Error() string {
	if e.Message == "" {
		return e.Code
	}
	return e.Code + ": " + e.Message
}

// Unwrap exposes the sentinel error to errors.Is.
func (e *Error) Unwrap() error { return e.cause }

// newError builds a typed error for the given sentinel.
func newError(cause error, message string) *Error {
	return &Error{Code: Code(cause), Message: message, cause: cause}
}

// Code maps any error to a stable code.
func Code(err error) string {
	if err == nil {
		return ""
	}
	var e *Error
	if errors.As(err, &e) && e.Code != "" {
		return e.Code
	}
	switch {
	case errors.Is(err, ErrNotFound):
		return "not_found"
	case errors.Is(err, ErrConflict):
		return "conflict"
	case errors.Is(err, ErrInvalidCredentials):
		return "invalid_credentials"
	case errors.Is(err, ErrSessionExpired):
		return "session_expired"
	case errors.Is(err, ErrLastAdmin):
		return "last_admin"
	case errors.Is(err, ErrInvalid):
		return "bad_request"
	default:
		return "internal"
	}
}

// Message returns the human readable message of an error.
func Message(err error) string {
	if err == nil {
		return ""
	}
	var e *Error
	if errors.As(err, &e) {
		return e.Message
	}
	return err.Error()
}

// User is an account of the server. The password hash is never part of it.
type User struct {
	// ID is the stable identifier of the account.
	ID string `json:"id"`
	// Name is the name the user logs in with.
	Name string `json:"name"`
	// Role is the role of the account.
	Role Role `json:"role"`
	// CreatedAt is the creation time of the account.
	CreatedAt time.Time `json:"createdAt"`
}

// Session is a server side session of a user.
type Session struct {
	// Token is the opaque token the client sends back.
	Token string `json:"token"`
	// User is the account of the session.
	User User `json:"user"`
	// ExpiresAt is the moment the session stops being valid.
	ExpiresAt time.Time `json:"expiresAt"`
}

// Store is the SQLite backed store of the accounts and of the sessions.
type Store struct {
	db *sql.DB
}

// schema is the schema of the store. Every statement is idempotent.
var schema = []string{
	`CREATE TABLE IF NOT EXISTS users (
	  id            TEXT PRIMARY KEY,
	  name          TEXT NOT NULL UNIQUE,
	  role          TEXT NOT NULL,
	  password_hash TEXT NOT NULL,
	  created_at    INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS sessions (
	  token      TEXT PRIMARY KEY,
	  user_id    TEXT NOT NULL,
	  created_at INTEGER NOT NULL DEFAULT 0,
	  expires_at INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
}

// Open opens (or creates) the store of the accounts. The parent directory of
// the path is created when it does not exist.
func Open(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("auth: empty credentials path")
	}
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("auth: create the directory of the credentials: %w", err)
		}
	}
	dsn := path + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("auth: open the credentials: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("auth: ping the credentials: %w", err)
	}
	s := &Store{db: db}
	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			db.Close()
			return nil, fmt.Errorf("auth: apply the schema: %w", err)
		}
	}
	return s, nil
}

// Close releases the database of the store.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// CreateUser creates an account. The name must be unique.
func (s *Store) CreateUser(ctx context.Context, name, password string, role Role) (User, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return User{}, newError(ErrInvalid, "the name of the user is required")
	}
	if password == "" {
		return User{}, newError(ErrInvalid, "the password of the user is required")
	}
	if !role.Valid() {
		return User{}, newError(ErrInvalid, "the role of the user is invalid")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, err
	}
	id, err := randomID()
	if err != nil {
		return User{}, err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO users (id, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, name, string(role), hash, now.UnixMilli())
	if err != nil {
		if isUnique(err) {
			return User{}, newError(ErrConflict, "the name of the user is already taken")
		}
		return User{}, fmt.Errorf("auth: cannot create the user: %w", err)
	}
	return User{ID: id, Name: name, Role: role, CreatedAt: now}, nil
}

// Users lists every account, sorted by name.
func (s *Store) Users(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, role, created_at FROM users ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("auth: cannot list the users: %w", err)
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// User returns the account with the given identifier.
func (s *Store) User(ctx context.Context, id string) (User, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, name, role, created_at FROM users WHERE id = ?`, id)
	u, err := scanUser(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, newError(ErrNotFound, "the user does not exist")
		}
		return User{}, err
	}
	return u, nil
}

// DeleteUser removes an account and its sessions. The last administrator
// cannot be removed: the server must always keep one.
func (s *Store) DeleteUser(ctx context.Context, id string) error {
	u, err := s.User(ctx, id)
	if err != nil {
		return err
	}
	if u.Role.IsAdmin() {
		admins, err := s.CountAdmins(ctx)
		if err != nil {
			return err
		}
		if admins <= 1 {
			return newError(ErrLastAdmin, "the last administrator cannot be removed")
		}
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, id); err != nil {
		return fmt.Errorf("auth: cannot remove the sessions of the user: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id); err != nil {
		return fmt.Errorf("auth: cannot remove the user: %w", err)
	}
	return nil
}

// SetRole changes the role of an account. The last administrator cannot be
// demoted.
func (s *Store) SetRole(ctx context.Context, id string, role Role) (User, error) {
	if !role.Valid() {
		return User{}, newError(ErrInvalid, "the role of the user is invalid")
	}
	u, err := s.User(ctx, id)
	if err != nil {
		return User{}, err
	}
	if u.Role.IsAdmin() && !role.IsAdmin() {
		admins, err := s.CountAdmins(ctx)
		if err != nil {
			return User{}, err
		}
		if admins <= 1 {
			return User{}, newError(ErrLastAdmin, "the last administrator cannot be demoted")
		}
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, string(role), id); err != nil {
		return User{}, fmt.Errorf("auth: cannot change the role of the user: %w", err)
	}
	u.Role = role
	return u, nil
}

// CountAdmins returns the number of the accounts with the role of an
// administrator.
func (s *Store) CountAdmins(ctx context.Context) (int, error) {
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM users WHERE role = ?`, string(RoleAdmin)).Scan(&n); err != nil {
		return 0, fmt.Errorf("auth: cannot count the administrators: %w", err)
	}
	return n, nil
}

// Authenticate checks the name and the password of an account. It never
// reveals which of the two is wrong.
func (s *Store) Authenticate(ctx context.Context, name, password string) (User, error) {
	var id, role, hash string
	var created int64
	err := s.db.QueryRowContext(ctx,
		`SELECT id, role, password_hash, created_at FROM users WHERE name = ?`,
		strings.TrimSpace(name)).Scan(&id, &role, &hash, &created)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// The work is done anyway, so that the answer does not depend on
			// the existence of the account.
			_ = VerifyPassword("pbkdf2-sha256$1$AAAA$AAAA", password)
			return User{}, newError(ErrInvalidCredentials, "the name or the password is wrong")
		}
		return User{}, fmt.Errorf("auth: cannot read the user: %w", err)
	}
	if !VerifyPassword(hash, password) {
		return User{}, newError(ErrInvalidCredentials, "the name or the password is wrong")
	}
	return User{
		ID:        id,
		Name:      strings.TrimSpace(name),
		Role:      Role(role),
		CreatedAt: time.UnixMilli(created).UTC(),
	}, nil
}

// Login authenticates a user and opens a session that lives for ttl.
func (s *Store) Login(ctx context.Context, name, password string, ttl time.Duration) (Session, error) {
	u, err := s.Authenticate(ctx, name, password)
	if err != nil {
		return Session{}, err
	}
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	token, err := randomToken()
	if err != nil {
		return Session{}, err
	}
	now := time.Now().UTC()
	expires := now.Add(ttl)
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		token, u.ID, now.UnixMilli(), expires.UnixMilli()); err != nil {
		return Session{}, fmt.Errorf("auth: cannot open the session: %w", err)
	}
	return Session{Token: token, User: u, ExpiresAt: expires}, nil
}

// Session returns the session of a token. An expired session is removed and
// reported with ErrSessionExpired.
func (s *Store) Session(ctx context.Context, token string) (Session, error) {
	if strings.TrimSpace(token) == "" {
		return Session{}, newError(ErrInvalidCredentials, "the token is missing")
	}
	var userID string
	var expires int64
	err := s.db.QueryRowContext(ctx,
		`SELECT user_id, expires_at FROM sessions WHERE token = ?`, token).Scan(&userID, &expires)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Session{}, newError(ErrInvalidCredentials, "the token is not valid")
		}
		return Session{}, fmt.Errorf("auth: cannot read the session: %w", err)
	}
	if time.Now().UTC().UnixMilli() >= expires {
		_ = s.Logout(ctx, token)
		return Session{}, newError(ErrSessionExpired, "the session has expired")
	}
	u, err := s.User(ctx, userID)
	if err != nil {
		return Session{}, err
	}
	return Session{Token: token, User: u, ExpiresAt: time.UnixMilli(expires).UTC()}, nil
}

// Logout removes a session.
func (s *Store) Logout(ctx context.Context, token string) error {
	if strings.TrimSpace(token) == "" {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token = ?`, token); err != nil {
		return fmt.Errorf("auth: cannot remove the session: %w", err)
	}
	return nil
}

// scanner reads the columns of a user.
type scanner interface {
	Scan(dest ...any) error
}

// scanUser reads a user from a row.
func scanUser(row scanner) (User, error) {
	var id, name, role string
	var created int64
	if err := row.Scan(&id, &name, &role, &created); err != nil {
		return User{}, err
	}
	return User{
		ID:        id,
		Name:      name,
		Role:      Role(role),
		CreatedAt: time.UnixMilli(created).UTC(),
	}, nil
}

// randomID returns a random identifier of an account.
func randomID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: cannot read the identifier: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// randomToken returns a random token of a session.
func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: cannot read the token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// isUnique reports whether the error of SQLite is a uniqueness violation.
func isUnique(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed") ||
		strings.Contains(msg, "constraint failed: UNIQUE")
}
