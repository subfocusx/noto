// Package web serves the built single page application.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// distFS contains the built frontend when it was copied into
// internal/web/dist before the build.
//
//go:embed all:dist
var distFS embed.FS

// placeholderFS contains the built-in fallback page.
//
//go:embed placeholder.html
var placeholderFS embed.FS

// Handler returns an http.Handler that serves the single page application.
//
// When staticDir is not empty the files are served from that directory,
// otherwise the embedded assets are used. Unknown paths fall back to
// index.html so that client side routing works. Requests below /api are never
// answered by the SPA.
func Handler(staticDir string) (http.Handler, error) {
	var files fs.FS
	var index []byte
	if staticDir != "" {
		if st, err := os.Stat(staticDir); err != nil || !st.IsDir() {
			return nil, &os.PathError{Op: "open", Path: staticDir, Err: os.ErrNotExist}
		}
		files = os.DirFS(staticDir)
		data, err := os.ReadFile(path.Join(staticDir, "index.html"))
		if err != nil {
			return nil, err
		}
		index = data
	} else {
		sub, err := fs.Sub(distFS, "dist")
		if err != nil {
			return nil, err
		}
		files = sub
		data, err := fs.ReadFile(distFS, "dist/index.html")
		if err != nil {
			// The frontend was not built yet: use the built-in placeholder.
			ph, err := fs.ReadFile(placeholderFS, "placeholder.html")
			if err != nil {
				return nil, err
			}
			index = ph
		} else {
			index = data
		}
	}
	return &spaHandler{files: files, index: index}, nil
}

// spaHandler serves the static files with an index.html fallback.
type spaHandler struct {
	files fs.FS
	index []byte
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api") {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		h.serveIndex(w, r)
		return
	}
	f, err := h.files.Open(name)
	if err != nil {
		h.serveIndex(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		h.serveIndex(w, r)
		return
	}
	data, err := fs.ReadFile(h.files, name)
	if err != nil {
		h.serveIndex(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType(name))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// serveIndex writes the SPA entry document.
func (h *spaHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(h.index)
}

// contentType guesses the content type of a static file.
func contentType(name string) string {
	switch path.Ext(name) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".ico":
		return "image/x-icon"
	case ".woff2":
		return "font/woff2"
	case ".webmanifest":
		return "application/manifest+json"
	case ".txt":
		return "text/plain; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}
