// Package sqlitestore implements port.Store on top of SQLite.
//
// The database holds the metadata of every note and folder, a full text
// search index, attachment metadata and trash entries. The Markdown files on
// disk remain the source of truth for the note bodies; this package only
// mirrors them into the search index.
//
// All methods are safe for concurrent use.
package sqlitestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite" // SQLite driver (pure Go).
)

// Store is the SQLite backed implementation of port.Store.
type Store struct {
	db *sql.DB

	// fts5 reports whether the FTS5 virtual table is usable. When it is
	// false the search falls back to a bounded LIKE scan.
	fts5 bool

	// ftsMu guards fts5, which is only written during Open.
	ftsMu sync.RWMutex
}

// Open opens (or creates) the SQLite database at dbPath and applies the
// schema and all pending migrations. The parent directory of dbPath is
// created when it does not exist.
//
// The FTS5 search index is used when the SQLite driver was built with FTS5
// support (build tag "sqlite_fts5"). Without it the store transparently
// falls back to a LIKE based scan; see FTS5Available.
func Open(ctx context.Context, dbPath string) (*Store, error) {
	if strings.TrimSpace(dbPath) == "" {
		return nil, errors.New("sqlitestore: empty database path")
	}
	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("sqlitestore: create database directory: %w", err)
		}
	}
	dsn := dbPath + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("sqlitestore: open database: %w", err)
	}
	// SQLite tolerates concurrent readers but a single writer. A modest pool
	// with a bounded number of connections keeps the writer queue short while
	// still allowing parallel reads.
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
	db.SetConnMaxLifetime(0)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("sqlitestore: ping database: %w", err)
	}
	s := &Store{db: db}
	if err := s.init(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// New wraps an already opened database handle. It is handy for tests that
// use an in-memory database (with db.SetMaxOpenConns(1)).
//
// New applies the schema and migrations to the given handle.
func New(ctx context.Context, db *sql.DB) (*Store, error) {
	if db == nil {
		return nil, errors.New("sqlitestore: nil database handle")
	}
	s := &Store{db: db}
	if err := s.init(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

// DB exposes the underlying handle for advanced use cases such as backups.
func (s *Store) DB() *sql.DB { return s.db }

// FTS5Available reports whether the FTS5 backed search index is in use.
// When it returns false the store falls back to a LIKE based scan.
func (s *Store) FTS5Available() bool {
	s.ftsMu.RLock()
	defer s.ftsMu.RUnlock()
	return s.fts5
}

// Close releases the database handle.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// ------------------------------------------------------------- helpers ---

func millis(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UTC().UnixMilli()
}

func fromMillis(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}

func baseName(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}

func parentPath(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[:i]
	}
	return ""
}

// escapeLike escapes the LIKE wildcards of a literal string.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}
