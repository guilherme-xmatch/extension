/**
 * @module domain/value-objects/Version
 * @description Semantic version value object for package versioning.
 */

export class Version {
  private constructor(
    public readonly major: number,
    public readonly minor: number,
    public readonly patch: number,
  ) {}

  /** Parse a semver string (e.g. "1.2.3") */
  static parse(version: string): Version {
    const parts = version.replace(/^v/, '').split('.').map(Number);
    return new Version(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
  }

  /** Create from components */
  static of(major: number, minor: number, patch: number): Version {
    return new Version(major, minor, patch);
  }

  /** String representation */
  toString(): string {
    return `${this.major}.${this.minor}.${this.patch}`;
  }

  /** Compare two versions. Returns -1, 0, or 1 */
  compareTo(other: Version): number {
    if (this.major !== other.major) { return this.major > other.major ? 1 : -1; }
    if (this.minor !== other.minor) { return this.minor > other.minor ? 1 : -1; }
    if (this.patch !== other.patch) { return this.patch > other.patch ? 1 : -1; }
    return 0;
  }

  /** Check if this version is newer than another */
  isNewerThan(other: Version): boolean {
    return this.compareTo(other) > 0;
  }

  equals(other: Version): boolean {
    return this.compareTo(other) === 0;
  }
}
