/**
 * @module infrastructure/services/StackDiffBuilder
 * @description Computes the diff between the current set of installed packages
 * and a chosen target bundle.
 *
 * The diff is returned as a plain JSON-serializable `StackDiff` object so it
 * can be embedded directly in webview HTML or rendered as Markdown in the
 * chat participant.
 */

import { Package } from '../../domain/entities/Package';
import { Bundle } from '../../domain/entities/Bundle';

// ─── Serializable output types ────────────────────────────────────────────────

export type DiffStatus = 'installed' | 'missing' | 'extra';

/** A single package entry within a diff result */
export interface PackageDiffEntry {
  id: string;
  displayName: string;
  description: string;
  /** Emoji from agentMeta.category or empty string for non-agents */
  categoryEmoji: string;
  /** Human-readable type label (e.g. "Agent", "Skill", "MCP") */
  typeLabel: string;
  /** Type value string (e.g. "agent", "skill", "mcp") */
  typeValue: string;
  /** "installed" = in workspace + in bundle; "missing" = in bundle only; "extra" = in workspace only */
  status: DiffStatus;
}

/** Full diff between the installed workspace packages and a target bundle */
export interface StackDiff {
  /** Bundle used as the comparison target */
  targetBundle: {
    id: string;
    displayName: string;
    description: string;
    packageCount: number;
    icon: string;
    color: string;
  };
  /** Packages that are INSTALLED and IN the target bundle ✅ */
  installed: PackageDiffEntry[];
  /** Packages that are IN the target bundle but NOT installed 🆕 */
  missing: PackageDiffEntry[];
  /** Packages that are INSTALLED but NOT in the target bundle 🔄 */
  extras: PackageDiffEntry[];
  /** Percentage of bundle coverage (installed / total in bundle) */
  coveragePercent: number;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * StackDiffBuilder — pure computation service with no I/O.
 *
 * Usage:
 * ```typescript
 * const diff = new StackDiffBuilder().build({
 *   targetBundle,
 *   allPackages,
 *   installedIds,
 * });
 * ```
 */
export class StackDiffBuilder {

  /**
   * Computes the full diff between the installed workspace packages and
   * the given target bundle.
   *
   * @param targetBundle  — the bundle to compare against
   * @param allPackages   — complete catalog (used to resolve display metadata)
   * @param installedIds  — IDs of packages currently installed in the workspace
   */
  build(params: {
    targetBundle: Bundle;
    allPackages: Package[];
    installedIds: string[];
  }): StackDiff {
    const { targetBundle, allPackages, installedIds } = params;

    const installedSet  = new Set(installedIds);
    const bundleSet     = new Set(targetBundle.packageIds);
    const allPkgMap     = new Map(allPackages.map(p => [p.id, p]));

    // ── Packages that are IN the bundle ───────────────────────────────────────
    const installed: PackageDiffEntry[] = [];
    const missing:   PackageDiffEntry[] = [];

    for (const pkgId of targetBundle.packageIds) {
      const pkg = allPkgMap.get(pkgId);
      if (!pkg) { continue; }          // unknown package — skip silently

      const entry = this._toEntry(pkg, installedSet.has(pkgId) ? 'installed' : 'missing');
      if (entry.status === 'installed') {
        installed.push(entry);
      } else {
        missing.push(entry);
      }
    }

    // ── Packages installed but NOT in the bundle ──────────────────────────────
    const extras: PackageDiffEntry[] = [];
    for (const pkgId of installedIds) {
      if (!bundleSet.has(pkgId)) {
        const pkg = allPkgMap.get(pkgId);
        if (!pkg) { continue; }
        extras.push(this._toEntry(pkg, 'extra'));
      }
    }

    // Sort each group alphabetically by displayName
    const byName = (a: PackageDiffEntry, b: PackageDiffEntry) =>
      a.displayName.localeCompare(b.displayName);
    installed.sort(byName);
    missing.sort(byName);
    extras.sort(byName);

    const totalInBundle = installed.length + missing.length;
    const coveragePercent = totalInBundle > 0
      ? Math.round((installed.length / totalInBundle) * 100)
      : 0;

    return {
      targetBundle: {
        id:           targetBundle.id,
        displayName:  targetBundle.displayName,
        description:  targetBundle.description,
        packageCount: targetBundle.packageCount,
        icon:         targetBundle.icon,
        color:        targetBundle.color,
      },
      installed,
      missing,
      extras,
      coveragePercent,
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _toEntry(pkg: Package, status: DiffStatus): PackageDiffEntry {
    return {
      id:            pkg.id,
      displayName:   pkg.displayName,
      description:   pkg.description,
      categoryEmoji: pkg.categoryEmoji,
      typeLabel:     pkg.type.label,
      typeValue:     pkg.type.value,
      status,
    };
  }
}
