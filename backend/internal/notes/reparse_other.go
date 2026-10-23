//go:build !windows

package notes

import "os"

// linkTarget reports whether path is a symbolic link and returns its target.
//
// On the platforms without reparse points a symbolic link is the only way to
// leave the notes root.
func linkTarget(path string) (string, bool, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			// The path does not exist, so it cannot be a link.
			return "", false, nil
		}
		return "", false, err
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return "", false, nil
	}
	target, err := os.Readlink(path)
	if err != nil {
		// The link cannot be resolved. The caller refuses the path instead
		// of following it.
		return "", true, nil
	}
	return target, true, nil
}
