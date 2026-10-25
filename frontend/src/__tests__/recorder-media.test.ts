// The tests of the recording of the sound.
//
// The recorder never touches a real microphone: the stream and the recorder of
// the browser are injected, so the tests run without a device.
import { describe, expect, it, vi } from 'vitest';
import {
  AudioRecorder,
  PREFERRED_MIME_TYPE,
  RecorderError,
  type MediaRecorderLike,
  type MediaStreamLike,
} from '../core/recorder/recorder';
import { createLevelMeter, levelFromSamples } from '../core/recorder/meter';

/** The stream of a fake microphone. */
const STREAM: MediaStreamLike = { getAudioTracks: () => [{}] };

/** The recorder of the browser, as a fake. */
class FakeRecorder implements MediaRecorderLike {
  mimeType = PREFERRED_MIME_TYPE;
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  started = false;
  stopped = false;

  start(): void {
    this.started = true;
    this.state = 'recording';
  }

  stop(): void {
    this.stopped = true;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['sound'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

describe('the recorder of the sound', () => {
  it('asks the microphone only when the recording starts', async () => {
    const getUserMedia = vi.fn(async () => STREAM);
    const recorder = new AudioRecorder({ getUserMedia, createRecorder: () => new FakeRecorder() });

    expect(getUserMedia).not.toHaveBeenCalled();

    await recorder.start();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('starts and stops the recording of the injected stream', async () => {
    const fake = new FakeRecorder();
    const recorder = new AudioRecorder({
      getUserMedia: async () => STREAM,
      createRecorder: () => fake,
    });

    await recorder.start();
    expect(fake.started).toBe(true);
    expect(recorder.state).toBe('recording');
    expect(recorder.isRecording).toBe(true);

    await recorder.stop();

    expect(fake.stopped).toBe(true);
    expect(recorder.state).toBe('stopped');
    expect(recorder.isRecording).toBe(false);
  });

  it('gives the mime type and the duration of the result', async () => {
    let clock = 1_000;
    const fake = new FakeRecorder();
    const recorder = new AudioRecorder({
      getUserMedia: async () => STREAM,
      createRecorder: () => fake,
      now: () => clock,
    });

    await recorder.start();
    clock = 1_000 + 2_500;
    const result = await recorder.stop();

    expect(result.mimeType).toBe('audio/webm');
    expect(result.durationMs).toBe(2_500);
    expect(result.blob.type).toBe('audio/webm');
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('refuses to stop a recording that does not run', async () => {
    const recorder = new AudioRecorder({
      getUserMedia: async () => STREAM,
      createRecorder: () => new FakeRecorder(),
    });

    await expect(recorder.stop()).rejects.toBeInstanceOf(RecorderError);
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'not-recording' });
  });

  it('measures the level of the microphone while the recording runs', async () => {
    const recorder = new AudioRecorder({
      getUserMedia: async () => STREAM,
      createRecorder: () => new FakeRecorder(),
      createLevelMeter: () => ({ level: () => 0.5, stop: () => undefined }),
    });

    await recorder.start();
    expect(recorder.level).toBe(0.5);

    await recorder.stop();
    expect(recorder.level).toBe(0);
  });
});

describe('the level of the microphone', () => {
  it('is zero for the silence', () => {
    expect(levelFromSamples(new Uint8Array(8).fill(128))).toBe(0);
  });

  it('grows with the loudness', () => {
    const quiet = levelFromSamples(new Uint8Array(8).fill(140));
    const loud = levelFromSamples(new Uint8Array(8).fill(220));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(loud).toBeLessThanOrEqual(1);
  });

  it('reads the samples of the analyser', () => {
    const samples = new Uint8Array(4).fill(255);
    const meter = createLevelMeter(STREAM, () => ({
      createMediaStreamSource: () => ({ connect: () => undefined }),
      createAnalyser: () => ({
        fftSize: 4,
        connect: () => undefined,
        getByteTimeDomainData: (array: Uint8Array) => array.set(samples),
      }),
      close: () => undefined,
    }));

    expect(meter).not.toBeNull();
    expect(meter?.level()).toBeGreaterThan(0);
    meter?.stop();
    expect(meter?.level()).toBe(0);
  });
});
