// Lazy loading of the markdown preview stack.
//
// `marked` and `dompurify` are only needed once the user actually opens the
// preview, so they must not be part of the start-up bundle. This module owns
// the dynamic `import()` of `lib/markdown.ts` and caches the promise, so the
// heavy chunk is fetched at most once.
//
// The rendered HTML is always sanitized inside `lib/markdown.ts`; the loader
// does not change that and never hands out raw markdown.
import type { WikiResolver } from './wiki';

/** Renders a markdown source into sanitized HTML. */
export type MarkdownRenderer = (source: string, resolve?: WikiResolver | null) => string;

let rendererPromise: Promise<MarkdownRenderer> | null = null;

/**
 * Loads the markdown renderer on demand.
 *
 * The returned promise resolves with a render function that always returns
 * sanitized HTML. If the chunk cannot be loaded the promise rejects with a
 * readable error and the next call retries the import.
 */
export async function loadMarkdownRenderer(): Promise<MarkdownRenderer> {
  if (!rendererPromise) {
    rendererPromise = import('./markdown')
      .then((mod): MarkdownRenderer => {
        const render: MarkdownRenderer = (source, resolve) =>
          mod.renderSafeMarkdown(source, resolve);
        return render;
      })
      .catch((error: unknown) => {
        // Allow a later call to retry the import.
        rendererPromise = null;
        throw new Error(
          `Не удалось загрузить модуль предпросмотра: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }
  return rendererPromise;
}
