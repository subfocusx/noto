package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ------------------------------------------------------------------ helpers --

func treeHas(t treeResponse, path string) bool {
	for _, n := range t.Folders {
		if n.Path == path {
			return true
		}
	}
	for _, n := range t.Files {
		if n.Path == path {
			return true
		}
	}
	return false
}

func treePaths(t treeResponse) []string {
	var out []string
	for _, n := range t.Folders {
		out = append(out, n.Path)
	}
	for _, n := range t.Files {
		out = append(out, n.Path)
	}
	sort.Strings(out)
	return out
}

func hitHas(s searchResponse, path string) bool {
	for _, h := range s.Hits {
		if h.Path == path {
			return true
		}
	}
	return false
}

func urlEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
			continue
		}
		fmt.Fprintf(&b, "%%%02X", c)
	}
	return b.String()
}

// findFile walks root and returns the first path whose base name is name.
func findFile(root, name string) (string, string) {
	var found, where string
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		if strings.EqualFold(info.Name(), name) {
			if found == "" {
				found = p
			}
			if where == "" {
				where = p
			}
		}
		return nil
	})
	return found, where
}
