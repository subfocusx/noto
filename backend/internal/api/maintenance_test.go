package api_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"noto/backend/internal/api"
	"noto/backend/internal/config"
	"noto/backend/internal/model"
	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// newMaintenanceServer starts a test server with the maintenance endpoints
// enabled. It returns the server, the store and the configuration.
func newMaintenanceServer(t *testing.T) (*httptest.Server, *testutil.MemStore, config.Config) {
	t.Helper()
	t.Setenv(api.MaintenanceEnabledEnv, "1")
	cfg := testutil.NewTestConfig(t)
	if err := cfg.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	store := testutil.NewMemStore()
	svc, err := notes.NewService(cfg, store)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	srv, err := api.New(cfg, svc, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new api: %v", err)
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, store, cfg
}

// postReconcile sends a reconcile request and returns the response and the
// decoded report.
func postReconcile(t *testing.T, ts *httptest.Server, body string) (*http.Response, notes.ReconcileReport) {
	t.Helper()
	res, err := http.Post(ts.URL+"/api/maintenance/reconcile", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	var report notes.ReconcileReport
	if res.StatusCode == http.StatusOK {
		if err := json.NewDecoder(res.Body).Decode(&report); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return res, report
}

// TestMaintenanceRouteIsOptional checks that the maintenance endpoint does
// not exist when it is not enabled.
func TestMaintenanceRouteIsOptional(t *testing.T) {
	t.Setenv(api.MaintenanceEnabledEnv, "")
	cfg := testutil.NewTestConfig(t)
	if err := cfg.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	store := testutil.NewMemStore()
	svc, err := notes.NewService(cfg, store)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	srv, err := api.New(cfg, svc, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new api: %v", err)
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	res, err := http.Post(ts.URL+"/api/maintenance/reconcile", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unexpected status %d, want %d", res.StatusCode, http.StatusNotFound)
	}
}

// TestMaintenanceReconcileEmptyLibrary checks that an empty library produces
// an empty report.
func TestMaintenanceReconcileEmptyLibrary(t *testing.T) {
	ts, _, _ := newMaintenanceServer(t)
	res, report := postReconcile(t, ts, "{}")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if len(report.MissingInDB) != 0 || len(report.MissingOnDisk) != 0 {
		t.Fatalf("unexpected report: %+v", report)
	}
}

// TestMaintenanceReconcileApply checks that the body {"apply": true} repairs
// the library and that the report alone changes nothing.
func TestMaintenanceReconcileApply(t *testing.T) {
	ts, store, cfg := newMaintenanceServer(t)
	if err := os.WriteFile(filepath.Join(cfg.NotesDir, "note.md"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	res, report := postReconcile(t, ts, "{}")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if len(report.MissingInDB) != 1 || report.MissingInDB[0] != "note.md" {
		t.Fatalf("unexpected report: %+v", report)
	}
	if _, found, _ := store.GetNote(context.Background(), "note.md"); found {
		t.Fatalf("the report created a metadata row")
	}

	res, report = postReconcile(t, ts, `{"apply":true}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if len(report.Restored) != 1 {
		t.Fatalf("unexpected report: %+v", report)
	}
	if _, found, _ := store.GetNote(context.Background(), "note.md"); !found {
		t.Fatalf("the metadata row was not created")
	}
}

// TestMaintenanceReconcileDropsGhosts checks that the ghosts are only deleted
// when the request asks for it.
func TestMaintenanceReconcileDropsGhosts(t *testing.T) {
	ts, store, cfg := newMaintenanceServer(t)
	if err := store.UpsertNote(context.Background(), model.Node{
		ID:         "ghost",
		Name:       "ghost.md",
		Path:       "ghost.md",
		Type:       model.NodeFile,
		ParentPath: "",
		Revision:   1,
	}); err != nil {
		t.Fatalf("upsert ghost: %v", err)
	}
	_ = cfg

	res, report := postReconcile(t, ts, "{}")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if len(report.MissingOnDisk) != 1 || report.MissingOnDisk[0] != "ghost.md" {
		t.Fatalf("unexpected report: %+v", report)
	}
	if _, found, _ := store.GetNote(context.Background(), "ghost.md"); !found {
		t.Fatalf("the ghost row was deleted without the flag")
	}

	res, report = postReconcile(t, ts, `{"dropGhosts":true}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if len(report.Dropped) != 1 {
		t.Fatalf("unexpected report: %+v", report)
	}
	if _, found, _ := store.GetNote(context.Background(), "ghost.md"); found {
		t.Fatalf("the ghost row was not deleted")
	}
}
