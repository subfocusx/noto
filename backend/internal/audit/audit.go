// Package audit keeps the append only log of the write operations of the
// server.
//
// The log lives in its own SQLite file inside the data directory of the vault.
// It never holds the content of a note: only the identifiers of the target
// and of the action. The log is append only: there is no method that updates
// or removes an entry.
package audit

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite" // SQLite driver (pure Go).
)

// The results of an operation.
const (
	// ResultOK reports that the operation succeeded.
	ResultOK = "ok"
	// ResultError reports that the operation failed.
	ResultError = "error"
)

// The actions of the log. They are stable identifiers: the interface reads
// them, it never parses them.
const (
	ActionNoteCreated  = "note.created"
	ActionNoteUpdated  = "note.updated"
	ActionNoteRenamed  = "note.renamed"
	ActionNoteMoved    = "note.moved"
	ActionNoteDeleted  = "note.deleted"
	ActionNoteRestored = "note.restored"
	ActionNoteImported = "note.imported"
	ActionFileCreated  = "file.created"
	ActionFolderCreated = "folder.created"
)

// Entry is one line of the log.
type Entry struct {
	// ID is the monotonic identifier of the entry.
	ID int64 `json:"id"`
	// Time is the moment of the operation.
	Time time.Time `json:"time"`
	// User is the name of the account that made the operation. It is
	// "anonymous" when the operation was not authenticated.
	User string `json:"user"`
	// Action is the stable identifier of the operation.
	Action string `json:"action"`
	// Target is the identifier of the object of the operation (the path of a
	// note). It never contains the content of the note.
	Target string `json:"target"`
	// Result is the outcome of the operation.
	Result string `json:"result"`
}

// Filter selects the entries of a listing.
type Filter struct {
	// User keeps only the entries of that user.
	User string
	// Action keeps only the entries of that action.
	Action string
	// Since keeps only the entries that are newer than that moment.
	Since time.Time
	// Limit is the maximum number of the returned entries. It is capped at
	// 1000.
	Limit int
}

// Log is the SQLite backed append only log.
type Log struct {
	db *sql.DB
}

// schema is the schema of the log. Every statement is idempotent.
var schema = []string{
	`CREATE TABLE IF NOT EXISTS audit_log (
	  id         INTEGER PRIMARY KEY AUTOINCREMENT,
	  created_at INTEGER NOT NULL,
	  user       TEXT NOT NULL DEFAULT 'anonymous',
	  action     TEXT NOT NULL,
	  target     TEXT NOT NULL DEFAULT '',
	  result     TEXT NOT NULL DEFAULT 'ok'
	)`,
	`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`,
	`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)`,
	`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user)`,
}

// Open opens (or creates) the log. The parent directory of the path is
// created when it does not exist.
func Open(path string) (*Log, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("audit: empty path")
	}
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("audit: create the directory of the log: %w", err)
		}
	}
	dsn := path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("audit: open the log: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("audit: ping the log: %w", err)
	}
	l := &Log{db: db}
	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			db.Close()
			return nil, fmt.Errorf("audit: apply the schema: %w", err)
		}
	}
	return l, nil
}

// Close releases the database of the log.
func (l *Log) Close() error {
	if l == nil || l.db == nil {
		return nil
	}
	return l.db.Close()
}

// Append writes an entry at the end of the log.
func (l *Log) Append(ctx context.Context, e Entry) error {
	if l == nil || l.db == nil {
		return nil
	}
	at := e.Time
	if at.IsZero() {
		at = time.Now().UTC()
	}
	user := strings.TrimSpace(e.User)
	if user == "" {
		user = "anonymous"
	}
	result := e.Result
	if result == "" {
		result = ResultOK
	}
	if _, err := l.db.ExecContext(ctx,
		`INSERT INTO audit_log (created_at, user, action, target, result) VALUES (?, ?, ?, ?, ?)`,
		at.UnixMilli(), user, e.Action, e.Target, result); err != nil {
		return fmt.Errorf("audit: cannot append the entry: %w", err)
	}
	return nil
}

// List returns the entries of the log, the newest first.
func (l *Log) List(ctx context.Context, f Filter) ([]Entry, error) {
	if l == nil || l.db == nil {
		return nil, errors.New("audit: the log is not open")
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	query := `SELECT id, created_at, user, action, target, result FROM audit_log WHERE 1 = 1`
	args := []any{}
	if f.User != "" {
		query += ` AND user = ?`
		args = append(args, f.User)
	}
	if f.Action != "" {
		query += ` AND action = ?`
		args = append(args, f.Action)
	}
	if !f.Since.IsZero() {
		query += ` AND created_at >= ?`
		args = append(args, f.Since.UnixMilli())
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := l.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("audit: cannot list the entries: %w", err)
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		var created int64
		if err := rows.Scan(&e.ID, &created, &e.User, &e.Action, &e.Target, &e.Result); err != nil {
			return nil, fmt.Errorf("audit: cannot read the entry: %w", err)
		}
		e.Time = time.UnixMilli(created).UTC()
		out = append(out, e)
	}
	return out, rows.Err()
}
