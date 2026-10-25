// Package mcp implements the Model Context Protocol over HTTP with JSON-RPC
// 2.0.
//
// The package knows nothing about the HTTP layer: it takes the raw body of a
// request and answers with the raw body of the answer. The transport (the
// route of the API) and the access to the notes are injected by the caller.
package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// Version is the version of the JSON-RPC protocol.
const Version = "2.0"

// ProtocolVersion is the version of the Model Context Protocol that the
// server implements.
const ProtocolVersion = "2024-11-05"

// The codes of the errors of JSON-RPC 2.0.
const (
	CodeParseError     = -32700
	CodeInvalidRequest = -32600
	CodeMethodNotFound = -32601
	CodeInvalidParams  = -32602
	CodeInternalError  = -32603
)

// Request is a JSON-RPC 2.0 request.
type Request struct {
	// JSONRPC must be "2.0".
	JSONRPC string `json:"jsonrpc"`
	// ID identifies the request. A request without an identifier is a
	// notification: it gets no answer.
	ID json.RawMessage `json:"id,omitempty"`
	// Method is the name of the method.
	Method string `json:"method"`
	// Params holds the arguments of the method.
	Params json.RawMessage `json:"params,omitempty"`
}

// Error is the error of a JSON-RPC 2.0 answer.
type Error struct {
	// Code is the numeric code of the error.
	Code int `json:"code"`
	// Message is the human readable description of the error.
	Message string `json:"message"`
	// Data holds the optional details of the error.
	Data any `json:"data,omitempty"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("mcp: %d %s", e.Code, e.Message)
}

// Response is a JSON-RPC 2.0 answer.
type Response struct {
	// JSONRPC is always "2.0".
	JSONRPC string `json:"jsonrpc"`
	// ID is the identifier of the request the answer belongs to.
	ID json.RawMessage `json:"id,omitempty"`
	// Result holds the result of a successful call.
	Result any `json:"result,omitempty"`
	// Error holds the error of a failed call.
	Error *Error `json:"error,omitempty"`
}

// newErrorResponse builds the answer of a failed call.
func newErrorResponse(id json.RawMessage, code int, message string) *Response {
	return &Response{
		JSONRPC: Version,
		ID:      id,
		Error:   &Error{Code: code, Message: message},
	}
}

// Handle answers a raw JSON-RPC 2.0 request. The body may hold a single
// request or a batch of requests. The answer is the raw JSON body.
func (s *Server) Handle(ctx context.Context, raw []byte) []byte {
	trimmed := trimSpace(raw)
	if len(trimmed) == 0 {
		return mustMarshal(newErrorResponse(nil, CodeParseError, "the request is empty"))
	}
	if trimmed[0] == '[' {
		return s.handleBatch(ctx, trimmed)
	}
	res, ok := s.handleRaw(ctx, trimmed)
	if !ok {
		// A notification gets no answer.
		return nil
	}
	return mustMarshal(res)
}

// handleBatch answers a batch of requests.
func (s *Server) handleBatch(ctx context.Context, raw []byte) []byte {
	var requests []Request
	if err := json.Unmarshal(raw, &requests); err != nil {
		return mustMarshal(newErrorResponse(nil, CodeParseError, "the batch is not valid JSON"))
	}
	if len(requests) == 0 {
		return mustMarshal(newErrorResponse(nil, CodeInvalidRequest, "the batch is empty"))
	}
	out := make([]*Response, 0, len(requests))
	for _, req := range requests {
		res, ok := s.Dispatch(ctx, req)
		if !ok {
			continue
		}
		out = append(out, res)
	}
	if len(out) == 0 {
		return nil
	}
	return mustMarshal(out)
}

// handleRaw answers a single request that was read as raw JSON.
func (s *Server) handleRaw(ctx context.Context, raw []byte) (*Response, bool) {
	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return newErrorResponse(nil, CodeParseError, "the request is not valid JSON"), true
	}
	return s.Dispatch(ctx, req)
}

// Dispatch answers a single request.
func (s *Server) Dispatch(ctx context.Context, req Request) (*Response, bool) {
	notification := len(req.ID) == 0 || string(req.ID) == "null"
	if req.JSONRPC != Version {
		res := newErrorResponse(req.ID, CodeInvalidRequest,
			"the jsonrpc field must be \"2.0\"")
		return res, !notification
	}
	if req.Method == "" {
		res := newErrorResponse(req.ID, CodeInvalidRequest, "the method is required")
		return res, !notification
	}
	if isNotification(req.Method) {
		// A notification never gets an answer.
		return nil, false
	}
	result, rpcErr := s.call(ctx, req)
	if rpcErr != nil {
		return newErrorResponse(req.ID, rpcErr.Code, rpcErr.Message), !notification
	}
	return &Response{JSONRPC: Version, ID: req.ID, Result: result}, !notification
}

// isNotification reports whether the method is a notification of the
// protocol.
func isNotification(method string) bool {
	return len(method) > 13 && method[:13] == "notifications/"
}

// call runs the method of the request.
func (s *Server) call(ctx context.Context, req Request) (any, *Error) {
	switch req.Method {
	case "initialize":
		return s.initialize(), nil
	case "tools/list":
		return s.listTools(), nil
	case "tools/call":
		return s.callTool(ctx, req.Params)
	default:
		return nil, &Error{Code: CodeMethodNotFound, Message: "the method \"" + req.Method + "\" is unknown"}
	}
}

// mustMarshal encodes a body of an answer. The encoding of the answers of the
// server cannot fail: the values are plain maps and slices.
func mustMarshal(v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		return []byte(`{"jsonrpc":"2.0","error":{"code":-32603,"message":"the answer cannot be encoded"}}`)
	}
	return data
}

// trimSpace removes the spaces around a body.
func trimSpace(raw []byte) []byte {
	start := 0
	for start < len(raw) && isSpace(raw[start]) {
		start++
	}
	end := len(raw)
	for end > start && isSpace(raw[end-1]) {
		end--
	}
	return raw[start:end]
}

// isSpace reports whether the byte is a space.
func isSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\r' || b == '\n'
}

// ErrNoNotes reports that the server was created without a notes service.
var ErrNoNotes = errors.New("mcp: the notes service is not available")
