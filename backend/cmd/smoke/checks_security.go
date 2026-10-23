package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// checkSecurityPaths covers the path traversal, the name validation and the
// security headers of the server.
func (s *smoke) checkSecurityPaths(st *checkState) {
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
		r, err := request(t.method, t.url, t.body, hdr)
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
		r, err := request(http.MethodPost, s.url("/api/files"),
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
	r, err := request(http.MethodPost, s.url("/api/folders"),
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
}

// checkOrigins covers the origin rules of the browser.
func (s *smoke) checkOrigins(st *checkState) {
	// 25 ------------------------------------------------------- same origin
	// A browser sends the Origin header with every state changing request.
	// The origin of the server itself must be accepted.
	r, err := request(http.MethodPost, s.url("/api/folders"),
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
}

// checkShutdownAndDisk covers the shutdown of the server and the files that
// were written to disk.
func (s *smoke) checkShutdownAndDisk(st *checkState) {
	// 28 ------------------------------------------------------- graceful shutdown
	alive := true
	r, err := request(http.MethodGet, s.url("/api/health"), nil, nil)
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
