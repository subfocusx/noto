import { render } from 'preact';
import { App } from './App';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/rail.css';
import './styles/components.css';
import './styles/palette.css';
import './styles/calendar.css';
import './styles/notifications.css';
import './styles/markdown.css';
import './styles/plugin.css';
import './styles/vault.css';

const root = document.getElementById('app');
if (root) render(<App />, root);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* service worker registration is best effort */
    });
  });
}
