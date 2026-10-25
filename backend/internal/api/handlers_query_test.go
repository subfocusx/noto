package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"noto/backend/internal/model"
)

// queryResponse is the answer of the endpoint of a query.
type queryResponse struct {
	Hits    []model.SearchHit `json:"hits"`
	Total   int               `json:"total"`
	Partial bool              `json:"partial"`
}

// TestQueryEndpoint checks the behaviour of POST /api/query.
func TestQueryEndpoint(t *testing.T) {
	t.Run("a query that matches a note answers with the note", func(t *testing.T) {
		ts, _ := newContractServer(t)
		contractSeedFile(t, ts, "a", "# Apple\\n\\n#pineapple")

		res := contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/query",
			`{"query":"tag == 'pineapple'","limit":10}`))
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			data, _ := io.ReadAll(res.Body)
			t.Fatalf("unexpected status %d: %s", res.StatusCode, data)
		}
		var out queryResponse
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			t.Fatalf("decode the answer: %v", err)
		}
		if out.Total != 1 {
			t.Fatalf("unexpected total %d: %+v", out.Total, out.Hits)
		}
		if len(out.Hits) != 1 || out.Hits[0].Path != "a.md" {
			t.Fatalf("unexpected hits %+v", out.Hits)
		}
	})

	t.Run("a query that matches nothing answers with an empty list", func(t *testing.T) {
		ts, _ := newContractServer(t)
		contractSeedFile(t, ts, "a", "# Apple")

		res := contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/query",
			`{"query":"tag == 'nothing'","limit":10}`))
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("unexpected status %d", res.StatusCode)
		}
		var out queryResponse
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			t.Fatalf("decode the answer: %v", err)
		}
		if out.Total != 0 || len(out.Hits) != 0 {
			t.Fatalf("unexpected answer %+v", out)
		}
	})

	t.Run("an empty query answers with an empty list", func(t *testing.T) {
		ts, _ := newContractServer(t)
		res := contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/query", `{"query":"   "}`))
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("unexpected status %d", res.StatusCode)
		}
		var out queryResponse
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			t.Fatalf("decode the answer: %v", err)
		}
		if out.Total != 0 {
			t.Fatalf("unexpected total %d", out.Total)
		}
	})

	t.Run("a broken query is answered with 400 and the code of the error", func(t *testing.T) {
		ts, _ := newContractServer(t)
		res := contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/query",
			`{"query":"title =="}`))
		defer res.Body.Close()
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("unexpected status %d", res.StatusCode)
		}
		var apiErr model.APIError
		if err := json.NewDecoder(res.Body).Decode(&apiErr); err != nil {
			t.Fatalf("decode the error envelope: %v", err)
		}
		if apiErr.Error.Code == "" {
			t.Errorf("the error envelope has no code")
		}
		if apiErr.Error.Message == "" {
			t.Errorf("the error envelope has no message")
		}
	})

	t.Run("an unknown field is answered with 400", func(t *testing.T) {
		ts, _ := newContractServer(t)
		res := contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/query",
			`{"query":"colour == 'red'"}`))
		defer res.Body.Close()
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("unexpected status %d", res.StatusCode)
		}
	})

	t.Run("a body that is not a json is answered with 400", func(t *testing.T) {
		ts, _ := newContractServer(t)
		res := contractDo(t, contractRequest(t, ts, http.MethodPost, "/api/query", `{"query":`))
		defer res.Body.Close()
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("unexpected status %d", res.StatusCode)
		}
	})

	t.Run("another method does not run a query", func(t *testing.T) {
		ts, _ := newContractServer(t)
		res := contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/query", ""))
		defer res.Body.Close()
		// The router answers with 404 (the route exists only for POST) or
		// with 405 (the method is not allowed). Both are refusals: the query
		// is never executed.
		switch res.StatusCode {
		case http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusBadRequest:
		default:
			t.Fatalf("unexpected status %d", res.StatusCode)
		}
	})
}

// TestTagsEndpoint checks the behaviour of GET /api/tags.
func TestTagsEndpoint(t *testing.T) {
	ts, _ := newContractServer(t)
	contractSeedFile(t, ts, "a", "# Apple\\n\\n#pineapple #fruit")
	contractSeedFile(t, ts, "b", "# Banana\\n\\n#fruit")

	res := contractDo(t, contractRequest(t, ts, http.MethodGet, "/api/tags", ""))
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	var out struct {
		Tags []model.TagCount `json:"tags"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	counts := map[string]int{}
	for _, tag := range out.Tags {
		counts[tag.Tag] = tag.Count
	}
	if counts["fruit"] != 2 {
		t.Errorf("unexpected count of the tag fruit: %d", counts["fruit"])
	}
	if counts["pineapple"] != 1 {
		t.Errorf("unexpected count of the tag pineapple: %d", counts["pineapple"])
	}
}

