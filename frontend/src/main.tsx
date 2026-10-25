import { render } from 'preact';
import { App } from './App';
import { getLanguage, loadCatalogue } from './i18n';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/rail.css';
import './styles/tabs.css';
import './styles/tags.css';
import './styles/components.css';
import './styles/palette.css';
import './styles/find.css';
import './styles/calendar.css';
import './styles/notifications.css';
import './styles/favorites.css';
import './styles/markdown.css';
import './styles/plugin.css';
import './styles/vault.css';
import './styles/storages.css';
import './styles/mobile-drawer.css';
import './styles/mobile-panels.css';
import './styles/mobile-editor.css';

const root = document.getElementById('app');

// The catalogue of the strings travels in its own chunk: the application
// waits for the catalogue of the language of the user before the first
// render, so the texts never flash the raw key.
if (root) {
  void loadCatalogue(getLanguage())
    .catch(() => undefined)
    .then(() => render(<App />, root));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* service worker registration is best effort */
    });
  });
}
