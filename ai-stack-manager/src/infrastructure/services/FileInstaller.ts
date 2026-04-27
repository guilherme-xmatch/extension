/**
 * @module infrastructure/services/FileInstaller
 * @description Coordena a instalação de pacotes delegando operações de sistema de arquivos
 * a implementações tipadas de IInstallationStrategy. Gerencia notificações do VS Code,
 * diálogos de confirmação e relatório de progresso.
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

  /** Direciona para a estratégia correta com base no tipo de pacote. */
  private strategyFor(pkg: Package): IInstallationStrategy {
    return pkg.type.value === 'mcp' ? this._mcpStrategy : this._copyStrategy;
  }

  async install(pkg: Package, options?: InstallExecutionOptions): Promise<void> {
    return this.runExclusive(async () => {
      const root = this.workspaceRoot;
      if (!root) { throw new Error('Nenhuma pasta de workspace aberta. Abra uma pasta primeiro.'); }

      options?.onProgress?.({ current: 0, total: 1, packageId: pkg.id, label: pkg.displayName });
      await this.strategyFor(pkg).install(root, pkg, 'prompt');
      await this._tracker?.trackInstall(pkg);
      new LockFileService(root).addOrUpdate({ id: pkg.id, version: pkg.version.toString(), sourceOfficial: pkg.source.official });
      options?.onProgress?.({ current: 1, total: 1, packageId: pkg.id, label: pkg.displayName });

      vscode.window.showInformationMessage(`✅ "${pkg.displayName}" instalado com sucesso!`);
    });
  }

  async uninstall(pkg: Package, options?: InstallExecutionOptions): Promise<void> {
    return this.runExclusive(async () => {
      const root = this.workspaceRoot;
      if (!root) { throw new Error('Nenhuma pasta de workspace aberta.'); }

      const confirm = await vscode.window.showWarningMessage(
        `Remover "${pkg.displayName}" e todos os seus arquivos?`,
        { modal: true },
        'Remover',
        'Cancelar',
      );
      if (confirm !== 'Remover') { return; }

      options?.onProgress?.({ current: 0, total: 1, packageId: pkg.id, label: pkg.displayName });
      await this.strategyFor(pkg).uninstall(root, pkg);
      new LockFileService(root).remove(pkg.id);
      options?.onProgress?.({ current: 1, total: 1, packageId: pkg.id, label: pkg.displayName });

      vscode.window.showInformationMessage(`🗑️ "${pkg.displayName}" desinstalado.`);
    });
  }

  async installMany(packages: Package[], options?: InstallExecutionOptions): Promise<void> {
    return this.runExclusive(async () => {
      const root = this.workspaceRoot;
      if (!root) { throw new Error('Nenhuma pasta de workspace aberta.'); }

      const uniquePackages = [...new Map(packages.map(pkg => [pkg.id, pkg])).values()];
      let installed = 0;
      const total = uniquePackages.length;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Instalando bundle (${total} pacotes)...`, cancellable: false },
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

      vscode.window.showInformationMessage(`✅ Bundle instalado! ${installed} pacotes prontos.`);
    });
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this._operationQueue.then(operation, operation);
    this._operationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}