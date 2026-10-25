package notes

import (
	"context"

	"noto/backend/internal/model"
)

// The paged listing of the children of a folder.
//
// The tree of the interface is loaded lazily: the interface asks for one
// page of the children of a folder at a time and follows the cursor of the
// answer when it needs more. The full listing (Tree) stays available for the
// callers that need the whole tree at once.

// defaultChildrenLimit is the number of the children of a page when the
// caller does not ask for a specific limit.
const defaultChildrenLimit = 100

// Children returns one page of the children of a folder.
//
// The parent path is the path of a folder relative to the notes root; the
// empty path is the root of the notes. The cursor is the path of the last
// child of the previous page: an empty cursor starts at the first child. The
// next cursor of the answer is empty when the page is the last one.
//
// The listing is based on the metadata of the store. The files on the disk
// stay the source of truth, and a reconciliation repairs the difference
// between the two.
func (s *Service) Children(ctx context.Context, parentPath, cursor string, limit int) (model.NodePage, error) {
	parent, err := normalizeRel(parentPath)
	if err != nil {
		return model.NodePage{}, err
	}
	if limit <= 0 {
		limit = defaultChildrenLimit
	}
	page, err := s.store.ListChildrenPaged(ctx, parent, cursor, limit)
	if err != nil {
		return model.NodePage{}, newErr(ErrInternal, "cannot read the children of the folder")
	}
	if page.Items == nil {
		page.Items = []model.Node{}
	}
	return page, nil
}
