package main

import (
	"fmt"
	"net/http"
	"strings"
)

// noteContentText is the body of the note that the checks write.
const noteContentText = "# Hello\n\nПривет мир\n"

// checkState holds the values that the checks share between each other.
type checkState struct {
	revision  int64
	tree      *treeResponse
	trashPath string
}

// ---------------------------------------------------------------- the checks --

// runChecks runs every check in the order of the contract. The checks are
// grouped by topic, but the order of the single checks never changes.
func (s *smoke) runChecks() {
	st := &checkState{}
	if !s.checkCoreNotes(st) {
		return
	}
	s.checkSecurityPaths(st)
	s.checkImportExport(st)
	s.checkOrigins(st)
	s.checkExportLimits(st)
	s.checkShutdownAndDisk(st)
}

// checkCoreNotes covers the health probe and the CRUD endpoints of a note.
func (s *smoke) checkCoreNotes(st *checkState) bool {
	// 1 -------------------------------------------------------------- health
	r, err := request(http.MethodGet, s.url("/api/health"), nil, nil)
	if err != nil {
		record("health", false, "request failed: "+err.Error())
		return false
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
			st.revision = nc.Revision
			record("read-empty-note", true, fmt.Sprintf("200 empty content revision=%d", nc.Revision))
		}
	}

	// 5 ------------------------------------------------------------ write note
	r, err = request(http.MethodPut, s.url("/api/notes"),
		jsonBody(map[string]any{"path": "Journal/day1.md", "content": noteContentText, "revision": st.revision}),
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
		case res.Revision <= st.revision:
			record("write-note", false, fmt.Sprintf("revision = %d, want > %d", res.Revision, st.revision))
		default:
			record("write-note", true, fmt.Sprintf("200 revision %d -> %d", st.revision, res.Revision))
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
		jsonBody(map[string]any{"path": "Journal/day1.md", "content": "stale write\n", "revision": st.revision}),
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
	st.tree = s.fetchTree()
	if st.tree == nil {
		record("tree", false, "cannot read the tree")
	} else if !treeHas(*st.tree, "Journal") {
		record("tree", false, "the folder Journal is missing from the tree")
	} else if !treeHas(*st.tree, "Journal/day1.md") {
		record("tree", false, "the file Journal/day1.md is missing from the tree")
	} else {
		record("tree", true, fmt.Sprintf("200 %d folders, %d files", len(st.tree.Folders), len(st.tree.Files)))
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
			st.tree = s.fetchTree()
			if st.tree == nil {
				record("rename", false, "cannot read the tree after the rename")
			} else if treeHas(*st.tree, "Journal/day1.md") {
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
			st.tree = s.fetchTree()
			if st.tree == nil || !treeHas(*st.tree, "day2.md") {
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
			st.tree = s.fetchTree()
			if st.tree == nil || treeHas(*st.tree, "day2.md") {
				record("delete", false, "the file day2.md is still in the tree")
			} else {
				record("delete", true, "200 the file is gone from the tree")
			}
		}
	}

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
			st.trashPath = tr.Entries[0].Path
			record("trash-list", true, fmt.Sprintf("200 one entry: %s", st.trashPath))
		}
	}

	if st.trashPath == "" {
		record("restore", false, "no trash entry to restore")
	} else {
		r, err = request(http.MethodPost, s.url("/api/notes/restore"),
			jsonBody(map[string]string{"trashPath": st.trashPath}),
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
				st.tree = s.fetchTree()
				if st.tree == nil || !treeHas(*st.tree, "day2.md") {
					record("restore", false, "the file day2.md is not in the tree after the restore")
				} else {
					record("restore", true, "200 the file is back in the tree")
				}
			}
		}
	}
	return true
}
