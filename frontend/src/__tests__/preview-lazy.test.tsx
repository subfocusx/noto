import { render, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Preview } from '../components/Preview';
import { renderSafeMarkdown } from '../lib/markdown';
import { loadMarkdownRenderer } from '../lib/markdownLoader';

// The loader is replaced by a controllable stub: the real module is kept so
// that the actual sanitizing renderer is used by the tests.
vi.mock('../lib/markdownLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/markdownLoader')>();
  return { ...actual, loadMarkdownRenderer: vi.fn() };
});

const mockedLoad = vi.mocked(loadMarkdownRenderer);

const XSS = '# Title\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">';

function preview(): HTMLElement {
  const node = document.querySelector('[data-testid="preview"]');
  if (!node) throw new Error('preview is not rendered');
  return node as HTMLElement;
}

beforeEach(() => {
  mockedLoad.mockReset();
});

describe('lazy preview', () => {
  it('renders the plain source as text while the renderer is loading', async () => {
    mockedLoad.mockImplementation(() => new Promise(() => {}));

    render(
      <Preview source={XSS} resolve={null} onOpenNote={() => undefined} />,
    );

    const node = preview();
    // The source is shown as a text node, not as markup.
    expect(node.textContent).toContain('# Title');
    expect(node.querySelector('h1')).toBeNull();
    expect(node.querySelector('script')).toBeNull();
    expect(node.querySelector('img')).toBeNull();
    expect(node.innerHTML).toContain('&lt;script&gt;');
    expect(node.innerHTML).not.toContain('<script');
  });

  it('renders sanitized HTML once the renderer is ready', async () => {
    mockedLoad.mockImplementation(async () => renderSafeMarkdown);

    render(<Preview source={XSS} resolve={null} onOpenNote={() => undefined} />);

    await waitFor(() => expect(preview().querySelector('h1')).not.toBeNull());

    const node = preview();
    expect(node.querySelector('h1')?.textContent).toBe('Title');
    // The XSS payload never becomes executable markup.
    expect(node.querySelector('script')).toBeNull();
    expect(node.querySelector('img[onerror]')).toBeNull();
    expect(node.innerHTML).not.toContain('onerror');
    expect(node.innerHTML).not.toContain('<script');
  });

  it('re-renders on note change without loading the module again', async () => {
    mockedLoad.mockImplementation(async () => renderSafeMarkdown);

    const view = render(<Preview source="# One" resolve={null} onOpenNote={() => undefined} />);
    await waitFor(() => expect(preview().querySelector('h1')?.textContent).toBe('One'));

    view.rerender(<Preview source="# Two" resolve={null} onOpenNote={() => undefined} />);
    await waitFor(() => expect(preview().querySelector('h1')?.textContent).toBe('Two'));

    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });

  it('shows a readable message when the renderer fails to load', async () => {
    mockedLoad.mockImplementation(() => Promise.reject(new Error('chunk load failed')));

    render(<Preview source="# Title" resolve={null} onOpenNote={() => undefined} />);

    await waitFor(() => expect(preview().textContent).toContain('Preview unavailable'));
    // No internal details leak into the UI.
    expect(preview().textContent).not.toContain('chunk load failed');
    expect(preview().querySelector('h1')).toBeNull();
  });
});

describe('markdown loader', () => {
  it('loads the renderer once and caches it', async () => {
    const actual = await vi.importActual<typeof import('../lib/markdownLoader')>(
      '../lib/markdownLoader',
    );
    const first = await actual.loadMarkdownRenderer();
    const second = await actual.loadMarkdownRenderer();
    expect(typeof first).toBe('function');
    // The cached renderer is reused, the module is not imported again.
    expect(second).toBe(first);
    // The renderer output is sanitized HTML.
    expect(first('<script>alert(1)</script>', null)).not.toContain('<script');
  });
});
