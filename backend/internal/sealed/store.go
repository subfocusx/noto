// Package sealed implements the blind object store of Noto.
//
// In sealed mode the browser encrypts every object and every manifest before
// it is written, so the server stores only ciphertext. The store therefore
// never parses, decrypts or inspects the payload: it is a dumb object store
// with an atomic write, a strict validation of the identifiers and a size
// limit. The plaintext only exists in the browser.
package sealed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// The constants of the layout of a sealed vault.
const (
	// ModeSealed is the mode of a vault whose content is encrypted by the
	// client.
	ModeSealed = "sealed"
	// ModeOpen is the mode of an ordinary vault.
	ModeOpen = "open"
	// Format is the version of the layout of a sealed vault. It is stored
	// in the configuration file, so that a future layout can be detected.
	Format = 1

	// MaxObjectSize is the maximum size of a stored object in bytes. The
	// limit protects the server from a client that sends a huge blob.
	MaxObjectSize = 64 << 20
	// MaxKeystoreSize is the maximum size of the keystore in bytes. The
	// keystore holds the wrapped key, so it is small.
	MaxKeystoreSize = 1 << 20

	// objectsDir holds the encrypted objects.
	objectsDir = "objects"
	// manifestsDir holds the encrypted manifests.
	manifestsDir = "manifests"
	// configFile holds the mode of the vault.
	configFile = "config.json"
	// keystoreFile holds the keystore of the client.
	keystoreFile = "keystore.json"
	// suffix is the extension of an encrypted blob.
	suffix = ".nse"
)

// The sentinel errors of the package. The API layer maps them to the stable
// error codes of the REST API.
var (
	// ErrInvalidPath means that the root of the store is not usable.
	ErrInvalidPath = errors.New("invalid_path")
	// ErrInvalidID means that an object identifier is not a valid one.
	ErrInvalidID = errors.New("invalid_id")
	// ErrInvalidGeneration means that a manifest generation is not a
	// positive integer.
	ErrInvalidGeneration = errors.New("invalid_generation")
	// ErrTooLarge means that a payload is bigger than the size limit.
	ErrTooLarge = errors.New("payload_too_large")
)

// config is the content of the configuration file of a sealed vault. It
// holds no secret: the mode and the format of the vault are public.
type config struct {
	Mode   string `json:"mode"`
	Format int    `json:"format"`
}

// Store is the blind object store of a sealed vault. The zero value is not
// usable: use New.
type Store struct {
	// root is the internal directory of the vault, the ".noto" directory.
	root string
}

// New creates a store over the given root directory. The root is the
// internal directory of the vault: "<vault>/.noto".
//
// The constructor does not touch the disk, so that a store can be created
// to read the mode of a vault that does not exist yet.
func New(root string) (*Store, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, fmt.Errorf("%w: the root directory is empty", ErrInvalidPath)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("%w: cannot resolve the root directory: %v", ErrInvalidPath, err)
	}
	return &Store{root: filepath.Clean(abs)}, nil
}

// Root returns the root directory of the store.
func (s *Store) Root() string { return s.root }

// PutObject stores an encrypted object under the given identifier. The
// payload is written byte for byte: the store never transforms it.
func (s *Store) PutObject(ctx context.Context, id string, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.objectPath(id)
	if err != nil {
		return err
	}
	if len(data) > MaxObjectSize {
		return fmt.Errorf("%w: the object is bigger than %d bytes", ErrTooLarge, MaxObjectSize)
	}
	return writeAtomic(path, data)
}

// GetObject returns the encrypted object of the given identifier. A missing
// object is reported with os.ErrNotExist.
func (s *Store) GetObject(ctx context.Context, id string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path, err := s.objectPath(id)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, wrapNotExist(err, path)
	}
	return data, nil
}

// DeleteObject removes the encrypted object of the given identifier.
func (s *Store) DeleteObject(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.objectPath(id)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		return wrapNotExist(err, path)
	}
	return nil
}

// ListObjects returns the identifiers of every stored object, sorted.
func (s *Store) ListObjects(ctx context.Context) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	dir := filepath.Join(s.root, objectsDir)
	shards, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, fmt.Errorf("cannot list the objects: %w", err)
	}
	ids := []string{}
	for _, shard := range shards {
		if !shard.IsDir() {
			continue
		}
		files, err := os.ReadDir(filepath.Join(dir, shard.Name()))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("cannot list the objects: %w", err)
		}
		for _, file := range files {
			if file.IsDir() {
				continue
			}
			name := file.Name()
			if !strings.HasSuffix(name, suffix) {
				continue
			}
			id := strings.TrimSuffix(name, suffix)
			// A file with an unexpected name is not ours: it is ignored
			// instead of failing the whole listing.
			if !validID(id) {
				continue
			}
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids, nil
}

// PutManifest stores an encrypted manifest under the given generation.
func (s *Store) PutManifest(ctx context.Context, gen uint64, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.manifestPath(gen)
	if err != nil {
		return err
	}
	if len(data) > MaxObjectSize {
		return fmt.Errorf("%w: the manifest is bigger than %d bytes", ErrTooLarge, MaxObjectSize)
	}
	return writeAtomic(path, data)
}

// GetManifest returns the encrypted manifest of the given generation.
func (s *Store) GetManifest(ctx context.Context, gen uint64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path, err := s.manifestPath(gen)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, wrapNotExist(err, path)
	}
	return data, nil
}

// ListManifests returns the generations of every stored manifest, sorted in
// ascending order.
func (s *Store) ListManifests(ctx context.Context) ([]uint64, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	dir := filepath.Join(s.root, manifestsDir)
	files, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []uint64{}, nil
		}
		return nil, fmt.Errorf("cannot list the manifests: %w", err)
	}
	gens := []uint64{}
	for _, file := range files {
		if file.IsDir() {
			continue
		}
		name := file.Name()
		if !strings.HasSuffix(name, suffix) {
			continue
		}
		gen, err := strconv.ParseUint(strings.TrimSuffix(name, suffix), 10, 64)
		if err != nil || gen == 0 {
			continue
		}
		gens = append(gens, gen)
	}
	sort.Slice(gens, func(i, j int) bool { return gens[i] < gens[j] })
	return gens, nil
}

// DeleteManifest removes the encrypted manifest of the given generation.
func (s *Store) DeleteManifest(ctx context.Context, gen uint64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.manifestPath(gen)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		return wrapNotExist(err, path)
	}
	return nil
}

// PutKeystore stores the keystore of the client. The keystore holds the
// parameters of the key derivation and the wrapped data encryption key, so it
// is plain JSON, but the store does not parse it.
func (s *Store) PutKeystore(ctx context.Context, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(data) > MaxKeystoreSize {
		return fmt.Errorf("%w: the keystore is bigger than %d bytes", ErrTooLarge, MaxKeystoreSize)
	}
	return writeAtomic(filepath.Join(s.root, keystoreFile), data)
}

// GetKeystore returns the keystore of the client. A missing keystore is
// reported with os.ErrNotExist.
func (s *Store) GetKeystore(ctx context.Context) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path := filepath.Join(s.root, keystoreFile)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, wrapNotExist(err, path)
	}
	return data, nil
}

// Mode returns the mode of the vault: "sealed", "open" or an empty string
// when the vault has no configuration file.
func (s *Store) Mode(ctx context.Context) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(s.root, configFile))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("cannot read the configuration of the vault: %w", err)
	}
	var c config
	if err := json.Unmarshal(data, &c); err != nil {
		return "", fmt.Errorf("the configuration of the vault is not valid JSON: %w", err)
	}
	return strings.TrimSpace(c.Mode), nil
}

// EnableSealed writes the configuration file of a sealed vault. It does not
// touch the other files of the vault: the migration of the plaintext is done
// by the client, which deletes it only after its own verification.
func (s *Store) EnableSealed(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	data, err := json.Marshal(config{Mode: ModeSealed, Format: Format})
	if err != nil {
		return fmt.Errorf("cannot encode the configuration of the vault: %w", err)
	}
	data = append(data, '\n')
	if err := writeAtomic(filepath.Join(s.root, configFile), data); err != nil {
		return err
	}
	return nil
}

// objectPath returns the path of an object. The identifier is validated, so
// that a hostile identifier cannot escape the store.
func (s *Store) objectPath(id string) (string, error) {
	if !validID(id) {
		return "", fmt.Errorf("%w: the identifier must be 32 lowercase hexadecimal characters", ErrInvalidID)
	}
	// The objects are spread over 256 shards, so that a directory does not
	// hold thousands of entries.
	return filepath.Join(s.root, objectsDir, id[:2], id+suffix), nil
}

// manifestPath returns the path of a manifest.
func (s *Store) manifestPath(gen uint64) (string, error) {
	if gen == 0 {
		return "", fmt.Errorf("%w: the generation must be a positive integer", ErrInvalidGeneration)
	}
	return filepath.Join(s.root, manifestsDir, strconv.FormatUint(gen, 10)+suffix), nil
}

// validID reports whether the identifier is a valid object identifier: 32
// lowercase hexadecimal characters. Every other character, and every path
// separator, is rejected.
func validID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch {
		case c >= '0' && c <= '9':
		case c >= 'a' && c <= 'f':
		default:
			return false
		}
	}
	return true
}

// wrapNotExist keeps the os.ErrNotExist sentinel of a missing file, so that
// the API can answer with a 404.
func wrapNotExist(err error, path string) error {
	if os.IsNotExist(err) {
		return fmt.Errorf("%w: %s does not exist", os.ErrNotExist, filepath.Base(path))
	}
	return err
}

// writeAtomic writes the data in the given path. The data is written in a
// temporary file of the same directory, flushed and renamed over the target,
// so that a reader never sees a half written file and a failed write leaves
// the previous content intact.
func writeAtomic(path string, data []byte) (err error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("cannot create %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, ".noto-tmp-*")
	if err != nil {
		return fmt.Errorf("cannot create a temporary file: %w", err)
	}
	name := tmp.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(name)
		}
	}()
	if _, err = tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("cannot write the temporary file: %w", err)
	}
	// The data must reach the disk before the rename, so that a crash never
	// leaves a file with a valid name and an incomplete content.
	if err = tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("cannot flush the temporary file: %w", err)
	}
	if err = tmp.Close(); err != nil {
		return fmt.Errorf("cannot close the temporary file: %w", err)
	}
	if err = os.Rename(name, path); err != nil {
		return fmt.Errorf("cannot store the file: %w", err)
	}
	return nil
}
