import { describe, it, expect, vi } from 'vitest';
import { CatalogManifestParser, CatalogPackageManifest } from '../../src/infrastructure/repositories/CatalogManifestParser';
import { AppLogger } from '../../src/infrastructure/services/AppLogger';

// ─── Logger mock ─────────────────────────────────────────────────────────────

const mockLogger = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as AppLogger;

const alwaysSafeUrl = (_url: string): boolean => true;
const neverSafeUrl  = (_url: string): boolean => false;

// ─── parseJsonWithComments ───────────────────────────────────────────────────

describe('CatalogManifestParser.parseJsonWithComments', () => {
  it('parses plain JSON', () => {
    const result = CatalogManifestParser.parseJsonWithComments('{"a":1}');
    expect(result).toEqual({ a: 1 });
  });

  it('strips single-line // comments', () => {
    const result = CatalogManifestParser.parseJsonWithComments(`
      // this is a comment
      { "key": "value" }
    `);
    expect(result).toEqual({ key: 'value' });
  });

  it('strips multi-line /* */ comments', () => {
    const result = CatalogManifestParser.parseJsonWithComments(`
      /* header comment */
      { "x": 42 }
    `);
    expect(result).toEqual({ x: 42 });
  });

  it('returns {} for empty/whitespace input', () => {
    expect(CatalogManifestParser.parseJsonWithComments('')).toEqual({});
    expect(CatalogManifestParser.parseJsonWithComments('   ')).toEqual({});
  });

  it('throws on malformed JSON', () => {
    expect(() => CatalogManifestParser.parseJsonWithComments('{invalid}')).toThrow();
  });
});

// ─── validateManifest ────────────────────────────────────────────────────────

describe('CatalogManifestParser.validateManifest', () => {
  const validManifest: CatalogPackageManifest = {
    id: 'agent-backend',
    type: 'agent',
    name: 'backend-specialist',
    displayName: 'Backend Specialist',
    description: 'Test agent',
  };

  it('accepts a valid manifest', () => {
    const result = CatalogManifestParser.validateManifest(validManifest, 'test', alwaysSafeUrl, mockLogger);
    expect(result).toEqual(validManifest);
  });

  it('rejects unknown type', () => {
    const m = { ...validManifest, type: 'unknown-type' };
    const result = CatalogManifestParser.validateManifest(m, 'test', alwaysSafeUrl, mockLogger);
    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('accepts all valid types', () => {
    for (const t of ['agent', 'skill', 'mcp', 'instruction', 'prompt'] as const) {
      const result = CatalogManifestParser.validateManifest({ ...validManifest, type: t }, 'src', alwaysSafeUrl, mockLogger);
      expect(result?.type).toBe(t);
    }
  });

  it('rejects invalid ID format (uppercase)', () => {
    const m = { ...validManifest, id: 'Agent-Backend' };
    const result = CatalogManifestParser.validateManifest(m, 'test', alwaysSafeUrl, mockLogger);
    expect(result).toBeUndefined();
  });

  it('rejects manifest with path traversal in source paths', () => {
    const m = { ...validManifest, source: { packagePath: '../evil/path' } };
    const result = CatalogManifestParser.validateManifest(m, 'test', alwaysSafeUrl, mockLogger);
    expect(result).toBeUndefined();
  });

  it('rejects manifest with absolute path in files', () => {
    const m = { ...validManifest, files: [{ relativePath: '/etc/passwd' }] };
    const result = CatalogManifestParser.validateManifest(m, 'test', alwaysSafeUrl, mockLogger);
    expect(result).toBeUndefined();
  });

  it('rejects manifest with unsafe URL (via isUrlSafe callback)', () => {
    const m = { ...validManifest, source: { repoUrl: 'http://evil.example.com' } };
    const result = CatalogManifestParser.validateManifest(m, 'test', neverSafeUrl, mockLogger);
    expect(result).toBeUndefined();
  });

  it('accepts manifest without optional URLs/paths', () => {
    const minimal = { type: 'skill', id: 'skill-api' };
    const result = CatalogManifestParser.validateManifest(minimal, 'src', alwaysSafeUrl, mockLogger);
    expect(result).toBeDefined();
  });
});

// ─── isSafeRelativePath ──────────────────────────────────────────────────────

describe('CatalogManifestParser.isSafeRelativePath', () => {
  it('accepts normal relative paths', () => {
    expect(CatalogManifestParser.isSafeRelativePath('agents/backend.agent.md')).toBe(true);
    expect(CatalogManifestParser.isSafeRelativePath('.github/agents/test.md')).toBe(true);
  });

  it('rejects path traversal with ..', () => {
    expect(CatalogManifestParser.isSafeRelativePath('../evil')).toBe(false);
    expect(CatalogManifestParser.isSafeRelativePath('a/../../etc/passwd')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(CatalogManifestParser.isSafeRelativePath('/etc/passwd')).toBe(false);
    expect(CatalogManifestParser.isSafeRelativePath('/absolute/path')).toBe(false);
  });

  it('rejects null bytes', () => {
    expect(CatalogManifestParser.isSafeRelativePath('file\0name')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(CatalogManifestParser.isSafeRelativePath('')).toBe(false);
    expect(CatalogManifestParser.isSafeRelativePath('   ')).toBe(false);
  });
});

// ─── asString ────────────────────────────────────────────────────────────────

describe('CatalogManifestParser.asString', () => {
  it('returns trimmed string for string input', () => {
    expect(CatalogManifestParser.asString('  hello  ')).toBe('hello');
  });

  it('returns empty string for non-string types', () => {
    expect(CatalogManifestParser.asString(42)).toBe('');
    expect(CatalogManifestParser.asString(null)).toBe('');
    expect(CatalogManifestParser.asString(undefined)).toBe('');
    expect(CatalogManifestParser.asString({})).toBe('');
    expect(CatalogManifestParser.asString(['a'])).toBe('');
  });
});

// ─── asStringArray ───────────────────────────────────────────────────────────

describe('CatalogManifestParser.asStringArray', () => {
  it('returns filtered array of trimmed strings', () => {
    expect(CatalogManifestParser.asStringArray(['a', 'b', '  c  '])).toEqual(['a', 'b', 'c']);
  });

  it('wraps single string in array', () => {
    expect(CatalogManifestParser.asStringArray('hello')).toEqual(['hello']);
  });

  it('filters out non-string items in array', () => {
    expect(CatalogManifestParser.asStringArray([1, 'valid', null])).toEqual(['valid']);
  });

  it('filters out empty strings', () => {
    expect(CatalogManifestParser.asStringArray(['', 'ok', '  '])).toEqual(['ok']);
  });

  it('returns empty array for non-string types', () => {
    expect(CatalogManifestParser.asStringArray(42)).toEqual([]);
    expect(CatalogManifestParser.asStringArray(null)).toEqual([]);
    expect(CatalogManifestParser.asStringArray({})).toEqual([]);
  });
});

// ─── asAuthor ────────────────────────────────────────────────────────────────

describe('CatalogManifestParser.asAuthor', () => {
  it('returns string author directly', () => {
    expect(CatalogManifestParser.asAuthor('Itaú Engineering')).toBe('Itaú Engineering');
  });

  it('returns name from object author', () => {
    expect(CatalogManifestParser.asAuthor({ name: 'Community Team' })).toBe('Community Team');
  });

  it('returns default for missing/invalid input', () => {
    expect(CatalogManifestParser.asAuthor(undefined)).toBe('DescomplicAI Community');
    expect(CatalogManifestParser.asAuthor({})).toBe('DescomplicAI Community');
    expect(CatalogManifestParser.asAuthor(42 as unknown as string)).toBe('DescomplicAI Community');
  });
});

// ─── asBoolean ───────────────────────────────────────────────────────────────

describe('CatalogManifestParser.asBoolean', () => {
  it('returns boolean values as-is', () => {
    expect(CatalogManifestParser.asBoolean(true)).toBe(true);
    expect(CatalogManifestParser.asBoolean(false)).toBe(false);
  });

  it('returns fallback for non-boolean', () => {
    expect(CatalogManifestParser.asBoolean(undefined)).toBe(false);
    expect(CatalogManifestParser.asBoolean('true')).toBe(false);
    expect(CatalogManifestParser.asBoolean(1)).toBe(false);
    expect(CatalogManifestParser.asBoolean(undefined, true)).toBe(true);
  });
});

// ─── asMaturity ──────────────────────────────────────────────────────────────

describe('CatalogManifestParser.asMaturity', () => {
  it('accepts valid maturity values', () => {
    expect(CatalogManifestParser.asMaturity('beta')).toBe('beta');
    expect(CatalogManifestParser.asMaturity('experimental')).toBe('experimental');
    expect(CatalogManifestParser.asMaturity('stable')).toBe('stable');
  });

  it('falls back to stable for unknown/missing values', () => {
    expect(CatalogManifestParser.asMaturity(undefined)).toBe('stable');
    expect(CatalogManifestParser.asMaturity('alpha')).toBe('stable');
    expect(CatalogManifestParser.asMaturity('')).toBe('stable');
  });
});

// ─── asInstallTargets ────────────────────────────────────────────────────────

describe('CatalogManifestParser.asInstallTargets', () => {
  it('parses valid targets', () => {
    const result = CatalogManifestParser.asInstallTargets([
      { source: 'src/agent.md', target: '.github/agents/agent.md' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].targetPath).toBe('.github/agents/agent.md');
    expect(result[0].sourcePath).toBe('src/agent.md');
    expect(result[0].mergeStrategy).toBe('replace');
  });

  it('uses merge-mcp-servers strategy when specified', () => {
    const result = CatalogManifestParser.asInstallTargets([
      { target: '.vscode/mcp.json', mergeStrategy: 'merge-mcp-servers' },
    ]);
    expect(result[0].mergeStrategy).toBe('merge-mcp-servers');
  });

  it('skips targets without target path', () => {
    const result = CatalogManifestParser.asInstallTargets([
      { source: 'file.md' }, // no target
    ]);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for non-array input', () => {
    expect(CatalogManifestParser.asInstallTargets(undefined)).toEqual([]);
    expect(CatalogManifestParser.asInstallTargets(null as never)).toEqual([]);
  });
});

// ─── slugify ─────────────────────────────────────────────────────────────────

describe('CatalogManifestParser.slugify', () => {
  it('lowercases and replaces spaces', () => {
    expect(CatalogManifestParser.slugify('Backend Specialist')).toBe('backend-specialist');
  });

  it('removes special characters', () => {
    expect(CatalogManifestParser.slugify('API Design & Patterns!')).toBe('api-design-patterns');
  });

  it('collapses multiple hyphens', () => {
    expect(CatalogManifestParser.slugify('foo---bar')).toBe('foo-bar');
  });

  it('strips leading/trailing hyphens', () => {
    expect(CatalogManifestParser.slugify('---hello---')).toBe('hello');
  });

  it('returns "package" for empty/invalid input', () => {
    expect(CatalogManifestParser.slugify('')).toBe('package');
    expect(CatalogManifestParser.slugify('!@#$%')).toBe('package');
  });
});

// ─── toDisplayName ───────────────────────────────────────────────────────────

describe('CatalogManifestParser.toDisplayName', () => {
  it('converts slug to title case', () => {
    expect(CatalogManifestParser.toDisplayName('backend-specialist')).toBe('Backend Specialist');
    expect(CatalogManifestParser.toDisplayName('aws_core')).toBe('Aws Core');
  });

  it('preserves existing uppercase and capitalizes first letter per word', () => {
    // toDisplayName only uppercases the first letter of each word — does NOT downcase the rest
    expect(CatalogManifestParser.toDisplayName('API Design')).toBe('API Design');
    expect(CatalogManifestParser.toDisplayName('test api')).toBe('Test Api');
  });
});

// ─── toRelativePath ──────────────────────────────────────────────────────────

describe('CatalogManifestParser.toRelativePath', () => {
  it('returns posix-style relative path', () => {
    const root = '/repo';
    const file = '/repo/agents/backend/manifest.json';
    const result = CatalogManifestParser.toRelativePath(root, file);
    expect(result).toBe('agents/backend/manifest.json');
  });
});
