// The HTTP client of the SEALED vault.
//
// This module is deliberately independent from `src/api/**`: the open mode
// client speaks JSON with the backend, while the sealed mode client moves
// opaque ciphertext bytes and must never send a plaintext field.
//
// The backend never parses the ciphertext. It stores blobs under random
// object ids and answers with the same bytes.

import type { KeystoreFile } from '../crypto/keys';
import type { SealedStatus } from './types';

/** The default prefix of the Noto API. */
export const SEALED_API_BASE = '/api';

/**
 * Every failure of the sealed backend is reported through this error.
 *
 * `code` is machine readable (`not_found`, `conflict`, `network_error`, ...)
 * and `status` is the HTTP status (0 when the request never reached the
 * server).
 */
export class SealedBackendError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SealedBackendError';
    this.code = code;
    this.status = status;
  }
}

/** Options of the sealed backend client. */
export interface SealedClientOptions {
  /** The prefix of the API, `/api` by default. */
  apiBase?: string;
  /** The fetch implementation, injected by the tests. */
  fetchImpl?: typeof fetch;
}

/** Maps an HTTP status onto a stable machine readable code. */
function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    default:
      return 'internal';
  }
}

/**
 * A thin typed client over the sealed endpoints.
 *
 * The client knows nothing about keys: it moves bytes. That keeps the
 * cryptographic surface in a single place (the vault) and makes the
 * transport trivially testable with a fake fetch.
 */
export class SealedClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SealedClientOptions = {}) {
    this.base = options.apiBase ?? SEALED_API_BASE;
    this.fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  /** Builds an absolute (relative to the API base) URL for a sealed path. */
  url(path: string): string {
    return `${this.base}${path}`;
  }

  /** Performs a request and returns the raw response, mapping failures. */
  private async send(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path), init);
    } catch {
      throw new SealedBackendError(
        'network_error',
        'Cannot reach the Noto server. Check that it is running and reachable.',
        0,
      );
    }
    if (!res.ok) throw await this.toError(res);
    return res;
  }

  /** Converts a failed response into a {@link SealedBackendError}. */
  private async toError(res: Response): Promise<SealedBackendError> {
    let code = codeForStatus(res.status);
    let message = `sealed request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
        code?: string;
        message?: string;
      };
      const envelope = body?.error ?? body;
      if (envelope?.code) code = envelope.code;
      if (envelope?.message) message = envelope.message;
    } catch {
      /* not a JSON error body — keep the defaults */
    }
    return new SealedBackendError(code, message, res.status);
  }

  /** Reads the body of a successful response as raw bytes. */
  private static async bytes(res: Response): Promise<Uint8Array> {
    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /** `GET /api/vault/sealed/status` — the mode and the known generations. */
  async status(): Promise<SealedStatus> {
    const res = await this.send('/vault/sealed/status');
    const body = (await res.json()) as SealedStatus;
    return {
      mode: body.mode,
      format: body.format,
      objectCount: body.objectCount,
      generations: body.generations ?? [],
    };
  }

  /** `GET /api/vault/sealed/objects` — the ids of the stored objects. */
  async listObjectIds(): Promise<string[]> {
    const res = await this.send('/vault/sealed/objects');
    const body = (await res.json()) as { ids?: string[] };
    return body.ids ?? [];
  }

  /** `PUT /api/vault/sealed/objects/{id}` — stores raw ciphertext bytes. */
  async putObject(id: string, bytes: Uint8Array): Promise<void> {
    await this.send(`/vault/sealed/objects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit,
    });
  }

  /** `GET /api/vault/sealed/objects/{id}` — reads raw ciphertext bytes. */
  async getObject(id: string): Promise<Uint8Array> {
    const res = await this.send(`/vault/sealed/objects/${encodeURIComponent(id)}`);
    return SealedClient.bytes(res);
  }

  /** `DELETE /api/vault/sealed/objects/{id}` — removes an object for good. */
  async deleteObject(id: string): Promise<void> {
    await this.send(`/vault/sealed/objects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** `GET /api/vault/sealed/manifests` — the known manifest generations. */
  async listGenerations(): Promise<number[]> {
    const res = await this.send('/vault/sealed/manifests');
    const body = (await res.json()) as { generations?: number[] };
    return body.generations ?? [];
  }

  /** `GET /api/vault/sealed/manifests/{gen}` — the encrypted manifest bytes. */
  async getManifest(generation: number): Promise<Uint8Array> {
    const res = await this.send(`/vault/sealed/manifests/${generation}`);
    return SealedClient.bytes(res);
  }

  /** `PUT /api/vault/sealed/manifests/{gen}` — stores the encrypted manifest. */
  async putManifest(generation: number, bytes: Uint8Array): Promise<void> {
    await this.send(`/vault/sealed/manifests/${generation}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit,
    });
  }

  /** `DELETE /api/vault/sealed/manifests/{gen}` — drops an old generation. */
  async deleteManifest(generation: number): Promise<void> {
    await this.send(`/vault/sealed/manifests/${generation}`, { method: 'DELETE' });
  }

  /**
   * `GET /api/vault/sealed/keystore` — the keystore file of the vault.
   *
   * The backend may answer with the keystore itself or with a
   * `{ keystore: ... }` envelope; both shapes are accepted.
   */
  async getKeystore(): Promise<KeystoreFile> {
    const res = await this.send('/vault/sealed/keystore');
    const body = (await res.json()) as KeystoreFile & { keystore?: KeystoreFile };
    const keystore = body && typeof body === 'object' && body.keystore ? body.keystore : body;
    if (!keystore || typeof keystore !== 'object') {
      throw new SealedBackendError('internal', 'malformed keystore response', res.status);
    }
    return keystore;
  }

  /** `PUT /api/vault/sealed/keystore` — stores the keystore file as JSON. */
  async putKeystore(keystore: KeystoreFile): Promise<void> {
    await this.send('/vault/sealed/keystore', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(keystore),
    });
  }
}
