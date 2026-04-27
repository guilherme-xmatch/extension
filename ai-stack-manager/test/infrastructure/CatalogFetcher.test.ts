import { describe, it, expect } from 'vitest';
import { CatalogFetcher } from '../../src/infrastructure/repositories/CatalogFetcher';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TRUSTED_URL  = 'https://github.com/guilherme-xmatch/DescomplicAI/tree/main/catalog';
const RAW_TRUSTED  = 'https://raw.githubusercontent.com/guilherme-xmatch/DescomplicAI/main/catalog/index.json';
const UNSAFE_HTTP  = 'http://example.com/catalog.json';
const UNSAFE_HTTPS = 'https://evil.example.com/catalog.json';
const INVALID_URL  = 'not-a-url';

// ─── isSafeRemoteUrl (allowUnsafeUrls = false) ───────────────────────────────

describe('CatalogFetcher.isSafeRemoteUrl (strict mode)', () => {
  const fetcher = new CatalogFetcher(false);

  it('accepts trusted HTTPS origins', () => {
    expect(fetcher.isSafeRemoteUrl(TRUSTED_URL)).toBe(true);
    expect(fetcher.isSafeRemoteUrl(RAW_TRUSTED)).toBe(true);
  });

  it('rejects HTTP (non-HTTPS)', () => {
    expect(fetcher.isSafeRemoteUrl(UNSAFE_HTTP)).toBe(false);
  });

  it('rejects HTTPS from untrusted host', () => {
    expect(fetcher.isSafeRemoteUrl(UNSAFE_HTTPS)).toBe(false);
  });

  it('rejects invalid URL strings', () => {
    expect(fetcher.isSafeRemoteUrl(INVALID_URL)).toBe(false);
    expect(fetcher.isSafeRemoteUrl('')).toBe(false);
  });
});

// ─── isSafeRemoteUrl (allowUnsafeUrls = true) ────────────────────────────────

describe('CatalogFetcher.isSafeRemoteUrl (permissive mode)', () => {
  const fetcher = new CatalogFetcher(true);

  it('accepts any HTTPS URL', () => {
    expect(fetcher.isSafeRemoteUrl(UNSAFE_HTTPS)).toBe(true);
  });

  it('still rejects HTTP', () => {
    expect(fetcher.isSafeRemoteUrl(UNSAFE_HTTP)).toBe(false);
  });

  it('still rejects invalid URLs', () => {
    expect(fetcher.isSafeRemoteUrl(INVALID_URL)).toBe(false);
  });
});

// ─── normalizeRepoUrl ────────────────────────────────────────────────────────

describe('CatalogFetcher.normalizeRepoUrl', () => {
  const fetcher = new CatalogFetcher();

  it('strips .git suffix', () => {
    expect(fetcher.normalizeRepoUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo');
  });

  it('strips .Git (case-insensitive)', () => {
    expect(fetcher.normalizeRepoUrl('https://github.com/org/repo.GIT')).toBe('https://github.com/org/repo');
  });

  it('leaves URL without .git unchanged', () => {
    expect(fetcher.normalizeRepoUrl('https://github.com/org/repo')).toBe('https://github.com/org/repo');
  });
});

// ─── assertTrustedRegistryUrl ────────────────────────────────────────────────

describe('CatalogFetcher.assertTrustedRegistryUrl', () => {
  const fetcher = new CatalogFetcher(false);

  it('does not throw for trusted URL', () => {
    expect(() => fetcher.assertTrustedRegistryUrl(TRUSTED_URL)).not.toThrow();
  });

  it('throws for untrusted URL', () => {
    expect(() => fetcher.assertTrustedRegistryUrl(UNSAFE_HTTPS)).toThrow(/não é confiável/i);
  });

  it('throws for HTTP URL', () => {
    expect(() => fetcher.assertTrustedRegistryUrl(UNSAFE_HTTP)).toThrow();
  });
});

// ─── isLocalPath ─────────────────────────────────────────────────────────────

describe('CatalogFetcher.isLocalPath', () => {
  const fetcher = new CatalogFetcher();

  it('detects file:// URL', () => {
    expect(fetcher.isLocalPath('file:///home/user/catalog')).toBe(true);
  });

  it('detects absolute paths', () => {
    expect(fetcher.isLocalPath('/usr/local/catalog')).toBe(true);
    expect(fetcher.isLocalPath('C:\\Users\\catalog')).toBe(true);
  });

  it('returns false for remote HTTP/HTTPS URLs', () => {
    expect(fetcher.isLocalPath('https://github.com/org/repo')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(fetcher.isLocalPath('')).toBe(false);
  });
});

// ─── isJsonEndpoint ──────────────────────────────────────────────────────────

describe('CatalogFetcher.isJsonEndpoint', () => {
  const fetcher = new CatalogFetcher();

  it('detects .json extension', () => {
    expect(fetcher.isJsonEndpoint('https://example.com/catalog.json')).toBe(true);
    expect(fetcher.isJsonEndpoint('https://example.com/data.json?v=1')).toBe(true);
  });

  it('detects raw.githubusercontent.com', () => {
    expect(fetcher.isJsonEndpoint('https://raw.githubusercontent.com/org/repo/main/index.json')).toBe(true);
  });

  it('returns false for regular git repository URLs', () => {
    expect(fetcher.isJsonEndpoint('https://github.com/org/repo')).toBe(false);
    expect(fetcher.isJsonEndpoint('https://github.com/org/repo.git')).toBe(false);
  });
});

// ─── normalizeLocalPath ──────────────────────────────────────────────────────

describe('CatalogFetcher.normalizeLocalPath', () => {
  const fetcher = new CatalogFetcher();

  it('converts file:// URL on POSIX to filesystem path', () => {
    // Note: this tests decode behavior; actual result depends on platform.
    const result = fetcher.normalizeLocalPath('file:///home/user/catalog');
    // Should not still start with file://
    expect(result).not.toContain('file://');
  });

  it('passes through regular paths unchanged', () => {
    expect(fetcher.normalizeLocalPath('/usr/local/catalog')).toBe('/usr/local/catalog');
  });

  it('handles URL-encoded paths', () => {
    const result = fetcher.normalizeLocalPath('file:///path%20with%20spaces/catalog');
    expect(result).toContain('path with spaces');
  });
});
