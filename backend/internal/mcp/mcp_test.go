package mcp_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"noto/backend/internal/mcp"
)

// fakeNotes is a notes service of the tests.
type fakeNotes struct {
	notes    []mcp.Note
	contents map[string]string
	deleted  []string
}

func (f *fakeNotes) List(context.Context) ([]mcp.Note, error) {
	return f.notes, nil
}

func (f *fakeNotes) Read(_ context.Context, path string) (mcp.Content, error) {
	content, ok := f.contents[path]
	if !ok {
		return mcp.Content{}, errNotFound
	}
	return mcp.Content{Path: path, Content: content, Revision: 1}, nil
}

func (f *fakeNotes) Create(_ context.Context, path, content string) (mcp.Note, error) {
	f.contents[path] = content
	return mcp.Note{Path: path, Name: path, Revision: 1}, nil
}

func (f *fakeNotes) Update(_ context.Context, path, content string, revision int64) (mcp.Note, error) {
	f.contents[path] = content
	return mcp.Note{Path: path, Name: path, Revision: revision + 1}, nil
}

func (f *fakeNotes) Delete(_ context.Context, path string) error {
	f.deleted = append(f.deleted, path)
	return nil
}

func (f *fakeNotes) Search(_ context.Context, query string, limit int) ([]mcp.Hit, error) {
	out := []mcp.Hit{}
	for _, n := range f.notes {
		if strings.Contains(n.Path, query) {
			out = append(out, mcp.Hit{Path: n.Path, Name: n.Name, Kind: "name"})
		}
	}
	return out, nil
}

// errNotFound is the error of the fake notes service.
var errNotFound = &mcp.Error{Code: mcp.CodeInvalidParams, Message: "the note does not exist"}

// newServer creates the server of the protocol.
func newServer() *mcp.Server {
	return mcp.New(&fakeNotes{
		notes:    []mcp.Note{{Path: "a.md", Name: "a.md", Revision: 1}},
		contents: map[string]string{"a.md": "hello"},
	})
}

// decode reads a JSON answer.
func decode(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode the answer %q: %v", raw, err)
	}
	return out
}

// TestInitialize makes sure that the handshake of the protocol works.
func TestInitialize(t *testing.T) {
	answer := newServer().Handle(context.Background(),
		[]byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`))
	obj := decode(t, answer)
	if obj["jsonrpc"] != "2.0" {
		t.Fatalf("unexpected version: %v", obj["jsonrpc"])
	}
	if obj["id"].(float64) != 1 {
		t.Fatalf("unexpected id: %v", obj["id"])
	}
	result, ok := obj["result"].(map[string]any)
	if !ok {
		t.Fatalf("the answer has no result: %s", answer)
	}
	if result["protocolVersion"] != mcp.ProtocolVersion {
		t.Fatalf("unexpected protocol version: %v", result["protocolVersion"])
	}
	if _, ok := result["capabilities"]; !ok {
		t.Fatalf("the answer has no capabilities: %s", answer)
	}
	info, ok := result["serverInfo"].(map[string]any)
	if !ok || info["name"] != "noto" {
		t.Fatalf("unexpected server info: %v", result["serverInfo"])
	}
}

// TestToolsList makes sure that the tools are described.
func TestToolsList(t *testing.T) {
	answer := newServer().Handle(context.Background(),
		[]byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`))
	obj := decode(t, answer)
	result := obj["result"].(map[string]any)
	tools := result["tools"].([]any)
	if len(tools) != 6 {
		t.Fatalf("unexpected number of the tools: %d", len(tools))
	}
	first := tools[0].(map[string]any)
	if _, ok := first["inputSchema"]; !ok {
		t.Fatalf("the tool has no schema: %v", first)
	}
}

// TestUnknownMethod makes sure that an unknown method answers with the error
// of JSON-RPC 2.0.
func TestUnknownMethod(t *testing.T) {
	answer := newServer().Handle(context.Background(),
		[]byte(`{"jsonrpc":"2.0","id":3,"method":"notes/explode"}`))
	obj := decode(t, answer)
	rpcErr, ok := obj["error"].(map[string]any)
	if !ok {
		t.Fatalf("the answer has no error: %s", answer)
	}
	if rpcErr["code"].(float64) != float64(mcp.CodeMethodNotFound) {
		t.Fatalf("unexpected error code: %v", rpcErr["code"])
	}
	if _, ok := obj["result"]; ok {
		t.Fatalf("the answer of an error carries a result: %s", answer)
	}
}

// TestToolCall makes sure that a tool of the notes can be called.
func TestToolCall(t *testing.T) {
	answer := newServer().Handle(context.Background(),
		[]byte(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"notes.read","arguments":{"path":"a.md"}}}`))
	obj := decode(t, answer)
	result, ok := obj["result"].(map[string]any)
	if !ok {
		t.Fatalf("the answer has no result: %s", answer)
	}
	if result["isError"] == true {
		t.Fatalf("the tool failed: %s", answer)
	}
	content := result["content"].([]any)
	text := content[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "hello") {
		t.Fatalf("unexpected content: %q", text)
	}
}

// TestUnknownTool makes sure that a tool that does not exist is refused.
func TestUnknownTool(t *testing.T) {
	answer := newServer().Handle(context.Background(),
		[]byte(`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"notes.explode"}}`))
	obj := decode(t, answer)
	rpcErr, ok := obj["error"].(map[string]any)
	if !ok {
		t.Fatalf("the answer has no error: %s", answer)
	}
	if rpcErr["code"].(float64) != float64(mcp.CodeInvalidParams) {
		t.Fatalf("unexpected error code: %v", rpcErr["code"])
	}
}

// TestTheBatchRequest makes sure that a batch of requests is answered with a
// batch of answers.
func TestTheBatchRequest(t *testing.T) {
	answer := newServer().Handle(context.Background(),
		[]byte(`[{"jsonrpc":"2.0","id":1,"method":"initialize"},
		         {"jsonrpc":"2.0","id":2,"method":"tools/list"},
		         {"jsonrpc":"2.0","id":3,"method":"nope"}]`))
	var answers []map[string]any
	if err := json.Unmarshal(answer, &answers); err != nil {
		t.Fatalf("decode the batch: %v", err)
	}
	if len(answers) != 3 {
		t.Fatalf("unexpected number of the answers: %d", len(answers))
	}
	if answers[0]["id"].(float64) != 1 || answers[1]["id"].(float64) != 2 {
		t.Fatalf("unexpected identifiers: %v", answers)
	}
	if _, ok := answers[2]["error"]; !ok {
		t.Fatalf("the third answer has no error: %s", answer)
	}
}

// TestInvalidRequest makes sure that a malformed request is refused.
func TestInvalidRequest(t *testing.T) {
	answer := newServer().Handle(context.Background(), []byte(`not json`))
	obj := decode(t, answer)
	rpcErr, ok := obj["error"].(map[string]any)
	if !ok {
		t.Fatalf("the answer has no error: %s", answer)
	}
	if rpcErr["code"].(float64) != float64(mcp.CodeParseError) {
		t.Fatalf("unexpected error code: %v", rpcErr["code"])
	}
}

// TestTheWrongVersionIsRefused makes sure that the version of the protocol is
// checked.
func TestTheWrongVersionIsRefused(t *testing.T) {
	answer := newServer().Handle(context.Background(),
		[]byte(`{"jsonrpc":"1.0","id":1,"method":"initialize"}`))
	obj := decode(t, answer)
	rpcErr, ok := obj["error"].(map[string]any)
	if !ok {
		t.Fatalf("the answer has no error: %s", answer)
	}
	if rpcErr["code"].(float64) != float64(mcp.CodeInvalidRequest) {
		t.Fatalf("unexpected error code: %v", rpcErr["code"])
	}
}

// TestTheNotificationHasNoAnswer makes sure that a notification gets no
// answer.
func TestTheNotificationHasNoAnswer(t *testing.T) {
	answer := newServer().Handle(context.Background(),
		[]byte(`{"jsonrpc":"2.0","method":"notifications/initialized"}`))
	if answer != nil {
		t.Fatalf("the notification got an answer: %s", answer)
	}
}

// TestTheToolThatFailsIsReported makes sure that an error of a tool is
// reported in the result of the call.
func TestTheToolThatFailsIsReported(t *testing.T) {
	answer := newServer().Handle(context.Background(),
		[]byte(`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"notes.read","arguments":{"path":"missing.md"}}}`))
	obj := decode(t, answer)
	result, ok := obj["result"].(map[string]any)
	if !ok {
		t.Fatalf("the answer has no result: %s", answer)
	}
	if result["isError"] != true {
		t.Fatalf("the failure is not reported: %s", answer)
	}
}
