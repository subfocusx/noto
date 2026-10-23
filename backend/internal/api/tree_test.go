package api_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

// treeAnswer is the answer of the tree endpoint.
type treeAnswer struct {
	Folders []struct {
		Path        string `json:"path"`
		NoteCount   int    `json:"noteCount"`
		FolderCount int    `json:"folderCount"`
	} `json:"folders"`
	Files []struct {
		Path string `json:"path"`
	} `json:"files"`
	NoteTotal   int `json:"noteTotal"`
	FolderTotal int `json:"folderTotal"`
}

// folderCountOf returns the counters of a folder of the answer.
func folderCountOf(t *testing.T, tree treeAnswer, path string) (int, int) {
	t.Helper()
	for _, f := range tree.Folders {
		if f.Path == path {
			return f.NoteCount, f.FolderCount
		}
	}
	t.Fatalf("the folder %q is not in the answer: %+v", path, tree.Folders)
	return 0, 0
}

// TestTreeReportsTheCounters makes sure that every folder of the tree reports
// the number of the notes below it and the number of its direct subfolders.
func TestTreeReportsTheCounters(t *testing.T) {
	ts, _ := newServer(t)

	// A folder with two notes, a subfolder with one note and an empty
	// folder.
	for _, folder := range []struct{ parent, name string }{
		{"", "Docs"},
		{"Docs", "Sub"},
		{"", "Empty"},
	} {
		body := `{"parentPath":"` + folder.parent + `","name":"` + folder.name + `"}`
		res := postJSON(t, ts.URL+"/api/folders", body, nil)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("unexpected status of the folder creation: %d", res.StatusCode)
		}
	}
	for _, file := range []string{`{"parentPath":"Docs","name":"a.md"}`, `{"parentPath":"Docs","name":"b.md"}`, `{"parentPath":"Docs/Sub","name":"c.md"}`} {
		res := postJSON(t, ts.URL+"/api/files", file, nil)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("unexpected status of the file creation: %d", res.StatusCode)
		}
	}

	var tree treeAnswer
	res := getJSON(t, ts.URL+"/api/tree", &tree)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	if tree.NoteTotal != 3 {
		t.Fatalf("unexpected number of the notes: %d", tree.NoteTotal)
	}
	if tree.FolderTotal != 3 {
		t.Fatalf("unexpected number of the folders: %d", tree.FolderTotal)
	}
	if len(tree.Files) != 3 {
		t.Fatalf("unexpected number of the files: %d", len(tree.Files))
	}

	// The parent folder counts the notes of its subfolder.
	notes, folders := folderCountOf(t, tree, "Docs")
	if notes != 3 || folders != 1 {
		t.Fatalf("unexpected counters of the folder Docs: notes=%d folders=%d", notes, folders)
	}
	notes, folders = folderCountOf(t, tree, "Docs/Sub")
	if notes != 1 || folders != 0 {
		t.Fatalf("unexpected counters of the folder Docs/Sub: notes=%d folders=%d", notes, folders)
	}
	notes, folders = folderCountOf(t, tree, "Empty")
	if notes != 0 || folders != 0 {
		t.Fatalf("unexpected counters of the empty folder: notes=%d folders=%d", notes, folders)
	}
}

// TestTreeOfAnEmptyVault makes sure that the counters of an empty vault are
// zero and that the lists are not null.
func TestTreeOfAnEmptyVault(t *testing.T) {
	ts, _ := newServer(t)

	var raw map[string]json.RawMessage
	res := getJSON(t, ts.URL+"/api/tree", &raw)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	var tree treeAnswer
	body, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := json.Unmarshal(body, &tree); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if tree.NoteTotal != 0 || tree.FolderTotal != 0 {
		t.Fatalf("unexpected counters of an empty vault: %+v", tree)
	}
	if len(tree.Folders) != 0 || len(tree.Files) != 0 {
		t.Fatalf("the lists of an empty vault are not empty: %+v", tree)
	}
}
