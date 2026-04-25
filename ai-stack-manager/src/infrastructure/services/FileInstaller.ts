/**
 * @module infrastructure/services/FileInstaller
 * @description Handles the actual file system operations for installing and uninstalling packages.
 * Creates directories, writes files, and handles merge scenarios.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Package } from '../../domain/entities/Package';
import { IInstaller, IInstallTracker, InstallExecutionOptions } from '../../domain/interfaces';
import { AppLogger } from './AppLogger';

export class FileInstaller implements IInstaller {
  private _operationQueue: Promise<unknown> = Promise.resolve();
  private readonly _logger = AppLogger.getInstance();

  constructor(
    private readonly _tracker?: IInstallTracker,
  ) {}

  private get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  async install(pkg: Package, options?: InstallExecutionOptions): Promise<void> {
    return this.runExclusive(async () => {
      const root = this.workspaceRoot;
      if (!root) {
        throw new Error('No workspace folder open. Please open a folder first.');
      }

      options?.onProgress?.({ current: 0, total: 1, packageId: pkg.id, label: pkg.displayName });
      await this.installPackage(root, pkg, 'prompt');
      await this._tracker?.trackInstall(pkg);
      options?.onProgress?.({ current: 1, total: 1, packageId: pkg.id, label: pkg.displayName });

      vscode.window.showInformationMessage(
        `✅ Installed "${pkg.displayName}" successfully!`
      );
    });
  }

  async uninstall(pkg: Package, options?: InstallExecutionOptions): Promise<void> {
    return this.runExclusive(async () => {
      const root = this.workspaceRoot;
      if (!root) {
        throw new Error('No workspace folder open.');
      }

      const confirm = await vscode.window.showWarningMessage(
        `Remove "${pkg.displayName}" and all its files?`,
        { modal: true },
        'Remove',
        'Cancel',
      );
      if (confirm !== 'Remove') { return; }

      options?.onProgress?.({ current: 0, total: 1, packageId: pkg.id, label: pkg.displayName });
      await this.uninstallPackage(root, pkg);
      options?.onProgress?.({ current: 1, total: 1, packageId: pkg.id, label: pkg.displayName });

      vscode.window.showInformationMessage(
        `🗑️ Uninstalled "${pkg.displayName}".`
      );
    });
  }

  async installMany(packages: Package[], options?: InstallExecutionOptions): Promise<void> {
    return this.runExclusive(async () => {
      const root = this.workspaceRoot;
      if (!root) {
        throw new Error('No workspace folder open.');
      }

      const uniquePackages = [...new Map(packages.map(pkg => [pkg.id, pkg])).values()];
      let installed = 0;
      const total = uniquePackages.length;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Installing bundle (${total} packages)...`,
          cancellable: false,
        },
        async (progress) => {
          for (const pkg of uniquePackages) {
            progress.report({
              message: `${pkg.displayName} (${installed + 1}/${total})`,
              increment: (100 / total),
            });
            options?.onProgress?.({ current: installed + 1, total, packageId: pkg.id, label: pkg.displayName });

            await this.installPackage(root, pkg, 'skip');
            await this._tracker?.trackInstall(pkg);

            installed++;
          }
        }
      );

      vscode.window.showInformationMessage(
        `✅ Bundle installed! ${installed} packages ready.`
      );
    });
  }

  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async removeEmptyParent(dirPath: string, rootPath: string): Promise<void> {
    if (dirPath === rootPath || dirPath.length <= rootPath.length) { return; }

    try {
      const uri = vscode.Uri.file(dirPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      if (entries.length === 0) {
        await vscode.workspace.fs.delete(uri);
        await this.removeEmptyParent(path.dirname(dirPath), rootPath);
      }
    } catch (error) {
      this._logger.debug('REMOVE_EMPTY_PARENT_SKIPPED', { dirPath, rootPath, error });
    }
  }

  private async installPackage(root: string, pkg: Package, existingFileMode: 'prompt' | 'skip'): Promise<void> {
    if (pkg.type.value === 'mcp') {
      await this.installMcpPackage(root, pkg);
      return;
    }

    for (const file of pkg.files) {
      const fullPath = path.join(root, file.relativePath);
      const uri = vscode.Uri.file(fullPath);
      const exists = await this.fileExists(uri);

      if (exists) {
        if (existingFileMode === 'skip') {
          continue;
        }

        const choice = await vscode.window.showWarningMessage(
          `File "${file.relativePath}" already exists. Overwrite?`,
          { modal: true },
          'Overwrite',
          'Skip',
        );
        if (choice !== 'Overwrite') {
          continue;
        }
      }

      const dirUri = vscode.Uri.file(path.dirname(fullPath));
      await vscode.workspace.fs.createDirectory(dirUri);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content, 'utf-8'));
    }
  }

  private async uninstallPackage(root: string, pkg: Package): Promise<void> {
    if (pkg.type.value === 'mcp') {
      await this.uninstallMcpPackage(root, pkg);
      return;
    }

    for (const file of pkg.files) {
      const fullPath = path.join(root, file.relativePath);
      const uri = vscode.Uri.file(fullPath);

      try {
        await vscode.workspace.fs.delete(uri);
        await this.removeEmptyParent(path.dirname(fullPath), root);
      } catch (error) {
        this._logger.debug('UNINSTALL_FILE_DELETE_SKIPPED', { fullPath, error });
      }
    }
  }

  private async installMcpPackage(root: string, pkg: Package): Promise<void> {
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
      if (!normalized.inputs.some(existingInput => existingInput.id === input.id)) {
        normalized.inputs.push(input);
      }
    }

    await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(JSON.stringify(normalized, null, 2), 'utf-8'));
  }

  private async uninstallMcpPackage(root: string, pkg: Package): Promise<void> {
    const mcpPath = path.join(root, '.vscode', 'mcp.json');
    const mcpUri = vscode.Uri.file(mcpPath);
    const exists = await this.fileExists(mcpUri);
    if (!exists) { return; }

    const existing = await this.readJsonWithComments(mcpUri, { servers: {}, inputs: [] });
    const normalized = this.normalizeMcpDocument(existing);
    const pkgConfig = this.extractMcpConfig(pkg);

    for (const serverName of Object.keys(pkgConfig.servers)) {
      delete normalized.servers[serverName];
    }

    if (Object.keys(normalized.servers).length === 0 && normalized.inputs.length === 0) {
      await vscode.workspace.fs.delete(mcpUri);
      await this.removeEmptyParent(path.dirname(mcpPath), root);
      return;
    }

    await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(JSON.stringify(normalized, null, 2), 'utf-8'));
  }

  private extractMcpConfig(pkg: Package): { servers: Record<string, unknown>; inputs: Array<{ id: string; [key: string]: unknown }> } {
    const rawContent = pkg.files[0]?.content || '{}';
    const parsed = this.parseJsonWithComments(rawContent) as {
      servers?: Record<string, unknown>;
      mcpServers?: Record<string, unknown>;
      inputs?: Array<{ id: string; [key: string]: unknown }>;
    };

    return {
      servers: parsed.servers || parsed.mcpServers || {},
      inputs: Array.isArray(parsed.inputs) ? parsed.inputs.filter(input => typeof input?.id === 'string') : [],
    };
  }

  private normalizeMcpDocument(value: unknown): { servers: Record<string, unknown>; inputs: Array<{ id: string; [key: string]: unknown }> } {
    const raw = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
    const servers = raw.servers && typeof raw.servers === 'object' ? raw.servers as Record<string, unknown> : {};
    const legacyServers = raw.mcpServers && typeof raw.mcpServers === 'object' ? raw.mcpServers as Record<string, unknown> : {};
    const inputs = Array.isArray(raw.inputs) ? raw.inputs.filter((input): input is { id: string; [key: string]: unknown } => Boolean(input) && typeof (input as { id?: unknown }).id === 'string') : [];

    return {
      servers: { ...legacyServers, ...servers },
      inputs,
    };
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

    if (!sanitized) {
      return {};
    }

    return JSON.parse(sanitized);
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this._operationQueue.then(operation, operation);
    this._operationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}
