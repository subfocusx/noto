import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  createDeck,
  deckProgress,
  nextSlide,
  previousSlide,
  presentationKeyAction,
  type DeckState,
} from '../core/presentations/deck';
import { parsePresentation, type Presentation } from '../core/presentations/slides';
import { loadMarkdownRenderer, type MarkdownRenderer } from '../lib/markdownLoader';
import type { WikiResolver } from '../lib/wiki';
import { useT } from '../i18n/useT';

export interface PreviewProps {
  source: string;
  resolve: WikiResolver | null;
  onOpenNote(path: string): void;
}

/**
 * The renderer is kept inside an object: a bare function stored in state would
 * be treated by Preact as a state updater and called with the old value.
 */
interface LoadedRenderer {
  render: MarkdownRenderer;
}

export function Preview(props: PreviewProps) {
  const t = useT();
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

  /**
   * The presentation of the note.
   *
   * A note that holds no separator holds no presentation: the button of the
   * deck does not show.
   */
  const presentation = useMemo(() => parsePresentation(props.source), [props.source]);
  const [deckOpen, setDeckOpen] = useState(false);
  const [deck, setDeck] = useState<DeckState>(() => createDeck(presentation?.slides.length ?? 0));

  // A new note starts the deck at its first slide.
  useEffect(() => {
    setDeck(createDeck(presentation?.slides.length ?? 0));
    setDeckOpen(false);
  }, [presentation]);

  // The keyboard of the deck: the arrows move through the slides, the Escape
  // closes the deck.
  useEffect(() => {
    if (!deckOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = presentationKeyAction(event.key);
      if (action === 'none') return;
      event.preventDefault();
      if (action === 'close') {
        setDeckOpen(false);
        return;
      }
      setDeck((state) => (action === 'next' ? nextSlide(state) : previousSlide(state)));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [deckOpen]);

  let body;
  if (failed) {
    body = (
      <div class="preview error-text" data-testid="preview" role="alert">
        {t('preview.unavailable')}
      </div>
    );
  } else if (html === null) {
    // The renderer is not ready yet: show the plain source as a text node.
    // No user content ever reaches innerHTML in this state.
    body = (
      <div class="preview" data-testid="preview">
        {props.source}
      </div>
    );
  } else {
    body = (
      <div
        class="preview"
        data-testid="preview"
        onClick={onClick}
        // The HTML is produced by marked and always sanitized with DOMPurify.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <>
      {presentation ? (
        <div class="preview-actions">
          <button
            type="button"
            class="text-button"
            onClick={() => setDeckOpen(true)}
            data-testid="presentation-open"
          >
            {t('preview.present')}
          </button>
        </div>
      ) : null}
      {body}
      {deckOpen && presentation ? (
        <PresentationDeck
          presentation={presentation}
          deck={deck}
          onDeck={setDeck}
          onClose={() => setDeckOpen(false)}
          render={loaded?.render ?? null}
          resolve={props.resolve}
        />
      ) : null}
    </>
  );
}

/** The properties of the deck of the slides. */
interface PresentationDeckProps {
  presentation: Presentation;
  deck: DeckState;
  onDeck(deck: DeckState): void;
  onClose(): void;
  render: MarkdownRenderer | null;
  resolve: WikiResolver | null;
}

/**
 * The deck of the slides: the full screen sequence of the slides.
 *
 * The deck shows the slide that is chosen, the progress of the sequence and
 * the keys that move through it.
 */
function PresentationDeck(props: PresentationDeckProps) {
  const t = useT();
  const slide = props.presentation.slides[props.deck.index];
  const html = props.render ? props.render(slide.content, props.resolve) : null;
  const progress = deckProgress(props.deck);

  return (
    <div
      class="presentation-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('preview.label', { title: props.presentation.title })}
      data-testid="presentation-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-palette)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-app)',
        color: 'var(--fg)',
      }}
    >
      <div class="presentation-slide" style={{ flex: '1 1 auto', overflow: 'auto', padding: 'var(--space-6)' }}>
        <h1 class="presentation-title">{slide.title}</h1>
        {html === null ? (
          <div class="presentation-body">{slide.content}</div>
        ) : (
          <div
            class="presentation-body"
            // The HTML is produced by marked and always sanitized with DOMPurify.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
      <div
        class="presentation-progress"
        style={{ flex: 'none', display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3)' }}
      >
        <span class="presentation-counter" data-testid="presentation-progress">
          {props.deck.index + 1} / {props.deck.total}
        </span>
        <div
          class="presentation-bar"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={props.deck.total}
          aria-valuenow={props.deck.index + 1}
          aria-label={t('preview.progress')}
          style={{ flex: '1 1 auto', height: '4px', background: 'var(--bg-hover)' }}
        >
          <div
            class="presentation-bar-fill"
            style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--accent)' }}
          />
        </div>
        <button type="button" class="text-button" onClick={props.onClose} data-testid="presentation-close">
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
