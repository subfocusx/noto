package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// checkImportExport covers the export, the import and the attachment
// endpoints.
func (s *smoke) checkImportExport(st *checkState) {
	// 21 --------------------------------------------------------------- export
	// The exported note must exist at Journal/day2.md, so it is (re)created here.
	r, err := request(http.MethodPost, s.url("/api/files"),
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
		"Imported/ok.md": []byte("# ok\n"),
		"../evil.md":     []byte("evil\n"),
		"/etc/evil.md":   []byte("evil\n"),
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
}

// checkExportLimits covers the error cases of the export and the size limit
// of an upload.
func (s *smoke) checkExportLimits(st *checkState) {
	// 26 ------------------------------------------------- export of a missing path
	r, err := request(http.MethodGet, s.url("/api/export/folder?path=doesnotexist"), nil, nil)
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
	body, ctype, mErr := multipartBody(map[string]string{"conflict": "skip"},
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
}
