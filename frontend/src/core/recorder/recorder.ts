// The recording of the sound.
//
// The recorder asks the microphone only when the user starts a recording, it
// measures the level while the recording runs and it gives the bytes back as
// a blob with their mime type and their duration.
//
// Every part of the browser that the recorder touches is injected, so the
// tests run with a fake stream and never touch a real microphone.

import { createLevelMeter, type LevelMeter } from './meter';

/** The state of the recorder. */
export type RecorderState = 'idle' | 'recording' | 'stopped' | 'error';

/** The stable codes of the errors of the recorder. */
export type RecorderErrorCode =
  | 'permission-denied'
  | 'unsupported'
  | 'recorder-failed'
  | 'not-recording';

/** The mime type the recorder asks for. */
export const PREFERRED_MIME_TYPE = 'audio/webm';

/**
 * The error of the recorder.
 *
 * The code is stable: the interface reads the code, never the message.
 */
export class RecorderError extends Error {
  /** The stable code of the error. */
  readonly code: RecorderErrorCode;

  constructor(code: RecorderErrorCode, message: string) {
    super(message);
    this.name = 'RecorderError';
    this.code = code;
  }
}

/** The parts of a media stream the recorder needs. */
export interface MediaStreamLike {
  getAudioTracks?(): unknown[];
}

/** The parts of the media recorder the recorder needs. */
export interface MediaRecorderLike {
  mimeType: string;
  state: string;
  start(timeslice?: number): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

/** The browser pieces the recorder uses. */
export interface RecorderDeps {
  /** Asks the browser for the microphone. */
  getUserMedia(constraints: { audio: true }): Promise<MediaStreamLike>;
  /** Creates the recorder of the stream. */
  createRecorder(stream: MediaStreamLike): MediaRecorderLike;
  /** Creates the meter of the level; null means "no meter". */
  createLevelMeter?(stream: MediaStreamLike): LevelMeter | null;
  /** The clock of the recorder, in milliseconds. */
  now(): number;
}

/** The result of a recording. */
export interface RecordingResult {
  /** The bytes of the recording. */
  blob: Blob;
  /** The mime type of the bytes. */
  mimeType: string;
  /** The length of the recording, in milliseconds. */
  durationMs: number;
}

/**
 * The recorder of the sound.
 *
 * The microphone is asked in `start()`, never before: the permission of the
 * browser belongs to the moment the user asks for a recording.
 */
export class AudioRecorder {
  private readonly deps: RecorderDeps;
  private recorder: MediaRecorderLike | null = null;
  private meter: LevelMeter | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private current: RecorderState = 'idle';

  constructor(deps: Partial<RecorderDeps> = {}) {
    this.deps = { ...defaultRecorderDeps(), ...deps };
  }

  /** The state of the recorder. */
  get state(): RecorderState {
    return this.current;
  }

  /** True while the recording runs. */
  get isRecording(): boolean {
    return this.current === 'recording';
  }

  /** The length of the recording that runs, in milliseconds. */
  get elapsedMs(): number {
    if (this.current !== 'recording') return 0;
    return Math.max(0, this.deps.now() - this.startedAt);
  }

  /** The level of the microphone, from 0 to 1 (0 without a meter). */
  get level(): number {
    if (!this.meter) return 0;
    return this.meter.level();
  }

  /**
   * Starts a recording.
   *
   * Asks the microphone for the permission: a refused permission gives a
   * `permission-denied` error and leaves the editor untouched.
   */
  async start(): Promise<void> {
    if (this.current === 'recording') return;
    let stream: MediaStreamLike;
    try {
      stream = await this.deps.getUserMedia({ audio: true });
    } catch (error) {
      this.current = 'error';
      throw toRecorderError(error);
    }
    let recorder: MediaRecorderLike;
    try {
      recorder = this.deps.createRecorder(stream);
    } catch (error) {
      this.current = 'error';
      throw toRecorderError(error);
    }
    this.chunks = [];
    recorder.ondataavailable = (event: { data: Blob }): void => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder = recorder;
    recorder.start();
    this.startedAt = this.deps.now();
    this.current = 'recording';
    try {
      this.meter = this.deps.createLevelMeter?.(stream) ?? null;
    } catch {
      // A meter that fails is not a reason to stop the recording.
      this.meter = null;
    }
  }

  /** Stops the recording and gives the bytes back. */
  async stop(): Promise<RecordingResult> {
    if (this.current !== 'recording' || !this.recorder) {
      throw new RecorderError('not-recording', 'There is no recording to stop.');
    }
    const recorder = this.recorder;
    const startedAt = this.startedAt;
    const done = new Promise<RecordingResult>((resolve) => {
      recorder.onstop = (): void => {
        const mimeType = recorder.mimeType || PREFERRED_MIME_TYPE;
        const blob = new Blob(this.chunks, { type: mimeType });
        const durationMs = Math.max(0, this.deps.now() - startedAt);
        this.current = 'stopped';
        this.meter?.stop();
        this.meter = null;
        resolve({ blob, mimeType, durationMs });
      };
    });
    recorder.stop();
    return done;
  }

  /** Throws the recording away and releases the microphone. */
  cancel(): void {
    if (this.recorder && this.current === 'recording') {
      try {
        this.recorder.stop();
      } catch {
        // The recorder is already gone: nothing to release.
      }
    }
    this.meter?.stop();
    this.meter = null;
    this.recorder = null;
    this.chunks = [];
    this.current = 'idle';
  }
}

/** The browser pieces the recorder uses, when the tests do not give them. */
export function defaultRecorderDeps(): RecorderDeps {
  return {
    async getUserMedia(constraints: { audio: true }): Promise<MediaStreamLike> {
      const devices = (
        globalThis.navigator as
          | (Navigator & { mediaDevices?: { getUserMedia(c: unknown): Promise<MediaStream> } })
          | undefined
      )?.mediaDevices;
      if (!devices) {
        throw new RecorderError(
          'unsupported',
          'This browser cannot record the sound: the microphone is not available.',
        );
      }
      return devices.getUserMedia(constraints);
    },
    createRecorder(stream: MediaStreamLike): MediaRecorderLike {
      const ctor = (
        globalThis as {
          MediaRecorder?: new (stream: unknown, options?: { mimeType?: string }) => MediaRecorderLike;
        }
      ).MediaRecorder;
      if (!ctor) {
        throw new RecorderError(
          'unsupported',
          'This browser cannot record the sound: the recorder is not available.',
        );
      }
      try {
        return new ctor(stream, { mimeType: PREFERRED_MIME_TYPE });
      } catch {
        // The browser does not know the mime type: it picks its own.
        return new ctor(stream);
      }
    },
    createLevelMeter(stream: MediaStreamLike): LevelMeter | null {
      return createLevelMeter(stream);
    },
    now(): number {
      return Date.now();
    },
  };
}

/** Turns the error of the browser into the typed error of the recorder. */
function toRecorderError(error: unknown): RecorderError {
  if (error instanceof RecorderError) return error;
  const name = (error as { name?: string } | null | undefined)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return new RecorderError(
      'permission-denied',
      'The microphone permission was refused: the recording was not started.',
    );
  }
  const message = (error as { message?: string } | null | undefined)?.message;
  return new RecorderError(
    'recorder-failed',
    message ? `The recording could not be started: ${message}` : 'The recording could not be started.',
  );
}
