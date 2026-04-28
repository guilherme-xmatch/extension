/**
 * Tests for CatalogFetcher.fetchJson and CatalogFetcher.ensureLocalClone.
 *
 * These methods make real HTTPS/exec calls, so we mock 'https' and
 * 'child_process' at module level (vi.mock is hoisted before imports).
 *
 * The unit-method tests (isSafeRemoteUrl, isLocalPath, etc.) remain in
 * CatalogFetcher.test.ts and are unaffected by these mocks.
 */

// ─── Hoisted mocks (run before any import) ───────────────────────────────────
vi.mock('https', () => ({ get: vi.fn() }));
vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  rmSync: vi.fn(),
  // Other fs methods used by CatalogFetcher (not needed here, but prevents import errors)
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as https from 'https';
import * as fs from 'fs';
import { exec } from 'child_process';
// Note: vi.mock('fs') above replaces fs.existsSync / fs.rmSync with vi.fn()
import { CatalogFetcher } from '../../src/infrastructure/repositories/CatalogFetcher';

// ─── Mock factory helpers ─────────────────────────────────────────────────────

/**
 * Queues an HTTPS response with the given status code and body.
 * The callback receives a fake IncomingMessage that fires 'data' then 'end'.
 */
function queueHttpsResponse(statusCode: number, body: string) {
  vi.mocked(https.get).mockImplementationOnce((_url: any, callback: any) => {
    const response: any = {
      statusCode,
      setEncoding: vi.fn(),
      resume: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'data') handler(body);
        if (event === 'end') handler();
        return response; // allow chaining
      }),
    };
    callback(response);
    return { on: vi.fn() } as any; // the returned ClientRequest (needed for .on('error', ...))
  });
}

/**
 * Queues a request-level network error (fires on the ClientRequest, not the response).
 */
function queueHttpsNetworkError(error: Error) {
  vi.mocked(https.get).mockImplementationOnce((_url: any, _callback: any) => {
    const req: any = {
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'error') process.nextTick(() => handler(error));
        return req;
      }),
    };
    return req;
  });
}

/**
 * Configures the exec mock to produce a sequence of results.
 * Each element is either { stdout, stderr } for success or an Error for failure.
 */
function queueExecResults(...results: Array<{ stdout?: string; stderr?: string } | Error>) {
  let index = 0;
  vi.mocked(exec).mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      const result = results[index++] ?? { stdout: '', stderr: '' };
      process.nextTick(() => {
        if (result instanceof Error) cb(result);
        else cb(null, result);
      });
    }
    return {} as any;
  });
}

// ─── fetchJson ────────────────────────────────────────────────────────────────

describe('CatalogFetcher.fetchJson', () => {
  // Trusted raw URL that satisfies isSafeRemoteUrl in strict mode
  const TRUSTED_RAW =
    'https://raw.githubusercontent.com/guilherme-xmatch/DescomplicAI/main/catalog/index.json';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── URL validation (synchronous checks before any network call) ─────────────

  it('rejeita URL HTTPS não-confiável em modo estrito (allowUnsafeUrls=false)', async () => {
    const fetcher = new CatalogFetcher(false);
    await expect(fetcher.fetchJson('https://evil.example.com/data.json')).rejects.toThrow(
      'URL remota não confiável',
    );
    expect(https.get).not.toHaveBeenCalled();
  });

  it('rejeita URL HTTP (sem HTTPS)', async () => {
    const fetcher = new CatalogFetcher(false);
    await expect(fetcher.fetchJson('http://example.com/data.json')).rejects.toThrow(
      'URL remota não confiável',
    );
  });

  // ── Successful response (status 200) ─────────────────────────────────────────

  it('resolve com dados parseados para uma resposta 200 de URL confiável', async () => {
    const fetcher = new CatalogFetcher(false);
    const payload = { packages: ['agent-one', 'agent-two'] };
    queueHttpsResponse(200, JSON.stringify(payload));

    const result = await fetcher.fetchJson(TRUSTED_RAW);

    expect(result).toEqual(payload);
    expect(https.get).toHaveBeenCalledTimes(1);
  });

  it('aceita JSON com comentários de linha // no corpo da resposta', async () => {
    const fetcher = new CatalogFetcher(true);
    const bodyWithComments = `{
  // Este é um comentário
  "items": [1, 2, 3]
}`;
    queueHttpsResponse(200, bodyWithComments);

    const result = (await fetcher.fetchJson('https://trusted.example.com/data.json')) as any;
    expect(result.items).toEqual([1, 2, 3]);
  });

  // ── HTTP error codes ──────────────────────────────────────────────────────────

  it('rejeita com código quando statusCode === 404', async () => {
    const fetcher = new CatalogFetcher(true);
    queueHttpsResponse(404, '');

    await expect(fetcher.fetchJson('https://trusted.example.com/data.json')).rejects.toThrow('404');
  });

  it('rejeita com código quando statusCode >= 500', async () => {
    const fetcher = new CatalogFetcher(true);
    queueHttpsResponse(503, '');

    await expect(fetcher.fetchJson('https://trusted.example.com/data.json')).rejects.toThrow('503');
  });

  it('rejeita com "sem status" quando statusCode está ausente', async () => {
    const fetcher = new CatalogFetcher(true);
    vi.mocked(https.get).mockImplementationOnce((_url: any, callback: any) => {
      const response = {
        statusCode: undefined,
        resume: vi.fn(),
        on: vi.fn(),
        setEncoding: vi.fn(),
      };
      callback(response);
      return { on: vi.fn() } as any;
    });

    await expect(fetcher.fetchJson('https://trusted.example.com/data.json')).rejects.toThrow(
      'sem status',
    );
  });

  // ── Network / parse errors ────────────────────────────────────────────────────

  it('rejeita com o erro de rede emitido pelo ClientRequest', async () => {
    const fetcher = new CatalogFetcher(true);
    queueHttpsNetworkError(new Error('ECONNREFUSED'));

    await expect(fetcher.fetchJson('https://trusted.example.com/data.json')).rejects.toThrow(
      'ECONNREFUSED',
    );
  });

  it('rejeita quando o corpo da resposta não é JSON válido', async () => {
    const fetcher = new CatalogFetcher(true);
    queueHttpsResponse(200, '{ invalid json {{ }}');

    await expect(fetcher.fetchJson('https://trusted.example.com/data.json')).rejects.toThrow();
  });
});

// ─── ensureLocalClone ─────────────────────────────────────────────────────────

describe('CatalogFetcher.ensureLocalClone', () => {
  const REPO_URL = 'https://github.com/guilherme-xmatch/DescomplicAI';
  const REPO_DIR = '/tmp/dai-test-cache/repo';

  beforeEach(() => {
    // Reset existsSync to its safe default (dir doesn't exist) before each test.
    // vi.clearAllMocks() (from setupFiles) clears call history but NOT mockReturnValue,
    // so we reset explicitly here.
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.rmSync).mockReset();
  });

  // ── Dir does not exist → clone ────────────────────────────────────────────────

  it('clona quando repoDir não existe', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    queueExecResults({ stdout: '', stderr: '' });

    const fetcher = new CatalogFetcher();
    await fetcher.ensureLocalClone(REPO_URL, REPO_DIR);

    expect(exec).toHaveBeenCalledWith(expect.stringContaining('git clone'), expect.any(Function));
  });

  it('clona quando repoDir existe mas .git não existe', async () => {
    let callCount = 0;
    vi.mocked(fs.existsSync).mockImplementation(() => {
      // First call (repoDir) → true; second call (gitDir) → false
      return ++callCount === 1;
    });
    queueExecResults({ stdout: '', stderr: '' });

    const fetcher = new CatalogFetcher();
    await fetcher.ensureLocalClone(REPO_URL, REPO_DIR);

    expect(exec).toHaveBeenCalledWith(expect.stringContaining('git clone'), expect.any(Function));
  });

  // ── Dir exists + .git exists ──────────────────────────────────────────────────

  it('faz pull quando repoDir e .git existem e remote.origin.url bate', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    queueExecResults(
      { stdout: `${REPO_URL}\n`, stderr: '' }, // git config --get remote.origin.url
      { stdout: 'Already up to date.\n', stderr: '' }, // git pull --ff-only
    );

    const fetcher = new CatalogFetcher();
    await fetcher.ensureLocalClone(REPO_URL, REPO_DIR);

    const execCalls = vi.mocked(exec).mock.calls;
    const hasPullCall = execCalls.some(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('git pull'),
    );
    expect(hasPullCall).toBe(true);
  });

  it('reclona quando remote.origin.url diverge do esperado', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    queueExecResults(
      { stdout: 'https://github.com/other/OtherRepo\n', stderr: '' }, // git config → different URL
      { stdout: '', stderr: '' }, // git clone → success
    );

    const fetcher = new CatalogFetcher();
    await fetcher.ensureLocalClone(REPO_URL, REPO_DIR);

    expect(fs.rmSync).toHaveBeenCalled();
    const lastExecCmd = vi.mocked(exec).mock.calls.at(-1)?.[0] as string;
    expect(lastExecCmd).toContain('git clone');
  });

  it('reclona quando git pull --ff-only lança erro (fallback do catch)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    queueExecResults(
      { stdout: `${REPO_URL}\n`, stderr: '' }, // git config → same URL
      new Error('fatal: Not possible to fast-forward'), // git pull → FAILS
      { stdout: '', stderr: '' }, // git clone → success
    );

    const fetcher = new CatalogFetcher();
    await fetcher.ensureLocalClone(REPO_URL, REPO_DIR);

    expect(fs.rmSync).toHaveBeenCalled();
    const lastExecCmd = vi.mocked(exec).mock.calls.at(-1)?.[0] as string;
    expect(lastExecCmd).toContain('git clone');
  });
});
