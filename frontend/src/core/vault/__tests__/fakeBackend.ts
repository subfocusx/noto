// A fake sealed backend.
//
// The fake answers the sealed endpoints from an in-memory map, so the tests
// need no server at all and can inspect what the backend would have stored.

import { SealedClient } from '../sealedClient';

/** Converts a request body into bytes. */
function toBytes(body: BodyInit | null | undefined): Uint8Array {
  if (!body) return new Uint8Array(0);
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  return new Uint8Array(0);
}

/** Builds a minimal Response-like object. */
function fakeResponse(status: number, body?: Uint8Array | string): Response {
  const data =
    typeof body === 'string'
      ? new TextEncoder().encode(body)
      : (body ?? new Uint8Array(0));
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(new TextDecoder().decode(data)) as unknown;
    },
    async text() {
      return new TextDecoder().decode(data);
    },
    async arrayBuffer() {
      return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
    },
  } as unknown as Response;
}

/** The in-memory state of the fake backend. */
export class FakeBackend {
  /** The stored ciphertext objects, by object id. */
  readonly objects = new Map<string, Uint8Array>();

  /** The stored encrypted manifests, by generation. */
  readonly manifests = new Map<number, Uint8Array>();

  /** The stored keystore document, as raw JSON text. */
  keystore: string | null = null;

  /** The fetch implementation to hand to the vault. */
  readonly fetch: typeof fetch;

  constructor() {
    this.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      this.handle(input, init)) as unknown as typeof fetch;
  }

  /** True when the given bytes contain the given text. */
  static containsText(bytes: Uint8Array, text: string): boolean {
    const needle = new TextEncoder().encode(text);
    if (needle.length === 0 || bytes.length < needle.length) return false;
    outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
      for (let j = 0; j < needle.length; j += 1) {
        if (bytes[i + j] !== needle[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  /** Every byte the backend would have stored. */
  allBytes(): Uint8Array[] {
    const parts: Uint8Array[] = [];
    for (const bytes of this.objects.values()) parts.push(bytes);
    for (const bytes of this.manifests.values()) parts.push(bytes);
    return parts;
  }

  /** The generations of the stored manifests, sorted. */
  generations(): number[] {
    return Array.from(this.manifests.keys()).sort((a, b) => a - b);
  }

  /** Answers one request. */
  private async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api/, '');
    const method = (init?.method ?? 'GET').toUpperCase();

    if (path === '/vault/sealed/status' && method === 'GET') {
      return fakeResponse(
        200,
        JSON.stringify({
          mode: 'sealed',
          format: 1,
          objectCount: this.objects.size,
          generations: this.generations(),
        }),
      );
    }

    if (path === '/vault/sealed/keystore') {
      if (method === 'GET') {
        if (!this.keystore) return fakeResponse(404, JSON.stringify({ error: { code: 'not_found' } }));
        return fakeResponse(200, this.keystore);
      }
      if (method === 'PUT') {
        const bytes = toBytes(init?.body);
        this.keystore = new TextDecoder().decode(bytes);
        return fakeResponse(204);
      }
    }

    if (path === '/vault/sealed/objects' && method === 'GET') {
      return fakeResponse(200, JSON.stringify({ ids: Array.from(this.objects.keys()) }));
    }

    const objectMatch = /^\/vault\/sealed\/objects\/([^/]+)$/.exec(path);
    if (objectMatch) {
      const id = decodeURIComponent(objectMatch[1]);
      if (method === 'PUT') {
        this.objects.set(id, toBytes(init?.body).slice());
        return fakeResponse(204);
      }
      if (method === 'GET') {
        const bytes = this.objects.get(id);
        if (!bytes) return fakeResponse(404, JSON.stringify({ error: { code: 'not_found' } }));
        return fakeResponse(200, bytes);
      }
      if (method === 'DELETE') {
        this.objects.delete(id);
        return fakeResponse(204);
      }
    }

    if (path === '/vault/sealed/manifests' && method === 'GET') {
      return fakeResponse(200, JSON.stringify({ generations: this.generations() }));
    }

    const manifestMatch = /^\/vault\/sealed\/manifests\/(\d+)$/.exec(path);
    if (manifestMatch) {
      const generation = Number(manifestMatch[1]);
      if (method === 'PUT') {
        this.manifests.set(generation, toBytes(init?.body).slice());
        return fakeResponse(204);
      }
      if (method === 'GET') {
        const bytes = this.manifests.get(generation);
        if (!bytes) return fakeResponse(404, JSON.stringify({ error: { code: 'not_found' } }));
        return fakeResponse(200, bytes);
      }
      if (method === 'DELETE') {
        this.manifests.delete(generation);
        return fakeResponse(204);
      }
    }

    return fakeResponse(404, JSON.stringify({ error: { code: 'not_found' } }));
  }
}

/** Builds a client that talks to the fake backend. */
export function fakeClient(backend: FakeBackend): SealedClient {
  return new SealedClient({ fetchImpl: backend.fetch });
}
