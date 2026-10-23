package main

import (
	"archive/zip"
	"bytes"
	"sort"
)

// buildZip creates an in-memory ZIP archive. The map key is the entry name,
// the value is the content of the entry.
func buildZip(entries map[string][]byte) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	names := make([]string, 0, len(entries))
	for name := range entries {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		w, err := zw.Create(name)
		if err != nil {
			continue
		}
		_, _ = w.Write(entries[name])
	}
	_ = zw.Close()
	return buf.Bytes()
}
