package api_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"noto/backend/internal/model"
)

// The paged listing of the tree: the interface asks for one page of the
// children of a folder and follows the cursor of the answer.
func TestTheChildrenOfAFolderAreListedPageByPage(t *testing.T) {
	ts, _ := newServer(t)

	// A folder with three notes.
	res, err := http.Post(ts.URL+"/api/folders", "application/json", strings.NewReader(`{"parentPath":"","name":"Journal"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	for _, name := range []string{"a.md", "b.md", "c.md"} {
		res, err := http.Post(ts.URL+"/api/files", "application/json", strings.NewReader(`{"parentPath":"Journal","name":"`+name+`"}`))
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("unexpected status %d for %s", res.StatusCode, name)
		}
	}

	first := getChildren(t, ts.URL+"/api/tree/children?parent=Journal&limit=2", http.StatusOK)
	if len(first.Items) != 2 {
		t.Fatalf("the first page holds %d items, want 2", len(first.Items))
	}
	if first.NextCursor == "" {
		t.Fatal("the first page must carry the cursor of the next one")
	}

	second := getChildren(t, ts.URL+"/api/tree/children?parent=Journal&limit=2&cursor="+first.NextCursor, http.StatusOK)
	if len(second.Items) != 1 {
		t.Fatalf("the last page holds %d items, want 1", len(second.Items))
	}
	if second.NextCursor != "" {
		t.Fatalf("the last page must not carry a cursor, got %q", second.NextCursor)
	}
}

// A limit that is not a number is refused with the code of the contract.
func TestTheLimitOfThePageMustBeANumber(t *testing.T) {
	ts, _ := newServer(t)

	res, err := http.Get(ts.URL + "/api/tree/children?limit=abc")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("the status is %d, want %d", res.StatusCode, http.StatusBadRequest)
	}
	if body := errorEnvelope(t, res); body.Code != "bad_request" {
		t.Fatalf("the code is %q, want %q", body.Code, "bad_request")
	}
}

// The page of a folder that does not exist is empty: the tree of a folder
// that is not there holds nothing.
func TestThePageOfAMissingFolderIsEmpty(t *testing.T) {
	ts, _ := newServer(t)

	page := getChildren(t, ts.URL+"/api/tree/children?parent=nope", http.StatusOK)
	if len(page.Items) != 0 {
		t.Fatalf("the page holds %d items, want 0", len(page.Items))
	}
	if page.NextCursor != "" {
		t.Fatalf("an empty page must not carry a cursor, got %q", page.NextCursor)
	}
}

// getChildren reads one page of the children of a folder.
func getChildren(t *testing.T, url string, wantStatus int) model.NodePage {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != wantStatus {
		t.Fatalf("the status of %s is %d, want %d", url, res.StatusCode, wantStatus)
	}
	var page model.NodePage
	if err := json.NewDecoder(res.Body).Decode(&page); err != nil {
		t.Fatalf("cannot decode the page: %v", err)
	}
	return page
}
