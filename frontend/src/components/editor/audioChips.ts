// The chips of the sounds in the editor.
//
// A recording lives in the text of the note as a Markdown reference. In the
// editor the reference is shown as a chip: the icon of the microphone, the
// name of the recording, its length and a button that plays the sound right
// in the editor.
//
// The text of the note does not change: the chip is only a view of the
// reference, and the note on the disk keeps the plain Markdown.

import { h, render } from 'preact';
import { StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { t } from '../../i18n';
import { findAudioReferences, recordingDuration } from '../../lib/audioReferences';
import { Icon } from '../../ui/icons';

/** The chip of one sound: the node, the icon of the button and the button. */
interface ChipView {
  chip: HTMLElement;
  glyph: HTMLElement;
  button: HTMLElement;
}

/**
 * The players of the sounds, by their address.
 *
 * The chip is drawn again every time the text changes, so the player of a
 * sound is kept: the sound keeps playing while the user writes.
 */
const players = new Map<string, HTMLAudioElement>();

/** The drawn chips of every sound, so that all of them show one state. */
const views = new Map<string, Set<ChipView>>();

/** The player of a sound; the same sound always has the same player. */
function playerFor(url: string): HTMLAudioElement {
  const known = players.get(url);
  if (known) return known;
  const audio = new Audio(url);
  audio.preload = 'metadata';
  players.set(url, audio);
  audio.addEventListener('play', () => paint(url));
  audio.addEventListener('pause', () => paint(url));
  audio.addEventListener('ended', () => paint(url));
  return audio;
}

/** Shows the state of the player of a sound on every drawn chip of it. */
function paint(url: string): void {
  const audio = players.get(url);
  if (!audio) return;
  const playing = !audio.paused && !audio.ended;
  const glyphName = playing ? 'pause' : 'play';
  const label = playing ? t('editor.audio.pause') : t('editor.audio.play');
  for (const view of views.get(url) ?? []) {
    view.chip.classList.toggle('is-playing', playing);
    view.button.setAttribute('aria-label', label);
    const glyph = document.createElement('span');
    glyph.className = 'noto-audio-chip-glyph';
    render(h(Icon, { name: glyphName, size: 12 }), glyph);
    view.glyph.replaceWith(glyph);
    view.glyph = glyph;
  }
}

/** The chip of a sound: the icon, the name, the length and the button. */
class AudioChipWidget extends WidgetType {
  constructor(
    private readonly url: string,
    private readonly label: string,
    private readonly duration: string | null,
  ) {
    super();
  }

  /** Two chips are the same when they show the same sound. */
  override eq(other: AudioChipWidget): boolean {
    return other.url === this.url && other.label === this.label && other.duration === this.duration;
  }

  /** The chip itself. */
  override toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'noto-audio-chip';
    chip.contentEditable = 'false';
    // The name of the recording stays reachable: the chip hides the Markdown.
    chip.title = this.label;

    const icon = document.createElement('span');
    icon.className = 'noto-audio-chip-icon';
    render(h(Icon, { name: 'mic', size: 14 }), icon);

    const name = document.createElement('span');
    name.className = 'noto-audio-chip-name';
    name.textContent = t('editor.audio.label');

    const clock = document.createElement('span');
    clock.className = 'noto-audio-chip-duration';
    clock.textContent = this.duration ?? '';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'noto-audio-chip-play';
    const glyph = document.createElement('span');
    glyph.className = 'noto-audio-chip-glyph';
    render(h(Icon, { name: 'play', size: 12 }), glyph);
    button.appendChild(glyph);

    const audio = playerFor(this.url);
    const view: ChipView = { chip, glyph, button };
    const drawn = views.get(this.url) ?? new Set<ChipView>();
    drawn.add(view);
    views.set(this.url, drawn);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (audio.paused) {
        const started = audio.play() as Promise<void> | undefined;
        if (started && typeof started.catch === 'function') started.catch(() => undefined);
      } else {
        audio.pause();
      }
      paint(this.url);
    });

    chip.append(icon, name);
    if (this.duration) chip.appendChild(clock);
    chip.appendChild(button);
    paint(this.url);
    return chip;
  }

  /** The chip is gone: it must not follow the state of the player. */
  override destroy(dom: HTMLElement): void {
    const drawn = views.get(this.url);
    if (!drawn) return;
    for (const view of drawn) {
      if (view.chip === dom) drawn.delete(view);
    }
  }

  /** The events of the chip belong to the chip, not to the editor. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The chips of the sounds of a text. */
function buildChips(text: string): DecorationSet {
  const ranges = findAudioReferences(text).map((reference) =>
    Decoration.replace({
      widget: new AudioChipWidget(
        reference.url,
        reference.label,
        recordingDuration(reference.label),
      ),
    }).range(reference.from, reference.to),
  );
  return Decoration.set(ranges, true);
}

/** The field of the state that holds the chips of the sounds. */
const audioChipsField = StateField.define<DecorationSet>({
  create(state) {
    return buildChips(state.doc.toString());
  },
  update(value, transaction) {
    return transaction.docChanged ? buildChips(transaction.state.doc.toString()) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The extension of the editor that shows the sounds as chips. */
export function audioChips(): Extension {
  return audioChipsField;
}
