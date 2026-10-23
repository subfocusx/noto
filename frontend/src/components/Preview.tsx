import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadMarkdownRenderer, type MarkdownRenderer } from '../lib/markdownLoader';
import type { WikiResolver } from '../lib/wiki';

interface PreviewProps {
  source: string;
  resolve: WikiResolver | null;
  onOpenNote(path: string): void;
}

/** Shown when the preview engine cannot be loaded. */
const UNAVAILABLE = 'Предпросмотр недоступен';

/**
 * The renderer is kept inside an object: a bare function stored in state would
 * be treated by Preact as a state updater and called with the old value.
 */
interface LoadedRenderer {
  render: MarkdownRenderer;
}

export function Preview(props: PreviewProps) {
  const [loaded, setLoaded] = useState<LoadedRenderer | null>(null);
  const [failed, setFailed] = useState(false);

  // The markdown stack (marked + dompurify) is loaded lazily, once per app.
  useEffect(() => {
    let active = true;
    loadMarkdownRenderer()
      .then((render) => {
        if (!active) return;
        setLoaded({ render });
        setFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const html = useMemo(
    () => (loaded ? loaded.render(props.source, props.resolve) : null),
    [loaded, props.source, props.resolve],
  );

  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest('a[data-noto-path]') as HTMLAnchorElement | null;
    if (!link) return;
    event.preventDefault();
    const path = link.getAttribute('data-noto-path');
    if (path) props.onOpenNote(path);
  };

  if (failed) {
    return (
      <div class="preview" data-testid="preview" role="alert">
        {UNAVAILABLE}
      </div>
    );
  }

  if (html === null) {
    // The renderer is not ready yet: show the plain source as a text node.
    // No user content ever reaches innerHTML in this state.
    return (
      <div class="preview" data-testid="preview">
        {props.source}
      </div>
    );
  }

  return (
    <div
      class="preview"
      data-testid="preview"
      onClick={onClick}
      // The HTML is produced by marked and always sanitized with DOMPurify.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
