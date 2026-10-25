package sealed

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// newStore creates a store over a temporary directory.
func newStore(t *testing.T) *Store {
	t.Helper()
	store, err := New(filepath.Join(t.TempDir(), ".noto"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	return store
}

// testID is a valid object identifier.
const testID = "0123456789abcdef0123456789abcdef"

func TestObjectLifecycle(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	payload := []byte{0x00, 0x01, 0xff, 'h', 'i'}
	if err := store.PutObject(ctx, testID, payload); err != nil {
		t.Fatalf("put object: %v", err)
	}
	got, err := store.GetObject(ctx, testID)
	if err != nil {
		t.Fatalf("get object: %v", err)
	}
	// The store must not transform the payload.
	if !bytes.Equal(got, payload) {
		t.Fatalf("unexpected payload %v", got)
	}

	ids, err := store.ListObjects(ctx)
	if err != nil {
		t.Fatalf("list objects: %v", err)
	}
	if len(ids) != 1 || ids[0] != testID {
		t.Fatalf("unexpected identifiers %v", ids)
	}

	if err := store.DeleteObject(ctx, testID); err != nil {
		t.Fatalf("delete object: %v", err)
	}
	ids, err = store.ListObjects(ctx)
	if err != nil {
		t.Fatalf("list objects: %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("the object was not deleted: %v", ids)
	}
}

func TestObjectListIsSorted(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	ids := []string{
		"ff000000000000000000000000000000",
		"0000000000000000000000000000000a",
		"aa000000000000000000000000000000",
	}
	for _, id := range ids {
		if err := store.PutObject(ctx, id, []byte(id)); err != nil {
			t.Fatalf("put object %q: %v", id, err)
		}
	}
	got, err := store.ListObjects(ctx)
	if err != nil {
		t.Fatalf("list objects: %v", err)
	}
	if len(got) != len(ids) {
		t.Fatalf("unexpected identifiers %v", got)
	}
	for i := 1; i < len(got); i++ {
		if got[i-1] > got[i] {
			t.Fatalf("the identifiers are not sorted: %v", got)
		}
	}
}

func TestManifestLifecycle(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	if err := store.PutManifest(ctx, 3, []byte("three")); err != nil {
		t.Fatalf("put manifest: %v", err)
	}
	if err := store.PutManifest(ctx, 1, []byte("one")); err != nil {
		t.Fatalf("put manifest: %v", err)
	}
	got, err := store.GetManifest(ctx, 3)
	if err != nil {
		t.Fatalf("get manifest: %v", err)
	}
	if string(got) != "three" {
		t.Fatalf("unexpected manifest %q", got)
	}
	gens, err := store.ListManifests(ctx)
	if err != nil {
		t.Fatalf("list manifests: %v", err)
	}
	if len(gens) != 2 || gens[0] != 1 || gens[1] != 3 {
		t.Fatalf("unexpected generations %v", gens)
	}
	if err := store.DeleteManifest(ctx, 1); err != nil {
		t.Fatalf("delete manifest: %v", err)
	}
	gens, err = store.ListManifests(ctx)
	if err != nil {
		t.Fatalf("list manifests: %v", err)
	}
	if len(gens) != 1 || gens[0] != 3 {
		t.Fatalf("unexpected generations %v", gens)
	}
}

func TestInvalidIdentifierIsRejected(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	bad := []string{
		"",
		"../x",
		"..",
		"ZZ3456789abcdef0123456789abcdef",
		"0123456789ABCDEF0123456789ABCDEF",
		"0123456789abcdef0123456789abcde",    // 31 characters
		"0123456789abcdef0123456789abcdef0",  // 33 characters
		"0123456789abcdef0123456789abcdef/x", // a path separator
		`0123456789abcdef0123456789abcde\`,
		"C:\\Windows\\noto",
	}
	for _, id := range bad {
		if err := store.PutObject(ctx, id, []byte("x")); !errors.Is(err, ErrInvalidID) {
			t.Errorf("put object %q: unexpected error %v", id, err)
		}
		if _, err := store.GetObject(ctx, id); !errors.Is(err, ErrInvalidID) {
			t.Errorf("get object %q: unexpected error %v", id, err)
		}
		if err := store.DeleteObject(ctx, id); !errors.Is(err, ErrInvalidID) {
			t.Errorf("delete object %q: unexpected error %v", id, err)
		}
	}
	// Nothing must have been written outside of the store.
	entries, err := os.ReadDir(store.Root())
	if err != nil && !os.IsNotExist(err) {
		t.Fatalf("read the root: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("the store is not empty: %v", entries)
	}
}

func TestInvalidGenerationIsRejected(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	if err := store.PutManifest(ctx, 0, []byte("x")); !errors.Is(err, ErrInvalidGeneration) {
		t.Fatalf("unexpected error %v", err)
	}
	if _, err := store.GetManifest(ctx, 0); !errors.Is(err, ErrInvalidGeneration) {
		t.Fatalf("unexpected error %v", err)
	}
	if err := store.DeleteManifest(ctx, 0); !errors.Is(err, ErrInvalidGeneration) {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestMissingObjectReturnsNotExist(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	if _, err := store.GetObject(ctx, testID); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected error %v", err)
	}
	if err := store.DeleteObject(ctx, testID); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected error %v", err)
	}
	if _, err := store.GetManifest(ctx, 1); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected error %v", err)
	}
	if _, err := store.GetKeystore(ctx); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestSizeLimitIsEnforced(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	big := make([]byte, MaxObjectSize+1)
	if err := store.PutObject(ctx, testID, big); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("unexpected error %v", err)
	}
	// The previous content must be intact after a failed write.
	if err := store.PutObject(ctx, testID, []byte("keep")); err != nil {
		t.Fatalf("put object: %v", err)
	}
	if err := store.PutObject(ctx, testID, big); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("unexpected error %v", err)
	}
	got, err := store.GetObject(ctx, testID)
	if err != nil {
		t.Fatalf("get object: %v", err)
	}
	if string(got) != "keep" {
		t.Fatalf("the previous content was lost: %q", got)
	}
	// A keystore that is too big is refused as well.
	if err := store.PutKeystore(ctx, make([]byte, MaxKeystoreSize+1)); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestFailedWriteLeavesNoTemporaryFile(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	if err := store.PutObject(ctx, testID, []byte("data")); err != nil {
		t.Fatalf("put object: %v", err)
	}
	dir := filepath.Join(store.Root(), "objects", testID[:2])
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read the shard: %v", err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".noto-tmp-") {
			t.Fatalf("a temporary file was left behind: %s", entry.Name())
		}
	}
	if len(entries) != 1 {
		t.Fatalf("unexpected files %v", entries)
	}
}

func TestKeystoreRoundTrip(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	keystore := []byte(`{"kdf":"argon2id","wrapped":"abc"}`)
	if err := store.PutKeystore(ctx, keystore); err != nil {
		t.Fatalf("put keystore: %v", err)
	}
	got, err := store.GetKeystore(ctx)
	if err != nil {
		t.Fatalf("get keystore: %v", err)
	}
	if !bytes.Equal(got, keystore) {
		t.Fatalf("unexpected keystore %q", got)
	}
}

func TestModeAndEnableSealed(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	mode, err := store.Mode(ctx)
	if err != nil {
		t.Fatalf("mode: %v", err)
	}
	if mode != "" {
		t.Fatalf("unexpected mode %q", mode)
	}

	if err := store.EnableSealed(ctx); err != nil {
		t.Fatalf("enable sealed: %v", err)
	}
	mode, err = store.Mode(ctx)
	if err != nil {
		t.Fatalf("mode: %v", err)
	}
	if mode != ModeSealed {
		t.Fatalf("unexpected mode %q", mode)
	}
	data, err := os.ReadFile(filepath.Join(store.Root(), "config.json"))
	if err != nil {
		t.Fatalf("read the configuration: %v", err)
	}
	if !strings.Contains(string(data), `"mode":"sealed"`) || !strings.Contains(string(data), `"format":1`) {
		t.Fatalf("unexpected configuration %q", data)
	}
}

func TestNewRejectsAnEmptyRoot(t *testing.T) {
	if _, err := New("  "); !errors.Is(err, ErrInvalidPath) {
		t.Fatalf("unexpected error %v", err)
	}
}
