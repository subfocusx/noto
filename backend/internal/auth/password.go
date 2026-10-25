package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// The parameters of the password hashing.
//
// The hash is PBKDF2-HMAC-SHA256 (RFC 8018) with a random salt of 16 bytes
// and 600000 iterations, the number that the OWASP password storage cheat
// sheet recommends for PBKDF2-HMAC-SHA256.
//
// The repository has no dependency on golang.org/x/crypto, and the machine
// that builds Noto has no network access, so the key derivation function is
// implemented here with the standard library (crypto/hmac, crypto/sha256)
// instead of bcrypt or argon2id. The encoded form is self describing, so the
// parameters can be raised later without breaking the existing accounts.
const (
	// hashScheme is the identifier of the hashing scheme in the encoded hash.
	hashScheme = "pbkdf2-sha256"
	// hashIterations is the number of iterations of the derivation.
	hashIterations = 600000
	// hashKeyLen is the length of the derived key in bytes.
	hashKeyLen = 32
	// hashSaltLen is the length of the random salt in bytes.
	hashSaltLen = 16
)

// ErrInvalidHash reports that an encoded hash is malformed.
var ErrInvalidHash = errors.New("auth: the encoded hash is invalid")

// HashPassword derives the hash of a password with a random salt.
//
// The result is self describing: "pbkdf2-sha256$<iterations>$<salt>$<key>",
// with the salt and the key encoded in base64 (raw, without padding).
func HashPassword(password string) (string, error) {
	salt := make([]byte, hashSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: cannot read the salt: %w", err)
	}
	key := pbkdf2SHA256([]byte(password), salt, hashIterations, hashKeyLen)
	return strings.Join([]string{
		hashScheme,
		strconv.Itoa(hashIterations),
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	}, "$"), nil
}

// VerifyPassword reports whether the password matches the encoded hash. The
// comparison is constant time. A malformed hash never matches.
func VerifyPassword(encoded, password string) bool {
	scheme, iterations, salt, key, err := decodeHash(encoded)
	if err != nil {
		return false
	}
	if scheme != hashScheme {
		return false
	}
	got := pbkdf2SHA256([]byte(password), salt, iterations, len(key))
	return subtle.ConstantTimeCompare(got, key) == 1
}

// decodeHash parses an encoded hash.
func decodeHash(encoded string) (scheme string, iterations int, salt, key []byte, err error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 {
		return "", 0, nil, nil, ErrInvalidHash
	}
	scheme = parts[0]
	iterations, err = strconv.Atoi(parts[1])
	if err != nil || iterations <= 0 {
		return "", 0, nil, nil, ErrInvalidHash
	}
	salt, err = base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", 0, nil, nil, ErrInvalidHash
	}
	key, err = base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return "", 0, nil, nil, ErrInvalidHash
	}
	if len(salt) == 0 || len(key) == 0 {
		return "", 0, nil, nil, ErrInvalidHash
	}
	return scheme, iterations, salt, key, nil
}

// pbkdf2SHA256 implements PBKDF2 with HMAC-SHA256 (RFC 8018, section 5.2).
func pbkdf2SHA256(password, salt []byte, iterations, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	hashLen := prf.Size()
	blocks := (keyLen + hashLen - 1) / hashLen
	out := make([]byte, 0, blocks*hashLen)
	buf := make([]byte, 4)
	u := make([]byte, hashLen)
	t := make([]byte, hashLen)

	for block := 1; block <= blocks; block++ {
		prf.Reset()
		prf.Write(salt)
		buf[0] = byte(block >> 24)
		buf[1] = byte(block >> 16)
		buf[2] = byte(block >> 8)
		buf[3] = byte(block)
		prf.Write(buf)
		u = prf.Sum(u[:0])
		copy(t, u)
		for i := 1; i < iterations; i++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(u[:0])
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}
