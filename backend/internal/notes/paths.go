package notes

import (
	"os"
	"path"
	"path/filepath"
	"strings"
)

// reservedNames are the Windows device names that must not be used as file or
// folder names.
var reservedNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true,
	"COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true,
	"LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// invalidNameChars are characters that are not allowed inside a name.
const invalidNameChars = `/\:*?"<>|`

// normalizeRel validates and normalises a slash separated path relative to
// the notes root.
//
// Absolute paths, "..", empty segments, drive letters, backslashes and NUL
// bytes are rejected. The empty string denotes the notes root itself.
func normalizeRel(p string) (string, error) {
	if strings.ContainsRune(p, 0) {
		return "", newErr(ErrInvalidPath, "path contains a NUL byte")
	}
	if strings.Contains(p, "\\") {
		return "", newErr(ErrInvalidPath, "path must not contain backslashes")
	}
	if p == "" {
		return "", nil
	}
	if strings.HasPrefix(p, "/") {
		return "", newErr(ErrInvalidPath, "path must be relative")
	}
	if hasDriveLetter(p) {
		return "", newErr(ErrInvalidPath, "path must not contain a drive letter")
	}
	segments := strings.Split(p, "/")
	for _, seg := range segments {
		switch seg {
		case "":
			return "", newErr(ErrInvalidPath, "path must not contain empty segments")
		case ".":
			return "", newErr(ErrInvalidPath, "path must not contain %q segments", ".")
		case "..":
			return "", newErr(ErrInvalidPath, "path must not contain %q segments", "..")
		}
		if seg != strings.TrimSpace(seg) {
			return "", newErr(ErrInvalidPath, "path must not contain leading or trailing spaces")
		}
	}
	clean := path.Clean(p)
	if clean == "." {
		return "", nil
	}
	return clean, nil
}

// hasDriveLetter reports whether the path starts with a Windows drive letter
// such as "C:" or "C:foo".
func hasDriveLetter(p string) bool {
	if len(p) >= 2 && p[1] == ':' {
		c := p[0]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') {
			return true
		}
	}
	return false
}

// validateName checks a single path segment (a file or folder name).
func validateName(name string) error {
	if name == "" {
		return newErr(ErrInvalidName, "name must not be empty")
	}
	if name == "." || name == ".." {
		return newErr(ErrInvalidName, "name %q is not allowed", name)
	}
	if strings.ContainsRune(name, 0) {
		return newErr(ErrInvalidName, "name contains a NUL byte")
	}
	if strings.ContainsAny(name, invalidNameChars) {
		return newErr(ErrInvalidName, "name %q contains an invalid character", name)
	}
	if strings.TrimSpace(name) != name {
		return newErr(ErrInvalidName, "name must not have leading or trailing spaces")
	}
	if strings.HasSuffix(name, ".") {
		return newErr(ErrInvalidName, "name must not end with a dot")
	}
	base := name
	if i := strings.Index(base, "."); i > 0 {
		base = base[:i]
	}
	// Windows ignores the trailing spaces and dots of a device name, so
	// "CON .md" is the reserved device "CON".
	base = strings.TrimRight(base, " .")
	if reservedNames[strings.ToUpper(base)] {
		return newErr(ErrInvalidName, "name %q is a reserved device name", name)
	}
	return nil
}

// joinRel joins a parent path and a name into a normalised relative path.
func joinRel(parent, name string) (string, error) {
	if err := validateName(name); err != nil {
		return "", err
	}
	p := name
	if parent != "" {
		p = parent + "/" + name
	}
	return normalizeRel(p)
}

// BaseName returns the last segment of a relative path.
func BaseName(rel string) string { return baseOf(rel) }

// withinRoot reports whether p is located inside root.
func withinRoot(root, p string) bool {
	if root == "" {
		return false
	}
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return !filepath.IsAbs(rel)
}

// realPath resolves symbolic links of the longest existing prefix of abs and
// returns the resolved path.
func realPath(abs string) (string, error) {
	p := abs
	for {
		if _, err := os.Lstat(p); err == nil {
			return filepath.EvalSymlinks(p)
		} else if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(p)
		if parent == p {
			return abs, nil
		}
		p = parent
	}
}

// resolve turns a relative path into an absolute path inside the notes root.
// It rejects paths that escape the root and paths that traverse a symbolic
// link or a reparse point (a Windows junction) pointing outside of the root.
func (s *Service) resolve(rel string) (string, error) {
	norm, err := normalizeRel(rel)
	if err != nil {
		return "", err
	}
	abs := filepath.Join(s.notesRoot, filepath.FromSlash(norm))
	if !withinRoot(s.rootReal, abs) {
		return "", newErr(ErrInvalidPath, "path escapes the notes directory")
	}
	if err := s.checkComponents(norm); err != nil {
		return "", err
	}
	real, err := realPath(abs)
	if err != nil {
		return "", newErr(ErrInvalidPath, "path cannot be resolved")
	}
	if !withinRoot(s.rootReal, real) {
		return "", newErr(ErrInvalidPath, "path escapes the notes directory")
	}
	return abs, nil
}

// checkComponents walks every component of the relative path and refuses the
// path when a component is a symbolic link or a reparse point (a Windows
// junction) that leaves the notes root.
//
// filepath.EvalSymlinks does not resolve Windows mount points, so the
// components are inspected one by one.
func (s *Service) checkComponents(rel string) error {
	if rel == "" {
		return nil
	}
	cur := s.notesRoot
	for _, seg := range strings.Split(rel, "/") {
		cur = filepath.Join(cur, seg)
		target, isLink, err := linkTarget(cur)
		if err != nil {
			return newErr(ErrInvalidPath, "path cannot be resolved")
		}
		if !isLink {
			continue
		}
		abs := linkTargetPath(target, filepath.Dir(cur))
		if abs == "" {
			return newErr(ErrInvalidPath, "path escapes the notes directory")
		}
		real, err := realPath(abs)
		if err != nil {
			return newErr(ErrInvalidPath, "path escapes the notes directory")
		}
		if !withinRoot(s.rootReal, real) {
			return newErr(ErrInvalidPath, "path escapes the notes directory")
		}
	}
	return nil
}

// linkTargetPath turns the target of a symbolic link or a reparse point into
// an absolute path. The Windows NT prefixes ("\??\") are removed.
func linkTargetPath(target, base string) string {
	t := strings.TrimSpace(target)
	if t == "" {
		return ""
	}
	for _, prefix := range []string{`\??\`, `\\?\`} {
		if strings.HasPrefix(t, prefix) {
			t = strings.TrimPrefix(t, prefix)
			break
		}
	}
	if t == "" {
		return ""
	}
	if !filepath.IsAbs(t) {
		t = filepath.Join(base, t)
	}
	return filepath.Clean(t)
}

// relativeTo converts an absolute path inside the notes root back into a
// slash separated relative path.
func (s *Service) relativeTo(abs string) string {
	rel, err := filepath.Rel(s.notesRoot, abs)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	if rel == "." {
		return ""
	}
	return rel
}
