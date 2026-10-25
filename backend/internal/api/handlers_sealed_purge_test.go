package api_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"noto/backend/internal/api"
	"noto/backend/internal/notes"
	"noto/backend/internal/sealed"
	"noto/backend/internal/testutil"
)

// newPurgableServer starts a test server in the sealed mode over a temporary
// configuration, and returns it together with the notes directory.
func newPurgableServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	cfg := testutil.NewTestConfig(t)
	if err := cfg.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	store := testutil.NewMemStore()
	svc, err := notes.NewService(cfg, store)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv, err := api.New(cfg, svc, logger)
	if err != nil {
		t.Fatalf("new api: %v", err)
	}
	sealedStore, err := sealed.New(cfg.DataDir)
	if err != nil {
		t.Fatalf("new sealed store: %v", err)
	}
	srv.SetSealedStore(sealedStore)
	srv.SetSealedMode(true)
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, cfg.NotesDir
}

// TestPurgePlaintextRemovesTheNotesAndKeepsTheSealedObjects checks the last
// step of the migration: the plaintext of the vault disappears, the sealed
// objects and the manifests stay.
func TestPurgePlaintextRemovesTheNotesAndKeepsTheSealedObjects(t *testing.T) {
	ts, notesDir := newPurgableServer(t)

	// A note and a folder with a note, the way an open vault looks.
	if err := os.MkdirAll(filepath.Join(notesDir, "Journal"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	notePath := filepath.Join(notesDir, "Journal", "day1.md")
	if err := os.WriteFile(notePath, []byte("# plaintext\n"), 0o644); err != nil {
		t.Fatalf("write note: %v", err)
	}
	rootNote := filepath.Join(notesDir, "readme.md")
	if err := os.WriteFile(rootNote, []byte("# readme\n"), 0o644); err != nil {
		t.Fatalf("write note: %v", err)
	}

	// The vault holds a sealed object.
	res := putRaw(t, ts.URL+"/api/vault/sealed/objects/"+sealedID, []byte("cipher"))
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	res, err := http.Post(ts.URL+"/api/vault/sealed/purge-plaintext", "application/json", nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
	}

	var answer struct {
		Deleted int   `json:"deleted"`
		Bytes   int64 `json:"bytes"`
	}
	if err := json.NewDecoder(res.Body).Decode(&answer); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if answer.Deleted != 2 {
		t.Fatalf("unexpected number of deleted files: %d", answer.Deleted)
	}

	if _, err := os.Stat(notePath); !os.IsNotExist(err) {
		t.Fatalf("the plaintext note was not removed: %v", err)
	}
	if _, err := os.Stat(rootNote); !os.IsNotExist(err) {
		t.Fatalf("the plaintext note was not removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(notesDir, "Journal")); !os.IsNotExist(err) {
		t.Fatalf("the empty folder was not removed: %v", err)
	}

	// The sealed object must survive the purge.
	res2, err := http.Get(ts.URL + "/api/vault/sealed/objects/" + sealedID)
	if err != nil {
		t.Fatalf("get object: %v", err)
	}
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusOK {
		t.Fatalf("the sealed object did not survive the purge: %d", res2.StatusCode)
	}
}

// TestPurgePlaintextRefusesAnOpenVault checks that the purge cannot be used
// on a vault that was not sealed: it would destroy the notes of the user.
func TestPurgePlaintextRefusesAnOpenVault(t *testing.T) {
	cfg := testutil.NewTestConfig(t)
	if err := cfg.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	store := testutil.NewMemStore()
	svc, err := notes.NewService(cfg, store)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv, err := api.New(cfg, svc, logger)
	if err != nil {
		t.Fatalf("new api: %v", err)
	}
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	res, err := http.Post(ts.URL+"/api/vault/sealed/purge-plaintext", "application/json", nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
}
