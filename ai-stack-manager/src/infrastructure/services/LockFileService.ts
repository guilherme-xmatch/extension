/**
 * @module infrastructure/services/LockFileService
 * @description Manages the persistent lock file that tracks installed package versions.
 * Lock file location: <workspaceRoot>/.descomplicai/installed.lock.json
 * Uses Node fs (synchronous) — not vscode.workspace.fs — for use in both
 * extension and test environments.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCK_RELATIVE_PATH = '.descomplicai/installed.lock.json';
const SCHEMA_VERSION = '1.0.0';

/** A single installed-package record stored in the lock file. */
export interface LockEntry {
  /** Package ID (e.g. "agent-code-architect") */
  id: string;
  /** Installed version string (e.g. "1.0.0") */
  version: string;
  /** ISO date-time when the package was installed */
  installedAt: string;
  /** Whether the package came from the official DescomplicAI registry */
  sourceOfficial: boolean;
}

/** Top-level structure of the lock file. */
export interface LockFile {
  /** Schema version — bump when the format changes */
  schemaVersion: string;
  /** ISO date-time of the last write */
  updatedAt: string;
  /** Ordered list of installed package entries */
  packages: LockEntry[];
}

export class LockFileService {
  private readonly lockFilePath: string;

  constructor(workspaceRoot: string) {
    this.lockFilePath = path.join(workspaceRoot, LOCK_RELATIVE_PATH);
  }

  /**
   * Read the lock file from disk.
   * Returns an empty lock structure if the file does not exist or is invalid.
   */
  read(): LockFile {
    try {
      const raw = fs.readFileSync(this.lockFilePath, 'utf-8');
      return JSON.parse(raw) as LockFile;
    } catch {
      return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), packages: [] };
    }
  }

  /**
   * Write the lock file to disk, creating the directory if necessary.
   */
  write(lockFile: LockFile): void {
    const dir = path.dirname(this.lockFilePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.lockFilePath, JSON.stringify(lockFile, null, 2), 'utf-8');
  }

  /**
   * Add a new entry or update an existing one (matched by ID).
   */
  addOrUpdate(pkg: { id: string; version: string; sourceOfficial: boolean }): void {
    const lockFile = this.read();
    const existingIndex = lockFile.packages.findIndex(p => p.id === pkg.id);

    const entry: LockEntry = {
      id: pkg.id,
      version: pkg.version,
      installedAt: new Date().toISOString(),
      sourceOfficial: pkg.sourceOfficial,
    };

    if (existingIndex >= 0) {
      lockFile.packages[existingIndex] = entry;
    } else {
      lockFile.packages.push(entry);
    }

    lockFile.updatedAt = new Date().toISOString();
    this.write(lockFile);
  }

  /**
   * Remove the entry for the given package ID.
   * No-op if the package is not in the lock file.
   */
  remove(packageId: string): void {
    const lockFile = this.read();
    lockFile.packages = lockFile.packages.filter(p => p.id !== packageId);
    lockFile.updatedAt = new Date().toISOString();
    this.write(lockFile);
  }

  /**
   * Find a lock entry by package ID.
   * Returns `undefined` if not found.
   */
  findById(packageId: string): LockEntry | undefined {
    return this.read().packages.find(p => p.id === packageId);
  }
}
