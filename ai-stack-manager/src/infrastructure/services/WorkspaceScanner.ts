/**
 * @module infrastructure/services/WorkspaceScanner
 * @description Scans the current VS Code workspace to detect installed packages.
 * Uses filesystem checks to determine installation status of each package.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Package, InstallStatus } from '../../domain/entities/Package';
import { IWorkspaceScanner } from '../../domain/interfaces';

export class WorkspaceScanner implements IWorkspaceScanner {

  private get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  async getInstallStatus(pkg: Package): Promise<InstallStatus> {
    const root = this.workspaceRoot;
    if (!root) { return InstallStatus.NotInstalled; }

    const results = await Promise.all(
      pkg.files.map(f => this.fileExists(path.join(root, f.relativePath)))
    );

    const existCount = results.filter(Boolean).length;

    if (existCount === 0) { return InstallStatus.NotInstalled; }
    if (existCount === pkg.files.length) { return InstallStatus.Installed; }
    return InstallStatus.Partial;
  }

  async getInstalledPackageIds(): Promise<string[]> {
    // This is called less frequently, so we can afford broader scanning
    return [];
  }

  async hasGitHubDirectory(): Promise<boolean> {
    const root = this.workspaceRoot;
    if (!root) { return false; }
    return this.fileExists(path.join(root, '.github'));
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }
}
