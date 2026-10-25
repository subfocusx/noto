package main

import (
	"io"
	"log/slog"
	"os"
	"testing"

	"noto/backend/internal/config"
)

// TestVaultFixedByEnv makes sure that only the variable NOTO_VAULT_FIXED
// fixes the storage of the notes.
func TestVaultFixedByEnv(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "unset", value: "", want: false},
		{name: "one", value: "1", want: true},
		{name: "true", value: "true", want: true},
		{name: "upper case true", value: "TRUE", want: true},
		{name: "yes", value: "yes", want: true},
		{name: "zero", value: "0", want: false},
		{name: "false", value: "false", want: false},
		{name: "upper case false", value: "False", want: false},
		{name: "spaces", value: "  ", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.value == "" {
				unsetEnv(t, "NOTO_VAULT_FIXED")
			} else {
				t.Setenv("NOTO_VAULT_FIXED", tc.value)
			}
			if got := vaultFixedByEnv(); got != tc.want {
				t.Fatalf("vaultFixedByEnv() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestDataDirDoesNotFixTheVault is the regression test of the report that
// the storage could not be changed: the variables that choose the default
// location of the data must not fix the storage.
func TestDataDirDoesNotFixTheVault(t *testing.T) {
	t.Setenv("NOTO_DATA_DIR", t.TempDir())
	t.Setenv("NOTO_NOTES_DIR", t.TempDir())
	if vaultFixedByEnv() {
		t.Fatal("the data directory fixed the storage")
	}

	// The environment still wins over the stored vault configuration.
	cfg := config.Config{NotesDir: t.TempDir()}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	vaultPath, _, err := resolveVault(cfg, logger)
	if err != nil {
		t.Fatalf("resolve vault: %v", err)
	}
	if vaultPath != "" {
		t.Fatalf("the environment did not win over the stored vault: %q", vaultPath)
	}
}

// unsetEnv removes an environment variable for the duration of the test.
func unsetEnv(t *testing.T, key string) {
	t.Helper()
	old, ok := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("unset %s: %v", key, err)
	}
	t.Cleanup(func() {
		if ok {
			_ = os.Setenv(key, old)
		}
	})
}
