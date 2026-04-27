/**
 * @module infrastructure/repositories/LocalCatalogData
 * @description Catálogo de fallback embutido usado pelo LocalRegistry.
 *
 * Todos os dados de pacotes/bundles são carregados em tempo de execução a partir do registro
 * remoto do DescomplicAI (configurado via `descomplicai.registryUrl`). Este módulo expõe
 * arrays congelados vazios para que o LocalRegistry funcione corretamente quando nenhum
 * registro externo estiver disponível, sem incluir conteúdo fixo na distribuição.
 *
 * Para injetar dados personalizados em testes, passe packages/bundles diretamente
 * ao construtor do LocalRegistry.
 */

import { Package } from '../../domain/entities/Package';
import { Bundle } from '../../domain/entities/Bundle';

// ─── Exports ──────────────────────────────────────────────────────────────────
// Ambos os arrays são intencionalmente vazios. Os dados dos pacotes são carregados
// em tempo de execução a partir do registro externo DescomplicAI.
// O LocalRegistry aceita dados injetados para fins de teste.

export const LOCAL_CATALOG_PACKAGES: readonly Package[] = Object.freeze<Package[]>([]);

export const LOCAL_CATALOG_BUNDLES: readonly Bundle[] = Object.freeze<Bundle[]>([]);
