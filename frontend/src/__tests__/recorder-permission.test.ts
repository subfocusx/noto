// The tests of the permission of the microphone.
//
// A refused permission must give a clear message and must not break the
// editor: the recorder stays idle and no bytes are produced.
import { describe, expect, it, vi } from 'vitest';
import { AudioRecorder, RecorderError } from '../core/recorder/recorder';

/** The error the browser throws when the permission is refused. */
function refused(): Error {
  const error = new Error('Permission denied');
  error.name = 'NotAllowedError';
  return error;
}

describe('the refused permission of the microphone', () => {
  it('gives the typed error of the permission', async () => {
    const recorder = new AudioRecorder({
      getUserMedia: async () => {
        throw refused();
      },
      createRecorder: () => {
        throw new Error('the recorder must not be created');
      },
    });

    await expect(recorder.start()).rejects.toBeInstanceOf(RecorderError);
    await expect(recorder.start()).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('explains the refusal in the message', async () => {
    const recorder = new AudioRecorder({
      getUserMedia: async () => {
        throw refused();
      },
    });

    const error = await recorder.start().catch((err: unknown) => err);
    expect((error as RecorderError).message).toContain('permission');
  });

  it('leaves the recorder idle and produces nothing', async () => {
    const createRecorder = vi.fn();
    const recorder = new AudioRecorder({
      getUserMedia: async () => {
        throw refused();
      },
      createRecorder,
    });

    await recorder.start().catch(() => undefined);

    expect(createRecorder).not.toHaveBeenCalled();
    expect(recorder.isRecording).toBe(false);
    expect(recorder.state).toBe('error');
    expect(recorder.level).toBe(0);
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'not-recording' });
  });
});
