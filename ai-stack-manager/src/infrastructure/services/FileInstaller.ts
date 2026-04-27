/**
 * @module infrastructure/services/FileInstaller
 * @description Coordinates package installation by delegating file-system operations
 * to typed IInstallationStrategy implementations. Handles VS Code notifications,
 * user confirmation dialogs, and progress reporting.
 */

import * as vscode from 'vscode';
import { Package } from '../../domain/entities/Package';
import { IInstaller, IInstallTracker, InstallExecutionOptions } from '../../domain/interfaces';
import { IInstallationStrategy, FileCopyStrategy, McpMergeStrategy } from './InstallationStrategy';
import { LockFileService } from './LockFileService';

export class FileInstaller implements IInstaller {
  private _operationQueue: Promise<unknown> = Promise.resolve();
  private readonly _copyStrategy: IInstallationStrategy = new FileCopyStrategy();
  private readonly _mcpStrategy: IInstallationStrategy = new McpMergeStrategy();

  constructor(private readonly _tracker?: IInstallTracker) {}

  private get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Route to the correct strategy based on package type. */
  private strategyFor(pkg: Package): IInstallationStrategy {
    return pkg.type.value === 'mcp' ? this._mcpStrategy : this._copyStrategy;
  }

  async install(pkg: Package, options?: InstallExecutionOptions): Promise<void> {
    return this.runExclusive(async () => {
      const root = this.workspaceRoot;
      if (!root) { throw new Error('No workspace folder open. Please open a folder first.'); }

      options?.onProgress?.({ current: 0, total: 1, packageId: pkg.id, label: pkg.displayName });
      await this.strategyFor(pkg).install(root, pkg, 'prompt');
      await this._tracker?.trackInstall(pkg);
      new LockFileService(root).addOrUpdate({ id: pkg.id, version: pkg.version.toString(), sourceOfficial: pkg.source.official });
      options?.onProgress?.({ current: 1, total: 1, packageId: pkg.id, label: pkg.displayName });

      vscode.window.showInformationMessage(`✅ Installed "${pkg.displayName}" successfully!`);
    });
  }

  async uninstall(pkg: Package, options?: InstallExecutionOptions): Promise<void> {
    return this.runExclusive(async () => {
      const root = this.workspaceRoot;
      if (!root) { throw new Error('No workspace folder open.'); }

      const confirm = await vscode.window.showWarningMessage(
        `Remove "${pkg.displayName}" and all its files?`,
        { modal: true },
        'Remove',
        'Cancel',
      );
      if (confirm !== 'Remove') { return; }

      options?.onProgress?.({ current: 0, total: 1, packageId: pkg.id, label: pkg.displayName });
      await this.strategyFor(pkg).uninstall(root, pkg);
      new LockFileService(root).remove(pkg.id);
      options?.onProgress?.({ current: 1, total: 1, packageId: pkg.id, label: pkg.displayName });

      vscode.window.showInformationMessage(`🗑️ Uninstalled "${pkg.displayName}".`);
    });
  }

  async installMany(packages: Package[], options?: InstallExecutionOptions): Promise<void> {
    return this.runExclusive(async () => {
      const root = this.workspaceRoot;
      if (!root) { throw new Error('No workspace folder open.'); }

      const uniquePackages = [...new Map(packages.map(pkg => [pkg.id, pkg])).values()];
      let installed = 0;
      const total = uniquePackages.length;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Installing bundle (${total} packages)...`, cancellable: false },
        async (progress) => {
          for (const pkg of uniquePackages) {
            progress.report({ message: `${pkg.displayName} (${installed + 1}/${total})`, increment: (100 / total) });
            options?.onProgress?.({ current: installed + 1, total, packageId: pkg.id, label: pkg.displayName });
            await this.strategyFor(pkg).install(root, pkg, 'skip');
            await this._tracker?.trackInstall(pkg);
            new LockFileService(root).addOrUpdate({ id: pkg.id, version: pkg.version.toString(), sourceOfficial: pkg.source.official });
            installed++;
          }
        },
      );

      vscode.window.showInformationMessage(`✅ Bundle installed! ${installed} packages ready.`);
    });
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this._operationQueue.then(operation, operation);
    this._operationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}