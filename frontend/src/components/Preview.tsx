import { useMemo } from 'preact/hooks';
import { renderSafeMarkdown } from '../lib/markdown';
import type { WikiResolver } from '../lib/wiki';

interface PreviewProps {
  source: string;
  resolve: WikiResolver | null;
  onOpenNote(path: string): void;
}

export function Preview(props: PreviewProps) {
  const html = useMemo(
    () => renderSafeMarkdown(props.source, props.resolve),
    [props.source, props.resolve],
  );

  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest('a[data-noto-path]') as HTMLAnchorElement | null;
    if (!link) return;
    event.preventDefault();
    const path = link.getAttribute('data-noto-path');
    if (path) props.onOpenNote(path);
  };

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
