/**
 * @module infrastructure/services/WorkspaceScanner
 * @description Scans the current VS Code workspace to detect installed packages.
 * Uses filesystem checks to determine installation status of each package.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Package, InstallStatus } from '../../domain/entities/Package';
import { IWorkspaceScanner } from '../../domain/interfaces';
import { AppLogger } from './AppLogger';
import { LockFileService } from './LockFileService';

export class WorkspaceScanner implements IWorkspaceScanner {
  private static readonly BUNDLES = {
    architectureBackend: 'bundle-architecture-backend',
    awsPlatform: 'bundle-aws-platform',
  } as const;

  private readonly logger = AppLogger.getInstance();

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
    if (existCount === pkg.files.length) {
      // All files present — check if the lock file records a different version (Outdated)
      const lockEntry = new LockFileService(root).findById(pkg.id);
      if (lockEntry && lockEntry.version !== pkg.version.toString()) {
        return InstallStatus.Outdated;
      }
      return InstallStatus.Installed;
    }
    return InstallStatus.Partial;
  }

  async getInstalledPackageIds(): Promise<string[]> {
    const root = this.workspaceRoot;
    if (!root) { return []; }
    try {
      return new LockFileService(root).read().packages.map(entry => entry.id);
    } catch {
      return [];
    }
  }

  async hasGitHubDirectory(): Promise<boolean> {
    const root = this.workspaceRoot;
    if (!root) { return false; }
    return this.fileExists(path.join(root, '.github'));
  }

  /**
   * Smart Workspace Analyzer
   *
   * Inspects the workspace for well-known files (manifests, lock files, config
   * files) and infers a project profile along with the best-matching catalog
   * bundle to recommend.
   *
   * Heuristics covered:
   * - Node.js Frontend  (React, Next, Vue, Angular)
   * - Node.js Backend   (Express, NestJS, Fastify)
   * - Python            (pyproject.toml, requirements.txt, Pipfile)
   * - Go                (go.mod)
   * - Rust              (Cargo.toml)
   * - Java / JVM        (pom.xml, build.gradle)
   * - .NET              (*.csproj, *.sln at root)
   * - AWS Cloud         (cdk.json, serverless.yml, samconfig.toml)
   * - Docker / Infra    (Dockerfile, docker-compose.yml, main.tf)
   * - Kubernetes        (k8s/ directory, helm/)
   *
   * Each result now includes:
   *  - `reason`          — one-line explanation of what triggered detection
   *  - `detectedSignals` — list of file/dependency names that were found
   */
  async detectProjectProfile(): Promise<Array<{
    profile: string;
    bundleId: string;
    confidence: number;
    reason: string;
    detectedSignals: string[];
  }>> {
    const root = this.workspaceRoot;
    if (!root) { return []; }

    type Rec = { profile: string; bundleId: string; confidence: number; reason: string; detectedSignals: string[] };
    const recommendations: Rec[] = [];

    // ── Helpers ──────────────────────────────────────────────────────────────
    const exists = (rel: string) => this.fileExists(path.join(root, rel));

    const push = (rec: Rec) => recommendations.push(rec);

    // ── Node.js (package.json) ────────────────────────────────────────────────
    const pkgJsonPath = path.join(root, 'package.json');
    if (await exists('package.json')) {
      try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(pkgJsonPath));
        const json = JSON.parse(Buffer.from(content).toString('utf-8'));
        const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) };
        const depNames = Object.keys(deps);

        // Frontend
        const frontendSignals = depNames.filter(d =>
          ['react', 'next', 'vue', 'svelte', 'nuxt', 'gatsby', '@angular/core'].includes(d));
        if (frontendSignals.length > 0) {
          push({
            profile:          'Frontend App',
            bundleId:         WorkspaceScanner.BUNDLES.architectureBackend,
            confidence:       0.65,
            reason:           `Framework front-end detectado: ${frontendSignals.join(', ')}`,
            detectedSignals:  frontendSignals,
          });
        }

        // Backend
        const backendSignals = depNames.filter(d =>
          ['express', '@nestjs/core', 'fastify', 'koa', 'hapi', '@hapi/hapi', 'restify'].includes(d));
        if (backendSignals.length > 0) {
          push({
            profile:          'Backend API',
            bundleId:         WorkspaceScanner.BUNDLES.architectureBackend,
            confidence:       0.9,
            reason:           `Framework backend Node.js detectado: ${backendSignals.join(', ')}`,
            detectedSignals:  backendSignals,
          });
        }
      } catch (error) {
        this.logger.debug('WORKSPACE_PROFILE_PACKAGE_JSON_UNREADABLE', { pkgJsonPath, error });
      }
    }

    // ── Python ────────────────────────────────────────────────────────────────
    const pythonSignals: string[] = [];
    for (const f of ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'setup.cfg']) {
      if (await exists(f)) { pythonSignals.push(f); }
    }
    if (pythonSignals.length > 0) {
      push({
        profile:          'Python Service',
        bundleId:         WorkspaceScanner.BUNDLES.architectureBackend,
        confidence:       0.85,
        reason:           `Projeto Python detectado via ${pythonSignals[0]}`,
        detectedSignals:  pythonSignals,
      });
    }

    // ── Go ────────────────────────────────────────────────────────────────────
    if (await exists('go.mod')) {
      push({
        profile:          'Go Service',
        bundleId:         WorkspaceScanner.BUNDLES.architectureBackend,
        confidence:       0.85,
        reason:           'Módulo Go detectado (go.mod)',
        detectedSignals:  ['go.mod'],
      });
    }

    // ── Rust ──────────────────────────────────────────────────────────────────
    if (await exists('Cargo.toml')) {
      push({
        profile:          'Rust Project',
        bundleId:         WorkspaceScanner.BUNDLES.architectureBackend,
        confidence:       0.8,
        reason:           'Projeto Rust detectado (Cargo.toml)',
        detectedSignals:  ['Cargo.toml'],
      });
    }

    // ── Java / JVM ────────────────────────────────────────────────────────────
    const jvmSignals: string[] = [];
    for (const f of ['pom.xml', 'build.gradle', 'build.gradle.kts', 'gradlew']) {
      if (await exists(f)) { jvmSignals.push(f); }
    }
    if (jvmSignals.length > 0) {
      push({
        profile:          'Java / JVM',
        bundleId:         WorkspaceScanner.BUNDLES.architectureBackend,
        confidence:       0.85,
        reason:           `Projeto Java/JVM detectado (${jvmSignals[0]})`,
        detectedSignals:  jvmSignals,
      });
    }

    // ── .NET ──────────────────────────────────────────────────────────────────
    const dotnetSignals: string[] = [];
    for (const f of ['global.json', 'Directory.Build.props']) {
      if (await exists(f)) { dotnetSignals.push(f); }
    }
    if (dotnetSignals.length > 0) {
      push({
        profile:          '.NET Project',
        bundleId:         WorkspaceScanner.BUNDLES.architectureBackend,
        confidence:       0.8,
        reason:           `.NET detectado (${dotnetSignals.join(', ')})`,
        detectedSignals:  dotnetSignals,
      });
    }

    // ── AWS Cloud (CDK / SAM / Serverless Framework) ──────────────────────────
    const awsSignals: string[] = [];
    for (const f of ['cdk.json', 'serverless.yml', 'serverless.yaml', 'samconfig.toml', 'template.yaml']) {
      if (await exists(f)) { awsSignals.push(f); }
    }
    if (awsSignals.length > 0) {
      push({
        profile:          'AWS Serverless / IaC',
        bundleId:         WorkspaceScanner.BUNDLES.awsPlatform,
        confidence:       0.9,
        reason:           `Projeto AWS detectado (${awsSignals.join(', ')})`,
        detectedSignals:  awsSignals,
      });
    }

    // ── Docker / Terraform (generic infra) ────────────────────────────────────
    const infraSignals: string[] = [];
    for (const f of ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'main.tf', '.terraform.lock.hcl']) {
      if (await exists(f)) { infraSignals.push(f); }
    }
    if (infraSignals.length > 0 && awsSignals.length === 0) {
      // Only add if we haven't already covered it via AWS heuristic
      push({
        profile:          'Infra & Cloud',
        bundleId:         WorkspaceScanner.BUNDLES.awsPlatform,
        confidence:       0.8,
        reason:           `Infraestrutura de containers/IaC detectada (${infraSignals[0]})`,
        detectedSignals:  infraSignals,
      });
    }

    // ── Kubernetes / Helm ─────────────────────────────────────────────────────
    const k8sSignals: string[] = [];
    for (const dir of ['k8s', 'helm', 'kubernetes', 'charts']) {
      if (await exists(dir)) { k8sSignals.push(`${dir}/`); }
    }
    if (k8sSignals.length > 0) {
      push({
        profile:          'Kubernetes / Helm',
        bundleId:         WorkspaceScanner.BUNDLES.awsPlatform,
        confidence:       0.85,
        reason:           `Orquestração de containers detectada (${k8sSignals.join(', ')})`,
        detectedSignals:  k8sSignals,
      });
    }

    // ── Full Stack bonus when multiple profiles hit ───────────────────────────
    if (recommendations.length > 1) {
      const allSignals = recommendations.flatMap(r => r.detectedSignals);
      recommendations.push({
        profile:          'Full Stack',
        bundleId:         WorkspaceScanner.BUNDLES.architectureBackend,
        confidence:       0.7,
        reason:           'Múltiplas tecnologias detectadas no mesmo workspace',
        detectedSignals:  allSignals,
      });
    }

    return recommendations;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch (error) {
      this.logger.debug('WORKSPACE_FILE_STAT_MISS', { filePath, error });
      return false;
    }
  }
}

