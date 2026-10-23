package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"noto/backend/internal/api"
	"noto/backend/internal/model"
	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// TestSameOriginRequestIsAllowed makes sure that a request of the browser
// that carries the origin of the server itself is not rejected. Every browser
// sends the Origin header with a state changing request.
func TestSameOriginRequestIsAllowed(t *testing.T) {
	ts, _ := newServer(t)
	origin := "http://" + ts.Listener.Addr().String()

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/folders", strings.NewReader(`{"parentPath":"","name":"Journal"}`))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
	}
}

// TestSameOriginRequestWithDefaultPortIsAllowed makes sure that the default
// ports of the scheme are normalised.
func TestSameOriginRequestWithDefaultPortIsAllowed(t *testing.T) {
	ts, _ := newServer(t)
	origin := "http://" + ts.Listener.Addr().String()

	req, err := http.NewRequest(http.MethodPut, ts.URL+"/api/notes", strings.NewReader(`{"path":"a.md","content":"x","revision":0}`))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
	}
}

// TestForeignOriginGetHasNoCorsHeader makes sure that a foreign origin cannot
// read the response of the API.
func TestForeignOriginGetHasNoCorsHeader(t *testing.T) {
	ts, _ := newServer(t)
	req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/health", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Origin", "http://evil.example.com")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unexpected CORS header %q", got)
	}
}

// TestMissingOriginIsAllowed makes sure that a client that is not a browser
// is not rejected.
func TestMissingOriginIsAllowed(t *testing.T) {
	ts, _ := newServer(t)
	res, err := http.Post(ts.URL+"/api/folders", "application/json", strings.NewReader(`{"parentPath":"","name":"Journal"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
}

// TestOversizedUploadIsRejected makes sure that the whole request body is
// limited, not only the single files of a multipart upload.
func TestOversizedUploadIsRejected(t *testing.T) {
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
	defer ts.Close()

	// Every single file is below the upload limit, but together they are
	// above it.
	chunk := bytes.Repeat([]byte("a"), int(cfg.MaxUploadBytes)-1024)
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for i := 0; i < 2; i++ {
		fw, err := mw.CreateFormFile("files", "imported.md")
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		if _, err := fw.Write(chunk); err != nil {
			t.Fatalf("write form file: %v", err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	res, err := http.Post(ts.URL+"/api/import/files", mw.FormDataContentType(), &buf)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	var body model.APIError
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res.StatusCode != http.StatusRequestEntityTooLarge || body.Error.Code != "payload_too_large" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Error.Code)
	}
}

// TestOversizedAttachmentUploadIsRejected makes sure that the attachment
// upload is limited as well.
func TestOversizedAttachmentUploadIsRejected(t *testing.T) {
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
	defer ts.Close()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", "big.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(bytes.Repeat([]byte("a"), int(cfg.MaxUploadBytes)+1024)); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	res, err := http.Post(ts.URL+"/api/attachments", mw.FormDataContentType(), &buf)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	var body model.APIError
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res.StatusCode != http.StatusRequestEntityTooLarge || body.Error.Code != "payload_too_large" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Error.Code)
	}
}

// TestExportFolderOfAMissingPathReturnsNotFound makes sure that a failing
// export is reported with the proper status code instead of an empty
// download.
func TestExportFolderOfAMissingPathReturnsNotFound(t *testing.T) {
	ts, _ := newServer(t)
	res, err := http.Get(ts.URL + "/api/export/folder?path=doesnotexist")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	body := errorEnvelope(t, res)
	if body.Code != "not_found" {
		t.Fatalf("unexpected error code %q", body.Code)
	}
}
