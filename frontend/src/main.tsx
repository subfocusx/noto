import { render } from 'preact';
import { App } from './App';
import './styles.css';

const root = document.getElementById('app');
if (root) render(<App />, root);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* service worker registration is best effort */
    });
  });
}
