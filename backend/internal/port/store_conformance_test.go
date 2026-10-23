package port_test

import (
	"context"
	"path/filepath"
	"testing"

	"noto/backend/internal/port"
	"noto/backend/internal/port/porttest"
	"noto/backend/internal/sqlitestore"
	"noto/backend/internal/testutil"
)

// newSQLiteStore opens a SQLite store in a temporary file.
func newSQLiteStore(t *testing.T) port.Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "noto.db")
	store, err := sqlitestore.Open(context.Background(), path)
	if err != nil {
		t.Fatalf("open the sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

// newMemStore returns the in-memory store of the test helpers.
func newMemStore(t *testing.T) port.Store {
	t.Helper()
	return testutil.NewMemStore()
}

// TestStoreConformance runs the conformance suite of port.Store against
// every implementation.
//
// The SQLite store is the reference implementation and must satisfy the whole
// suite. The in-memory store is a faithful stand-in for it and must satisfy
// the whole suite as well: a divergence is a defect and is reported.
func TestStoreConformance(t *testing.T) {
	t.Run("sqlitestore", func(t *testing.T) {
		divergences := porttest.Run(t, "sqlitestore", newSQLiteStore)
		for _, d := range divergences {
			t.Errorf("%s", d)
		}
		if len(divergences) != 0 {
			t.Errorf("the sqlite store diverges from the conformance suite in %d case(s)", len(divergences))
		}
	})

	t.Run("memstore", func(t *testing.T) {
		divergences := porttest.Run(t, "memstore", newMemStore)
		for _, d := range divergences {
			t.Errorf("%s", d)
		}
		if len(divergences) != 0 {
			t.Errorf("the in-memory store diverges from the conformance suite in %d case(s)", len(divergences))
		}
	})
}
