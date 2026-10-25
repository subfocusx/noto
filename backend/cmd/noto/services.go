package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"noto/backend/internal/api"
	"noto/backend/internal/audit"
	"noto/backend/internal/auth"
	"noto/backend/internal/config"
	"noto/backend/internal/webhooks"
)

// services holds the optional services of the server and the resources they
// need.
type services struct {
	// api holds the services that the API server uses.
	api api.Services
	// cleanup releases the resources of the services.
	cleanup func()
	// worker delivers the events of the webhooks in the background.
	worker *webhooks.Worker
}

// applyVaultPaths moves the files of the optional services into the data
// directory of the current vault.
//
// The paths that the environment sets explicitly are kept: the user decides
// where the accounts, the audit log and the webhooks live.
func applyVaultPaths(cfg config.Config) config.Config {
	if os.Getenv("NOTO_CREDENTIALS_PATH") == "" {
		cfg.CredentialsPath = filepath.Join(cfg.DataDir, "credentials.db")
	}
	if os.Getenv("NOTO_AUDIT_PATH") == "" {
		cfg.AuditPath = filepath.Join(cfg.DataDir, "audit.db")
	}
	if os.Getenv("NOTO_WEBHOOKS_PATH") == "" {
		cfg.WebhooksPath = filepath.Join(cfg.DataDir, "webhooks.db")
	}
	return cfg
}

// openServices opens the optional services of the server: the accounts of the
// users, the audit log and the webhooks.
//
// The audit log and the webhooks are always open: they keep their data in
// their own file inside the data directory of the vault. The accounts are
// only opened when the authentication is enabled.
func openServices(ctx context.Context, cfg config.Config, logger *slog.Logger) (*services, error) {
	out := &services{cleanup: func() {}}
	cfg = applyVaultPaths(cfg)

	auditLog, err := audit.Open(cfg.AuditPath)
	if err != nil {
		return nil, fmt.Errorf("cannot open the audit log: %w", err)
	}
	out.cleanup = func() { _ = auditLog.Close() }
	out.api.Audit = auditLog

	webhookStore, err := webhooks.Open(cfg.WebhooksPath)
	if err != nil {
		out.cleanup()
		return nil, fmt.Errorf("cannot open the webhooks: %w", err)
	}
	previous := out.cleanup
	out.cleanup = func() {
		previous()
		_ = webhookStore.Close()
	}
	out.api.Webhooks = webhookStore

	if cfg.AuthEnabled {
		authStore, err := auth.Open(cfg.CredentialsPath)
		if err != nil {
			out.cleanup()
			return nil, fmt.Errorf("cannot open the credentials: %w", err)
		}
		previous = out.cleanup
		out.cleanup = func() {
			previous()
			_ = authStore.Close()
		}
		out.api.Auth = authStore
		if err := bootstrapAdmin(ctx, authStore, logger); err != nil {
			out.cleanup()
			return nil, err
		}
	}

	deliverer := webhooks.NewDeliverer(webhookStore, webhooks.DelivererOptions{Logger: logger})
	out.worker = webhooks.NewWorker(deliverer, 5*time.Second, 20, logger)
	return out, nil
}

// bootstrapAdmin creates the first administrator of the server.
//
// The password comes from the variable NOTO_ADMIN_PASSWORD. When the variable
// is not set, a random password is generated and printed once on the
// console: it is never written to the logs.
func bootstrapAdmin(ctx context.Context, store *auth.Store, logger *slog.Logger) error {
	users, err := store.Users(ctx)
	if err != nil {
		return fmt.Errorf("cannot read the accounts: %w", err)
	}
	if len(users) > 0 {
		return nil
	}
	password := os.Getenv("NOTO_ADMIN_PASSWORD")
	generated := false
	if password == "" {
		var err error
		password, err = randomPassword()
		if err != nil {
			return err
		}
		generated = true
	}
	if _, err := store.CreateUser(ctx, "admin", password, auth.RoleAdmin); err != nil {
		return fmt.Errorf("cannot create the administrator: %w", err)
	}
	if generated {
		fmt.Println("Noto created the administrator \"admin\" with the password:", password)
		fmt.Println("Change it after the first login.")
	}
	logger.Info("the administrator account was created")
	return nil
}

// randomPassword returns a random password of an account.
func randomPassword() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("cannot read the password: %w", err)
	}
	return hex.EncodeToString(b), nil
}
