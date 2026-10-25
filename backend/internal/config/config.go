// Package config loads the runtime configuration of the Noto server from
// environment variables with sensible local defaults.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config holds every tunable runtime setting of the server.
type Config struct {
	// Addr is the TCP address the HTTP server listens on.
	Addr string
	// DataDir is the root of all persistent state.
	DataDir string
	// NotesDir contains the Markdown files.
	NotesDir string
	// AttachmentsDir contains uploaded binaries.
	AttachmentsDir string
	// TrashDir contains deleted notes that can be restored.
	TrashDir string
	// DBPath is the SQLite database file.
	DBPath string
	// StaticDir contains the built frontend. When empty the embedded assets
	// from internal/web are used.
	StaticDir string
	// AllowedOrigins lists additional origins allowed to call the API.
	AllowedOrigins []string
	// AllowPublic disables the localhost-only guard for reverse proxy setups.
	AllowPublic bool
	// MaxUploadBytes limits a single upload request body.
	MaxUploadBytes int64
	// MaxArchiveBytes limits the uncompressed size of an imported archive.
	MaxArchiveBytes int64
	// RequestTimeout bounds a single request.
	RequestTimeout time.Duration
	// ShutdownTimeout bounds the graceful shutdown.
	ShutdownTimeout time.Duration
	// LogLevel is one of debug, info, warn, error.
	LogLevel string

	// AuthEnabled turns the authentication on. It is off by default, so that
	// the local single user mode keeps working exactly as before.
	AuthEnabled bool
	// CredentialsPath is the SQLite file that holds the accounts and the
	// sessions. It lives in the data directory of the vault.
	CredentialsPath string
	// SessionTTL is the lifetime of a session.
	SessionTTL time.Duration
	// AuditPath is the SQLite file of the append only audit log.
	AuditPath string
	// WebhooksPath is the SQLite file of the webhook subscriptions and of the
	// outbox of the deliveries.
	WebhooksPath string

	// TLSCertFile is the path of the certificate of the server. When it and
	// TLSKeyFile are set, the server serves HTTPS.
	TLSCertFile string
	// TLSKeyFile is the path of the private key of the certificate.
	TLSKeyFile string
}

// TLSEnabled reports whether the server must serve HTTPS.
func (c Config) TLSEnabled() bool {
	return c.TLSCertFile != "" && c.TLSKeyFile != ""
}

// Load reads the configuration from the environment.
func Load() (Config, error) {
	dataDir := envString("NOTO_DATA_DIR", defaultDataDir())
	c := Config{
		Addr:            envString("NOTO_ADDR", "127.0.0.1:8080"),
		DataDir:         dataDir,
		NotesDir:        envString("NOTO_NOTES_DIR", filepath.Join(dataDir, "notes")),
		AttachmentsDir:  envString("NOTO_ATTACHMENTS_DIR", filepath.Join(dataDir, "attachments")),
		TrashDir:        envString("NOTO_TRASH_DIR", filepath.Join(dataDir, "trash")),
		DBPath:          envString("NOTO_DB_PATH", filepath.Join(dataDir, "noto.db")),
		StaticDir:       envString("NOTO_STATIC_DIR", ""),
		AllowedOrigins:  envList("NOTO_ALLOWED_ORIGINS"),
		AllowPublic:     envBool("NOTO_ALLOW_PUBLIC", false),
		MaxUploadBytes:  int64(envInt("NOTO_MAX_UPLOAD_MB", 32)) << 20,
		MaxArchiveBytes: int64(envInt("NOTO_MAX_ARCHIVE_MB", 256)) << 20,
		RequestTimeout:  time.Duration(envInt("NOTO_REQUEST_TIMEOUT_SEC", 60)) * time.Second,
		ShutdownTimeout: time.Duration(envInt("NOTO_SHUTDOWN_TIMEOUT_SEC", 15)) * time.Second,
		LogLevel:        envString("NOTO_LOG_LEVEL", "info"),

		AuthEnabled:     envBool("NOTO_AUTH_ENABLED", false),
		CredentialsPath: envString("NOTO_CREDENTIALS_PATH", filepath.Join(dataDir, "credentials.db")),
		SessionTTL:      time.Duration(envInt("NOTO_SESSION_TTL_SEC", 24*60*60)) * time.Second,
		AuditPath:       envString("NOTO_AUDIT_PATH", filepath.Join(dataDir, "audit.db")),
		WebhooksPath:    envString("NOTO_WEBHOOKS_PATH", filepath.Join(dataDir, "webhooks.db")),

		TLSCertFile: envString("NOTO_TLS_CERT_FILE", ""),
		TLSKeyFile:  envString("NOTO_TLS_KEY_FILE", ""),
	}
	return c, nil
}

// EnsureDirs creates every directory the server needs.
func (c Config) EnsureDirs() error {
	for _, d := range []string{c.DataDir, c.NotesDir, c.AttachmentsDir, c.TrashDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return fmt.Errorf("create %s: %w", d, err)
		}
	}
	return nil
}

// IsLoopback reports whether the configured listen address is local only.
func (c Config) IsLoopback() bool {
	host := c.Addr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		host = host[:i]
	}
	host = strings.Trim(host, "[]")
	switch host {
	case "", "127.0.0.1", "localhost", "::1":
		return true
	}
	return strings.HasPrefix(host, "127.")
}

func defaultDataDir() string {
	if dir, err := os.UserConfigDir(); err == nil && dir != "" {
		return filepath.Join(dir, "noto")
	}
	wd, err := os.Getwd()
	if err != nil {
		return "noto-data"
	}
	return filepath.Join(wd, "noto-data")
}

func envString(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

func envList(key string) []string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func envBool(key string, def bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func envInt(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
