/**
 * @module infrastructure/repositories/LocalCatalogData
 * @description Built-in fallback catalog used by LocalRegistry.
 *
 * All package/bundle data is loaded at runtime from the remote DescomplicAI
 * registry (configured via `descomplicai.registryUrl`). This module exposes
 * empty frozen arrays so that LocalRegistry works correctly when no external
 * registry is available, without shipping any hardcoded content.
 *
 * To inject custom data in tests, pass packages/bundles directly to the
 * LocalRegistry constructor.
 */

import { Package } from '../../domain/entities/Package';
import { Bundle } from '../../domain/entities/Bundle';

// ─── Exports ──────────────────────────────────────────────────────────────────
// Ambos os arrays são intencionalmente vazios. Os dados dos pacotes são carregados
// em tempo de execução a partir do registro externo DescomplicAI.
// O LocalRegistry aceita dados injetados para fins de teste.

export const LOCAL_CATALOG_PACKAGES: readonly Package[] = Object.freeze<Package[]>([]);

export const LOCAL_CATALOG_BUNDLES: readonly Bundle[] = Object.freeze<Bundle[]>([]);
