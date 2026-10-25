// The state of the filter and the address bar.
//
// The filter of the notes lives in the store, but the address of the page
// may hold it too: a link with `?q=tag%20%3D%3D%20%22work%22` opens the
// application with the filter already applied. The rules of the mapping live
// here, so they can be tested without a browser.

/** The state of the filter that the address bar may carry. */
export interface FilterUrlState {
  /** The query of the query language. */
  query: string;
  /** The tag the filter is limited to, if any. */
  tag: string | null;
  /** The name of the saved filter that is applied, if any. */
  view: string | null;
}

/** The name of the parameter of the query. */
export const QUERY_PARAM = 'q';
/** The name of the parameter of the tag. */
export const TAG_PARAM = 'tag';
/** The name of the parameter of the saved filter. */
export const VIEW_PARAM = 'view';

/**
 * Reads the state of the filter out of the parameters of the address.
 *
 * An unknown parameter is ignored and a missing parameter is an empty
 * value: the address is never an error, it is only a hint.
 */
export function parseFilterUrl(input: string | URLSearchParams): FilterUrlState {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  const tag = params.get(TAG_PARAM);
  const view = params.get(VIEW_PARAM);
  return {
    query: params.get(QUERY_PARAM) ?? '',
    tag: tag && tag.trim() !== '' ? tag : null,
    view: view && view.trim() !== '' ? view : null,
  };
}

/**
 * Writes the state of the filter into the parameters of the address.
 *
 * Only the values that carry something are written, so the address of an
 * empty filter stays clean. The result starts with `?` and is empty when
 * there is nothing to write.
 */
export function serializeFilterUrl(state: FilterUrlState): string {
  const params = new URLSearchParams();
  if (state.query.trim() !== '') params.set(QUERY_PARAM, state.query);
  if (state.tag) params.set(TAG_PARAM, state.tag);
  if (state.view) params.set(VIEW_PARAM, state.view);
  const serialized = params.toString();
  return serialized === '' ? '' : `?${serialized}`;
}
