/**
 * @module infrastructure/services/FileInstaller
 * @description Handles the actual file system operations for installing and uninstalling packages.
 * Creates directories, writes files, and handles merge scenarios.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Package } from '../../domain/entities/Package';
import { IInstaller } from '../../domain/interfaces';

export class FileInstaller implements IInstaller {

  private get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  async install(pkg: Package): Promise<void> {
    const root = this.workspaceRoot;
    if (!root) {
      throw new Error('No workspace folder open. Please open a folder first.');
    }

    for (const file of pkg.files) {
      const fullPath = path.join(root, file.relativePath);
      const uri = vscode.Uri.file(fullPath);

      // Check if file already exists
      const exists = await this.fileExists(uri);
      if (exists) {
        const choice = await vscode.window.showWarningMessage(
          `File "${file.relativePath}" already exists. Overwrite?`,
          { modal: true },
          'Overwrite',
          'Skip',
        );
        if (choice !== 'Overwrite') { continue; }
      }

      // Create directories and write file
      const dirUri = vscode.Uri.file(path.dirname(fullPath));
      await vscode.workspace.fs.createDirectory(dirUri);

      const content = Buffer.from(file.content, 'utf-8');
      await vscode.workspace.fs.writeFile(uri, content);
    }

    vscode.window.showInformationMessage(
      `✅ Installed "${pkg.displayName}" successfully!`
    );
  }

  async uninstall(pkg: Package): Promise<void> {
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

    for (const file of pkg.files) {
      const fullPath = path.join(root, file.relativePath);
      const uri = vscode.Uri.file(fullPath);

      try {
        await vscode.workspace.fs.delete(uri);

        // Try to remove parent directory if empty
        await this.removeEmptyParent(path.dirname(fullPath), root);
      } catch {
        // File may not exist, that's ok
      }
    }

    vscode.window.showInformationMessage(
      `🗑️ Uninstalled "${pkg.displayName}".`
    );
  }

  async installMany(packages: Package[]): Promise<void> {
    const root = this.workspaceRoot;
    if (!root) {
      throw new Error('No workspace folder open.');
    }

    let installed = 0;
    const total = packages.length;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Installing bundle (${total} packages)...`,
        cancellable: false,
      },
      async (progress) => {
        for (const pkg of packages) {
          progress.report({
            message: `${pkg.displayName} (${installed + 1}/${total})`,
            increment: (100 / total),
          });

          for (const file of pkg.files) {
            const fullPath = path.join(root, file.relativePath);
            const uri = vscode.Uri.file(fullPath);

            // Skip existing files in bundle mode
            const exists = await this.fileExists(uri);
            if (exists) { continue; }

            const dirUri = vscode.Uri.file(path.dirname(fullPath));
            await vscode.workspace.fs.createDirectory(dirUri);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content, 'utf-8'));
          }

          installed++;
        }
      }
    );

    vscode.window.showInformationMessage(
      `✅ Bundle installed! ${installed} packages ready.`
    );
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
      }
    } catch {
      // Directory doesn't exist or can't be deleted
    }
  }
}
