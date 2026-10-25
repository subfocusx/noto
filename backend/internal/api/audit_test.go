package api_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"noto/backend/internal/audit"
	"noto/backend/internal/auth"
	"noto/backend/internal/notes"
)

// contextBackground is the context of the calls of the tests.
func contextBackground() context.Context { return context.Background() }

// auditEntry is an entry of the audit log.
type auditEntry struct {
	ID     int64  `json:"id"`
	Time   string `json:"time"`
	User   string `json:"user"`
	Action string `json:"action"`
	Target string `json:"target"`
	Result string `json:"result"`
}

// readAudit reads the audit log through the API.
func readAudit(t *testing.T, env *authEnv, token, query string) []auditEntry {
	t.Helper()
	res := env.do(t, http.MethodGet, "/api/audit"+query, "", token)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("read the audit log: unexpected status %d: %s", res.StatusCode, body)
	}
	var obj struct {
		Entries []auditEntry `json:"entries"`
	}
	if err := json.NewDecoder(res.Body).Decode(&obj); err != nil {
		t.Fatalf("decode the audit log: %v", err)
	}
	return obj.Entries
}

// TestTheAuditLogRecordsTheWrites makes sure that every write operation of
// the notes is recorded.
func TestTheAuditLogRecordsTheWrites(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodPost, "/api/files", `{"parentPath":"","name":"a"}`, "")
	res.Body.Close()
	res = env.do(t, http.MethodPut, "/api/notes",
		`{"path":"a.md","content":"the secret content","revision":0}`, "")
	res.Body.Close()
	res = env.do(t, http.MethodPost, "/api/notes/rename", `{"path":"a.md","newName":"b.md"}`, "")
	res.Body.Close()
	res = env.do(t, http.MethodDelete, "/api/notes?path=b.md", "", "")
	res.Body.Close()

	entries := readAudit(t, env, "", "")
	if len(entries) < 4 {
		t.Fatalf("unexpected number of the entries: %d: %+v", len(entries), entries)
	}
	found := map[string]bool{}
	for _, e := range entries {
		found[e.Action] = true
		if e.User != "local" {
			t.Errorf("unexpected user: %q", e.User)
		}
		if e.Result != audit.ResultOK {
			t.Errorf("unexpected result of %q: %q", e.Action, e.Result)
		}
	}
	for _, action := range []string{
		audit.ActionFileCreated,
		audit.ActionNoteUpdated,
		audit.ActionNoteRenamed,
		audit.ActionNoteDeleted,
	} {
		if !found[action] {
			t.Errorf("the action %q is not recorded: %+v", action, entries)
		}
	}
}

// TestTheAuditLogNeverHoldsTheContent makes sure that the log only holds the
// identifiers of the notes.
func TestTheAuditLogNeverHoldsTheContent(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodPut, "/api/notes",
		`{"path":"a.md","content":"the secret content","revision":0}`, "")
	res.Body.Close()

	res = env.do(t, http.MethodGet, "/api/audit", "", "")
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if strings.Contains(string(body), "the secret content") {
		t.Fatalf("the audit log holds the content of the note: %s", body)
	}
}

// TestTheAuditLogIsFiltered makes sure that the filters of the route work.
func TestTheAuditLogIsFiltered(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodPost, "/api/files", `{"parentPath":"","name":"a"}`, "")
	res.Body.Close()
	res = env.do(t, http.MethodPut, "/api/notes", `{"path":"a.md","content":"x","revision":0}`, "")
	res.Body.Close()

	entries := readAudit(t, env, "", "?action="+audit.ActionNoteUpdated)
	if len(entries) != 1 {
		t.Fatalf("unexpected number of the entries: %d", len(entries))
	}
	if entries[0].Action != audit.ActionNoteUpdated {
		t.Fatalf("unexpected entry: %+v", entries[0])
	}

	entries = readAudit(t, env, "", "?action="+audit.ActionNoteDeleted)
	if len(entries) != 0 {
		t.Fatalf("the filter is not applied: %+v", entries)
	}
}

// TestTheAuditLogIsClosedToThePlainUser makes sure that only an
// administrator reads the audit log.
func TestTheAuditLogIsClosedToThePlainUser(t *testing.T) {
	env := newAuthEnv(t, true)
	if _, err := env.auth.CreateUser(contextBackground(), "alice", "secret", auth.RoleUser); err != nil {
		t.Fatalf("create the user: %v", err)
	}
	token := env.login(t, "alice", "secret")

	res := env.do(t, http.MethodGet, "/api/audit", "", token)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	if code := errorCode(t, res); code != notes.CodeForbidden {
		t.Fatalf("unexpected error code %q", code)
	}
}
