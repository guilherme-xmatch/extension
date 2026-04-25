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
  private static readonly BUNDLES = {
    architectureBackend: 'bundle-architecture-backend',
    awsPlatform: 'bundle-aws-platform',
  } as const;

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

  /**
   * Smart Workspace Analyzer
   * Detects project profiles based on files and dependencies.
   * Returns a list of recommended Bundle IDs.
   */
  async detectProjectProfile(): Promise<{ profile: string; bundleId: string; confidence: number }[]> {
    const root = this.workspaceRoot;
    if (!root) { return []; }

    const recommendations: { profile: string; bundleId: string; confidence: number }[] = [];

    // Check package.json for Frontend/Backend
    const pkgJsonPath = path.join(root, 'package.json');
    if (await this.fileExists(pkgJsonPath)) {
      try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(pkgJsonPath));
        const json = JSON.parse(Buffer.from(content).toString('utf-8'));
        const deps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };

        // Frontend heuristics
        if (deps['react'] || deps['next'] || deps['vue'] || deps['@angular/core']) {
          recommendations.push({ profile: 'Frontend App', bundleId: WorkspaceScanner.BUNDLES.architectureBackend, confidence: 0.65 });
        }

        // Backend heuristics
        if (deps['express'] || deps['@nestjs/core'] || deps['fastify']) {
          recommendations.push({ profile: 'Backend API', bundleId: WorkspaceScanner.BUNDLES.architectureBackend, confidence: 0.9 });
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    // Check DevOps/Cloud heuristics
    const hasDocker = await this.fileExists(path.join(root, 'Dockerfile')) || await this.fileExists(path.join(root, 'docker-compose.yml'));
    const hasTerraform = await this.fileExists(path.join(root, 'main.tf'));
    if (hasDocker || hasTerraform) {
      recommendations.push({ profile: 'Infra & Cloud', bundleId: WorkspaceScanner.BUNDLES.awsPlatform, confidence: 0.8 });
    }

    // Default recommendation if empty or full stack
    if (recommendations.length > 1) {
      recommendations.push({ profile: 'Full Stack', bundleId: WorkspaceScanner.BUNDLES.architectureBackend, confidence: 0.7 });
    }

    return recommendations;
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
