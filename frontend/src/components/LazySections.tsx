// The sections of the left column, loaded on demand.
//
// Only one section is open at a time, and the explorer is the one the user
// sees first. The other sections are loaded when they are opened for the first
// time, so they stay out of the entry chunk.
export { CalendarSection } from './sections/CalendarSection';
export { FavoritesSection } from './sections/FavoritesSection';
export { FiltersSection } from './sections/FiltersSection';
export { HistorySection } from './sections/HistorySection';
export { NotificationsSection } from './sections/NotificationsSection';
export { SearchSection } from './sections/SearchSection';
export { TrashSection } from './sections/TrashSection';
