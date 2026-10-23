// Command smoke runs the complete Noto REST API smoke test.
//
// It builds the real server binary, starts it against a throwaway data
// directory, exercises every endpoint of docs/CONTRACT.md and prints a
// PASS/FAIL line for every single check.
//
// Usage (from the backend directory):
//
//	go run ./cmd/smoke
package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// ---------------------------------------------------------------- reporting --

type checkResult struct {
	name   string
	ok     bool
	detail string
}

var results []checkResult

func record(name string, ok bool, detail string) {
	results = append(results, checkResult{name: name, ok: ok, detail: detail})
	mark := "PASS"
	if !ok {
		mark = "FAIL"
	}
	fmt.Printf("[%s] %-4s %s\n", mark, name, detail)
}

// ------------------------------------------------------------------- models --

type apiError struct {
	Code    string       `json:"code"`
	Message string       `json:"message"`
	Current *noteContent `json:"current"`
}

type errorEnvelope struct {
	Error apiError `json:"error"`
}

type noteContent struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Revision int64  `json:"revision"`
}

type node struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Path       string `json:"path"`
	Type       string `json:"type"`
	ParentPath string `json:"parentPath"`
	Revision   int64  `json:"revision"`
}

type treeResponse struct {
	Folders []node `json:"folders"`
	Files   []node `json:"files"`
}

type searchResponse struct {
	Hits []struct {
		Path string `json:"path"`
		Name string `json:"name"`
		Kind string `json:"kind"`
	} `json:"hits"`
}

type trashResponse struct {
	Entries []node `json:"entries"`
}

type attachment struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	MIME string `json:"mime"`
}

// ------------------------------------------------------------- http helpers --

type httpResp struct {
	status int
	header http.Header
	body   []byte
}

func (r *httpResp) json() []byte { return r.body }

func (r *httpResp) truncated() string {
	s := strings.TrimSpace(string(r.body))
	if len(s) > 400 {
		return s[:400] + "..."
	}
	return s
}

var httpClient = &http.Client{
	Timeout: 30 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// request performs a single HTTP request against the smoke server.
func request(method, url string, body []byte, headers map[string]string) (*httpResp, error) {
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, url, rdr)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		if strings.EqualFold(k, "Host") {
			req.Host = v
			continue
		}
		req.Header.Set(k, v)
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	return &httpResp{status: res.StatusCode, header: res.Header, body: data}, nil
}

func jsonBody(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func decode(r *httpResp, v any) error {
	return json.Unmarshal(r.body, v)
}

func errorCode(r *httpResp) string {
	var env errorEnvelope
	if err := decode(r, &env); err != nil {
		return ""
	}
	return env.Error.Code
}

func errorMessage(r *httpResp) string {
	var env errorEnvelope
	if err := decode(r, &env); err != nil {
		return ""
	}
	return env.Error.Message
}

// multipartBody builds a multipart/form-data body. The files map is a list of
// (field, filename, content) triples.
type filePart struct {
	field    string
	filename string
	content  []byte
}

func multipartBody(fields map[string]string, files []filePart) ([]byte, string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			return nil, "", err
		}
	}
	for _, f := range files {
		part, err := w.CreateFormFile(f.field, f.filename)
		if err != nil {
			return nil, "", err
		}
		if _, err := part.Write(f.content); err != nil {
			return nil, "", err
		}
	}
	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), w.FormDataContentType(), nil
}

// ------------------------------------------------------------------ helpers --

func treeHas(t treeResponse, path string) bool {
	for _, n := range t.Folders {
		if n.Path == path {
			return true
		}
	}
	for _, n := range t.Files {
		if n.Path == path {
			return true
		}
	}
	return false
}

func treePaths(t treeResponse) []string {
	var out []string
	for _, n := range t.Folders {
		out = append(out, n.Path)
	}
	for _, n := range t.Files {
		out = append(out, n.Path)
	}
	sort.Strings(out)
	return out
}

func hitHas(s searchResponse, path string) bool {
	for _, h := range s.Hits {
		if h.Path == path {
			return true
		}
	}
	return false
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// findBackendDir walks up from the working directory until it finds the
// go.mod of the backend module.
func findBackendDir() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("cannot find the backend module (no go.mod above %s)", dir)
}

func goBinary() string {
	candidates := []string{
		filepath.Join(runtime.GOROOT(), "bin", "go.exe"),
		filepath.Join(runtime.GOROOT(), "bin", "go"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	if p, err := exec.LookPath("go"); err == nil {
		return p
	}
	return ""
}

// --------------------------------------------------------------- smoke state --

type smoke struct {
	base    string
	dataDir string
	notes   string
	dbPath  string
	server  *exec.Cmd
	logBuf  *bytes.Buffer
}

func (s *smoke) url(path string) string { return s.base + path }

// --------------------------------------------------------------------- main --

func main() {
	code := run()
	os.Exit(code)
}

func run() int {
	fmt.Println("== Noto backend smoke test ==")

	backendDir, err := findBackendDir()
	if err != nil {
		fmt.Println("FATAL:", err)
		return 1
	}

	dataDir, err := os.MkdirTemp("", "noto-smoke-*")
	if err != nil {
		fmt.Println("FATAL: cannot create the temporary data directory:", err)
		return 1
	}
	defer os.RemoveAll(dataDir)

	port, err := freePort()
	if err != nil {
		fmt.Println("FATAL: cannot find a free port:", err)
		return 1
	}

	goBin := goBinary()
	if goBin == "" {
		fmt.Println("FATAL: cannot find the go tool")
		return 1
	}

	serverBin := filepath.Join(dataDir, "noto-server.exe")
	if runtime.GOOS != "windows" {
		serverBin = filepath.Join(dataDir, "noto-server")
	}
	build := exec.Command(goBin, "build", "-o", serverBin, "./cmd/noto")
	build.Dir = backendDir
	build.Stdout = os.Stderr
	build.Stderr = os.Stderr
	fmt.Printf("building the server: %s build -o %s ./cmd/noto\n", goBin, serverBin)
	if err := build.Run(); err != nil {
		fmt.Println("FATAL: cannot build the server:", err)
		return 1
	}

	sm := &smoke{
		base:    fmt.Sprintf("http://127.0.0.1:%d", port),
		dataDir: dataDir,
		notes:   filepath.Join(dataDir, "notes"),
		dbPath:  filepath.Join(dataDir, "noto.db"),
		logBuf:  &bytes.Buffer{},
	}
	defer sm.stop()

	if err := sm.start(serverBin, port); err != nil {
		fmt.Println("FATAL: cannot start the server:", err)
		fmt.Println("server output:\n" + sm.logBuf.String())
		return 1
	}
	if err := sm.waitHealthy(45 * time.Second); err != nil {
		fmt.Println("FATAL: the server did not become healthy:", err)
		fmt.Println("server output:\n" + sm.logBuf.String())
		return 1
	}
	fmt.Printf("server is healthy at %s (data dir %s)\n\n", sm.base, dataDir)

	sm.runChecks()
	sm.checkLoopbackGuard(serverBin)

	// ------------------------------------------------------------- summary --
	fails := 0
	for _, r := range results {
		if !r.ok {
			fails++
		}
	}
	fmt.Println()
	fmt.Println("== Summary ==")
	fmt.Printf("PASS %d / FAIL %d\n", len(results)-fails, fails)
	if fails > 0 {
		fmt.Println()
		fmt.Println("Failed checks:")
		for _, r := range results {
			if r.ok {
				continue
			}
			fmt.Printf("  - %s: %s\n", r.name, r.detail)
		}
	}
	fmt.Println()
	fmt.Println("Server log (last 4000 bytes):")
	log := sm.logBuf.String()
	if len(log) > 4000 {
		log = log[len(log)-4000:]
	}
	fmt.Println(log)
	if fails > 0 {
		return 1
	}
	return 0
}

func (s *smoke) start(serverBin string, port int) error {
	cmd := exec.Command(serverBin)
	cmd.Env = append(os.Environ(),
		"NOTO_ADDR=127.0.0.1:"+fmt.Sprint(port),
		"NOTO_DATA_DIR="+s.dataDir,
		"NOTO_ALLOW_PUBLIC=false",
		"NOTO_STATIC_DIR=",
		"NOTO_LOG_LEVEL=info",
		"NOTO_MAX_UPLOAD_MB=2",
	)
	cmd.Stdout = s.logBuf
	cmd.Stderr = s.logBuf
	if err := cmd.Start(); err != nil {
		return err
	}
	s.server = cmd
	return nil
}

func (s *smoke) stop() {
	if s.server == nil || s.server.Process == nil {
		return
	}
	_ = s.server.Process.Kill()
	_, _ = s.server.Process.Wait()
}

func (s *smoke) waitHealthy(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var last error
	for time.Now().Before(deadline) {
		r, err := request(http.MethodGet, s.url("/api/health"), nil, nil)
		if err == nil {
			if r.status == http.StatusOK {
				return nil
			}
			last = fmt.Errorf("health returned status %d: %s", r.status, r.truncated())
		} else {
			last = err
		}
		time.Sleep(200 * time.Millisecond)
	}
	if last == nil {
		last = fmt.Errorf("timeout")
	}
	return last
}

// ---------------------------------------------------------------- the checks --

func (s *smoke) runChecks() {
	const noteContentText = "# Hello\n\nПривет мир\n"

	// 1 -------------------------------------------------------------- health
	r, err := request(http.MethodGet, s.url("/api/health"), nil, nil)
	if err != nil {
		record("health", false, "request failed: "+err.Error())
		return
	}
	var health struct {
		Status  string `json:"status"`
		Version string `json:"version"`
	}
	if r.status != http.StatusOK {
		record("health", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
	} else if err := decode(r, &health); err != nil {
		record("health", false, "invalid JSON: "+err.Error())
	} else if health.Status != "ok" {
		record("health", false, fmt.Sprintf("status field = %q, want %q", health.Status, "ok"))
	} else {
		record("health", true, fmt.Sprintf("200 status=ok version=%s", health.Version))
	}

	// 2 -------------------------------------------------------- create folder
	r, err = request(http.MethodPost, s.url("/api/folders"),
		jsonBody(map[string]string{"parentPath": "", "name": "Journal"}),
		map[string]string{"Content-Type": "application/json"})
	if err != nil {
		record("create-folder", false, "request failed: "+err.Error())
	} else {
		var n node
		derr := decode(r, &n)
		switch {
		case r.status != http.StatusOK:
			record("create-folder", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case derr != nil:
			record("create-folder", false, "invalid JSON: "+derr.Error())
		case n.Type != "folder":
			record("create-folder", false, fmt.Sprintf("type = %q, want %q", n.Type, "folder"))
		case n.Path != "Journal":
			record("create-folder", false, fmt.Sprintf("path = %q, want %q", n.Path, "Journal"))
		default:
			record("create-folder", true, fmt.Sprintf("200 folder path=%s", n.Path))
		}
	}

	// 3 --------------------------------------------------------- create file
	r, err = request(http.MethodPost, s.url("/api/files"),
		jsonBody(map[string]string{"parentPath": "Journal", "name": "day1.md"}),
		map[string]string{"Content-Type": "application/json"})
	if err != nil {
		record("create-file", false, "request failed: "+err.Error())
	} else {
		var n node
		derr := decode(r, &n)
		switch {
		case r.status != http.StatusOK:
			record("create-file", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case derr != nil:
			record("create-file", false, "invalid JSON: "+derr.Error())
		case n.Path != "Journal/day1.md" || n.Type != "file":
			record("create-file", false, fmt.Sprintf("path=%q type=%q, want path=Journal/day1.md type=file", n.Path, n.Type))
		default:
			record("create-file", true, fmt.Sprintf("200 file path=%s", n.Path))
		}
	}

	// 4 ------------------------------------------------------ read empty note
	var revision int64
	r, err = request(http.MethodGet, s.url("/api/notes?path=Journal%2Fday1.md"), nil, nil)
	if err != nil {
		record("read-empty-note", false, "request failed: "+err.Error())
	} else {
		var nc noteContent
		derr := decode(r, &nc)
		switch {
		case r.status != http.StatusOK:
			record("read-empty-note", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case derr != nil:
			record("read-empty-note", false, "invalid JSON: "+derr.Error())
		case nc.Content != "":
			record("read-empty-note", false, fmt.Sprintf("content = %q, want empty", nc.Content))
		case nc.Revision < 1:
			record("read-empty-note", false, fmt.Sprintf("revision = %d, want >= 1", nc.Revision))
		default:
			revision = nc.Revision
			record("read-empty-note", true, fmt.Sprintf("200 empty content revision=%d", nc.Revision))
		}
	}

	// 5 ------------------------------------------------------------ write note
	r, err = request(http.MethodPut, s.url("/api/notes"),
		jsonBody(map[string]any{"path": "Journal/day1.md", "content": noteContentText, "revision": revision}),
		map[string]string{"Content-Type": "application/json"})
	if err != nil {
		record("write-note", false, "request failed: "+err.Error())
	} else {
		var res struct {
			Path     string `json:"path"`
			Revision int64  `json:"revision"`
		}
		derr := decode(r, &res)
		switch {
		case r.status != http.StatusOK:
			record("write-note", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case derr != nil:
			record("write-note", false, "invalid JSON: "+derr.Error())
		case res.Revision <= revision:
			record("write-note", false, fmt.Sprintf("revision = %d, want > %d", res.Revision, revision))
		default:
			record("write-note", true, fmt.Sprintf("200 revision %d -> %d", revision, res.Revision))
		}
	}

	// 6 --------------------------------------------------- content round trip
	r, err = request(http.MethodGet, s.url("/api/notes?path=Journal%2Fday1.md"), nil, nil)
	if err != nil {
		record("content-roundtrip", false, "request failed: "+err.Error())
	} else {
		var nc noteContent
		derr := decode(r, &nc)
		switch {
		case r.status != http.StatusOK:
			record("content-roundtrip", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case derr != nil:
			record("content-roundtrip", false, "invalid JSON: "+derr.Error())
		case nc.Content != noteContentText:
			record("content-roundtrip", false, fmt.Sprintf("content = %q, want %q", nc.Content, noteContentText))
		case !strings.Contains(nc.Content, "Привет"):
			record("content-roundtrip", false, "the Cyrillic text is missing")
		default:
			record("content-roundtrip", true, "200 content matches exactly (including the Cyrillic text)")
		}
	}

	// 7 ------------------------------------------------------ revision conflict
	r, err = request(http.MethodPut, s.url("/api/notes"),
		jsonBody(map[string]any{"path": "Journal/day1.md", "content": "stale write\n", "revision": revision}),
		map[string]string{"Content-Type": "application/json"})
	if err != nil {
		record("revision-conflict", false, "request failed: "+err.Error())
	} else {
		var env errorEnvelope
		derr := decode(r, &env)
		switch {
		case r.status != http.StatusConflict:
			record("revision-conflict", false, fmt.Sprintf("status %d (want 409) body %s", r.status, r.truncated()))
		case derr != nil:
			record("revision-conflict", false, "invalid JSON: "+derr.Error())
		case env.Error.Code != "revision_conflict":
			record("revision-conflict", false, fmt.Sprintf("error.code = %q, want %q", env.Error.Code, "revision_conflict"))
		case env.Error.Current == nil:
			record("revision-conflict", false, "error.current is missing")
		default:
			record("revision-conflict", true, fmt.Sprintf("409 revision_conflict, current revision=%d", env.Error.Current.Revision))
		}
	}

	// 8 ---------------------------------------------------------------- tree
	tree := s.fetchTree()
	if tree == nil {
		record("tree", false, "cannot read the tree")
	} else if !treeHas(*tree, "Journal") {
		record("tree", false, "the folder Journal is missing from the tree")
	} else if !treeHas(*tree, "Journal/day1.md") {
		record("tree", false, "the file Journal/day1.md is missing from the tree")
	} else {
		record("tree", true, fmt.Sprintf("200 %d folders, %d files", len(tree.Folders), len(tree.Files)))
	}

	// 9 --------------------------------------------------------------- search
	for _, q := range []string{"Привет", "Hello"} {
		r, err = request(http.MethodGet, s.url("/api/search?q="+urlEscape(q)), nil, nil)
		name := "search-" + q
		if err != nil {
			record(name, false, "request failed: "+err.Error())
			continue
		}
		var sr searchResponse
		derr := decode(r, &sr)
		switch {
		case r.status != http.StatusOK:
			record(name, false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case derr != nil:
			record(name, false, "invalid JSON: "+derr.Error())
		case !hitHas(sr, "Journal/day1.md"):
			record(name, false, fmt.Sprintf("no hit for Journal/day1.md, hits=%s", r.truncated()))
		default:
			record(name, true, fmt.Sprintf("200 %d hits, Journal/day1.md found", len(sr.Hits)))
		}
	}

	// 10 --------------------------------------------------------------- rename
	r, err = request(http.MethodPost, s.url("/api/notes/rename"),
		jsonBody(map[string]string{"path": "Journal/day1.md", "newName": "day2.md"}),
		map[string]string{"Content-Type": "application/json"})
	if err != nil {
		record("rename", false, "request failed: "+err.Error())
	} else {
		var n node
		derr := decode(r, &n)
		switch {
		case r.status != http.StatusOK:
			record("rename", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case derr != nil:
			record("rename", false, "invalid JSON: "+derr.Error())
		case n.Path != "Journal/day2.md":
			record("rename", false, fmt.Sprintf("path = %q, want %q", n.Path, "Journal/day2.md"))
		default:
			tree = s.fetchTree()
			if tree == nil {
				record("rename", false, "cannot read the tree after the rename")
			} else if treeHas(*tree, "Journal/day1.md") {
				record("rename", false, "the old path Journal/day1.md is still in the tree")
			} else {
				record("rename", true, "200 renamed to Journal/day2.md, the old path is gone")
			}
		}
	}

	// 11 ---------------------------------------------------------------- move
	r, err = request(http.MethodPost, s.url("/api/notes/move"),
		jsonBody(map[string]string{"path": "Journal/day2.md", "newParentPath": ""}),
		map[string]string{"Content-Type": "application/json"})
	if err != nil {
		record("move", false, "request failed: "+err.Error())
	} else {
		var n node
		derr := decode(r, &n)
		switch {
		case r.status != http.StatusOK:
			record("move", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case derr != nil:
			record("move", false, "invalid JSON: "+derr.Error())
		case n.Path != "day2.md":
			record("move", false, fmt.Sprintf("path = %q, want %q", n.Path, "day2.md"))
		default:
			tree = s.fetchTree()
			if tree == nil || !treeHas(*tree, "day2.md") {
				record("move", false, "the file day2.md is not at the root of the tree")
			} else {
				record("move", true, "200 the file is at the root (day2.md)")
			}
		}
	}

	// 12 ------------------------------------------------------ delete / trash
	r, err = request(http.MethodDelete, s.url("/api/notes?path=day2.md"), nil, nil)
	if err != nil {
		record("delete", false, "request failed: "+err.Error())
	} else {
		switch {
		case r.status != http.StatusOK:
			record("delete", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		default:
			tree = s.fetchTree()
			if tree == nil || treeHas(*tree, "day2.md") {
				record("delete", false, "the file day2.md is still in the tree")
			} else {
				record("delete", true, "200 the file is gone from the tree")
			}
		}
	}

	trashPath := ""
	r, err = request(http.MethodGet, s.url("/api/trash"), nil, nil)
	if err != nil {
		record("trash-list", false, "request failed: "+err.Error())
	} else {
		var tr trashResponse
		derr := decode(r, &tr)
		switch {
		case r.status != http.StatusOK:
			record("trash-list", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case derr != nil:
			record("trash-list", false, "invalid JSON: "+derr.Error())
		case len(tr.Entries) != 1:
			record("trash-list", false, fmt.Sprintf("%d entries, want exactly 1: %s", len(tr.Entries), r.truncated()))
		default:
			trashPath = tr.Entries[0].Path
			record("trash-list", true, fmt.Sprintf("200 one entry: %s", trashPath))
		}
	}

	if trashPath == "" {
		record("restore", false, "no trash entry to restore")
	} else {
		r, err = request(http.MethodPost, s.url("/api/notes/restore"),
			jsonBody(map[string]string{"trashPath": trashPath}),
			map[string]string{"Content-Type": "application/json"})
		if err != nil {
			record("restore", false, "request failed: "+err.Error())
		} else {
			var n node
			derr := decode(r, &n)
			switch {
			case r.status != http.StatusOK:
				record("restore", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
			case derr != nil:
				record("restore", false, "invalid JSON: "+derr.Error())
			default:
				tree = s.fetchTree()
				if tree == nil || !treeHas(*tree, "day2.md") {
					record("restore", false, "the file day2.md is not in the tree after the restore")
				} else {
					record("restore", true, "200 the file is back in the tree")
				}
			}
		}
	}

	// 13 -------------------------------------------------------- path traversal
	traversals := []struct {
		name   string
		method string
		url    string
		body   []byte
	}{
		{"traversal-get-relative", http.MethodGet, s.url("/api/notes?path=..%2F..%2Fetc%2Fpasswd"), nil},
		{"traversal-get-absolute", http.MethodGet, s.url("/api/notes?path=%2Fetc%2Fpasswd"), nil},
		{"traversal-put", http.MethodPut, s.url("/api/notes"),
			jsonBody(map[string]any{"path": "../evil.md", "content": "x", "revision": 0})},
	}
	for _, t := range traversals {
		hdr := map[string]string{"Content-Type": "application/json"}
		r, err = request(t.method, t.url, t.body, hdr)
		if err != nil {
			record(t.name, false, "request failed: "+err.Error())
			continue
		}
		if r.status < 400 || r.status > 499 {
			record(t.name, false, fmt.Sprintf("status %d (want 4xx) body %s", r.status, r.truncated()))
		} else {
			record(t.name, true, fmt.Sprintf("%d %s", r.status, errorCode(r)))
		}
	}

	// 14 --------------------------------------------------------- invalid names
	for _, name := range []string{"CON.md", "bad/name.md", "a<b.md"} {
		r, err = request(http.MethodPost, s.url("/api/files"),
			jsonBody(map[string]string{"parentPath": "", "name": name}),
			map[string]string{"Content-Type": "application/json"})
		checkName := "invalid-name-" + name
		if err != nil {
			record(checkName, false, "request failed: "+err.Error())
			continue
		}
		code := errorCode(r)
		if r.status < 400 || r.status > 499 {
			record(checkName, false, fmt.Sprintf("status %d (want 4xx) body %s", r.status, r.truncated()))
		} else if code != "invalid_name" {
			record(checkName, false, fmt.Sprintf("status %d error.code = %q, want %q", r.status, code, "invalid_name"))
		} else {
			record(checkName, true, fmt.Sprintf("%d invalid_name", r.status))
		}
	}

	// 15 --------------------------------------------------------- duplicate name
	r, err = request(http.MethodPost, s.url("/api/folders"),
		jsonBody(map[string]string{"parentPath": "", "name": "Journal"}),
		map[string]string{"Content-Type": "application/json"})
	if err != nil {
		record("duplicate-name", false, "request failed: "+err.Error())
	} else {
		code := errorCode(r)
		if r.status < 400 || r.status > 499 {
			record("duplicate-name", false, fmt.Sprintf("status %d (want 4xx) body %s", r.status, r.truncated()))
		} else if code != "duplicate_name" {
			record("duplicate-name", false, fmt.Sprintf("status %d error.code = %q, want %q", r.status, code, "duplicate_name"))
		} else {
			record("duplicate-name", true, fmt.Sprintf("%d duplicate_name", r.status))
		}
	}

	// 16 ------------------------------------------------- move folder into itself
	r, err = request(http.MethodPost, s.url("/api/folders"),
		jsonBody(map[string]string{"parentPath": "Journal", "name": "Sub"}),
		map[string]string{"Content-Type": "application/json"})
	if err != nil {
		record("folder-into-descendant", false, "cannot create Journal/Sub: "+err.Error())
	} else {
		r, err = request(http.MethodPost, s.url("/api/notes/move"),
			jsonBody(map[string]string{"path": "Journal", "newParentPath": "Journal/Sub"}),
			map[string]string{"Content-Type": "application/json"})
		if err != nil {
			record("folder-into-descendant", false, "request failed: "+err.Error())
		} else {
			code := errorCode(r)
			if r.status < 400 || r.status > 499 {
				record("folder-into-descendant", false, fmt.Sprintf("status %d (want 4xx) body %s", r.status, r.truncated()))
			} else if code != "invalid_path" {
				record("folder-into-descendant", false, fmt.Sprintf("status %d error.code = %q, want %q", r.status, code, "invalid_path"))
			} else {
				record("folder-into-descendant", true, fmt.Sprintf("%d invalid_path", r.status))
			}
		}
	}

	// 17 ------------------------------------------------------- security headers
	r, err = request(http.MethodGet, s.url("/api/health"), nil, nil)
	if err != nil {
		record("security-headers", false, "request failed: "+err.Error())
	} else {
		want := []struct{ header, value string }{
			{"X-Content-Type-Options", "nosniff"},
			{"X-Frame-Options", "DENY"},
		}
		problems := []string{}
		for _, w := range want {
			if got := r.header.Get(w.header); got != w.value {
				problems = append(problems, fmt.Sprintf("%s = %q, want %q", w.header, got, w.value))
			}
		}
		csp := r.header.Get("Content-Security-Policy")
		if !strings.Contains(csp, "default-src 'self'") {
			problems = append(problems, fmt.Sprintf("Content-Security-Policy = %q, want it to contain %q", csp, "default-src 'self'"))
		}
		if len(problems) > 0 {
			record("security-headers", false, strings.Join(problems, "; "))
		} else {
			record("security-headers", true, "nosniff, DENY and the CSP are present")
		}
	}

	// 18 ----------------------------------------------------------------- CORS
	r, err = request(http.MethodGet, s.url("/api/health"), nil,
		map[string]string{"Origin": "https://evil.example"})
	if err != nil {
		record("cors", false, "request failed: "+err.Error())
	} else {
		if acao := r.header.Get("Access-Control-Allow-Origin"); acao != "" {
			record("cors", false, fmt.Sprintf("Access-Control-Allow-Origin = %q, want no such header", acao))
		} else {
			record("cors", true, "no Access-Control-Allow-Origin header for a foreign origin")
		}
	}

	// 19 ------------------------------------------------------------------ CSRF
	r, err = request(http.MethodPost, s.url("/api/folders"),
		jsonBody(map[string]string{"parentPath": "", "name": "csrf"}),
		map[string]string{"Content-Type": "application/json", "Origin": "https://evil.example"})
	if err != nil {
		record("csrf", false, "request failed: "+err.Error())
	} else {
		if r.status != http.StatusForbidden {
			record("csrf", false, fmt.Sprintf("status %d (want 403) body %s", r.status, r.truncated()))
		} else {
			record("csrf", true, "403 forbidden for a cross origin state change")
		}
	}

	// 20 ------------------------------------------------------------ host check
	r, err = request(http.MethodGet, s.url("/api/health"), nil,
		map[string]string{"Host": "evil.example"})
	if err != nil {
		record("host-validation", false, "request failed: "+err.Error())
	} else {
		if r.status < 400 || r.status > 499 {
			record("host-validation", false, fmt.Sprintf("status %d (want 4xx) body %s", r.status, r.truncated()))
		} else {
			record("host-validation", true, fmt.Sprintf("%d %s", r.status, errorCode(r)))
		}
	}

	// 21 --------------------------------------------------------------- export
	// The exported note must exist at Journal/day2.md, so it is (re)created here.
	r, err = request(http.MethodPost, s.url("/api/files"),
		jsonBody(map[string]string{"parentPath": "Journal", "name": "day2.md"}),
		map[string]string{"Content-Type": "application/json"})
	if err != nil {
		record("export-setup", false, "request failed: "+err.Error())
	} else if r.status != http.StatusOK {
		record("export-setup", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
	} else {
		r, err = request(http.MethodPut, s.url("/api/notes"),
			jsonBody(map[string]any{"path": "Journal/day2.md", "content": noteContentText, "revision": 0}),
			map[string]string{"Content-Type": "application/json"})
		if err != nil || r.status != http.StatusOK {
			record("export-setup", false, fmt.Sprintf("cannot write Journal/day2.md: %v %s", err, r.truncated()))
		} else {
			record("export-setup", true, "Journal/day2.md created with the expected content")
		}
	}

	r, err = request(http.MethodGet, s.url("/api/export/note?path=Journal%2Fday2.md"), nil, nil)
	if err != nil {
		record("export-note", false, "request failed: "+err.Error())
	} else {
		ct := r.header.Get("Content-Type")
		switch {
		case r.status != http.StatusOK:
			record("export-note", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case !strings.Contains(ct, "text/markdown"):
			record("export-note", false, fmt.Sprintf("Content-Type = %q, want text/markdown", ct))
		case string(r.body) != noteContentText:
			record("export-note", false, fmt.Sprintf("body = %q, want %q", string(r.body), noteContentText))
		default:
			record("export-note", true, "200 text/markdown with the exact content")
		}
	}

	r, err = request(http.MethodGet, s.url("/api/export/all"), nil, nil)
	if err != nil {
		record("export-all", false, "request failed: "+err.Error())
	} else {
		ct := r.header.Get("Content-Type")
		switch {
		case r.status != http.StatusOK:
			record("export-all", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case !strings.Contains(ct, "application/zip"):
			record("export-all", false, fmt.Sprintf("Content-Type = %q, want application/zip", ct))
		default:
			zr, zerr := zip.NewReader(bytes.NewReader(r.body), int64(len(r.body)))
			if zerr != nil {
				record("export-all", false, "the response is not a valid ZIP: "+zerr.Error())
			} else {
				found := ""
				for _, f := range zr.File {
					if f.Name == "Journal/day2.md" {
						found = f.Name
					}
				}
				if found == "" {
					var names []string
					for _, f := range zr.File {
						names = append(names, f.Name)
					}
					record("export-all", false, fmt.Sprintf("the ZIP does not contain Journal/day2.md, entries=%v", names))
				} else {
					record("export-all", true, "200 application/zip containing Journal/day2.md")
				}
			}
		}
	}

	// 22 --------------------------------------------------------------- import
	// A clean archive must be imported.
	goodZip := buildZip(map[string][]byte{
		"Imported/note.md": []byte("# Imported\n"),
	})
	body, ctype, mErr := multipartBody(map[string]string{"conflict": "skip"},
		[]filePart{{field: "file", filename: "good.zip", content: goodZip}})
	if mErr != nil {
		record("import-good-zip", false, "cannot build the multipart body: "+mErr.Error())
	} else {
		r, err = request(http.MethodPost, s.url("/api/import/zip"), body,
			map[string]string{"Content-Type": ctype})
		if err != nil {
			record("import-good-zip", false, "request failed: "+err.Error())
		} else if r.status != http.StatusOK {
			record("import-good-zip", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		} else {
			p := filepath.Join(s.notes, "Imported", "note.md")
			if _, err := os.Stat(p); err != nil {
				record("import-good-zip", false, "the imported note is not on disk: "+err.Error())
			} else {
				record("import-good-zip", true, "200 the archive was imported, Imported/note.md exists")
			}
		}
	}

	// A malicious archive must never write outside of the notes directory.
	evilZip := buildZip(map[string][]byte{
		"Imported/ok.md":  []byte("# ok\n"),
		"../evil.md":      []byte("evil\n"),
		"/etc/evil.md":    []byte("evil\n"),
	})
	body, ctype, mErr = multipartBody(map[string]string{"conflict": "skip"},
		[]filePart{{field: "file", filename: "evil.zip", content: evilZip}})
	evilStatus := 0
	evilBody := ""
	if mErr != nil {
		record("import-zip-traversal", false, "cannot build the multipart body: "+mErr.Error())
	} else {
		r, err = request(http.MethodPost, s.url("/api/import/zip"), body,
			map[string]string{"Content-Type": ctype})
		if err != nil {
			record("import-zip-traversal", false, "request failed: "+err.Error())
		} else {
			evilStatus = r.status
			evilBody = r.truncated()
			found, _ := findFile(s.dataDir, "evil.md")
			outside, _ := findFile(filepath.Dir(s.dataDir), "evil.md")
			switch {
			case found != "":
				record("import-zip-traversal", false, fmt.Sprintf("evil.md was written to %s", found))
			case outside != "" && !strings.HasPrefix(outside, s.dataDir):
				record("import-zip-traversal", false, fmt.Sprintf("evil.md was written outside the data dir: %s", outside))
			default:
				record("import-zip-traversal", true,
					fmt.Sprintf("no evil.md on disk (the server answered %d %s); malicious entries rejected", evilStatus, evilBody))
			}
		}
	}

	// 23 ----------------------------------------------------------- attachments
	png, _ := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
	body, ctype, mErr = multipartBody(map[string]string{},
		[]filePart{{field: "file", filename: "pixel.png", content: png}})
	if mErr != nil {
		record("attachment-upload", false, "cannot build the multipart body: "+mErr.Error())
	} else {
		r, err = request(http.MethodPost, s.url("/api/attachments"), body,
			map[string]string{"Content-Type": ctype})
		if err != nil {
			record("attachment-upload", false, "request failed: "+err.Error())
		} else {
			var att attachment
			derr := decode(r, &att)
			switch {
			case r.status != http.StatusOK:
				record("attachment-upload", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
			case derr != nil:
				record("attachment-upload", false, "invalid JSON: "+derr.Error())
			case att.ID == "":
				record("attachment-upload", false, "the attachment has no id: "+r.truncated())
			default:
				record("attachment-upload", true, fmt.Sprintf("200 id=%s mime=%s", att.ID, att.MIME))

				r, err = request(http.MethodGet, s.url("/api/attachments/"+att.ID+"/raw"), nil, nil)
				if err != nil {
					record("attachment-raw", false, "request failed: "+err.Error())
				} else {
					ct := r.header.Get("Content-Type")
					switch {
					case r.status != http.StatusOK:
						record("attachment-raw", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
					case !strings.Contains(ct, "image/png"):
						record("attachment-raw", false, fmt.Sprintf("Content-Type = %q, want image/png", ct))
					default:
						record("attachment-raw", true, "200 image/png")
					}
				}
			}
		}
	}

	body, ctype, mErr = multipartBody(map[string]string{},
		[]filePart{{field: "file", filename: "evil.exe", content: []byte("MZ\x90\x00\x03\x00\x00\x00binary")}})
	if mErr != nil {
		record("attachment-reject-exe", false, "cannot build the multipart body: "+mErr.Error())
	} else {
		r, err = request(http.MethodPost, s.url("/api/attachments"), body,
			map[string]string{"Content-Type": ctype})
		if err != nil {
			record("attachment-reject-exe", false, "request failed: "+err.Error())
		} else {
			if r.status < 400 || r.status > 499 {
				record("attachment-reject-exe", false, fmt.Sprintf("status %d (want 4xx) body %s", r.status, r.truncated()))
			} else {
				record("attachment-reject-exe", true, fmt.Sprintf("%d %s", r.status, errorCode(r)))
			}
		}
	}

	// 24 -------------------------------------------------------------- reindex
	before := s.fetchTree()
	r, err = request(http.MethodPost, s.url("/api/search/reindex"), nil, nil)
	if err != nil {
		record("reindex", false, "request failed: "+err.Error())
	} else {
		var res struct {
			Indexed int64 `json:"indexed"`
		}
		derr := decode(r, &res)
		switch {
		case r.status != http.StatusOK:
			record("reindex", false, fmt.Sprintf("status %d body %s", r.status, r.truncated()))
		case derr != nil:
			record("reindex", false, "invalid JSON: "+derr.Error())
		default:
			after := s.fetchTree()
			if before == nil || after == nil {
				record("reindex", false, "cannot read the tree")
			} else if strings.Join(treePaths(*before), "|") != strings.Join(treePaths(*after), "|") {
				record("reindex", false, fmt.Sprintf("the tree changed: before=%v after=%v", treePaths(*before), treePaths(*after)))
			} else {
				record("reindex", true, fmt.Sprintf("200 indexed=%d, the tree is unchanged", res.Indexed))
			}
		}
	}

	// 25 ------------------------------------------------------- same origin
	// A browser sends the Origin header with every state changing request.
	// The origin of the server itself must be accepted.
	r, err = request(http.MethodPost, s.url("/api/folders"),
		jsonBody(map[string]string{"parentPath": "", "name": "SameOrigin"}),
		map[string]string{"Content-Type": "application/json", "Origin": s.base})
	if err != nil {
		record("same-origin-post", false, "request failed: "+err.Error())
	} else {
		switch {
		case r.status != http.StatusOK:
			record("same-origin-post", false, fmt.Sprintf("status %d (want 200) body %s", r.status, r.truncated()))
		case r.header.Get("Access-Control-Allow-Origin") != "":
			record("same-origin-post", false, "a same origin request must not carry a CORS header")
		default:
			record("same-origin-post", true, "200 the state change of the own origin is accepted")
		}
	}

	// A foreign origin may read nothing and change nothing.
	r, err = request(http.MethodGet, s.url("/api/health"), nil,
		map[string]string{"Origin": "https://evil.example"})
	if err != nil {
		record("foreign-origin-get", false, "request failed: "+err.Error())
	} else {
		switch {
		case r.status != http.StatusOK:
			record("foreign-origin-get", false, fmt.Sprintf("status %d (want 200)", r.status))
		case r.header.Get("Access-Control-Allow-Origin") != "":
			record("foreign-origin-get", false, "a foreign origin must not receive a CORS header")
		default:
			record("foreign-origin-get", true, "200 without an Access-Control-Allow-Origin header")
		}
	}

	// 26 ------------------------------------------------- export of a missing path
	r, err = request(http.MethodGet, s.url("/api/export/folder?path=doesnotexist"), nil, nil)
	if err != nil {
		record("export-missing-folder", false, "request failed: "+err.Error())
	} else {
		switch {
		case r.status != http.StatusNotFound:
			record("export-missing-folder", false, fmt.Sprintf("status %d (want 404) body %s", r.status, r.truncated()))
		case errorCode(r) != "not_found":
			record("export-missing-folder", false, fmt.Sprintf("error.code = %q, want %q", errorCode(r), "not_found"))
		default:
			record("export-missing-folder", true, "404 not_found instead of an empty download")
		}
	}

	// 27 ------------------------------------------------------ upload body limit
	// The whole request body is limited, not only the single files.
	big := bytes.Repeat([]byte("a"), 3<<20)
	body, ctype, mErr = multipartBody(map[string]string{"conflict": "skip"},
		[]filePart{{field: "files", filename: "big.md", content: big}})
	if mErr != nil {
		record("upload-body-limit", false, "cannot build the multipart body: "+mErr.Error())
	} else {
		r, err = request(http.MethodPost, s.url("/api/import/files"), body,
			map[string]string{"Content-Type": ctype})
		if err != nil {
			record("upload-body-limit", false, "request failed: "+err.Error())
		} else {
			switch {
			case r.status != http.StatusRequestEntityTooLarge:
				record("upload-body-limit", false, fmt.Sprintf("status %d (want 413) body %s", r.status, r.truncated()))
			case errorCode(r) != "payload_too_large":
				record("upload-body-limit", false, fmt.Sprintf("error.code = %q, want %q", errorCode(r), "payload_too_large"))
			default:
				record("upload-body-limit", true, "413 payload_too_large")
			}
		}
	}

	// 28 ------------------------------------------------------- graceful shutdown
	alive := true
	r, err = request(http.MethodGet, s.url("/api/health"), nil, nil)
	if err != nil || r.status != http.StatusOK {
		alive = false
	}
	sigErr := "not attempted"
	if s.server != nil && s.server.Process != nil {
		sigErr = s.server.Process.Signal(os.Interrupt).Error()
	}
	if !alive {
		record("graceful-shutdown", false, "the server is not healthy any more")
	} else {
		record("graceful-shutdown", true,
			"the server is running and healthy; os.Interrupt could not be delivered ("+sigErr+"), see the report")
	}

	// 29 ------------------------------------------------------- files on disk
	p := filepath.Join(s.notes, "Journal", "day2.md")
	data, err := os.ReadFile(p)
	switch {
	case err != nil:
		record("files-on-disk", false, fmt.Sprintf("%s cannot be read: %v", p, err))
	case string(data) != noteContentText:
		record("files-on-disk", false, fmt.Sprintf("%s = %q, want %q", p, string(data), noteContentText))
	default:
		if _, err := os.Stat(s.dbPath); err != nil {
			record("files-on-disk", false, fmt.Sprintf("%s does not exist: %v", s.dbPath, err))
		} else {
			record("files-on-disk", true, "the note file and noto.db exist with the expected content")
		}
	}
}

// checkLoopbackGuard makes sure that the server refuses to listen on an
// address without a host: it would be reachable from the whole network.
func (s *smoke) checkLoopbackGuard(serverBin string) {
	port, err := freePort()
	if err != nil {
		record("loopback-guard", false, "cannot find a free port: "+err.Error())
		return
	}
	dataDir, err := os.MkdirTemp("", "noto-smoke-guard-*")
	if err != nil {
		record("loopback-guard", false, "cannot create a temporary data directory: "+err.Error())
		return
	}
	defer os.RemoveAll(dataDir)
	cmd := exec.Command(serverBin)
	cmd.Env = append(os.Environ(),
		"NOTO_ADDR=:"+fmt.Sprint(port),
		"NOTO_DATA_DIR="+dataDir,
		"NOTO_ALLOW_PUBLIC=false",
	)
	out, err := cmd.CombinedOutput()
	if err == nil {
		record("loopback-guard", false, "the server started with an address without a host")
		return
	}
	msg := strings.TrimSpace(string(out))
	if len(msg) > 300 {
		msg = msg[:300] + "..."
	}
	record("loopback-guard", true, "the server refused to start: "+msg)
}

// ------------------------------------------------------------------ support --

func (s *smoke) fetchTree() *treeResponse {
	r, err := request(http.MethodGet, s.url("/api/tree"), nil, nil)
	if err != nil || r.status != http.StatusOK {
		return nil
	}
	var t treeResponse
	if err := decode(r, &t); err != nil {
		return nil
	}
	return &t
}

func urlEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
			continue
		}
		fmt.Fprintf(&b, "%%%02X", c)
	}
	return b.String()
}

// buildZip creates an in-memory ZIP archive. The map key is the entry name,
// the value is the content of the entry.
func buildZip(entries map[string][]byte) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	names := make([]string, 0, len(entries))
	for name := range entries {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		w, err := zw.Create(name)
		if err != nil {
			continue
		}
		_, _ = w.Write(entries[name])
	}
	_ = zw.Close()
	return buf.Bytes()
}

// findFile walks root and returns the first path whose base name is name.
func findFile(root, name string) (string, string) {
	var found, where string
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		if strings.EqualFold(info.Name(), name) {
			if found == "" {
				found = p
			}
			if where == "" {
				where = p
			}
		}
		return nil
	})
	return found, where
}
