package notes

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// This file contains the property based tests of the path helpers. The
// tests live in the package "notes" (and not in "notes_test") because
// normalizeRel, joinRel and validateName are not exported.
//
// The properties below are a characterisation of the *current* behaviour of
// backend/internal/notes/paths.go. Every rule that is checked here is
// derived from that file, not from an imagined specification:
//
//   - normalizeRel rejects a path that contains a NUL byte, a backslash, a
//     drive letter ("C:foo"), an absolute path (a leading "/"), an empty
//     segment ("a//b"), the segments "." and ".." and a segment with
//     leading or trailing whitespace. The empty string is *accepted* and
//     denotes the notes root itself; the result of a successful call is
//     therefore allowed to be empty.
//   - A successful normalizeRel returns exactly the input: because no
//     segment can be "", "." or "..", path.Clean is the identity function
//     on every accepted path.
//   - joinRel validates the name first (validateName) and then concatenates
//     the parent and the name with a single "/" before the result is
//     normalised. A parent that is not a clean relative path is therefore
//     rejected by the normalisation step.
//   - validateName rejects the empty name, "." and "..", a NUL byte, every
//     character of invalidNameChars ("/\:*?"<>|"), a control character (the C0
//     range and the delete character), a name with leading or
//     trailing whitespace and a name with a trailing dot. It rejects the
//     Windows device names (reservedNames) case insensitively; the device
//     name is the part before the first dot, with trailing dots and spaces
//     removed, so "con.txt", "CON.md" and "con .md" are all rejected. A name
//     longer than maxNameRunes characters is rejected as well.

// hasDotSegment reports whether the path contains a "." or ".." segment.
func hasDotSegment(p string) bool {
	for _, seg := range strings.Split(p, "/") {
		if seg == "." || seg == ".." {
			return true
		}
	}
	return false
}

// reservedDeviceName returns the Windows device name of a name, if any.
// It mirrors the derivation of validateName: the part before the first dot,
// with trailing dots and spaces removed.
func reservedDeviceName(name string) string {
	base := name
	if i := strings.Index(base, "."); i > 0 {
		base = base[:i]
	}
	base = strings.TrimRight(base, " .")
	if reservedNames[strings.ToUpper(base)] {
		return strings.ToUpper(base)
	}
	return ""
}

// FuzzNormalizeRel checks that a normalised path is always safe to use.
//
// Invariants (checked for every accepted input):
//
//  1. the error code is invalid_path;
//  2. the result is never absolute and never contains a drive letter;
//  3. the result contains no backslash and no NUL byte;
//  4. the result has no "." and no ".." segment;
//  5. the result is either empty (the notes root) or equal to the input.
func FuzzNormalizeRel(f *testing.F) {
	seeds := []string{
		"", "a", "a/b", "a/b/c", "a/b/c/d.md", "notes/2026/october.md",
		"a b/c d.md", "кириллица/файл.md", "😀/emoji.md", "a//b", "./a", ".",
		"..", "../a", "a/..", "a/../b", "/abs", "/", "C:/x", "c:x",
		`a\b`, "a\\b\\c", "a\x00b", "\x00", " lead", "trail ", " a/b ",
		"a/ b", "a/b ", "%2e%2e", "..%2f..%2fetc", "%2Fetc", "a/./b",
		"note.md", "note.md.", ".hidden", "...", "a/...", " ", "\t", "\n",
		"CON", "con.md", "nul", "COM1.md",
	}
	for _, s := range seeds {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, in string) {
		out, err := normalizeRel(in)
		if err != nil {
			if Code(err) != CodeInvalidPath {
				t.Fatalf("normalizeRel(%q) failed with %q, want %q", in, Code(err), CodeInvalidPath)
			}
			return
		}

		// 1. The result is a relative path.
		if strings.HasPrefix(out, "/") {
			t.Fatalf("normalizeRel(%q) = %q, want a relative path", in, out)
		}
		if hasDriveLetter(out) {
			t.Fatalf("normalizeRel(%q) = %q, want no drive letter", in, out)
		}

		// 2. The result contains no backslash and no NUL byte.
		if strings.Contains(out, "\\") {
			t.Fatalf("normalizeRel(%q) = %q, want no backslash", in, out)
		}
		if strings.ContainsRune(out, 0) {
			t.Fatalf("normalizeRel(%q) = %q, want no NUL byte", in, out)
		}

		// 3. The result has no "." and no ".." segment.
		if hasDotSegment(out) {
			t.Fatalf("normalizeRel(%q) = %q, want no dot segment", in, out)
		}
		if strings.Contains(out, "//") {
			t.Fatalf("normalizeRel(%q) = %q, want no empty segment", in, out)
		}

		// 4. The result is empty (the notes root) or equal to the input.
		// The empty input is the notes root and stays empty.
		if out == "" {
			if in != "" {
				t.Fatalf("normalizeRel(%q) = %q, want the input unchanged", in, out)
			}
			return
		}
		if out != in {
			t.Fatalf("normalizeRel(%q) = %q, want the input unchanged", in, out)
		}
	})
}

// FuzzJoinRel checks that a joined path stays inside its parent.
//
// Invariants (checked for every accepted input):
//
//  1. the error code is invalid_name or invalid_path;
//  2. the result ends with "/name" (or is "name" for an empty parent);
//  3. the result is exactly parent + "/" + name;
//  4. the result has no ".." segment, so it cannot escape the parent.
func FuzzJoinRel(f *testing.F) {
	type pair struct{ parent, name string }
	seeds := []pair{
		{"", "note.md"}, {"", "a"}, {"notes", "note.md"},
		{"notes/2026", "october.md"}, {"кириллица", "файл.md"},
		{"a b", "c d.md"}, {"", "😀.md"}, {"notes", ".."},
		{"notes", "a/b.md"}, {"notes", `a\b.md`}, {"notes", "CON"},
		{"notes", "con.md"}, {"notes", "trailing."}, {"notes", " leading"},
		{"..", "note.md"}, {"notes/..", "note.md"}, {"/abs", "note.md"},
		{"C:/x", "note.md"}, {"notes//x", "note.md"},
	}
	for _, s := range seeds {
		f.Add(s.parent, s.name)
	}

	f.Fuzz(func(t *testing.T, parent, name string) {
		out, err := joinRel(parent, name)
		if err != nil {
			switch Code(err) {
			case CodeInvalidName, CodeInvalidPath:
			default:
				t.Fatalf("joinRel(%q, %q) failed with %q", parent, name, Code(err))
			}
			return
		}

		if parent == "" {
			if out != name {
				t.Fatalf("joinRel(%q, %q) = %q, want %q", parent, name, out, name)
			}
		} else {
			if !strings.HasSuffix(out, "/"+name) {
				t.Fatalf("joinRel(%q, %q) = %q, want a path ending with %q", parent, name, out, "/"+name)
			}
			if out != parent+"/"+name {
				t.Fatalf("joinRel(%q, %q) = %q, want %q", parent, name, out, parent+"/"+name)
			}
		}
		if hasDotSegment(out) {
			t.Fatalf("joinRel(%q, %q) = %q, want no dot segment", parent, name, out)
		}
		if strings.Contains(out, "\\") {
			t.Fatalf("joinRel(%q, %q) = %q, want no backslash", parent, name, out)
		}
	})
}

// FuzzValidateName checks the name rules.
//
// Invariants (checked for every accepted name):
//
//  1. the error code is invalid_name;
//  2. the name is not empty, not "." and not "..";
//  3. the name contains no NUL byte, no character of invalidNameChars and no
//     control character;
//  4. the name has no leading or trailing whitespace;
//  5. the name does not end with a dot;
//  6. the name is not a reserved Windows device name;
//  7. the name is at most maxNameRunes characters long.
func FuzzValidateName(f *testing.F) {
	seeds := []string{
		"note.md", "a", "file name.md", "кириллица.md", "файл.md",
		"😀.md", "note-2026_10.md", ".hidden", "...", "a..b",
		"", ".", "..", "a/b", `a\b`, "a:b", "a*b", "a?b", `a"b`, "a<b",
		"a>b", "a|b", " lead", "trail ", " lead and trail ", "name.",
		"CON", "con", "Con", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1",
		"LPT9", "nul.md", "con.txt", "COM1.md", "con .md", "CON.", "NUL.txt",
		"a\x00b", "\x00", "%2e%2e", "..%2f", "a\nb", "a\tb", "\x01",
		"auxiliary", "console", "com10", "lpt0",
	}
	for _, s := range seeds {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, name string) {
		err := validateName(name)
		if err != nil {
			if Code(err) != CodeInvalidName {
				t.Fatalf("validateName(%q) failed with %q, want %q", name, Code(err), CodeInvalidName)
			}
			return
		}

		if name == "" {
			t.Fatal("validateName accepted the empty name")
		}
		if name == "." || name == ".." {
			t.Fatalf("validateName accepted %q", name)
		}
		if strings.ContainsRune(name, 0) {
			t.Fatalf("validateName accepted the NUL byte in %q", name)
		}
		if strings.ContainsAny(name, invalidNameChars) {
			t.Fatalf("validateName accepted the invalid character in %q", name)
		}
		if _, ok := controlRune(name); ok {
			t.Fatalf("validateName accepted a control character in %q", name)
		}
		if utf8.RuneCountInString(name) > maxNameRunes {
			t.Fatalf("validateName accepted a name of %d characters", utf8.RuneCountInString(name))
		}
		if strings.TrimSpace(name) != name {
			t.Fatalf("validateName accepted the surrounding whitespace in %q", name)
		}
		if strings.HasSuffix(name, ".") {
			t.Fatalf("validateName accepted the trailing dot in %q", name)
		}
		if dev := reservedDeviceName(name); dev != "" {
			t.Fatalf("validateName accepted the reserved device name %q in %q", dev, name)
		}
	})
}

// TestValidateNameRejectsInvalidNames pins the names that must be rejected.
// It is the deterministic companion of FuzzValidateName.
func TestValidateNameRejectsInvalidNames(t *testing.T) {
	cases := []struct {
		name string
		why  string
	}{
		{"", "empty"},
		{".", "the current folder"},
		{"..", "the parent folder"},
		{"a/b", "path separator"},
		{`a\b`, "backslash"},
		{"a:b", "drive separator"},
		{"a*b", "wildcard"},
		{"a?b", "wildcard"},
		{`a"b`, "quote"},
		{"a<b", "redirect"},
		{"a>b", "redirect"},
		{"a|b", "pipe"},
		{" lead", "leading space"},
		{"trail ", "trailing space"},
		{" lead and trail ", "surrounding spaces"},
		{"name.", "trailing dot"},
		{".hidden", "leading dot is allowed, but this is checked below"},
		{"a\x00b", "NUL byte"},
		{"CON", "device name"},
		{"con", "device name, lower case"},
		{"Con", "device name, mixed case"},
		{"PRN", "device name"},
		{"AUX", "device name"},
		{"NUL", "device name"},
		{"COM1", "device name"},
		{"COM9", "device name"},
		{"LPT1", "device name"},
		{"LPT9", "device name"},
		{"nul.md", "device name with an extension"},
		{"con.txt", "device name with an extension"},
		{"COM1.md", "device name with an extension"},
		{"con .md", "device name with a trailing space"},
	}
	for _, c := range cases {
		if c.name == ".hidden" {
			// A leading dot is allowed, only a trailing dot is rejected.
			if err := validateName(c.name); err != nil {
				t.Fatalf("validateName(%q) = %v, want no error", c.name, err)
			}
			continue
		}
		err := validateName(c.name)
		if err == nil {
			t.Fatalf("validateName(%q) accepted the name (%s)", c.name, c.why)
		}
		if Code(err) != CodeInvalidName {
			t.Fatalf("validateName(%q) failed with %q, want %q", c.name, Code(err), CodeInvalidName)
		}
	}
}

// TestValidateNameAcceptsValidNames pins the names that must be accepted.
func TestValidateNameAcceptsValidNames(t *testing.T) {
	names := []string{
		"a", "note.md", "file name.md", "кириллица.md", "файл.md", "😀.md",
		"note-2026_10.md", ".hidden", "a..b", "auxiliary", "console",
		"com10", "lpt0", "COM", "NULA",
	}
	for _, name := range names {
		if err := validateName(name); err != nil {
			t.Fatalf("validateName(%q) = %v, want no error", name, err)
		}
	}
}

// TestValidateNameLimitsAndControlCharacters pins the limits of a name: the
// length limit and the control characters.
//
// The two gaps that the implementation documented are closed: a name that is
// too long is rejected, and a control character is rejected everywhere in the
// name, not only when it is a whitespace character.
func TestValidateNameLimitsAndControlCharacters(t *testing.T) {
	// The longest name that is accepted.
	longest := strings.Repeat("a", maxNameRunes)
	if err := validateName(longest); err != nil {
		t.Fatalf("validateName(<%d chars>) = %v, want no error", maxNameRunes, err)
	}
	// One character more is rejected.
	tooLong := strings.Repeat("a", maxNameRunes+1)
	err := validateName(tooLong)
	if err == nil {
		t.Fatalf("validateName(<%d chars>) accepted the name", maxNameRunes+1)
	}
	if Code(err) != CodeInvalidName {
		t.Fatalf("validateName(<%d chars>) failed with %q, want %q", maxNameRunes+1, Code(err), CodeInvalidName)
	}

	// The limit counts the characters, not the bytes.
	multibyte := strings.Repeat("é", maxNameRunes)
	if err := validateName(multibyte); err != nil {
		t.Fatalf("validateName(<%d multibyte chars>) = %v, want no error", maxNameRunes, err)
	}

	// The control characters are rejected everywhere in the name.
	for _, name := range []string{"a\x01b", "a\nb", "a\tb", "a\rb", "a\x1fb", "a\x7fb", "\x01"} {
		err := validateName(name)
		if err == nil {
			t.Fatalf("validateName(%q) accepted the control character", name)
		}
		if Code(err) != CodeInvalidName {
			t.Fatalf("validateName(%q) failed with %q, want %q", name, Code(err), CodeInvalidName)
		}
	}
}

// TestStripNUL pins the rule of the NUL byte: it is stripped from a name
// instead of rejecting the name.
func TestStripNUL(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"note.md", "note.md"},
		{"no\x00nul.md", "nonul.md"},
		{"\x00", ""},
		{"a\x00b\x00c", "abc"},
	}
	for _, c := range cases {
		if got := stripNUL(c.name); got != c.want {
			t.Fatalf("stripNUL(%q) = %q, want %q", c.name, got, c.want)
		}
	}
}
