package notes_test

import (
	"context"
	"testing"
)

// benchNoteCount is the size of the generated notes tree.
const benchNoteCount = 2000

// BenchmarkTree measures the cost of building the notes tree with the real
// SQLite store.
func BenchmarkTree(b *testing.B) {
	env := newBenchEnv(b, benchNoteCount)
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		folders, files, err := env.svc.Tree(ctx)
		if err != nil {
			b.Fatalf("tree: %v", err)
		}
		if len(files) != benchNoteCount {
			b.Fatalf("got %d files, want %d", len(files), benchNoteCount)
		}
		_ = folders
	}
}

// BenchmarkSearch measures a full text search over the indexed notes.
func BenchmarkSearch(b *testing.B) {
	env := newBenchEnv(b, benchNoteCount)
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hits, err := env.svc.Search(ctx, "lorem", 50)
		if err != nil {
			b.Fatalf("search: %v", err)
		}
		if len(hits) == 0 {
			b.Fatal("no search hits")
		}
	}
}

// BenchmarkReindex measures a full rebuild of the metadata and of the search
// index.
func BenchmarkReindex(b *testing.B) {
	env := newBenchEnv(b, benchNoteCount)
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		n, err := env.svc.Reindex(ctx)
		if err != nil {
			b.Fatalf("reindex: %v", err)
		}
		if n != benchNoteCount {
			b.Fatalf("reindexed %d notes, want %d", n, benchNoteCount)
		}
	}
}
