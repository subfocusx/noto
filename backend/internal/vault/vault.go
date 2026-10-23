// Package vault manages the storage folder of the notes.
//
// A vault is an ordinary directory that holds the Markdown notes directly.
// The internal data of the application (the database, the trash and the
// attachments) lives in the ".noto" subdirectory of the vault, so that the
// vault can be opened with any other Markdown editor.
//
// The configuration of the vault is stored outside of the vault, in the user
// configuration directory, so that it survives a change of the folder.
package vault

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"noto/backend/internal/config"
)

// Environment variables of the vault.
const (
	// EnvFile overrides the location of the vault configuration file.
	EnvFile = "NOTO_VAULT_FILE"
	// DataDirName is the name of the internal directory of a vault.
	DataDirName = ".noto"
)

// Sentinel errors of the package. The API layer maps them to the stable
// error codes of the notes package.
var (
	// ErrInvalidPath means that the given path is not a usable vault.
	ErrInvalidPath = errors.New("invalid_path")
	// ErrNotFound means that the path does not exist.
	ErrNotFound = errors.New("not_found")
)

// Config is the persisted configuration of the vault.
type Config struct {
	// Path is the absolute path of the vault directory.
	Path string `json:"path"`
}

// Layout describes the directories that belong to a vault.
type Layout struct {
	// VaultPath is the vault directory itself.
	VaultPath string
	// NotesDir is the directory of the Markdown notes. For a vault it is
	// the vault directory itself.
	NotesDir string
	// DataDir is the internal directory of the vault.
	DataDir string
	// DBPath is the SQLite database of the vault.
	DBPath string
	// TrashDir holds the deleted notes.
	TrashDir string
	// AttachmentsDir holds the uploaded attachments.
	AttachmentsDir string
}

// ConfigFile returns the path of the vault configuration file. The
// NOTO_VAULT_FILE environment variable overrides the default location in the
// user configuration directory.
func ConfigFile() (string, error) {
	if v := strings.TrimSpace(os.Getenv(EnvFile)); v != "" {
		return filepath.Clean(v), nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine the user configuration directory: %w", err)
	}
	return filepath.Join(dir, "noto", "vault.json"), nil
}

// Read returns the persisted configuration. The second result reports
// whether a vault is configured. A missing configuration file is not an
// error.
func Read() (Config, bool, error) {
	file, err := ConfigFile()
	if err != nil {
		return Config{}, false, err
	}
	data, err := os.ReadFile(file)
	if err != nil {
		if os.IsNotExist(err) {
			return Config{}, false, nil
		}
		return Config{}, false, fmt.Errorf("cannot read the vault configuration: %w", err)
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return Config{}, false, fmt.Errorf("the vault configuration is not valid JSON: %w", err)
	}
	c.Path = strings.TrimSpace(c.Path)
	if c.Path == "" {
		return Config{}, false, nil
	}
	return c, true, nil
}

// Write validates the given directory and stores it as the configuration of
// the vault. The stored path is absolute and cleaned.
func Write(path string) (Config, error) {
	layout, err := Resolve(path)
	if err != nil {
		return Config{}, err
	}
	file, err := ConfigFile()
	if err != nil {
		return Config{}, err
	}
	if dir := filepath.Dir(file); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return Config{}, fmt.Errorf("cannot create the configuration directory: %w", err)
		}
	}
	data, err := json.Marshal(Config{Path: layout.VaultPath})
	if err != nil {
		return Config{}, fmt.Errorf("cannot encode the vault configuration: %w", err)
	}
	data = append(data, '\n')
	tmp, err := os.CreateTemp(filepath.Dir(file), ".vault-*.json")
	if err != nil {
		return Config{}, fmt.Errorf("cannot create the vault configuration: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return Config{}, fmt.Errorf("cannot write the vault configuration: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return Config{}, fmt.Errorf("cannot write the vault configuration: %w", err)
	}
	if err := os.Rename(tmpName, file); err != nil {
		return Config{}, fmt.Errorf("cannot store the vault configuration: %w", err)
	}
	return Config{Path: layout.VaultPath}, nil
}

// Clear removes the persisted configuration. A missing configuration file is
// not an error.
func Clear() error {
	file, err := ConfigFile()
	if err != nil {
		return err
	}
	if err := os.Remove(file); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("cannot remove the vault configuration: %w", err)
	}
	return nil
}

// Validate checks that the given path can be used as a vault: it must exist,
// it must be a directory and it must be writable.
func Validate(path string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("%w: the path is empty", ErrInvalidPath)
	}
	if strings.ContainsRune(path, 0) {
		return fmt.Errorf("%w: the path contains a NUL byte", ErrInvalidPath)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("%w: cannot resolve the path", ErrInvalidPath)
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("%w: the directory does not exist", ErrNotFound)
		}
		return fmt.Errorf("%w: cannot stat the directory", ErrInvalidPath)
	}
	if !info.IsDir() {
		return fmt.Errorf("%w: the path is not a directory", ErrInvalidPath)
	}
	if err := checkWritable(abs); err != nil {
		return err
	}
	return nil
}

// checkWritable verifies that a file can be created in the directory.
func checkWritable(dir string) error {
	f, err := os.CreateTemp(dir, ".noto-write-*")
	if err != nil {
		return fmt.Errorf("%w: the directory is not writable", ErrInvalidPath)
	}
	name := f.Name()
	_ = f.Close()
	_ = os.Remove(name)
	return nil
}

// Resolve validates the given path and returns the layout of the vault.
func Resolve(path string) (Layout, error) {
	if err := Validate(path); err != nil {
		return Layout{}, err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return Layout{}, fmt.Errorf("%w: cannot resolve the path", ErrInvalidPath)
	}
	abs = filepath.Clean(abs)
	data := filepath.Join(abs, DataDirName)
	return Layout{
		VaultPath:      abs,
		NotesDir:       abs,
		DataDir:        data,
		DBPath:         filepath.Join(data, "noto.db"),
		TrashDir:       filepath.Join(data, "trash"),
		AttachmentsDir: filepath.Join(data, "attachments"),
	}, nil
}

// ApplyTo returns a copy of the configuration that points to the given vault.
// The unrelated settings of the configuration are kept.
func ApplyTo(cfg config.Config, path string) (config.Config, Layout, error) {
	layout, err := Resolve(path)
	if err != nil {
		return cfg, Layout{}, err
	}
	cfg.DataDir = layout.DataDir
	cfg.NotesDir = layout.NotesDir
	cfg.DBPath = layout.DBPath
	cfg.TrashDir = layout.TrashDir
	cfg.AttachmentsDir = layout.AttachmentsDir
	return cfg, layout, nil
}
