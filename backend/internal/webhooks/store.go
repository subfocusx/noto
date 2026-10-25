// Package webhooks delivers the events of the notes to the URLs the user
// registered.
//
// The package owns its own SQLite file inside the data directory of the
// vault. It holds the subscriptions of the users and the outbox of the
// deliveries: every event is written to the outbox first and delivered
// afterwards by a worker, so that a webhook that is down never loses an
// event.
package webhooks

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite" // SQLite driver (pure Go).
)

// The errors of the package.
var (
	// ErrNotFound reports that the subscription or the delivery does not
	// exist.
	ErrNotFound = errors.New("webhooks: not found")
	// ErrInvalid reports an invalid subscription (a bad URL, an unknown
	// event).
	ErrInvalid = errors.New("webhooks: invalid subscription")
	// ErrConflict reports that the subscription already exists.
	ErrConflict = errors.New("webhooks: already exists")
)

// Error is the typed error of the package.
type Error struct {
	// Code is the stable machine readable code.
	Code string
	// Message is human readable.
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
	case errors.Is(err, ErrInvalid):
		return "bad_request"
	case errors.Is(err, ErrConflict):
		return "conflict"
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

// Store is the SQLite backed store of the subscriptions and of the outbox.
type Store struct {
	db *sql.DB
}

// schema is the schema of the store. Every statement is idempotent.
var schema = []string{
	`CREATE TABLE IF NOT EXISTS subscriptions (
	  id         TEXT PRIMARY KEY,
	  owner      TEXT NOT NULL DEFAULT '',
	  url        TEXT NOT NULL,
	  events     TEXT NOT NULL DEFAULT '[]',
	  secret     TEXT NOT NULL,
	  created_at INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE INDEX IF NOT EXISTS idx_subscriptions_owner ON subscriptions(owner)`,
	`CREATE TABLE IF NOT EXISTS outbox (
	  id              INTEGER PRIMARY KEY AUTOINCREMENT,
	  subscription_id TEXT NOT NULL,
	  event           TEXT NOT NULL,
	  payload         TEXT NOT NULL,
	  state           TEXT NOT NULL DEFAULT 'pending',
	  attempts        INTEGER NOT NULL DEFAULT 0,
	  next_attempt    INTEGER NOT NULL DEFAULT 0,
	  last_error      TEXT NOT NULL DEFAULT '',
	  created_at      INTEGER NOT NULL DEFAULT 0,
	  delivered_at    INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox(state, next_attempt)`,
	`CREATE INDEX IF NOT EXISTS idx_outbox_subscription ON outbox(subscription_id)`,
}

// Open opens (or creates) the store. The parent directory of the path is
// created when it does not exist.
func Open(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("webhooks: empty path")
	}
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("webhooks: create the directory of the store: %w", err)
		}
	}
	dsn := path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("webhooks: open the store: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("webhooks: ping the store: %w", err)
	}
	s := &Store{db: db}
	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			db.Close()
			return nil, fmt.Errorf("webhooks: apply the schema: %w", err)
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

// now returns the current time in milliseconds. It is a variable so that the
// tests can freeze it.
var now = func() time.Time { return time.Now().UTC() }
