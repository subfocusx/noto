package notes_test

import (
	"archive/zip"
	"bytes"
	"context"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

func TestCreateFolderAndFile(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	folder, err := svc.CreateFolder(ctx, "", "Journal")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if folder.Path != "Journal" || folder.Type != "folder" {
		t.Fatalf("unexpected folder node: %+v", folder)
	}

	file, err := svc.CreateFile(ctx, "Journal", "day")
	if err != nil {
		t.Fatalf("create file: %v", err)
	}
	if file.Path != "Journal/day.md" {
		t.Fatalf("unexpected file path: %q", file.Path)
	}
	if _, err := os.Stat(filepath.Join(cfg.NotesDir, "Journal", "day.md")); err != nil {
		t.Fatalf("the file was not created on disk: %v", err)
	}
}

func TestDuplicateAndInvalidNames(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFolder(ctx, "", "Docs"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	_, err := svc.CreateFolder(ctx, "", "Docs")
	if notes.Code(err) != notes.CodeDuplicateName {
		t.Fatalf("expected duplicate_name, got %q (%v)", notes.Code(err), err)
	}

	for _, name := range []string{"", "a/b", "a\\b", "a:b", "a*b", "a?b", `a"b`, "a<b", "a>b", "a|b", " lead", "trail ", ".", "..", "CON", "nul.md", "COM1"} {
		if _, err := svc.CreateFolder(ctx, "", name); notes.Code(err) != notes.CodeInvalidName {
			t.Fatalf("expected invalid_name for %q, got %q", name, notes.Code(err))
		}
	}
}

func TestPathTraversalIsRejected(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	bad := []string{
		"../../etc/passwd",
		"..%2f..%2fetc",
		"/etc/passwd",
		"C:/Windows/System32",
		`..\..\windows`,
		"a/../../b",
		"a//b",
		"a/./b",
	}
	for _, p := range bad {
		// The API decodes the query parameters before they reach the service.
		decoded, err := url.PathUnescape(p)
		if err != nil {
			decoded = p
		}
		if _, err := svc.Read(ctx, decoded); notes.Code(err) != notes.CodeInvalidPath {
			t.Fatalf("expected invalid_path for %q, got %q (%v)", p, notes.Code(err), err)
		}
	}
}

func TestSymlinkEscapeIsRejected(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.md")
	if err := os.WriteFile(secret, []byte("secret"), 0o644); err != nil {
		t.Fatalf("write secret: %v", err)
	}
	link := filepath.Join(cfg.NotesDir, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks are not supported: %v", err)
	}
	if _, err := svc.Read(ctx, "link/secret.md"); notes.Code(err) != notes.CodeInvalidPath {
		t.Fatalf("expected invalid_path for the symlink escape, got %q", notes.Code(err))
	}
}

func TestWriteReadAndRevisionConflict(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	res, err := svc.Write(ctx, "note.md", "hello", 0)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if res.Revision != 2 {
		t.Fatalf("unexpected revision %d", res.Revision)
	}
	content, err := svc.Read(ctx, "note.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if content.Content != "hello" || content.Revision != 2 {
		t.Fatalf("unexpected content: %+v", content)
	}
	_, err = svc.Write(ctx, "note.md", "other", 1)
	if notes.Code(err) != notes.CodeRevisionConflict {
		t.Fatalf("expected revision_conflict, got %q", notes.Code(err))
	}
	cur := notes.CurrentContent(err)
	if cur == nil || cur.Content != "hello" {
		t.Fatalf("the conflict does not carry the current content: %+v", cur)
	}
	if _, err := svc.Write(ctx, "note.md", "forced", 0); err != nil {
		t.Fatalf("forced write: %v", err)
	}
}

func TestConcurrentWritesConflict(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "note"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	base, err := svc.Write(ctx, "note.md", "base", 0)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	conflicts := 0
	ok := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := svc.Write(ctx, "note.md", "concurrent", base.Revision)
			mu.Lock()
			defer mu.Unlock()
			switch notes.Code(err) {
			case notes.CodeRevisionConflict:
				conflicts++
			case "":
				ok++
			default:
				t.Errorf("unexpected error: %v", err)
			}
		}(i)
	}
	wg.Wait()
	if ok != 1 {
		t.Fatalf("expected exactly one successful write, got %d", ok)
	}
	if conflicts != 7 {
		t.Fatalf("expected 7 revision conflicts, got %d", conflicts)
	}
}

func TestRenameAndMove(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFolder(ctx, "", "src"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "src", "a"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.CreateFolder(ctx, "src", "sub"); err != nil {
		t.Fatalf("create sub folder: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "src/sub", "b"); err != nil {
		t.Fatalf("create nested file: %v", err)
	}

	if _, err := svc.Rename(ctx, "src/a.md", "renamed.md"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cfg.NotesDir, "src", "renamed.md")); err != nil {
		t.Fatalf("the renamed file is missing: %v", err)
	}

	if _, err := svc.Move(ctx, "src", "dst"); err != nil {
		t.Fatalf("move: %v", err)
	}
	for _, p := range []string{"dst/src/renamed.md", "dst/src/sub/b.md"} {
		if _, err := os.Stat(filepath.Join(cfg.NotesDir, filepath.FromSlash(p))); err != nil {
			t.Fatalf("%s is missing after the move: %v", p, err)
		}
	}
	folders, files, err := svc.Tree(ctx)
	if err != nil {
		t.Fatalf("tree: %v", err)
	}
	for _, f := range files {
		if strings.HasPrefix(f.Path, "src/") {
			t.Fatalf("the old path is still listed: %q", f.Path)
		}
	}
	if len(folders) != 3 {
		t.Fatalf("unexpected folder count %d", len(folders))
	}
}

func TestMoveFolderIntoItselfIsRejected(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFolder(ctx, "", "a"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFolder(ctx, "a", "b"); err != nil {
		t.Fatalf("create sub folder: %v", err)
	}
	if _, err := svc.Move(ctx, "a", "a/b"); notes.Code(err) != notes.CodeInvalidPath {
		t.Fatalf("expected invalid_path, got %q", notes.Code(err))
	}
	if _, err := svc.Move(ctx, "a", "a"); notes.Code(err) != notes.CodeInvalidPath {
		t.Fatalf("expected invalid_path, got %q", notes.Code(err))
	}
}

func TestDeleteAndRestore(t *testing.T) {
	svc, _, cfg := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFolder(ctx, "", "docs"); err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if _, err := svc.CreateFile(ctx, "docs", "a"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if err := svc.Delete(ctx, "docs"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cfg.NotesDir, "docs")); !os.IsNotExist(err) {
		t.Fatalf("the folder was not moved to the trash")
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
		if strings.HasSuffix(e.Path, "/docs/a.md") {
			target = e.Path
		}
	}
	if target == "" {
		t.Fatalf("the trashed file is missing: %+v", entries)
	}
	if _, err := svc.Restore(ctx, target); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cfg.NotesDir, "docs", "a.md")); err != nil {
		t.Fatalf("the file was not restored: %v", err)
	}
	content, err := svc.Read(ctx, "docs/a.md")
	if err != nil {
		t.Fatalf("read restored file: %v", err)
	}
	if content.Content != "" {
		t.Fatalf("unexpected content %q", content.Content)
	}
}

func TestSearchIndexConsistency(t *testing.T) {
	svc, store, _ := testutil.NewTestService(t)
	ctx := context.Background()

	if _, err := svc.CreateFile(ctx, "", "hello"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := svc.Write(ctx, "hello.md", "the quick brown fox", 0); err != nil {
		t.Fatalf("write: %v", err)
	}
	hits, err := svc.Search(ctx, "brown", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatalf("the search did not find the content")
	}
	hits, err = svc.Search(ctx, "hello", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatalf("the name search did not find the note")
	}

	if _, err := svc.Rename(ctx, "hello.md", "renamed.md"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	hits, err = svc.Search(ctx, "brown", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	for _, h := range hits {
		if h.Path == "hello.md" {
			t.Fatalf("the old path is still indexed")
		}
	}
	if err := svc.Delete(ctx, "renamed.md"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	hits, err = svc.Search(ctx, "brown", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("the deleted note is still indexed: %+v", hits)
	}

	// The index can be rebuilt from the disk.
	if _, err := svc.CreateFile(ctx, "", "again"); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(svc.Config().NotesDir, "again.md"), []byte("brown again"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if err := store.ClearIndex(ctx); err != nil {
		t.Fatalf("clear index: %v", err)
	}
	count, err := svc.Reindex(ctx)
	if err != nil {
		t.Fatalf("reindex: %v", err)
	}
	if count != 1 {
		t.Fatalf("unexpected indexed count %d", count)
	}
	hits, err = svc.Search(ctx, "brown", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatalf("the reindex did not restore the index")
	}
}

func TestImportFilesAndExportRoundTrip(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	files := []notes.UploadedFile{
		{Name: "one.md", Content: []byte("# one")},
		{Name: "two.md", Content: []byte("# two")},
	}
	res, err := svc.ImportFiles(ctx, files, "", notes.ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if len(res.Imported) != 2 {
		t.Fatalf("unexpected import result: %+v", res)
	}
	// A second import with the same names is skipped by default.
	res, err = svc.ImportFiles(ctx, files, "", notes.ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if len(res.Skipped) != 2 {
		t.Fatalf("expected two skipped entries, got %+v", res)
	}
	// With the rename policy a new file is created.
	res, err = svc.ImportFiles(ctx, files, "", notes.ConflictRename)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if len(res.Imported) != 2 {
		t.Fatalf("expected two imported entries, got %+v", res)
	}
	// With the overwrite policy the content is replaced.
	res, err = svc.ImportFiles(ctx, []notes.UploadedFile{{Name: "one.md", Content: []byte("new")}}, "", notes.ConflictOverwrite)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if len(res.Imported) != 1 {
		t.Fatalf("expected one imported entry, got %+v", res)
	}
	content, err := svc.Read(ctx, "one.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if content.Content != "new" {
		t.Fatalf("the overwrite policy did not replace the content: %q", content.Content)
	}
}

func TestImportZipPreservesHierarchy(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	files := map[string]string{
		"journal/2026/october.md":  "# october",
		"journal/2026/november.md": "# november",
	}
	for name, content := range files {
		f, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := f.Write([]byte(content)); err != nil {
			t.Fatalf("write zip entry: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	res, err := svc.ImportZip(ctx, buf.Bytes(), "", notes.ConflictSkip)
	if err != nil {
		t.Fatalf("import zip: %v", err)
	}
	if len(res.Imported) != 2 {
		t.Fatalf("unexpected import result: %+v", res)
	}
	content, err := svc.Read(ctx, "journal/2026/october.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if content.Content != "# october" {
		t.Fatalf("unexpected content %q", content.Content)
	}

	// Export the folder and import it again into another folder.
	archive, err := svc.ExportFolderBytes(ctx, "journal")
	if err != nil {
		t.Fatalf("export folder: %v", err)
	}
	res, err = svc.ImportZip(ctx, archive, "backup", notes.ConflictRename)
	if err != nil {
		t.Fatalf("import zip: %v", err)
	}
	if len(res.Imported) != 2 {
		t.Fatalf("unexpected import result: %+v", res)
	}
	if _, err := svc.Read(ctx, "backup/journal/2026/november.md"); err != nil {
		t.Fatalf("read imported file: %v", err)
	}
}

func TestImportZipRejectsMaliciousArchives(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	t.Run("traversal", func(t *testing.T) {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		f, _ := zw.Create("../evil.md")
		f.Write([]byte("evil"))
		zw.Close()
		if _, err := svc.ImportZip(ctx, buf.Bytes(), "", notes.ConflictSkip); notes.Code(err) != notes.CodeInvalidPath {
			t.Fatalf("expected invalid_path, got %q (%v)", notes.Code(err), err)
		}
	})
	t.Run("absolute", func(t *testing.T) {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		f, _ := zw.Create("/etc/evil.md")
		f.Write([]byte("evil"))
		zw.Close()
		if _, err := svc.ImportZip(ctx, buf.Bytes(), "", notes.ConflictSkip); notes.Code(err) != notes.CodeInvalidPath {
			t.Fatalf("expected invalid_path, got %q", notes.Code(err))
		}
	})
	t.Run("symlink", func(t *testing.T) {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		hdr := &zip.FileHeader{Name: "link.md"}
		hdr.SetMode(os.ModeSymlink | 0o777)
		f, _ := zw.CreateHeader(hdr)
		f.Write([]byte("/etc/passwd"))
		zw.Close()
		if _, err := svc.ImportZip(ctx, buf.Bytes(), "", notes.ConflictSkip); notes.Code(err) != notes.CodeInvalidPath {
			t.Fatalf("expected invalid_path, got %q", notes.Code(err))
		}
	})
	t.Run("malformed", func(t *testing.T) {
		if _, err := svc.ImportZip(ctx, []byte("not a zip"), "", notes.ConflictSkip); notes.Code(err) != notes.CodeBadRequest {
			t.Fatalf("expected bad_request, got %q", notes.Code(err))
		}
	})
	t.Run("oversized", func(t *testing.T) {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		f, _ := zw.Create("big.md")
		f.Write(bytes.Repeat([]byte("a"), 1024))
		zw.Close()
		if _, err := svc.ImportZip(ctx, buf.Bytes(), "", notes.ConflictSkip); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestAttachments(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("\x00", 64))
	att, err := svc.UploadAttachment(ctx, "photo.png", png, "")
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if att.MIME != "image/png" {
		t.Fatalf("unexpected mime type %q", att.MIME)
	}
	if att.ID == "" {
		t.Fatalf("the attachment has no id")
	}
	list, err := svc.ListAttachments(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("unexpected attachment count %d", len(list))
	}
	_, data, err := svc.AttachmentContent(ctx, att.ID)
	if err != nil {
		t.Fatalf("content: %v", err)
	}
	if !bytes.Equal(data, png) {
		t.Fatalf("the stored bytes differ")
	}
	if err := svc.DeleteAttachment(ctx, att.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, _, err := svc.AttachmentContent(ctx, att.ID); notes.Code(err) != notes.CodeNotFound {
		t.Fatalf("expected not_found, got %q", notes.Code(err))
	}

	// A renamed executable is rejected because of its content.
	exe := []byte("MZ\x90\x00" + strings.Repeat("\x00", 128))
	if _, err := svc.UploadAttachment(ctx, "virus.png", exe, ""); notes.Code(err) != notes.CodeUnsupportedMedia {
		t.Fatalf("expected unsupported_media_type, got %q", notes.Code(err))
	}
	// An oversized attachment is rejected.
	big := bytes.Repeat([]byte("a"), int(svc.Config().MaxUploadBytes)+1)
	if _, err := svc.UploadAttachment(ctx, "big.txt", big, ""); notes.Code(err) != notes.CodePayloadTooLarge {
		t.Fatalf("expected payload_too_large, got %q", notes.Code(err))
	}
}
