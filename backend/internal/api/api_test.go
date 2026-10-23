package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"noto/backend/internal/api"
	"noto/backend/internal/model"
	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// newServer starts a test server with a temporary data directory.
func newServer(t *testing.T) (*httptest.Server, *api.Server) {
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
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, srv
}

// put sends a PUT request with a JSON body.
func put(t *testing.T, url, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	return res
}

// errorEnvelope reads the error envelope of a response.
func errorEnvelope(t *testing.T, res *http.Response) model.ErrorBody {
	t.Helper()
	var body model.APIError
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("cannot decode the error envelope: %v", err)
	}
	return body.Error
}

func TestHealth(t *testing.T) {
	ts, _ := newServer(t)
	res, err := http.Get(ts.URL + "/api/health")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("unexpected health body: %v", body)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("unexpected content type %q", ct)
	}
}

func TestSecurityHeaders(t *testing.T) {
	ts, _ := newServer(t)
	res, err := http.Get(ts.URL + "/api/health")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer res.Body.Close()
	want := map[string]string{
		"X-Content-Type-Options":     "nosniff",
		"Referrer-Policy":            "no-referrer",
		"X-Frame-Options":            "DENY",
		"Cross-Origin-Opener-Policy": "same-origin",
	}
	for k, v := range want {
		if got := res.Header.Get(k); got != v {
			t.Fatalf("header %s: got %q want %q", k, got, v)
		}
	}
	if res.Header.Get("Content-Security-Policy") == "" {
		t.Fatalf("the content security policy header is missing")
	}
}

func TestNoCorsHeaderByDefault(t *testing.T) {
	ts, _ := newServer(t)
	res, err := http.Get(ts.URL + "/api/health")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer res.Body.Close()
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unexpected CORS header %q", got)
	}
}

func TestForeignOriginIsRejected(t *testing.T) {
	ts, _ := newServer(t)
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/folders", strings.NewReader(`{"name":"x"}`))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://evil.example.com")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	body := errorEnvelope(t, res)
	if body.Code != "forbidden" {
		t.Fatalf("unexpected error code %q", body.Code)
	}
}

func TestAllowedOriginGetsCorsHeader(t *testing.T) {
	cfg := testutil.NewTestConfig(t)
	cfg.AllowedOrigins = []string{"http://localhost:5173"}
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

	req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/health", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Origin", "http://localhost:5173")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("unexpected CORS header %q", got)
	}
}

func TestForeignHostIsRejected(t *testing.T) {
	ts, _ := newServer(t)
	req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/health", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Host = "evil.example.com"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
}

func TestNoteLifecycle(t *testing.T) {
	ts, _ := newServer(t)

	// Create a folder.
	res, err := http.Post(ts.URL+"/api/folders", "application/json", strings.NewReader(`{"parentPath":"","name":"Journal"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	var node model.Node
	if err := json.NewDecoder(res.Body).Decode(&node); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if node.Path != "Journal" {
		t.Fatalf("unexpected node %+v", node)
	}

	// A duplicate folder is a conflict.
	res, err = http.Post(ts.URL+"/api/folders", "application/json", strings.NewReader(`{"parentPath":"","name":"Journal"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	body := errorEnvelope(t, res)
	res.Body.Close()
	if res.StatusCode != http.StatusConflict || body.Code != "duplicate_name" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Code)
	}

	// An invalid name is a bad request.
	res, err = http.Post(ts.URL+"/api/files", "application/json", strings.NewReader(`{"parentPath":"","name":"bad:name"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	body = errorEnvelope(t, res)
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest || body.Code != "invalid_name" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Code)
	}

	// Create a note.
	res, err = http.Post(ts.URL+"/api/files", "application/json", strings.NewReader(`{"parentPath":"","name":"a"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	// Write the note.
	res = put(t, ts.URL+"/api/notes", `{"path":"a.md","content":"hello","revision":0}`)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	// Read the note.
	res, err = http.Get(ts.URL + "/api/notes?path=a.md")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var content model.NoteContent
	if err := json.NewDecoder(res.Body).Decode(&content); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if content.Content != "hello" {
		t.Fatalf("unexpected content %q", content.Content)
	}

	// A stale revision is a conflict that carries the current content.
	res = put(t, ts.URL+"/api/notes", `{"path":"a.md","content":"other","revision":99}`)
	body = errorEnvelope(t, res)
	res.Body.Close()
	if res.StatusCode != http.StatusConflict || body.Code != "revision_conflict" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Code)
	}
	if body.Current == nil || body.Current.Content != "hello" {
		t.Fatalf("the conflict does not carry the current content: %+v", body.Current)
	}

	// The tree lists the note.
	res, err = http.Get(ts.URL + "/api/tree")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var tree struct {
		Folders []model.Node `json:"folders"`
		Files   []model.Node `json:"files"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tree); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if len(tree.Files) != 1 || tree.Files[0].Path != "a.md" {
		t.Fatalf("unexpected tree: %+v", tree)
	}
}

func TestInvalidPathIsRejected(t *testing.T) {
	ts, _ := newServer(t)
	for _, p := range []string{"../../etc/passwd", "%2e%2e%2f%2e%2e%2fetc", "/etc/passwd"} {
		res, err := http.Get(ts.URL + "/api/notes?path=" + p)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		body := errorEnvelope(t, res)
		res.Body.Close()
		if res.StatusCode != http.StatusBadRequest || body.Code != "invalid_path" {
			t.Fatalf("path %q: unexpected status %d and code %q", p, res.StatusCode, body.Code)
		}
	}
}

func TestUnknownNoteReturnsNotFound(t *testing.T) {
	ts, _ := newServer(t)
	res, err := http.Get(ts.URL + "/api/notes?path=missing.md")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	body := errorEnvelope(t, res)
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound || body.Code != "not_found" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Code)
	}
}

func TestUnknownApiRouteReturnsJSONError(t *testing.T) {
	ts, _ := newServer(t)
	res, err := http.Get(ts.URL + "/api/unknown")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	body := errorEnvelope(t, res)
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if body.Code == "" || body.Message == "" {
		t.Fatalf("incomplete error envelope: %+v", body)
	}
}

func TestDeleteRestoreAndTrash(t *testing.T) {
	ts, _ := newServer(t)
	if _, err := http.Post(ts.URL+"/api/files", "application/json", strings.NewReader(`{"parentPath":"","name":"a"}`)); err != nil {
		t.Fatalf("post: %v", err)
	}
	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/notes?path=a.md", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	res, err = http.Get(ts.URL + "/api/trash")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var trash struct {
		Entries []model.Node `json:"entries"`
	}
	if err := json.NewDecoder(res.Body).Decode(&trash); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if len(trash.Entries) == 0 {
		t.Fatalf("the trash is empty")
	}
	res, err = http.Post(ts.URL+"/api/notes/restore", "application/json", strings.NewReader(`{"trashPath":"`+trash.Entries[0].Path+`"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	res, err = http.Get(ts.URL + "/api/notes?path=a.md")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("the note was not restored: %d", res.StatusCode)
	}
}

func TestSearchAndReindex(t *testing.T) {
	ts, _ := newServer(t)
	if _, err := http.Post(ts.URL+"/api/files", "application/json", strings.NewReader(`{"parentPath":"","name":"a"}`)); err != nil {
		t.Fatalf("post: %v", err)
	}
	if res := put(t, ts.URL+"/api/notes", `{"path":"a.md","content":"pineapple","revision":0}`); res != nil {
		res.Body.Close()
	}
	res, err := http.Get(ts.URL + "/api/search?q=pineapple")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var hits struct {
		Hits []model.SearchHit `json:"hits"`
	}
	if err := json.NewDecoder(res.Body).Decode(&hits); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if len(hits.Hits) == 0 {
		t.Fatalf("the search did not find the note")
	}
	res, err = http.Get(ts.URL + "/api/search?q=")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	res, err = http.Post(ts.URL+"/api/search/reindex", "application/json", nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	var reindexed struct {
		Indexed int `json:"indexed"`
	}
	if err := json.NewDecoder(res.Body).Decode(&reindexed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if reindexed.Indexed != 1 {
		t.Fatalf("unexpected indexed count %d", reindexed.Indexed)
	}
}

func TestImportAndExport(t *testing.T) {
	ts, _ := newServer(t)

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("files", "imported.md")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	fw.Write([]byte("# imported"))
	mw.WriteField("conflict", "skip")
	mw.Close()

	res, err := http.Post(ts.URL+"/api/import/files", mw.FormDataContentType(), &buf)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	var result model.ImportResult
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK || len(result.Imported) != 1 {
		t.Fatalf("unexpected import result %+v (%d)", result, res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/api/export/note?path=imported.md")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	data, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || string(data) != "# imported" {
		t.Fatalf("unexpected export %q (%d)", data, res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "text/markdown") {
		t.Fatalf("unexpected content type %q", ct)
	}

	res, err = http.Get(ts.URL + "/api/export/all")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	data, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || len(data) == 0 {
		t.Fatalf("unexpected export (%d)", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("unexpected content type %q", ct)
	}
}

func TestAttachments(t *testing.T) {
	ts, _ := newServer(t)
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("\x00", 32))

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", "photo.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	fw.Write(png)
	mw.Close()

	res, err := http.Post(ts.URL+"/api/attachments", mw.FormDataContentType(), &buf)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	var att model.Attachment
	if err := json.NewDecoder(res.Body).Decode(&att); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if att.MIME != "image/png" {
		t.Fatalf("unexpected mime type %q", att.MIME)
	}

	res, err = http.Get(ts.URL + "/api/attachments")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var list struct {
		Attachments []model.Attachment `json:"attachments"`
	}
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if len(list.Attachments) != 1 {
		t.Fatalf("unexpected attachment list %+v", list)
	}

	res, err = http.Get(ts.URL + "/api/attachments/" + att.ID + "/raw")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	data, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !bytes.Equal(data, png) {
		t.Fatalf("unexpected raw response (%d)", res.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/attachments/"+att.ID, nil)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
}

func TestSPAServesIndexForUnknownRoutes(t *testing.T) {
	ts, _ := newServer(t)
	res, err := http.Get(ts.URL + "/some/client/route")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	data, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if !strings.Contains(string(data), "<html") {
		t.Fatalf("the SPA fallback did not return an HTML document")
	}
}

func TestOversizedJSONBodyIsRejected(t *testing.T) {
	ts, _ := newServer(t)
	big := strings.Repeat("a", 5<<20)
	res := put(t, ts.URL+"/api/notes", `{"path":"a.md","content":"`+big+`"}`)
	body := errorEnvelope(t, res)
	res.Body.Close()
	if res.StatusCode != http.StatusRequestEntityTooLarge && body.Code != "payload_too_large" {
		t.Fatalf("unexpected status %d and code %q", res.StatusCode, body.Code)
	}
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
