package api_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"noto/backend/internal/api"
	"noto/backend/internal/config"
	"noto/backend/internal/model"
	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
	"noto/backend/internal/vault"
)

// vaultServer starts a test server that can switch its vault.
func vaultServer(t *testing.T) (*httptest.Server, config.Config) {
	t.Helper()
	return newVaultServer(t, false)
}

// newVaultServer starts a test server whose storage is optionally fixed by
// the environment.
func newVaultServer(t *testing.T, fixed bool) (*httptest.Server, config.Config) {
	t.Helper()
	t.Setenv(vault.EnvFile, filepath.Join(t.TempDir(), "vault.json"))
	base := testutil.NewTestConfig(t)
	if err := base.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	factory := func(vaultPath string) (*notes.Service, func(), error) {
		cfg := base
		if strings.TrimSpace(vaultPath) != "" {
			var err error
			cfg, _, err = vault.ApplyTo(base, vaultPath)
			if err != nil {
				return nil, nil, err
			}
		}
		if err := cfg.EnsureDirs(); err != nil {
			return nil, nil, err
		}
		svc, err := notes.NewService(cfg, testutil.NewMemStore())
		if err != nil {
			return nil, nil, err
		}
		return svc, func() {}, nil
	}
	svc, _, err := factory("")
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv, err := api.NewWithFactory(base, svc, logger, factory)
	if err != nil {
		t.Fatalf("new api: %v", err)
	}
	srv.SetVaultFixed(fixed)
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, base
}

// vaultStatus is the answer of the vault status endpoint.
type vaultStatus struct {
	Configured bool   `json:"configured"`
	Path       string `json:"path"`
	NotesDir   string `json:"notesDir"`
	Fixed      bool   `json:"fixed"`
}

// getJSON sends a GET request and decodes the JSON answer.
func getJSON(t *testing.T, url string, dst any) *http.Response {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	t.Cleanup(func() { _ = res.Body.Close() })
	if dst != nil {
		if err := json.NewDecoder(res.Body).Decode(dst); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return res
}

// postJSON sends a POST request with a JSON body and decodes the answer.
func postJSON(t *testing.T, url, body string, dst any) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	t.Cleanup(func() { _ = res.Body.Close() })
	if dst != nil {
		if err := json.NewDecoder(res.Body).Decode(dst); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return res
}

// vaultBody builds the JSON body of the vault selection.
func vaultBody(t *testing.T, path string) string {
	t.Helper()
	b, err := json.Marshal(map[string]string{"path": path})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// tree is the answer of the tree endpoint.
type tree struct {
	Folders []struct {
		Path string `json:"path"`
	} `json:"folders"`
	Files []struct {
		Path string `json:"path"`
	} `json:"files"`
}

func TestVaultGetReportsTheDefaultDirectory(t *testing.T) {
	ts, base := vaultServer(t)
	var st vaultStatus
	res := getJSON(t, ts.URL+"/api/vault", &st)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	if st.Configured {
		t.Fatal("a vault is configured, but none was selected")
	}
	if st.NotesDir != base.NotesDir {
		t.Fatalf("unexpected notes directory: %q", st.NotesDir)
	}
	if st.Fixed {
		t.Fatal("the storage is reported as fixed, but the environment did not fix it")
	}
}

// TestVaultGetReportsAFixedStorage makes sure that a storage that was fixed by
// the environment is reported as a normal state.
func TestVaultGetReportsAFixedStorage(t *testing.T) {
	ts, _ := newVaultServer(t, true)
	var st vaultStatus
	res := getJSON(t, ts.URL+"/api/vault", &st)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	if !st.Fixed {
		t.Fatal("the storage is not reported as fixed")
	}
}

// TestVaultOfAFixedStorageIsRefused makes sure that a fixed storage cannot
// be changed and that the dedicated error code is used.
func TestVaultOfAFixedStorageIsRefused(t *testing.T) {
	ts, _ := newVaultServer(t, true)

	res := postJSON(t, ts.URL+"/api/vault", vaultBody(t, t.TempDir()), nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected status of the vault selection: %d", res.StatusCode)
	}
	var apiErr model.APIError
	if err := json.NewDecoder(res.Body).Decode(&apiErr); err != nil {
		t.Fatalf("decode the error envelope: %v", err)
	}
	if apiErr.Error.Code != notes.CodeVaultFixed {
		t.Fatalf("unexpected error code: %q", apiErr.Error.Code)
	}

	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/vault", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	del, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	defer func() { _ = del.Body.Close() }()
	if del.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected status of the vault deletion: %d", del.StatusCode)
	}
	var apiErr2 model.APIError
	if err := json.NewDecoder(del.Body).Decode(&apiErr2); err != nil {
		t.Fatalf("decode the error envelope: %v", err)
	}
	if apiErr2.Error.Code != notes.CodeVaultFixed {
		t.Fatalf("unexpected error code: %q", apiErr2.Error.Code)
	}
}

func TestVaultSwitchChangesTheNotesDirectory(t *testing.T) {
	ts, _ := vaultServer(t)
	root := t.TempDir()
	first := filepath.Join(root, "first")
	second := filepath.Join(root, "second")
	for _, dir := range []string{first, second} {
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}

	var ok struct {
		OK   bool   `json:"ok"`
		Path string `json:"path"`
	}
	res := postJSON(t, ts.URL+"/api/vault", vaultBody(t, first), &ok)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	if !ok.OK {
		t.Fatal("the vault was not accepted")
	}

	var st vaultStatus
	getJSON(t, ts.URL+"/api/vault", &st)
	if !st.Configured {
		t.Fatal("the vault is not reported as configured")
	}
	if st.Path != filepath.Clean(first) {
		t.Fatalf("unexpected vault path: %q", st.Path)
	}
	if st.NotesDir != filepath.Clean(first) {
		t.Fatalf("unexpected notes directory: %q", st.NotesDir)
	}

	// The configuration is stored outside of the vault.
	vc, found, err := vault.Read()
	if err != nil || !found {
		t.Fatalf("the vault configuration was not stored: found=%v err=%v", found, err)
	}
	if vc.Path != filepath.Clean(first) {
		t.Fatalf("unexpected stored path: %q", vc.Path)
	}

	// A note is written into the selected vault.
	res = postJSON(t, ts.URL+"/api/files", `{"parentPath":"","name":"note.md"}`, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status of the file creation: %d", res.StatusCode)
	}
	res = put(t, ts.URL+"/api/notes", `{"path":"note.md","content":"hello"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status of the note write: %d", res.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(first, "note.md")); err != nil {
		t.Fatalf("the note is not in the vault: %v", err)
	}

	var tr tree
	getJSON(t, ts.URL+"/api/tree", &tr)
	if len(tr.Files) != 1 || tr.Files[0].Path != "note.md" {
		t.Fatalf("unexpected tree: %+v", tr.Files)
	}

	// A second vault is empty.
	res = postJSON(t, ts.URL+"/api/vault", vaultBody(t, second), &ok)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	getJSON(t, ts.URL+"/api/tree", &tr)
	if len(tr.Files) != 0 {
		t.Fatalf("the notes of the old vault are still visible: %+v", tr.Files)
	}
}

func TestVaultRejectsAnUnusablePath(t *testing.T) {
	ts, _ := vaultServer(t)
	missing := filepath.Join(t.TempDir(), "missing")
	res := postJSON(t, ts.URL+"/api/vault", vaultBody(t, missing), nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	if _, found, err := vault.Read(); err != nil || found {
		t.Fatalf("the vault configuration was stored: found=%v err=%v", found, err)
	}
}

func TestVaultDeleteResetsTheConfiguration(t *testing.T) {
	ts, _ := vaultServer(t)
	dir := t.TempDir()
	res := postJSON(t, ts.URL+"/api/vault", vaultBody(t, dir), nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/vault", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	del, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	defer func() { _ = del.Body.Close() }()
	if del.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", del.StatusCode)
	}
	if _, found, err := vault.Read(); err != nil || found {
		t.Fatalf("the vault configuration was not removed: found=%v err=%v", found, err)
	}
	var st vaultStatus
	getJSON(t, ts.URL+"/api/vault", &st)
	if st.Configured {
		t.Fatal("the vault is still reported as configured")
	}
}

// TestVaultSwitchIsSafeUnderConcurrentRequests makes sure that the service
// can be replaced while the requests are running.
func TestVaultSwitchIsSafeUnderConcurrentRequests(t *testing.T) {
	ts, _ := vaultServer(t)
	dirs := []string{t.TempDir(), t.TempDir()}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if i%2 == 0 {
				res, err := http.Get(ts.URL + "/api/tree")
				if err != nil {
					t.Errorf("get tree: %v", err)
					return
				}
				_ = res.Body.Close()
				return
			}
			body, err := json.Marshal(map[string]string{"path": dirs[i%len(dirs)]})
			if err != nil {
				t.Errorf("marshal: %v", err)
				return
			}
			res, err := http.Post(ts.URL+"/api/vault", "application/json", strings.NewReader(string(body)))
			if err != nil {
				t.Errorf("post vault: %v", err)
				return
			}
			_ = res.Body.Close()
		}(i)
	}
	wg.Wait()
}

func TestVaultBrowseListsTheDirectories(t *testing.T) {
	ts, _ := vaultServer(t)
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "notes"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.Mkdir(filepath.Join(dir, ".hidden"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "note.md"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	var res struct {
		Path   string `json:"path"`
		Parent string `json:"parent"`
		Dirs   []struct {
			Name string `json:"name"`
			Path string `json:"path"`
		} `json:"dirs"`
	}
	getJSON(t, ts.URL+"/api/vault/browse?path="+url.QueryEscape(dir), &res)
	if len(res.Dirs) != 1 || res.Dirs[0].Name != "notes" {
		t.Fatalf("unexpected directory list: %+v", res.Dirs)
	}
	if res.Path != filepath.Clean(dir) {
		t.Fatalf("unexpected path: %q", res.Path)
	}

	// A missing directory is refused.
	resp := getJSON(t, ts.URL+"/api/vault/browse?path="+url.QueryEscape(filepath.Join(dir, "missing")), nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected status: %d", resp.StatusCode)
	}
	// A file is refused.
	resp = getJSON(t, ts.URL+"/api/vault/browse?path="+url.QueryEscape(filepath.Join(dir, "note.md")), nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected status: %d", resp.StatusCode)
	}
}
