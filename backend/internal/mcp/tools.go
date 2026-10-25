package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// The names of the tools of the server.
const (
	ToolList   = "notes.list"
	ToolRead   = "notes.read"
	ToolCreate = "notes.create"
	ToolUpdate = "notes.update"
	ToolDelete = "notes.delete"
	ToolSearch = "notes.search"
)

// Server answers the requests of the Model Context Protocol.
type Server struct {
	notes Notes
	// name is the name of the server.
	name string
	// version is the version of the server.
	version string
}

// New creates the server of the protocol. The notes service may be nil: the
// tools that need it answer with an error.
func New(notes Notes) *Server {
	return &Server{notes: notes, name: "noto", version: "0.1.0"}
}

// initialize answers the method "initialize".
func (s *Server) initialize() any {
	return map[string]any{
		"protocolVersion": ProtocolVersion,
		"capabilities": map[string]any{
			"tools": map[string]any{"listChanged": false},
		},
		"serverInfo": map[string]any{
			"name":    s.name,
			"version": s.version,
		},
	}
}

// tool describes a tool of the server.
type tool struct {
	name        string
	description string
	schema      map[string]any
}

// tools is the list of the tools of the server.
func tools() []tool {
	return []tool{
		{
			name:        ToolList,
			description: "List the notes of the vault.",
			schema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			name:        ToolRead,
			description: "Read the content of a note.",
			schema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{"type": "string", "description": "The path of the note."},
				},
				"required": []string{"path"},
			},
		},
		{
			name:        ToolCreate,
			description: "Create a note with the given content.",
			schema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":    map[string]any{"type": "string", "description": "The path of the new note."},
					"content": map[string]any{"type": "string", "description": "The text of the new note."},
				},
				"required": []string{"path"},
			},
		},
		{
			name:        ToolUpdate,
			description: "Update the content of a note.",
			schema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":     map[string]any{"type": "string", "description": "The path of the note."},
					"content":  map[string]any{"type": "string", "description": "The new text of the note."},
					"revision": map[string]any{"type": "integer", "description": "The revision the client has read. Zero forces the write."},
				},
				"required": []string{"path", "content"},
			},
		},
		{
			name:        ToolDelete,
			description: "Move a note to the trash.",
			schema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{"type": "string", "description": "The path of the note."},
				},
				"required": []string{"path"},
			},
		},
		{
			name:        ToolSearch,
			description: "Search the notes of the vault.",
			schema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string", "description": "The text to look for."},
					"limit": map[string]any{"type": "integer", "description": "The maximum number of the results."},
				},
				"required": []string{"query"},
			},
		},
	}
}

// listTools answers the method "tools/list".
func (s *Server) listTools() any {
	out := make([]map[string]any, 0, 6)
	for _, t := range tools() {
		out = append(out, map[string]any{
			"name":        t.name,
			"description": t.description,
			"inputSchema": t.schema,
		})
	}
	return map[string]any{"tools": out}
}

// toolParams are the parameters of the method "tools/call".
type toolParams struct {
	// Name is the name of the called tool.
	Name string `json:"name"`
	// Arguments holds the arguments of the tool.
	Arguments map[string]any `json:"arguments"`
}

// callTool answers the method "tools/call".
func (s *Server) callTool(ctx context.Context, raw json.RawMessage) (any, *Error) {
	var params toolParams
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, &Error{Code: CodeInvalidParams, Message: "the params are not valid JSON"}
		}
	}
	if strings.TrimSpace(params.Name) == "" {
		return nil, &Error{Code: CodeInvalidParams, Message: "the name of the tool is required"}
	}
	if s.notes == nil {
		return nil, &Error{Code: CodeInternalError, Message: ErrNoNotes.Error()}
	}
	result, err := s.run(ctx, params.Name, params.Arguments)
	if err != nil {
		if errors.Is(err, errUnknownTool) {
			return nil, &Error{Code: CodeInvalidParams, Message: "the tool \"" + params.Name + "\" is unknown"}
		}
		// An error of a tool is reported in the result: the call itself was
		// a valid one.
		return toolResult(map[string]any{"error": err.Error()}, true), nil
	}
	return toolResult(result, false), nil
}

// toolResult builds the result of a tool call.
func toolResult(value any, isError bool) map[string]any {
	text, err := json.Marshal(value)
	if err != nil {
		text = []byte(`{"error":"the result cannot be encoded"}`)
	}
	return map[string]any{
		"content": []any{
			map[string]any{"type": "text", "text": string(text)},
		},
		"isError": isError,
	}
}

// errUnknownTool reports that the tool does not exist.
var errUnknownTool = fmt.Errorf("mcp: the tool is unknown")

// run executes the tool with the arguments.
func (s *Server) run(ctx context.Context, name string, args map[string]any) (any, error) {
	switch name {
	case ToolList:
		return s.notes.List(ctx)
	case ToolRead:
		path, err := stringArg(args, "path")
		if err != nil {
			return nil, err
		}
		return s.notes.Read(ctx, path)
	case ToolCreate:
		path, err := stringArg(args, "path")
		if err != nil {
			return nil, err
		}
		content, err := optionalStringArg(args, "content")
		if err != nil {
			return nil, err
		}
		return s.notes.Create(ctx, path, content)
	case ToolUpdate:
		path, err := stringArg(args, "path")
		if err != nil {
			return nil, err
		}
		content, err := optionalStringArg(args, "content")
		if err != nil {
			return nil, err
		}
		revision := int64(0)
		if raw, ok := args["revision"]; ok {
			switch v := raw.(type) {
			case float64:
				revision = int64(v)
			case json.Number:
				n, err := v.Int64()
				if err != nil {
					return nil, fmt.Errorf("the revision is not a number")
				}
				revision = n
			}
		}
		return s.notes.Update(ctx, path, content, revision)
	case ToolDelete:
		path, err := stringArg(args, "path")
		if err != nil {
			return nil, err
		}
		if err := s.notes.Delete(ctx, path); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "path": path}, nil
	case ToolSearch:
		query, err := stringArg(args, "query")
		if err != nil {
			return nil, err
		}
		limit := 20
		if raw, ok := args["limit"]; ok {
			switch v := raw.(type) {
			case float64:
				limit = int(v)
			case json.Number:
				n, err := v.Int64()
				if err != nil {
					return nil, fmt.Errorf("the limit is not a number")
				}
				limit = int(n)
			}
		}
		if limit <= 0 {
			limit = 20
		}
		return s.notes.Search(ctx, query, limit)
	default:
		return nil, errUnknownTool
	}
}

// stringArg reads a required string argument.
func stringArg(args map[string]any, name string) (string, error) {
	raw, ok := args[name]
	if !ok {
		return "", fmt.Errorf("the argument %q is required", name)
	}
	value, ok := raw.(string)
	if !ok || strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("the argument %q must be a non empty string", name)
	}
	return value, nil
}

// optionalStringArg reads an optional string argument.
func optionalStringArg(args map[string]any, name string) (string, error) {
	raw, ok := args[name]
	if !ok {
		return "", nil
	}
	value, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("the argument %q must be a string", name)
	}
	return value, nil
}
