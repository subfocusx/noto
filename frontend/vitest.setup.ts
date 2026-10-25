import { cleanup } from '@testing-library/preact';
import { afterEach, beforeAll } from 'vitest';
import { loadCatalogue } from './src/i18n';

// The catalogue of the strings travels in its own chunk: the application
// loads it before the first render. The tests do the same, so the components
// draw the text of the interface and not the raw key.
beforeAll(async () => {
  await loadCatalogue('en');
  await loadCatalogue('ru');
});

// jsdom does not know the media queries: the application uses them to switch
// the columns of the shell into drawers on a narrow screen.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
});
