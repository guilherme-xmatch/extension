/**
 * @module infrastructure/services/InstallationStrategy
 * @description Padrão Strategy para instalação de pacotes.
 * Cada estratégia encapsula como um tipo específico de pacote é instalado/desinstalado
 * no workspace, tornando cada uma independentemente testável e extensível.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Package } from '../../domain/entities/Package';
import { AppLogger } from './AppLogger';

/** Estratégia para instalar e desinstalar um pacote na raiz de um workspace. */
export interface IInstallationStrategy {
  install(root: string, pkg: Package, existingFileMode: 'prompt' | 'skip'): Promise<void>;
  uninstall(root: string, pkg: Package): Promise<void>;
}

// ─── Shared file-system helpers ────────────────────────────────────────────

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function removeEmptyParent(dirPath: string, rootPath: string, logger: AppLogger): Promise<void> {
  if (dirPath === rootPath || dirPath.length <= rootPath.length) { return; }
  try {
    const uri = vscode.Uri.file(dirPath);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    if (entries.length === 0) {
      await vscode.workspace.fs.delete(uri);
      await removeEmptyParent(path.dirname(dirPath), rootPath, logger);
    }
  } catch (error) {
    logger.debug('REMOVE_EMPTY_PARENT_SKIPPED', { dirPath, rootPath, error });
  }
}

// ─── FileCopyStrategy ──────────────────────────────────────────────────────

/**
 * Estratégia padrão: copia os arquivos do pacote diretamente no workspace.
 * Solicita confirmação do usuário em caso de conflito quando existingFileMode é 'prompt'.
 */
export class FileCopyStrategy implements IInstallationStrategy {
  private readonly _logger = AppLogger.getInstance();

  async install(root: string, pkg: Package, existingFileMode: 'prompt' | 'skip'): Promise<void> {
    for (const file of pkg.files) {
      const fullPath = path.join(root, file.relativePath);
      const uri = vscode.Uri.file(fullPath);
      const exists = await fileExists(uri);

      if (exists) {
        if (existingFileMode === 'skip') { continue; }

        const choice = await vscode.window.showWarningMessage(
          `O arquivo "${file.relativePath}" já existe. Sobrescrever?`,
          { modal: true },
          'Sobrescrever',
          'Pular',
        );
        if (choice !== 'Sobrescrever') { continue; }
      }

      const dirUri = vscode.Uri.file(path.dirname(fullPath));
      await vscode.workspace.fs.createDirectory(dirUri);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content, 'utf-8'));
    }
  }

  async uninstall(root: string, pkg: Package): Promise<void> {
    for (const file of pkg.files) {
      const fullPath = path.join(root, file.relativePath);
      const uri = vscode.Uri.file(fullPath);
      try {
        await vscode.workspace.fs.delete(uri);
        await removeEmptyParent(path.dirname(fullPath), root, this._logger);
      } catch (error) {
        this._logger.debug('UNINSTALL_FILE_DELETE_SKIPPED', { fullPath, error });
      }
    }
  }
}

// ─── McpMergeStrategy ─────────────────────────────────────────────────────

type McpDocument = {
  servers: Record<string, unknown>;
  inputs: Array<{ id: string; [key: string]: unknown }>;
};

/**
 * Estratégia MCP: mescla entradas de servidor no `.vscode/mcp.json` em vez de
 * copiar arquivos individualmente. Preserva servidores existentes e deduplica as entradas.
 */
export class McpMergeStrategy implements IInstallationStrategy {
  private readonly _logger = AppLogger.getInstance();

  async install(root: string, pkg: Package): Promise<void> {
    const mcpConfig = this.extractMcpConfig(pkg);
    const mcpPath = path.join(root, '.vscode', 'mcp.json');
    const mcpUri = vscode.Uri.file(mcpPath);

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(mcpPath)));

    const existing = await this.readJsonWithComments(mcpUri, { servers: {}, inputs: [] });
    const normalized = this.normalizeMcpDocument(existing);

    for (const [serverName, serverConfig] of Object.entries(mcpConfig.servers)) {
      normalized.servers[serverName] = serverConfig;
    }
    for (const input of mcpConfig.inputs) {
      if (!normalized.inputs.some(e => e.id === input.id)) {
        normalized.inputs.push(input);
      }
    }

    await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(JSON.stringify(normalized, null, 2), 'utf-8'));
  }

  async uninstall(root: string, pkg: Package): Promise<void> {
    const mcpPath = path.join(root, '.vscode', 'mcp.json');
    const mcpUri = vscode.Uri.file(mcpPath);
    if (!(await fileExists(mcpUri))) { return; }

    const existing = await this.readJsonWithComments(mcpUri, { servers: {}, inputs: [] });
    const normalized = this.normalizeMcpDocument(existing);
    const pkgConfig = this.extractMcpConfig(pkg);

    for (const serverName of Object.keys(pkgConfig.servers)) {
      delete normalized.servers[serverName];
    }

    if (Object.keys(normalized.servers).length === 0 && normalized.inputs.length === 0) {
      await vscode.workspace.fs.delete(mcpUri);
      await removeEmptyParent(path.dirname(mcpPath), root, this._logger);
      return;
    }

    await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(JSON.stringify(normalized, null, 2), 'utf-8'));
  }

  private extractMcpConfig(pkg: Package): McpDocument {
    const rawContent = pkg.files[0]?.content || '{}';
    const parsed = this.parseJsonWithComments(rawContent) as {
      servers?: Record<string, unknown>;
      mcpServers?: Record<string, unknown>;
      inputs?: Array<{ id: string; [key: string]: unknown }>;
    };
    return {
      servers: parsed.servers || parsed.mcpServers || {},
      inputs: Array.isArray(parsed.inputs)
        ? parsed.inputs.filter(input => typeof input?.id === 'string')
        : [],
    };
  }

  private normalizeMcpDocument(value: unknown): McpDocument {
    const raw = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
    const servers = raw.servers && typeof raw.servers === 'object' ? raw.servers as Record<string, unknown> : {};
    const legacyServers = raw.mcpServers && typeof raw.mcpServers === 'object' ? raw.mcpServers as Record<string, unknown> : {};
    const inputs = Array.isArray(raw.inputs)
      ? raw.inputs.filter((input): input is { id: string; [key: string]: unknown } =>
          Boolean(input) && typeof (input as { id?: unknown }).id === 'string')
      : [];
    return { servers: { ...legacyServers, ...servers }, inputs };
  }

  private async readJsonWithComments<T>(uri: vscode.Uri, fallback: T): Promise<T> {
    try {
      const buffer = await vscode.workspace.fs.readFile(uri);
      return this.parseJsonWithComments(Buffer.from(buffer).toString('utf-8')) as T;
    } catch (error) {
      this._logger.debug('READ_JSON_FALLBACK_USED', { uri: uri.toString(), error });
      return fallback;
    }
  }

  private parseJsonWithComments(content: string): unknown {
    const sanitized = content
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    return sanitized ? JSON.parse(sanitized) : {};
  }
}
