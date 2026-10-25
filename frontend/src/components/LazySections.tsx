// The sections of the left column, loaded on demand.
//
// Only one section is open at a time, and the explorer is the one the user
// sees first. The other sections are loaded when they are opened for the first
// time, so they stay out of the entry chunk.
export { CalendarSection } from './sections/CalendarSection';
export { FavoritesSection } from './sections/FavoritesSection';
export { HistorySection } from './sections/HistorySection';
export { NotificationsSection } from './sections/NotificationsSection';
export { TrashSection } from './sections/TrashSection';
