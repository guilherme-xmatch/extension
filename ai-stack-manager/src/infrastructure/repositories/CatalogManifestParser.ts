/**
 * @module infrastructure/repositories/CatalogManifestParser
 * @description Pure data-transformation utilities for catalog manifests.
 * No I/O, no network, no VS Code dependencies — all methods are static and testable in isolation.
 */

import * as path from 'path';
import {
  PackageInstallTarget,
  PackageMaturity,
  PackageStats,
} from '../../domain/entities/Package';
import { AppLogger } from '../services/AppLogger';

// ─── Catalog Schema Types ──────────────────────────────────────────────────

export interface CatalogIndex {
  schemaVersion?: string;
  repoUrl?: string;
  packages?: Array<string | CatalogPackageManifest>;
  bundles?: unknown[];
  stats?: { packagesBasePath?: string };
}

export interface CatalogPackageManifest {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  type?: string;
  version?: string;
  tags?: string[];
  author?: string | { name?: string };
  dependencies?: string[];
  icon?: string;
  files?: Array<{ relativePath?: string; content?: string }>;
  install?: {
    strategy?: 'copy' | 'mcp-merge';
    targets?: Array<{ source?: string; target?: string; mergeStrategy?: 'replace' | 'merge-mcp-servers' }>;
  };
  source?: {
    repoUrl?: string;
    packagePath?: string;
    manifestPath?: string;
    readmePath?: string;
    detailsPath?: string;
    homepage?: string;
    official?: boolean;
  };
  ui?: {
    longDescription?: string;
    highlights?: string[];
    installNotes?: string[];
    badges?: string[];
    maturity?: PackageMaturity;
    icon?: string;
    banner?: string;
  };
  docs?: {
    readmePath?: string;
    detailsPath?: string;
    readme?: string;
    details?: string;
    links?: Array<{ label?: string; url?: string }>;
  };
  stats?: PackageStats;
  agentMeta?: {
    category?: string;
    tools?: string[];
    delegatesTo?: string[];
    workflowPhase?: string;
    userInvocable?: boolean;
    relatedSkills?: string[];
  };
}

export type ManifestInstallTargets = Array<{
  source?: string; target?: string; mergeStrategy?: 'replace' | 'merge-mcp-servers';
}>;

export type ManifestLinks = Array<{ label?: string; url?: string }>;

// ─── Parser ────────────────────────────────────────────────────────────────

/**
 * Static utility class for parsing and validating catalog manifests.
 * All methods are side-effect-free and independently testable.
 */
export class CatalogManifestParser {

  static parseJsonWithComments(content: string): unknown {
    const sanitized = content
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    return sanitized ? JSON.parse(sanitized) : {};
  }

  /**
   * Validates a manifest object for required fields, ID format, safe paths, and URLs.
   * @param isUrlSafe  Caller-supplied predicate for URL safety (from CatalogFetcher).
   */
  static validateManifest(
    manifest: CatalogPackageManifest,
    source: string,
    isUrlSafe: (url: string) => boolean,
    logger: AppLogger,
  ): CatalogPackageManifest | undefined {
    const type = CatalogManifestParser.asString(manifest.type);
    const id = CatalogManifestParser.asString(manifest.id);

    if (!type || !['agent', 'skill', 'mcp', 'instruction', 'prompt'].includes(type)) {
      logger.warn('Manifest ignorado por tipo inválido.', { source, type });
      return undefined;
    }

    if (id && !/^[a-z0-9-]+$/.test(id)) {
      logger.warn('Manifest ignorado por ID inválido.', { source, id });
      return undefined;
    }

    const safePaths = [
      CatalogManifestParser.asString(manifest.source?.packagePath),
      CatalogManifestParser.asString(manifest.source?.manifestPath),
      CatalogManifestParser.asString(manifest.source?.readmePath),
      CatalogManifestParser.asString(manifest.source?.detailsPath),
      CatalogManifestParser.asString(manifest.docs?.readmePath),
      CatalogManifestParser.asString(manifest.docs?.detailsPath),
      ...((manifest.install?.targets ?? []).flatMap(t => [CatalogManifestParser.asString(t.source), CatalogManifestParser.asString(t.target)])),
      ...((manifest.files ?? []).map(f => CatalogManifestParser.asString(f.relativePath))),
    ].filter(Boolean);

    for (const candidatePath of safePaths) {
      if (!CatalogManifestParser.isSafeRelativePath(candidatePath)) {
        logger.warn('Manifest ignorado por caminho potencialmente inseguro.', { source, candidatePath });
        return undefined;
      }
    }

    const candidateUrls = [
      CatalogManifestParser.asString(manifest.source?.repoUrl),
      CatalogManifestParser.asString(manifest.source?.homepage),
      ...((manifest.docs?.links ?? []).map(link => CatalogManifestParser.asString(link.url))),
    ].filter(Boolean);

    for (const candidateUrl of candidateUrls) {
      if (!isUrlSafe(candidateUrl)) {
        logger.warn('Manifest ignorado por URL insegura.', { source, candidateUrl });
        return undefined;
      }
    }

    return manifest;
  }

  static isSafeRelativePath(value: string): boolean {
    const normalized = value.replace(/\\/g, '/').trim();
    if (!normalized) { return false; }
    if (path.posix.isAbsolute(normalized)) { return false; }
    if (normalized.includes('\0')) { return false; }
    return !normalized.split('/').some(segment => segment === '..');
  }

  static asInstallTargets(value: ManifestInstallTargets | undefined): PackageInstallTarget[] {
    if (!Array.isArray(value)) { return []; }
    return value.flatMap(item => {
      const targetPath = CatalogManifestParser.asString(item?.target);
      if (!targetPath) { return []; }
      return [{
        sourcePath: CatalogManifestParser.asString(item?.source) || undefined,
        targetPath,
        mergeStrategy: item?.mergeStrategy === 'merge-mcp-servers' ? 'merge-mcp-servers' : 'replace',
      }];
    });
  }

  static asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  static asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map(item => CatalogManifestParser.asString(item)).filter(Boolean);
    }
    if (typeof value === 'string') { return [value.trim()].filter(Boolean); }
    return [];
  }

  static asAuthor(value: CatalogPackageManifest['author']): string {
    if (typeof value === 'string') { return value.trim(); }
    if (value && typeof value === 'object' && typeof value.name === 'string') { return value.name.trim(); }
    return 'DescomplicAI Community';
  }

  static asBoolean(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  static asMaturity(value: unknown): PackageMaturity {
    return value === 'beta' || value === 'experimental' ? value : 'stable';
  }

  static toRelativePath(rootDir: string, filePath: string): string {
    return path.relative(rootDir, filePath).replace(/\\/g, '/');
  }

  static toDisplayName(value: string): string {
    return value
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map(word => {
        if (!word) { return word; }
        // Preserve all-uppercase words (acronyms like API, AWS, MCP)
        if (word.length > 1 && word === word.toUpperCase()) { return word; }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }

  static slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-') || 'package';
  }
}
