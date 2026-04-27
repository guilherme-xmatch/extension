/**
 * @module domain/entities/Bundle
 * @description Um Bundle é um pacote composto que instala múltiplos pacotes de uma só vez.
 * Exemplo: "Backend Starter" = skill api-design + skill security + agente backend-specialist.
 */

import { Version } from '../value-objects/Version';

/** Um bundle agrupa múltiplos IDs de pacote para instalação com um clique. */
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

  /** Número de pacotes no bundle. */
  get packageCount(): number {
    return this.packageIds.length;
  }

  /** Verifica se o bundle contém um pacote específico. */
  containsPackage(packageId: string): boolean {
    return this.packageIds.includes(packageId);
  }

  /** Verifica se o bundle corresponde a uma query de busca. */
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
