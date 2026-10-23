package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"noto/backend/internal/config"
	"noto/backend/internal/notes"
	"noto/backend/internal/sqlitestore"
)

// TestResolveListenAddr makes sure that an address without a host is not
// treated as a loopback address: it would listen on every interface.
func TestResolveListenAddr(t *testing.T) {
	cases := []struct {
		addr    string
		public  bool
		wantErr bool
		want    string
	}{
		{addr: "127.0.0.1:8139", want: "127.0.0.1:8139"},
		{addr: "localhost:8139", want: "localhost:8139"},
		{addr: "[::1]:8139", want: "[::1]:8139"},
		{addr: ":8139", wantErr: true},
		{addr: ":8139", public: true, want: ":8139"},
		{addr: "0.0.0.0:8139", wantErr: true},
		{addr: "0.0.0.0:8139", public: true, want: "0.0.0.0:8139"},
		{addr: "192.168.1.10:8139", wantErr: true},
	}
	for _, c := range cases {
		cfg := config.Config{Addr: c.addr, AllowPublic: c.public}
		got, err := resolveListenAddr(cfg)
		if c.wantErr {
			if err == nil {
				t.Fatalf("%q: expected an error, got %q", c.addr, got)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%q: unexpected error %v", c.addr, err)
		}
		if got != c.want {
			t.Fatalf("%q: got %q, want %q", c.addr, got, c.want)
		}
	}
}

// TestIsLoopbackHost makes sure that only the loopback addresses are local.
func TestIsLoopbackHost(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "127.1.2.3", "localhost", "::1"} {
		if !isLoopbackHost(host) {
			t.Fatalf("%q must be a loopback host", host)
		}
	}
	for _, host := range []string{"", "0.0.0.0", "192.168.1.10", "example.com"} {
		if isLoopbackHost(host) {
			t.Fatalf("%q must not be a loopback host", host)
		}
	}
}

// TestServiceWithRealStore exercises the business logic against the real
// SQLite store.
func TestServiceWithRealStore(t *testing.T) {
	dir := t.TempDir()
	cfg := config.Config{
		Addr:            "127.0.0.1:0",
		DataDir:         dir,
		NotesDir:        filepath.Join(dir, "notes"),
		AttachmentsDir:  filepath.Join(dir, "attachments"),
		TrashDir:        filepath.Join(dir, "trash"),
		DBPath:          filepath.Join(dir, "noto.db"),
		MaxUploadBytes:  1 << 20,
		MaxArchiveBytes: 8 << 20,
	}
	if err := cfg.EnsureDirs(); err != nil {
		t.Fatalf("ensure dirs: %v", err)
	}
	ctx := context.Background()
	store, err := sqlitestore.Open(ctx, cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()

	svc, err := notes.NewService(cfg, store)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	if _, err := svc.CreateFolder(ctx, "", "journal"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "journal", "a"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	res, err := svc.Write(ctx, "journal/a.md", "hello world", 0)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if res.Revision != 2 {
		t.Fatalf("unexpected revision %d", res.Revision)
	}
	hits, err := svc.Search(ctx, "world", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatalf("the search did not find the note")
	}
	if _, err := svc.Rename(ctx, "journal/a.md", "b.md"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cfg.NotesDir, "journal", "b.md")); err != nil {
		t.Fatalf("the renamed file is missing: %v", err)
	}
	hits, err = svc.Search(ctx, "world", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	for _, h := range hits {
		if h.Path == "journal/a.md" {
			t.Fatalf("the old path is still indexed")
		}
	}
	if err := svc.Delete(ctx, "journal/b.md"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	entries, err := svc.Trash(ctx)
	if err != nil {
		t.Fatalf("trash: %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("the trash is empty")
	}
	var target string
	for _, e := range entries {
		if e.Path == "trash/"+filepath.Base(filepath.Dir(e.Path))+"/journal/b.md" {
			target = e.Path
		}
	}
	if target == "" {
		for _, e := range entries {
			target = e.Path
		}
	}
	if _, err := svc.Restore(ctx, target); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cfg.NotesDir, "journal", "b.md")); err != nil {
		t.Fatalf("the file was not restored: %v", err)
	}
	count, err := svc.Reindex(ctx)
	if err != nil {
		t.Fatalf("reindex: %v", err)
	}
	if count != 1 {
		t.Fatalf("unexpected indexed count %d", count)
	}
}
