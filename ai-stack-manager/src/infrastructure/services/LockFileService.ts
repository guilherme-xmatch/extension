/**
 * @module infrastructure/services/LockFileService
 * @description Gerencia o arquivo de lock persistente que rastreia as versões de pacotes instalados.
 * Localização do lock file: <workspaceRoot>/.descomplicai/installed.lock.json
 * Usa Node fs (síncrono) — não vscode.workspace.fs — para funcionar tanto na extensão
 * quanto em ambientes de teste.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCK_RELATIVE_PATH = '.descomplicai/installed.lock.json';
const SCHEMA_VERSION = '1.0.0';

/** Um único registro de pacote instalado armazenado no lock file. */
export interface LockEntry {
  /** ID do pacote (ex.: "agent-code-architect") */
  id: string;
  /** String de versão instalada (ex.: "1.0.0") */
  version: string;
  /** Data e hora ISO de quando o pacote foi instalado */
  installedAt: string;
  /** Se o pacote veio do registro oficial do DescomplicAI */
  sourceOfficial: boolean;
}

/** Estrutura de nível superior do lock file. */
export interface LockFile {
  /** Versão do schema — incrementar quando o formato mudar */
  schemaVersion: string;
  /** Data e hora ISO da última escrita */
  updatedAt: string;
  /** Lista ordenada de entradas de pacotes instalados */
  packages: LockEntry[];
}

export class LockFileService {
  private readonly lockFilePath: string;

  constructor(workspaceRoot: string) {
    this.lockFilePath = path.join(workspaceRoot, LOCK_RELATIVE_PATH);
  }

  /**
   * Lê o lock file do disco.
   * Retorna uma estrutura de lock vazia se o arquivo não existir ou for inválido.
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
   * Escreve o lock file no disco, criando o diretório se necessário.
   */
  write(lockFile: LockFile): void {
    const dir = path.dirname(this.lockFilePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.lockFilePath, JSON.stringify(lockFile, null, 2), 'utf-8');
  }

  /**
   * Adiciona uma nova entrada ou atualiza uma existente (identificada pelo ID).
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
   * Remove a entrada do pacote com o ID fornecido.
   * Sem efeito se o pacote não estiver no lock file.
   */
  remove(packageId: string): void {
    const lockFile = this.read();
    lockFile.packages = lockFile.packages.filter(p => p.id !== packageId);
    lockFile.updatedAt = new Date().toISOString();
    this.write(lockFile);
  }

  /**
   * Localiza uma entrada pelo ID do pacote.
   * Retorna `undefined` se não encontrada.
   */
  findById(packageId: string): LockEntry | undefined {
    return this.read().packages.find(p => p.id === packageId);
  }
}
