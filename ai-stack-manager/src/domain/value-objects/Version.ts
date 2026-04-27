/**
 * @module domain/value-objects/Version
 * @description Value object de versão semântica para versionamento de pacotes.
 */

export class Version {
  private constructor(
    public readonly major: number,
    public readonly minor: number,
    public readonly patch: number,
  ) {}

  /** Analisa uma string semver (ex.: "1.2.3"). */
  static parse(version: string): Version {
    const parts = version.replace(/^v/, '').split('.').map(Number);
    return new Version(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
  }

  /** Cria uma versão a partir de componentes numéricos. */
  static of(major: number, minor: number, patch: number): Version {
    return new Version(major, minor, patch);
  }

  /** Representação em string. */
  toString(): string {
    return `${this.major}.${this.minor}.${this.patch}`;
  }

  /** Compara duas versões. Retorna -1, 0 ou 1. */
  compareTo(other: Version): number {
    if (this.major !== other.major) { return this.major > other.major ? 1 : -1; }
    if (this.minor !== other.minor) { return this.minor > other.minor ? 1 : -1; }
    if (this.patch !== other.patch) { return this.patch > other.patch ? 1 : -1; }
    return 0;
  }

  /** Verifica se esta versão é mais recente que outra. */
  isNewerThan(other: Version): boolean {
    return this.compareTo(other) > 0;
  }

  equals(other: Version): boolean {
    return this.compareTo(other) === 0;
  }
}
