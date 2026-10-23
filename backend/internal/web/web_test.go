package web_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"noto/backend/internal/web"
)

func TestEmbeddedHandlerServesIndexAndFallback(t *testing.T) {
	h, err := web.Handler("")
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("unexpected status %d", res.Code)
	}
	body := res.Body.String()
	if !strings.Contains(body, "<html") {
		t.Fatalf("the index is not an HTML document: %q", body)
	}

	// Unknown routes fall back to the index.
	res = httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/journal/2026", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("unexpected status %d", res.Code)
	}
	if !strings.Contains(res.Body.String(), "<html") {
		t.Fatalf("the fallback did not return the index")
	}

	// API routes are never answered by the SPA.
	res = httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/notes", nil))
	if res.Code != http.StatusNotFound {
		t.Fatalf("unexpected status %d", res.Code)
	}
}

func TestStaticDirHandler(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>app</html>"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	h, err := web.Handler(dir)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/app.js", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("unexpected status %d", res.Code)
	}
	if ct := res.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Fatalf("unexpected content type %q", ct)
	}
	data, _ := io.ReadAll(res.Body)
	if string(data) != "console.log(1)" {
		t.Fatalf("unexpected body %q", data)
	}
}
