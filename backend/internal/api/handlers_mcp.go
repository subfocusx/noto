package api

import (
	"context"
	"io"
	"net/http"
	"path"
	"strings"

	"noto/backend/internal/mcp"
	"noto/backend/internal/notes"
)

// handleMCP answers a JSON-RPC 2.0 request of the Model Context Protocol.
//
// The body may hold a single request or a batch of requests. The answer is
// the raw JSON body of the protocol; the envelope of the API is not used,
// because the protocol has its own.
func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBody))
	if err != nil {
		writeAuthError(w, http.StatusBadRequest, notes.CodeBadRequest,
			"the request body cannot be read")
		return
	}
	answer := s.mcpServer.Handle(r.Context(), body)
	if answer == nil {
		// A notification gets no answer.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(answer)
}

// mcpNotes exposes the service of the notes to the tools of the protocol.
//
// The adapter reads the current service of the server on every call, so that
// a change of the vault is seen by the protocol.
type mcpNotes struct {
	server *Server
}

// List returns the summary of every note of the vault.
func (m mcpNotes) List(ctx context.Context) ([]mcp.Note, error) {
	svc := m.server.service()
	_, files, err := svc.Tree(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]mcp.Note, 0, len(files))
	for _, f := range files {
		out = append(out, mcp.Note{
			Path:      f.Path,
			Name:      f.Name,
			Revision:  f.Revision,
			Size:      f.Size,
			UpdatedAt: f.UpdatedAt,
		})
	}
	return out, nil
}

// Read returns the content of a note.
func (m mcpNotes) Read(ctx context.Context, notePath string) (mcp.Content, error) {
	content, err := m.server.service().Read(ctx, notePath)
	if err != nil {
		return mcp.Content{}, err
	}
	return mcp.Content{
		Path:      content.Path,
		Content:   content.Content,
		Revision:  content.Revision,
		UpdatedAt: content.UpdatedAt,
	}, nil
}

// Create creates a note and writes its content.
func (m mcpNotes) Create(ctx context.Context, notePath, content string) (mcp.Note, error) {
	svc := m.server.service()
	parent, name := splitPath(notePath)
	node, err := svc.CreateFile(ctx, parent, name)
	if err != nil {
		return mcp.Note{}, err
	}
	if content != "" {
		if _, err := svc.Write(ctx, node.Path, content, 0); err != nil {
			return mcp.Note{}, err
		}
	}
	return mcp.Note{
		Path:      node.Path,
		Name:      node.Name,
		Revision:  node.Revision,
		Size:      node.Size,
		UpdatedAt: node.UpdatedAt,
	}, nil
}

// Update writes the content of a note.
func (m mcpNotes) Update(ctx context.Context, notePath, content string, revision int64) (mcp.Note, error) {
	svc := m.server.service()
	res, err := svc.Write(ctx, notePath, content, revision)
	if err != nil {
		return mcp.Note{}, err
	}
	return mcp.Note{
		Path:      res.Path,
		Name:      path.Base(res.Path),
		Revision:  res.Revision,
		UpdatedAt: res.UpdatedAt,
	}, nil
}

// Delete moves a note to the trash.
func (m mcpNotes) Delete(ctx context.Context, notePath string) error {
	return m.server.service().Delete(ctx, notePath)
}

// Search returns the notes that match a text.
func (m mcpNotes) Search(ctx context.Context, query string, limit int) ([]mcp.Hit, error) {
	hits, err := m.server.service().Search(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	out := make([]mcp.Hit, 0, len(hits))
	for _, h := range hits {
		out = append(out, mcp.Hit{
			Path:    h.Path,
			Name:    h.Name,
			Kind:    h.Kind,
			Snippet: h.Snippet,
		})
	}
	return out, nil
}

// splitPath splits a relative path into its parent folder and its name.
func splitPath(rel string) (string, string) {
	rel = strings.TrimSpace(rel)
	dir, name := path.Split(rel)
	return strings.TrimSuffix(dir, "/"), name
}
