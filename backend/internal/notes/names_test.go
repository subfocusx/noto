package notes_test

import (
	"context"
	"strings"
	"testing"

	"noto/backend/internal/notes"
	"noto/backend/internal/testutil"
)

// TestNamesAreLimited checks the limits of a name at the level of the
// service: the code of the error is the one of the contract.
func TestNamesAreLimited(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	// A name that is too long is rejected with invalid_name.
	long := strings.Repeat("a", 513)
	_, err := svc.CreateFolder(ctx, "", long)
	if notes.Code(err) != notes.CodeInvalidName {
		t.Fatalf("expected invalid_name, got %q (%v)", notes.Code(err), err)
	}
	_, err = svc.CreateFile(ctx, "", long)
	if notes.Code(err) != notes.CodeInvalidName {
		t.Fatalf("expected invalid_name, got %q (%v)", notes.Code(err), err)
	}

	// The longest name that is accepted by the rules. The file system may
	// still refuse it (the path of Windows is limited to 260 characters),
	// but the rules of the name must not be the ones that refuse it.
	ok := strings.Repeat("a", 512)
	if _, err := svc.CreateFolder(ctx, "", ok); err != nil && notes.Code(err) == notes.CodeInvalidName {
		t.Fatalf("the name of %d characters was refused by the rules of the name", len(ok))
	}

	// A control character is rejected with invalid_name.
	for _, name := range []string{"a\x01b", "a\nb", "a\tb"} {
		_, err := svc.CreateFolder(ctx, "", name)
		if notes.Code(err) != notes.CodeInvalidName {
			t.Fatalf("expected invalid_name for %q, got %q (%v)", name, notes.Code(err), err)
		}
	}
}

// TestNamesWithANULByteAreStripped checks the rule of the NUL byte: it is
// stripped from a name instead of rejecting the name.
func TestNamesWithANULByteAreStripped(t *testing.T) {
	svc, _, _ := testutil.NewTestService(t)
	ctx := context.Background()

	folder, err := svc.CreateFolder(ctx, "", "no\x00te")
	if err != nil {
		t.Fatalf("create the folder: %v", err)
	}
	if folder.Path != "note" {
		t.Fatalf("unexpected folder path %q", folder.Path)
	}

	file, err := svc.CreateFile(ctx, "", "fi\x00le")
	if err != nil {
		t.Fatalf("create the file: %v", err)
	}
	if file.Path != "file.md" {
		t.Fatalf("unexpected file path %q", file.Path)
	}
}
