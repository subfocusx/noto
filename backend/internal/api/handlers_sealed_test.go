package api_test

import (
	"bytes"
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
	"noto/backend/internal/notes"
	"noto/backend/internal/sealed"
	"noto/backend/internal/testutil"
)

// sealedID is a valid object identifier.
const sealedID = "0123456789abcdef0123456789abcdef"

// newSealedServer starts a test server in the sealed mode. The blind object
// store is created over the internal directory of the configuration, so that
// the test never touches the user data.
func newSealedServer(t *testing.T) (*httptest.Server, *api.Server) {
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
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, srv
}

// putRaw sends a PUT request with a raw body.
func putRaw(t *testing.T, url string, body []byte) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	return res
}

func TestSealedObjectRoundTrip(t *testing.T) {
	ts, _ := newSealedServer(t)

	payload := []byte{0x00, 0xff, 'c', 'i', 'p', 'h', 'e', 'r'}
	res := putRaw(t, ts.URL+"/api/vault/sealed/objects/"+sealedID, payload)
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	res, err := http.Get(ts.URL + "/api/vault/sealed/objects/" + sealedID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	data, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if !bytes.Equal(data, payload) {
		t.Fatalf("unexpected payload %v", data)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "application/octet-stream") {
		t.Fatalf("unexpected content type %q", ct)
	}

	res, err = http.Get(ts.URL + "/api/vault/sealed/objects")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var list struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if len(list.IDs) != 1 || list.IDs[0] != sealedID {
		t.Fatalf("unexpected identifiers %v", list.IDs)
	}

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/vault/sealed/objects/"+sealedID, nil)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/api/vault/sealed/objects/" + sealedID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	body := errorEnvelope(t, res)
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound || body.Code != "not_found" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Code)
	}
}

func TestSealedManifestRoundTrip(t *testing.T) {
	ts, _ := newSealedServer(t)

	payload := []byte("encrypted manifest")
	res := putRaw(t, ts.URL+"/api/vault/sealed/manifests/7", payload)
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	res, err := http.Get(ts.URL + "/api/vault/sealed/manifests/7")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	data, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !bytes.Equal(data, payload) {
		t.Fatalf("unexpected response %q (%d)", data, res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/api/vault/sealed/manifests")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var list struct {
		Generations []uint64 `json:"generations"`
	}
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if len(list.Generations) != 1 || list.Generations[0] != 7 {
		t.Fatalf("unexpected generations %v", list.Generations)
	}

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/vault/sealed/manifests/7", nil)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
}

func TestSealedInvalidIdentifierIsRejected(t *testing.T) {
	ts, _ := newSealedServer(t)
	for _, id := range []string{"not-an-id", "ZZ", "0123456789abcdef0123456789abcdef0"} {
		res := putRaw(t, ts.URL+"/api/vault/sealed/objects/"+id, []byte("x"))
		body := errorEnvelope(t, res)
		res.Body.Close()
		if res.StatusCode != http.StatusBadRequest || body.Code != "bad_request" {
			t.Fatalf("id %q: unexpected status %d and code %q", id, res.StatusCode, body.Code)
		}
	}
}

func TestSealedInvalidGenerationIsRejected(t *testing.T) {
	ts, _ := newSealedServer(t)
	res := putRaw(t, ts.URL+"/api/vault/sealed/manifests/0", []byte("x"))
	body := errorEnvelope(t, res)
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest || body.Code != "bad_request" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Code)
	}
}

func TestSealedKeystoreRoundTrip(t *testing.T) {
	ts, _ := newSealedServer(t)

	keystore := []byte(`{"kdf":"argon2id","wrapped":"key"}`)
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/vault/sealed/keystore", bytes.NewReader(keystore))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/api/vault/sealed/keystore")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	data, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if !bytes.Equal(data, keystore) {
		t.Fatalf("unexpected keystore %q", data)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("unexpected content type %q", ct)
	}
}

func TestSealedStatusReportsTheState(t *testing.T) {
	ts, _ := newSealedServer(t)
	res, err := http.Get(ts.URL + "/api/vault/sealed/status")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var status struct {
		Mode        string   `json:"mode"`
		Format      int      `json:"format"`
		ObjectCount int      `json:"objectCount"`
		Generations []uint64 `json:"generations"`
	}
	if err := json.NewDecoder(res.Body).Decode(&status); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if status.Mode != "sealed" || status.Format != 1 || status.ObjectCount != 0 {
		t.Fatalf("unexpected status %+v", status)
	}
}

func TestOpenEndpointIsRefusedInSealedMode(t *testing.T) {
	ts, _ := newSealedServer(t)
	res, err := http.Get(ts.URL + "/api/tree")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	body := errorEnvelope(t, res)
	res.Body.Close()
	if res.StatusCode != http.StatusConflict || body.Code != "vault_sealed" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Code)
	}
	if body.Message == "" {
		t.Fatalf("the conflict has no message")
	}
}

func TestEnableSealedWritesTheConfiguration(t *testing.T) {
	ts, cfg := newContractServer(t)

	// The server is not sealed yet, so the status is not available.
	res, err := http.Get(ts.URL + "/api/vault/sealed/status")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	res, err = http.Post(ts.URL+"/api/vault/sealed/enable", "application/json", nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	// The configuration file of the vault is written.
	file := filepath.Join(cfg.DataDir, "config.json")
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("read the configuration: %v", err)
	}
	if !strings.Contains(string(data), `"mode":"sealed"`) {
		t.Fatalf("unexpected configuration %q", data)
	}

	// The open endpoints are refused from now on.
	res, err = http.Get(ts.URL + "/api/tree")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	body := errorEnvelope(t, res)
	res.Body.Close()
	if res.StatusCode != http.StatusConflict || body.Code != "vault_sealed" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Code)
	}

	// The vault status reports the mode.
	res, err = http.Get(ts.URL + "/api/vault")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var status struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(res.Body).Decode(&status); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if status.Mode != "sealed" {
		t.Fatalf("unexpected mode %q", status.Mode)
	}
}
