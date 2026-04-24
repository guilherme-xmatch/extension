/**
 * @module domain/entities/Bundle
 * @description A Bundle is a composite package that installs multiple packages at once.
 * Example: "Backend Starter" = api-design skill + security skill + backend-specialist agent.
 */

import { Version } from '../value-objects/Version';

/** A bundle groups multiple package IDs for one-click installation */
export class Bundle {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly displayName: string,
    public readonly description: string,
    public readonly version: Version,
    public readonly packageIds: ReadonlyArray<string>,
    public readonly icon: string,
    public readonly color: string,
  ) {}

  static create(props: {
    id: string;
    name: string;
    displayName: string;
    description: string;
    version: string;
    packageIds: string[];
    icon?: string;
    color?: string;
  }): Bundle {
    return new Bundle(
      props.id,
      props.name,
      props.displayName,
      props.description,
      Version.parse(props.version),
      Object.freeze([...props.packageIds]),
      props.icon ?? '$(package)',
      props.color ?? '#EC7000',
    );
  }

  /** Number of packages in the bundle */
  get packageCount(): number {
    return this.packageIds.length;
  }

  /** Check if bundle contains a specific package */
  containsPackage(packageId: string): boolean {
    return this.packageIds.includes(packageId);
  }

  /** Check if this bundle matches a search query */
  matchesQuery(query: string): boolean {
    const q = query.toLowerCase().trim();
    if (q === '') { return true; }
    return (
      this.name.toLowerCase().includes(q) ||
      this.displayName.toLowerCase().includes(q) ||
      this.description.toLowerCase().includes(q)
    );
  }
}
