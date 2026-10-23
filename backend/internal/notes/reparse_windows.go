//go:build windows

package notes

import (
	"os"

	"golang.org/x/sys/windows"
)

// linkTarget reports whether path is a symbolic link, a Windows junction
// (mount point) or another reparse point and returns the target of the link.
//
// Windows mount points are reparse points that filepath.EvalSymlinks does
// not resolve, so every component of a path is inspected with the reparse
// point API of the operating system. Without this check a junction inside
// the notes root would be followed out of the root.
func linkTarget(path string) (string, bool, error) {
	attrs, err := windows.GetFileAttributes(windows.StringToUTF16Ptr(path))
	if err != nil {
		if errno, ok := err.(windows.Errno); ok {
			switch errno {
			case windows.ERROR_FILE_NOT_FOUND, windows.ERROR_PATH_NOT_FOUND:
				// The path does not exist, so it cannot be a link.
				return "", false, nil
			case windows.ERROR_INVALID_NAME:
				// The path cannot exist at all.
				return "", false, nil
			}
		}
		return "", false, err
	}
	if attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT == 0 {
		return "", false, nil
	}
	// os.Readlink resolves the symbolic links and the Windows junctions.
	target, err := os.Readlink(path)
	if err != nil {
		// The reparse point cannot be resolved. The caller refuses the path
		// instead of following it.
		return "", true, nil
	}
	return target, true, nil
}
