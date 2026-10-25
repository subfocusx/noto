package api_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// mcpAnswer is the answer of the Model Context Protocol.
type mcpAnswer struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// TestTheMCPHandshake makes sure that the route of the protocol answers the
// handshake.
func TestTheMCPHandshake(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodPost, "/api/mcp",
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`, "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	var answer mcpAnswer
	if err := json.NewDecoder(res.Body).Decode(&answer); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	if answer.JSONRPC != "2.0" {
		t.Fatalf("unexpected version: %q", answer.JSONRPC)
	}
	if answer.Error != nil {
		t.Fatalf("unexpected error: %+v", answer.Error)
	}
	if !strings.Contains(string(answer.Result), "protocolVersion") {
		t.Fatalf("unexpected result: %s", answer.Result)
	}
}

// TestTheMCPToolCall makes sure that a tool of the notes can be called
// through the route.
func TestTheMCPToolCall(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodPost, "/api/files", `{"parentPath":"","name":"a"}`, "")
	res.Body.Close()
	res = env.do(t, http.MethodPut, "/api/notes", `{"path":"a.md","content":"hello","revision":0}`, "")
	res.Body.Close()

	res = env.do(t, http.MethodPost, "/api/mcp",
		`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes.read","arguments":{"path":"a.md"}}}`, "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	var answer mcpAnswer
	if err := json.NewDecoder(res.Body).Decode(&answer); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	if answer.Error != nil {
		t.Fatalf("unexpected error: %+v", answer.Error)
	}
	if !strings.Contains(string(answer.Result), "hello") {
		t.Fatalf("unexpected result: %s", answer.Result)
	}
}

// TestTheMCPUnknownMethod makes sure that an unknown method answers with the
// error of the protocol.
func TestTheMCPUnknownMethod(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodPost, "/api/mcp",
		`{"jsonrpc":"2.0","id":3,"method":"notes/explode"}`, "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	var answer mcpAnswer
	if err := json.NewDecoder(res.Body).Decode(&answer); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	if answer.Error == nil {
		t.Fatalf("the answer has no error")
	}
	if answer.Error.Code != -32601 {
		t.Fatalf("unexpected error code: %d", answer.Error.Code)
	}
}

// TestTheMCPNeedsTheCredentials makes sure that the route of the protocol is
// protected.
func TestTheMCPNeedsTheCredentials(t *testing.T) {
	env := newAuthEnv(t, true)

	res := env.do(t, http.MethodPost, "/api/mcp",
		`{"jsonrpc":"2.0","id":4,"method":"initialize"}`, "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
}
