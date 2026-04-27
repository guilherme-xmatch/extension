/**
 * @module domain/interfaces
 * @description Interfaces de repositório e serviço (portas) para a camada de domínio.
 * As implementações de infraestrutura fornecem os adaptadores concretos.
 */

import { Package, InstallStatus } from '../entities/Package';
import { Bundle } from '../entities/Bundle';
import { HealthReport } from '../entities/HealthReport';
import { OperationContext, OperationDefinition, OperationMetricsSnapshot, OperationSnapshot } from '../entities/Operation';

/**
 * Interface de evento genérico — desacoplada do SDK do VS Code.
 * Estruturalmente compatível com vscode.Event<T>: qualquer vscode.EventEmitter<T>.event
 * pode ser atribuído a IEvent<T> sem modificação.
 */
export interface IEvent<T> {
  (listener: (e: T) => void): { dispose(): void };
}

/** Acesso somente leitura ao catálogo de pacotes. */
export interface IPackageRepository {
  /** Retorna todos os pacotes disponíveis. */
  getAll(): Promise<Package[]>;
  /** Busca um pacote pelo ID. */
  findById(id: string): Promise<Package | undefined>;
  /** Busca pacotes por query. */
  search(query: string): Promise<Package[]>;
  /** Retorna todos os bundles. */
  getAllBundles(): Promise<Bundle[]>;
  /** Busca um bundle pelo ID. */
  findBundleById(id: string): Promise<Bundle | undefined>;
  getAgentNetwork(agentId: string): Promise<Package[]>;
  getRelatedSkills(agentId: string): Promise<Package[]>;
}

/** Detecta o que está instalado no workspace atual. */
export interface IWorkspaceScanner {
  /** Retorna o status de instalação de um pacote específico. */
  getInstallStatus(pkg: Package): Promise<InstallStatus>;
  /** Retorna os IDs de todos os pacotes instalados. */
  getInstalledPackageIds(): Promise<string[]>;
  /** Verifica se o workspace possui um diretório .github. */
  hasGitHubDirectory(): Promise<boolean>;
  /**
   * Detecta o perfil do projeto a partir dos arquivos do workspace e recomenda IDs de bundle.
   * - `profile`          — Tipo do projeto (ex.: "Backend API", "Python Service")
   * - `bundleId`         — Bundle do catálogo que melhor se encaixa no perfil
   * - `confidence`       — Certeza da correspondência (0–1); maior = sinal mais forte
   * - `reason`           — Explicação de uma linha sobre por que o perfil foi detectado
   * - `detectedSignals`  — Lista de nomes de arquivos/dependências que ativaram a detecção
   */
  detectProjectProfile(): Promise<Array<{
    profile: string;
    bundleId: string;
    confidence: number;
    reason: string;
    detectedSignals: string[];
  }>>;
}

/** Instala e desinstala pacotes no workspace. */
export interface IInstaller {
  /** Instala um pacote no workspace. */
  install(pkg: Package, options?: InstallExecutionOptions): Promise<void>;
  /** Desinstala um pacote do workspace. */
  uninstall(pkg: Package, options?: InstallExecutionOptions): Promise<void>;
  /** Instala múltiplos pacotes (bundle). */
  installMany(packages: Package[], options?: InstallExecutionOptions): Promise<void>;
}

/** Valida a integridade da infraestrutura de AI. */
export interface IHealthChecker {
  /** Executa uma verificação completa de saúde no workspace. */
  check(): Promise<HealthReport>;
}

export interface IInstallTracker {
  trackInstall(pkg: Package): Promise<void>;
}

export interface InstallExecutionProgress {
  readonly current: number;
  readonly total: number;
  readonly packageId?: string;
  readonly label?: string;
}

export interface InstallExecutionOptions {
  readonly onProgress?: (progress: InstallExecutionProgress) => void;
}

export interface IOperationCoordinator {
  getCurrentOperation(): OperationSnapshot | undefined;
  getRecentOperations(limit?: number): ReadonlyArray<OperationSnapshot>;
  getMetrics(): ReadonlyArray<OperationMetricsSnapshot>;
  run<T>(definition: OperationDefinition, action: (context: OperationContext) => Promise<T>): Promise<T>;
  readonly onDidChangeCurrentOperation: IEvent<OperationSnapshot | undefined>;
  readonly onDidFinishOperation: IEvent<OperationSnapshot>;
}
