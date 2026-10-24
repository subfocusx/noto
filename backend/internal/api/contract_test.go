package api_test

import (
	"archive/zip"
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
	"noto/backend/internal/config"
	"noto/backend/internal/model"
	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// The constants below freeze the public HTTP contract of the API. They must
// only be changed together with a deliberate change of the contract.

// contractCSP is the exact value of the Content-Security-Policy header.
const contractCSP = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"

// contractSecurityHeaders is the exact set of security headers and their
// values that every response carries.
var contractSecurityHeaders = map[string]string{
	"X-Content-Type-Options":     "nosniff",
	"Referrer-Policy":            "no-referrer",
	"X-Frame-Options":            "DENY",
	"Cross-Origin-Opener-Policy": "same-origin",
	"Content-Security-Policy":    contractCSP,
}

// The JSON field names of the response types of the API.
var (
	contractNodeFields = []string{
		"id", "name", "path", "type", "parentPath",
		"size", "modTime", "revision", "createdAt", "updatedAt",
	}
	contractNoteContentFields = []string{
		"path", "content", "revision", "updatedAt", "conflict",
	}
	contractSearchHitFields = []string{
		"path", "name", "kind", "snippet",
	}
	contractAttachmentFields = []string{
		"id", "name", "mime", "size", "notePath", "createdAt",
	}
	contractImportResultFields = []string{
		"imported", "skipped", "errors",
	}
)

// newContractServer starts a test server and also returns the configuration
// of the server, so that a test can reach the data directories.
func newContractServer(t *testing.T) (*httptest.Server, config.Config) {
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
	srv, err := api.New(cfg, svc, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new api: %v", err)
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, cfg
}

// contractRequest builds a JSON request for the contract tests.
func contractRequest(t *testing.T, ts *httptest.Server, method, path, body string) *http.Request {
	t.Helper()
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, ts.URL+path, rdr)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	return req
}

// contractDo performs a request and returns the response.
func contractDo(t *testing.T, req *http.Request) *http.Response {
	t.Helper()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	return res
}

// contractObject reads a JSON object of a response.
func contractObject(t *testing.T, res *http.Response) map[string]json.RawMessage {
	t.Helper()
	defer res.Body.Close()
	var m map[string]json.RawMessage
	if err := json.NewDecoder(res.Body).Decode(&m); err != nil {
		t.Fatalf("decode json object: %v", err)
	}
	return m
}

// contractRequireKeys makes sure that a JSON object carries every field.
func contractRequireKeys(t *testing.T, what string, obj map[string]json.RawMessage, keys []string) {
	t.Helper()
	for _, k := range keys {
		if _, ok := obj[k]; !ok {
			t.Errorf("%s: the field %q is missing", what, k)
		}
	}
}

// contractEnv holds the identifiers that a seeded server produced.
type contractEnv struct {
	attachmentID string
	trashPath    string
}

// contractCase is a single entry of the route table.
type contractCase struct {
	name       string
	method     string
	path       string
	body       string
	seed       func(t *testing.T, ts *httptest.Server, env *contractEnv)
	build      func(t *testing.T, ts *httptest.Server, env *contractEnv) *http.Request
	wantStatus int
	wantKeys   []string
	wantType   string
}

// contractSeedFile creates a note and writes a content into it.
func contractSeedFile(t *testing.T, ts *httptest.Server, name, content string) {
	t.Helper()
	res := contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/files",
		`{"parentPath":"","name":"`+name+`"}`))
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create file %q: unexpected status %d", name, res.StatusCode)
	}
	res = contractDo(t, contractRequest(t, ts, http.MethodPut, "/api/notes",
		`{"path":"`+name+`.md","content":"`+content+`","revision":0}`))
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("write file %q: unexpected status %d", name, res.StatusCode)
	}
}

// contractMultipart builds a multipart request with a single file.
func contractMultipart(t *testing.T, ts *httptest.Server, path, field, filename string, content []byte) *http.Request {
	t.Helper()
	return contractMultipartFields(t, ts, path, field, filename, content, nil)
}

// contractMultipartFields builds a multipart request with a single file and
// additional form fields.
func contractMultipartFields(t *testing.T, ts *httptest.Server, path, field, filename string, content []byte, extra map[string]string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile(field, filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(content); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	mw.WriteField("conflict", "skip")
	for k, v := range extra {
		mw.WriteField(k, v)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, ts.URL+path, &buf)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

// TestRouteContract walks the table of the stable routes. Every route must
// exist and must answer with the expected status code and the expected JSON
// fields. A route that silently turns into an unknown route (404) fails the
// test.
func TestRouteContract(t *testing.T) {
	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 32)...)

	zipBytes := func(t *testing.T) []byte {
		t.Helper()
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		f, err := zw.Create("imported.md")
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := f.Write([]byte("# imported")); err != nil {
			t.Fatalf("write zip entry: %v", err)
		}
		if err := zw.Close(); err != nil {
			t.Fatalf("close zip writer: %v", err)
		}
		return buf.Bytes()
	}

	cases := []contractCase{
		{
			name:       "GET /api/health",
			method:     http.MethodGet,
			path:       "/api/health",
			wantStatus: http.StatusOK,
			wantKeys:   []string{"status", "version", "time"},
		},
		{
			name:       "GET /api/tree",
			method:     http.MethodGet,
			path:       "/api/tree",
			wantStatus: http.StatusOK,
			wantKeys:   []string{"folders", "files"},
		},
		{
			name:       "POST /api/folders",
			method:     http.MethodPost,
			path:       "/api/folders",
			body:       `{"parentPath":"","name":"Journal"}`,
			wantStatus: http.StatusOK,
			wantKeys:   contractNodeFields,
		},
		{
			name:       "POST /api/files",
			method:     http.MethodPost,
			path:       "/api/files",
			body:       `{"parentPath":"","name":"a"}`,
			wantStatus: http.StatusOK,
			wantKeys:   contractNodeFields,
		},
		{
			name:   "GET /api/notes",
			method: http.MethodGet,
			path:   "/api/notes?path=a.md",
			seed: func(t *testing.T, ts *httptest.Server, _ *contractEnv) {
				contractSeedFile(t, ts, "a", "hello")
			},
			wantStatus: http.StatusOK,
			wantKeys:   contractNoteContentFields,
		},
		{
			name:   "PUT /api/notes",
			method: http.MethodPut,
			path:   "/api/notes",
			body:   `{"path":"a.md","content":"hello","revision":0}`,
			seed: func(t *testing.T, ts *httptest.Server, _ *contractEnv) {
				contractSeedFile(t, ts, "a", "")
			},
			wantStatus: http.StatusOK,
			wantKeys:   []string{"path", "revision", "updatedAt"},
		},
		{
			name:   "POST /api/notes/rename",
			method: http.MethodPost,
			path:   "/api/notes/rename",
			body:   `{"path":"a.md","newName":"b.md"}`,
			seed: func(t *testing.T, ts *httptest.Server, _ *contractEnv) {
				contractSeedFile(t, ts, "a", "hello")
			},
			wantStatus: http.StatusOK,
			wantKeys:   contractNodeFields,
		},
		{
			name:   "POST /api/notes/move",
			method: http.MethodPost,
			path:   "/api/notes/move",
			body:   `{"path":"a.md","newParentPath":"Journal"}`,
			seed: func(t *testing.T, ts *httptest.Server, _ *contractEnv) {
				contractSeedFile(t, ts, "a", "hello")
				res := contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/folders",
					`{"parentPath":"","name":"Journal"}`))
				res.Body.Close()
			},
			wantStatus: http.StatusOK,
			wantKeys:   contractNodeFields,
		},
		{
			name:   "DELETE /api/notes",
			method: http.MethodDelete,
			path:   "/api/notes?path=a.md",
			seed: func(t *testing.T, ts *httptest.Server, _ *contractEnv) {
				contractSeedFile(t, ts, "a", "hello")
			},
			wantStatus: http.StatusOK,
			wantKeys:   []string{"ok"},
		},
		{
			name:   "POST /api/notes/restore",
			method: http.MethodPost,
			path:   "/api/notes/restore",
			seed: func(t *testing.T, ts *httptest.Server, env *contractEnv) {
				contractSeedFile(t, ts, "a", "hello")
				res := contractDo(t, contractRequest(t, ts, http.MethodDelete, "/api/notes?path=a.md", ""))
				res.Body.Close()
				res = contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/trash", ""))
				obj := contractObject(t, res)
				var raw json.RawMessage = obj["entries"]
				var entries []model.Node
				if err := json.Unmarshal(raw, &entries); err != nil {
					t.Fatalf("decode trash entries: %v", err)
				}
				if len(entries) == 0 {
					t.Fatalf("the trash is empty")
				}
				env.trashPath = entries[0].Path
			},
			build: func(t *testing.T, ts *httptest.Server, env *contractEnv) *http.Request {
				return contractRequest(t, ts, http.MethodPost, "/api/notes/restore",
					`{"trashPath":"`+env.trashPath+`"}`)
			},
			wantStatus: http.StatusOK,
			wantKeys:   contractNodeFields,
		},
		{
			name:       "GET /api/trash",
			method:     http.MethodGet,
			path:       "/api/trash",
			wantStatus: http.StatusOK,
			wantKeys:   []string{"entries"},
		},
		{
			name:   "GET /api/search",
			method: http.MethodGet,
			path:   "/api/search?q=pineapple",
			seed: func(t *testing.T, ts *httptest.Server, _ *contractEnv) {
				contractSeedFile(t, ts, "a", "pineapple")
			},
			wantStatus: http.StatusOK,
			wantKeys:   []string{"hits"},
		},
		{
			name:   "POST /api/query",
			method: http.MethodPost,
			path:   "/api/query",
			body:   `{"query":"tag == 'pineapple'","limit":10}`,
			seed: func(t *testing.T, ts *httptest.Server, _ *contractEnv) {
				contractSeedFile(t, ts, "a", "# Apple\\n\\n#pineapple")
			},
			wantStatus: http.StatusOK,
			wantKeys:   []string{"hits", "total", "partial"},
		},
		{
			name:       "GET /api/tags",
			method:     http.MethodGet,
			path:       "/api/tags",
			wantStatus: http.StatusOK,
			wantKeys:   []string{"tags"},
		},
		{
			name:       "POST /api/search/reindex",
			method:     http.MethodPost,
			path:       "/api/search/reindex",
			wantStatus: http.StatusOK,
			wantKeys:   []string{"indexed"},
		},
		{
			name:   "POST /api/import/files",
			method: http.MethodPost,
			path:   "/api/import/files",
			build: func(t *testing.T, ts *httptest.Server, _ *contractEnv) *http.Request {
				return contractMultipart(t, ts, "/api/import/files", "files", "imported.md", []byte("# imported"))
			},
			wantStatus: http.StatusOK,
			wantKeys:   contractImportResultFields,
		},
		{
			name:   "POST /api/import/zip",
			method: http.MethodPost,
			path:   "/api/import/zip",
			build: func(t *testing.T, ts *httptest.Server, _ *contractEnv) *http.Request {
				return contractMultipart(t, ts, "/api/import/zip", "file", "archive.zip", zipBytes(t))
			},
			wantStatus: http.StatusOK,
			wantKeys:   contractImportResultFields,
		},
		{
			name:   "GET /api/export/note",
			method: http.MethodGet,
			path:   "/api/export/note?path=a.md",
			seed: func(t *testing.T, ts *httptest.Server, _ *contractEnv) {
				contractSeedFile(t, ts, "a", "hello")
			},
			wantStatus: http.StatusOK,
			wantType:   "text/markdown",
		},
		{
			name:   "GET /api/export/folder",
			method: http.MethodGet,
			path:   "/api/export/folder?path=Journal",
			seed: func(t *testing.T, ts *httptest.Server, _ *contractEnv) {
				res := contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/folders",
					`{"parentPath":"","name":"Journal"}`))
				res.Body.Close()
			},
			wantStatus: http.StatusOK,
			wantType:   "application/zip",
		},
		{
			name:       "GET /api/export/all",
			method:     http.MethodGet,
			path:       "/api/export/all",
			wantStatus: http.StatusOK,
			wantType:   "application/zip",
		},
		{
			name:   "POST /api/attachments",
			method: http.MethodPost,
			path:   "/api/attachments",
			seed: func(t *testing.T, ts *httptest.Server, _ *contractEnv) {
				contractSeedFile(t, ts, "a", "hello")
			},
			build: func(t *testing.T, ts *httptest.Server, _ *contractEnv) *http.Request {
				return contractMultipartFields(t, ts, "/api/attachments", "file", "photo.png", png,
					map[string]string{"notePath": "a.md"})
			},
			wantStatus: http.StatusOK,
			wantKeys:   contractAttachmentFields,
		},
		{
			name:       "GET /api/attachments",
			method:     http.MethodGet,
			path:       "/api/attachments",
			wantStatus: http.StatusOK,
			wantKeys:   []string{"attachments"},
		},
		{
			name:   "GET /api/attachments/{id}/raw",
			method: http.MethodGet,
			path:   "/api/attachments/{id}/raw",
			seed: func(t *testing.T, ts *httptest.Server, env *contractEnv) {
				req := contractMultipart(t, ts, "/api/attachments", "file", "photo.png", png)
				res := contractDo(t, req)
				obj := contractObject(t, res)
				var att model.Attachment
				raw, ok := obj["id"]
				if !ok {
					t.Fatalf("the attachment has no id")
				}
				if err := json.Unmarshal(raw, &att.ID); err != nil {
					t.Fatalf("decode attachment id: %v", err)
				}
				env.attachmentID = att.ID
			},
			build: func(t *testing.T, ts *httptest.Server, env *contractEnv) *http.Request {
				return contractRequest(t, ts, http.MethodGet, "/api/attachments/"+env.attachmentID+"/raw", "")
			},
			wantStatus: http.StatusOK,
			wantType:   "image/png",
		},
		{
			name:   "DELETE /api/attachments/{id}",
			method: http.MethodDelete,
			path:   "/api/attachments/{id}",
			seed: func(t *testing.T, ts *httptest.Server, env *contractEnv) {
				req := contractMultipart(t, ts, "/api/attachments", "file", "photo.png", png)
				res := contractDo(t, req)
				obj := contractObject(t, res)
				var att model.Attachment
				raw, ok := obj["id"]
				if !ok {
					t.Fatalf("the attachment has no id")
				}
				if err := json.Unmarshal(raw, &att.ID); err != nil {
					t.Fatalf("decode attachment id: %v", err)
				}
				env.attachmentID = att.ID
			},
			build: func(t *testing.T, ts *httptest.Server, env *contractEnv) *http.Request {
				return contractRequest(t, ts, http.MethodDelete, "/api/attachments/"+env.attachmentID, "")
			},
			wantStatus: http.StatusOK,
			wantKeys:   []string{"ok"},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			ts, _ := newContractServer(t)
			env := &contractEnv{}
			if tc.seed != nil {
				tc.seed(t, ts, env)
			}
			req := contractRequest(t, ts, tc.method, tc.path, tc.body)
			if tc.build != nil {
				req = tc.build(t, ts, env)
			}
			res := contractDo(t, req)
			if res.StatusCode != tc.wantStatus {
				data, _ := io.ReadAll(res.Body)
				res.Body.Close()
				t.Fatalf("unexpected status %d (want %d): %s", res.StatusCode, tc.wantStatus, data)
			}
			if tc.wantType != "" {
				if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, tc.wantType) {
					res.Body.Close()
					t.Fatalf("unexpected content type %q, want %q", ct, tc.wantType)
				}
			}
			if len(tc.wantKeys) > 0 {
				obj := contractObject(t, res)
				contractRequireKeys(t, tc.name, obj, tc.wantKeys)
			} else {
				res.Body.Close()
			}
		})
	}
}

// TestTypeFieldNames checks the JSON field names of every response type of
// the API on real responses.
func TestTypeFieldNames(t *testing.T) {
	t.Run("Node", func(t *testing.T) {
		ts, _ := newContractServer(t)
		res := contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/folders",
			`{"parentPath":"","name":"Journal"}`))
		obj := contractObject(t, res)
		contractRequireKeys(t, "Node", obj, contractNodeFields)
	})

	t.Run("NoteContent", func(t *testing.T) {
		ts, _ := newContractServer(t)
		contractSeedFile(t, ts, "a", "hello")
		res := contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/notes?path=a.md", ""))
		obj := contractObject(t, res)
		contractRequireKeys(t, "NoteContent", obj, contractNoteContentFields)
	})

	t.Run("SearchHit", func(t *testing.T) {
		ts, _ := newContractServer(t)
		contractSeedFile(t, ts, "a", "pineapple")
		res := contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/search?q=pineapple", ""))
		obj := contractObject(t, res)
		raw, ok := obj["hits"]
		if !ok {
			t.Fatalf("the search response has no hits")
		}
		var hits []map[string]json.RawMessage
		if err := json.Unmarshal(raw, &hits); err != nil {
			t.Fatalf("decode hits: %v", err)
		}
		if len(hits) == 0 {
			t.Fatalf("the search did not find the note")
		}
		contractRequireKeys(t, "SearchHit", hits[0], contractSearchHitFields)
	})

	t.Run("Attachment", func(t *testing.T) {
		ts, _ := newContractServer(t)
		contractSeedFile(t, ts, "a", "hello")
		png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 32)...)
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, err := mw.CreateFormFile("file", "photo.png")
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		if _, err := fw.Write(png); err != nil {
			t.Fatalf("write form file: %v", err)
		}
		mw.WriteField("notePath", "a.md")
		if err := mw.Close(); err != nil {
			t.Fatalf("close multipart writer: %v", err)
		}
		req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/attachments", &buf)
		if err != nil {
			t.Fatalf("new request: %v", err)
		}
		req.Header.Set("Content-Type", mw.FormDataContentType())
		res := contractDo(t, req)
		obj := contractObject(t, res)
		contractRequireKeys(t, "Attachment", obj, contractAttachmentFields)
	})

	t.Run("ImportResult", func(t *testing.T) {
		ts, _ := newContractServer(t)
		req := contractMultipart(t, ts, "/api/import/files", "files", "imported.md", []byte("# imported"))
		res := contractDo(t, req)
		obj := contractObject(t, res)
		contractRequireKeys(t, "ImportResult", obj, contractImportResultFields)
	})

	t.Run("APIError", func(t *testing.T) {
		ts, _ := newContractServer(t)
		res := contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/notes?path=missing.md", ""))
		defer res.Body.Close()
		var apiErr model.APIError
		if err := json.NewDecoder(res.Body).Decode(&apiErr); err != nil {
			t.Fatalf("decode error envelope: %v", err)
		}
		if apiErr.Error.Code == "" {
			t.Errorf("the error envelope has no code")
		}
		if apiErr.Error.Message == "" {
			t.Errorf("the error envelope has no message")
		}
		if apiErr.Error.Current != nil {
			t.Errorf("a not_found error must not carry the current content")
		}
	})
}

// TestErrorCodeStatusMapping checks that every stable error code is mapped
// to the documented HTTP status code.
func TestErrorCodeStatusMapping(t *testing.T) {
	cases := []struct {
		code       string
		wantStatus int
	}{
		{notes.CodeBadRequest, http.StatusBadRequest},
		{notes.CodeInvalidPath, http.StatusBadRequest},
		{notes.CodeInvalidName, http.StatusBadRequest},
		{notes.CodeNotFound, http.StatusNotFound},
		{notes.CodeConflict, http.StatusConflict},
		{notes.CodeRevisionConflict, http.StatusConflict},
		{notes.CodeDuplicateName, http.StatusConflict},
		{notes.CodePayloadTooLarge, http.StatusRequestEntityTooLarge},
		{notes.CodeUnsupportedMedia, http.StatusUnsupportedMediaType},
		{notes.CodeForbidden, http.StatusForbidden},
		{notes.CodeInternal, http.StatusInternalServerError},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.code, func(t *testing.T) {
			ts, cfg := newContractServer(t)

			var res *http.Response
			switch tc.code {
			case notes.CodeBadRequest:
				// A missing path parameter is a bad request.
				res = contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/notes", ""))
			case notes.CodeInvalidPath:
				res = contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/notes?path=../secret", ""))
			case notes.CodeInvalidName:
				res = contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/files",
					`{"parentPath":"","name":"bad:name"}`))
			case notes.CodeNotFound:
				res = contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/notes?path=missing.md", ""))
			case notes.CodeConflict:
				// A write to a note that was renamed away is a conflict.
				contractSeedFile(t, ts, "a", "hello")
				res = contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/notes/rename",
					`{"path":"a.md","newName":"b.md"}`))
				res.Body.Close()
				res = contractDo(t, contractRequest(t, ts, http.MethodPut, "/api/notes",
					`{"path":"a.md","content":"x","revision":0}`))
			case notes.CodeRevisionConflict:
				contractSeedFile(t, ts, "a", "hello")
				res = contractDo(t, contractRequest(t, ts, http.MethodPut, "/api/notes",
					`{"path":"a.md","content":"other","revision":99}`))
			case notes.CodeDuplicateName:
				res = contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/folders",
					`{"parentPath":"","name":"Journal"}`))
				res.Body.Close()
				res = contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/folders",
					`{"parentPath":"","name":"Journal"}`))
			case notes.CodePayloadTooLarge:
				big := strings.Repeat("a", 5<<20)
				res = contractDo(t, contractRequest(t, ts, http.MethodPut, "/api/notes",
					`{"path":"a.md","content":"`+big+`"}`))
			case notes.CodeUnsupportedMedia:
				exe := append([]byte("MZ"), bytes.Repeat([]byte{0}, 64)...)
				req := contractMultipart(t, ts, "/api/attachments", "file", "virus.exe", exe)
				res = contractDo(t, req)
			case notes.CodeForbidden:
				req := contractRequest(t, ts, http.MethodGet, "/api/health", "")
				req.Host = "evil.example.com"
				res = contractDo(t, req)
			case notes.CodeInternal:
				// A missing notes directory makes the tree walk fail.
				if err := os.RemoveAll(cfg.NotesDir); err != nil {
					t.Fatalf("remove notes dir: %v", err)
				}
				res = contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/tree", ""))
			}

			defer res.Body.Close()
			if res.StatusCode != tc.wantStatus {
				body, _ := io.ReadAll(res.Body)
				t.Fatalf("unexpected status %d (want %d): %s", res.StatusCode, tc.wantStatus, body)
			}
			var apiErr model.APIError
			if err := json.NewDecoder(res.Body).Decode(&apiErr); err != nil {
				t.Fatalf("decode error envelope: %v", err)
			}
			if apiErr.Error.Code != tc.code {
				t.Fatalf("unexpected error code %q (want %q)", apiErr.Error.Code, tc.code)
			}
			if tc.code == notes.CodeRevisionConflict {
				if apiErr.Error.Current == nil {
					t.Fatalf("a revision conflict must carry the current content")
				}
				raw, err := json.Marshal(apiErr.Error.Current)
				if err != nil {
					t.Fatalf("marshal current content: %v", err)
				}
				var current map[string]json.RawMessage
				if err := json.Unmarshal(raw, &current); err != nil {
					t.Fatalf("decode current content: %v", err)
				}
				contractRequireKeys(t, "current", current, contractNoteContentFields)
			}
		})
	}
}

// TestSecurityHeaderContract freezes the exact values of the security
// headers of every response.
func TestSecurityHeaderContract(t *testing.T) {
	ts, _ := newContractServer(t)
	res := contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/health", ""))
	defer res.Body.Close()
	for name, want := range contractSecurityHeaders {
		if got := res.Header.Get(name); got != want {
			t.Errorf("header %s: got %q, want %q", name, got, want)
		}
	}
}

// TestMiddlewareOrderContract freezes the behaviour of the middleware chain:
// a foreign origin is rejected on a state changing request, a foreign origin
// is served without a CORS header on a read request, a foreign host is
// rejected and an oversized body is refused.
func TestMiddlewareOrderContract(t *testing.T) {
	t.Run("foreign origin on POST is forbidden", func(t *testing.T) {
		ts, _ := newContractServer(t)
		req := contractRequest(t, ts, http.MethodPost, "/api/folders", `{"parentPath":"","name":"Journal"}`)
		req.Header.Set("Origin", "http://evil.example.com")
		res := contractDo(t, req)
		defer res.Body.Close()
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("unexpected status %d", res.StatusCode)
		}
		body := errorEnvelope(t, res)
		if body.Code != notes.CodeForbidden {
			t.Fatalf("unexpected error code %q", body.Code)
		}
	})

	t.Run("foreign origin on GET has no CORS header", func(t *testing.T) {
		ts, _ := newContractServer(t)
		req := contractRequest(t, ts, http.MethodGet, "/api/health", "")
		req.Header.Set("Origin", "http://evil.example.com")
		res := contractDo(t, req)
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("unexpected status %d", res.StatusCode)
		}
		if got := res.Header.Get("Access-Control-Allow-Origin"); got != "" {
			t.Fatalf("unexpected CORS header %q", got)
		}
	})

	t.Run("foreign host is forbidden", func(t *testing.T) {
		ts, _ := newContractServer(t)
		req := contractRequest(t, ts, http.MethodGet, "/api/health", "")
		req.Host = "evil.example.com"
		res := contractDo(t, req)
		defer res.Body.Close()
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("unexpected status %d", res.StatusCode)
		}
		body := errorEnvelope(t, res)
		if body.Code != notes.CodeForbidden {
			t.Fatalf("unexpected error code %q", body.Code)
		}
	})

	t.Run("oversized JSON body is refused", func(t *testing.T) {
		ts, _ := newContractServer(t)
		big := strings.Repeat("a", 5<<20)
		res := contractDo(t, contractRequest(t, ts, http.MethodPut, "/api/notes",
			`{"path":"a.md","content":"`+big+`"}`))
		defer res.Body.Close()
		if res.StatusCode != http.StatusRequestEntityTooLarge {
			body, _ := io.ReadAll(res.Body)
			t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
		}
		var apiErr model.APIError
		if err := json.NewDecoder(res.Body).Decode(&apiErr); err != nil {
			t.Fatalf("decode error envelope: %v", err)
		}
		if apiErr.Error.Code != notes.CodePayloadTooLarge {
			t.Fatalf("unexpected error code %q", apiErr.Error.Code)
		}
	})
}
