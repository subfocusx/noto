// The level metering of the recording.
//
// The level is the loudness of the microphone, from 0 (silence) to 1 (the
// loudest). It is read from an analyser of the Web Audio API; a browser that
// does not offer the API simply has no meter — the recording itself does not
// depend on it.

/** A source of the samples of the microphone. */
export interface AudioSourceLike {
  connect(node: unknown): void;
}

/** The analyser that reads the samples of the microphone. */
export interface AnalyserLike {
  fftSize: number;
  connect(node: unknown): void;
  getByteTimeDomainData(array: Uint8Array): void;
}

/** The part of the Web Audio API that the meter needs. */
export interface AudioContextLike {
  createMediaStreamSource(stream: unknown): AudioSourceLike;
  createAnalyser(): AnalyserLike;
  close?(): unknown;
}

/** The meter of the level of the microphone. */
export interface LevelMeter {
  /** The current level, from 0 to 1. */
  level(): number;
  /** Stops the meter and releases the resources it holds. */
  stop(): void;
}

/**
 * The loudness of the samples, from 0 to 1.
 *
 * The samples of the analyser are bytes around 128 (the silence). The root of
 * the mean square of their distance to the silence is the loudness.
 */
export function levelFromSamples(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const value of samples) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, Math.max(0, rms));
}

/**
 * Creates the meter of the level of the given stream.
 *
 * Returns null when the browser has no Web Audio API: the recording works
 * without a meter, it only shows no level.
 */
export function createLevelMeter(
  stream: unknown,
  createContext?: () => AudioContextLike | null,
): LevelMeter | null {
  const factory = createContext ?? defaultAudioContext;
  const context = factory();
  if (!context) return null;
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let stopped = false;
  return {
    level(): number {
      if (stopped) return 0;
      analyser.getByteTimeDomainData(samples);
      return levelFromSamples(samples);
    },
    stop(): void {
      stopped = true;
      void context.close?.();
    },
  };
}

/** The audio context of the browser, or null when it has none. */
function defaultAudioContext(): AudioContextLike | null {
  const ctor = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext;
  if (!ctor) return null;
  try {
    return new ctor();
  } catch {
    return null;
  }
}
