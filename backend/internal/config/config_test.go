package config_test

import (
	"path/filepath"
	"testing"
	"time"

	"noto/backend/internal/config"
)

// TestTheDefaultsKeepTheLocalMode makes sure that the authentication is off
// and that the TLS is off by default: the local single user mode works as
// before.
func TestTheDefaultsKeepTheLocalMode(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NOTO_DATA_DIR", dir)

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load the configuration: %v", err)
	}
	if cfg.AuthEnabled {
		t.Fatalf("the authentication must be off by default")
	}
	if cfg.TLSEnabled() {
		t.Fatalf("the TLS must be off by default")
	}
	if cfg.CredentialsPath != filepath.Join(dir, "credentials.db") {
		t.Fatalf("unexpected path of the credentials: %q", cfg.CredentialsPath)
	}
	if cfg.AuditPath != filepath.Join(dir, "audit.db") {
		t.Fatalf("unexpected path of the audit log: %q", cfg.AuditPath)
	}
	if cfg.WebhooksPath != filepath.Join(dir, "webhooks.db") {
		t.Fatalf("unexpected path of the webhooks: %q", cfg.WebhooksPath)
	}
	if cfg.SessionTTL != 24*time.Hour {
		t.Fatalf("unexpected lifetime of the sessions: %s", cfg.SessionTTL)
	}
}

// TestTheAuthenticationIsConfigured makes sure that the authentication and
// the lifetime of the sessions are read from the environment.
func TestTheAuthenticationIsConfigured(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NOTO_DATA_DIR", dir)
	t.Setenv("NOTO_AUTH_ENABLED", "true")
	t.Setenv("NOTO_SESSION_TTL_SEC", "60")
	t.Setenv("NOTO_CREDENTIALS_PATH", filepath.Join(dir, "accounts.db"))

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load the configuration: %v", err)
	}
	if !cfg.AuthEnabled {
		t.Fatalf("the authentication is not enabled")
	}
	if cfg.SessionTTL != time.Minute {
		t.Fatalf("unexpected lifetime of the sessions: %s", cfg.SessionTTL)
	}
	if cfg.CredentialsPath != filepath.Join(dir, "accounts.db") {
		t.Fatalf("unexpected path of the credentials: %q", cfg.CredentialsPath)
	}
}

// TestTheTLSIsConfigured makes sure that the certificate and the key are read
// from the environment.
func TestTheTLSIsConfigured(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NOTO_DATA_DIR", dir)

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load the configuration: %v", err)
	}
	if cfg.TLSEnabled() {
		t.Fatalf("the TLS must be off without a certificate")
	}

	t.Setenv("NOTO_TLS_CERT_FILE", filepath.Join(dir, "cert.pem"))
	t.Setenv("NOTO_TLS_KEY_FILE", filepath.Join(dir, "key.pem"))
	cfg, err = config.Load()
	if err != nil {
		t.Fatalf("load the configuration: %v", err)
	}
	if !cfg.TLSEnabled() {
		t.Fatalf("the TLS is not enabled")
	}
	if cfg.TLSCertFile != filepath.Join(dir, "cert.pem") {
		t.Fatalf("unexpected certificate: %q", cfg.TLSCertFile)
	}
	if cfg.TLSKeyFile != filepath.Join(dir, "key.pem") {
		t.Fatalf("unexpected key: %q", cfg.TLSKeyFile)
	}

	// A certificate without a key is not enough.
	t.Setenv("NOTO_TLS_KEY_FILE", "")
	cfg, err = config.Load()
	if err != nil {
		t.Fatalf("load the configuration: %v", err)
	}
	if cfg.TLSEnabled() {
		t.Fatalf("the TLS must be off without a key")
	}
}
