// Small helpers shared by the app.
//
// The implementation lives in focused modules; this file only keeps the
// historic import surface (`from '../lib/utils'`) working.
export { debounce, type Debounced } from './debounce';
export { errorMessage } from './errors';
export { formatSize } from './format';
export { compareStrings } from './ordering';
