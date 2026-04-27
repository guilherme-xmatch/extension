import { WorkspaceScanner } from '../../src/infrastructure/services/WorkspaceScanner';
import { Package, InstallStatus } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { setWorkspaceRoot } from '../setup/vscode.mock';
import { createTempWorkspace } from '../setup/tempWorkspace';

const makeAgentPkg = (files: Array<{ relativePath: string; content: string }> = [
  { relativePath: '.github/agents/backend-specialist.agent.md', content: '# agent' },
]) =>
  Package.create({
    id: 'agent-backend-specialist',
    name: 'backend-specialist',
    displayName: 'Backend Specialist',
    description: 'Backend',
    type: PackageType.Agent,
    version: '1.0.0',
    tags: ['backend'],
    author: 'Community',
    files,
  });

describe('WorkspaceScanner', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    await cleanup?.();
    cleanup = undefined;
  });

  // ─── getInstallStatus ─────────────────────────────────────────────────────

  it('retorna NotInstalled quando não há workspace aberto', async () => {
    setWorkspaceRoot(undefined);
    const scanner = new WorkspaceScanner();
    const pkg = makeAgentPkg();
    await expect(scanner.getInstallStatus(pkg)).resolves.toBe(InstallStatus.NotInstalled);
  });

  it('detecta status Installed quando todos os arquivos existem', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/backend-specialist.agent.md': '# agent',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const scanner = new WorkspaceScanner();
    await expect(scanner.getInstallStatus(makeAgentPkg())).resolves.toBe(InstallStatus.Installed);
  });

  it('retorna NotInstalled quando nenhum arquivo existe', async () => {
    const workspace = await createTempWorkspace({});
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const scanner = new WorkspaceScanner();
    await expect(scanner.getInstallStatus(makeAgentPkg())).resolves.toBe(InstallStatus.NotInstalled);
  });

  it('retorna Partial quando apenas alguns arquivos existem', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/backend-specialist.agent.md': '# agent',
      // SKILL.md ausente propositalmente
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const pkg = makeAgentPkg([
      { relativePath: '.github/agents/backend-specialist.agent.md', content: '# agent' },
      { relativePath: '.github/skills/api-design/SKILL.md', content: '# skill' },
    ]);

    const scanner = new WorkspaceScanner();
    await expect(scanner.getInstallStatus(pkg)).resolves.toBe(InstallStatus.Partial);
  });

  // ─── getInstalledPackageIds ───────────────────────────────────────────────

  it('getInstalledPackageIds retorna array vazio por ora', async () => {
    const workspace = await createTempWorkspace({});
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const scanner = new WorkspaceScanner();
    await expect(scanner.getInstalledPackageIds()).resolves.toEqual([]);
  });

  // ─── hasGitHubDirectory ───────────────────────────────────────────────────

  it('hasGitHubDirectory retorna false sem workspace', async () => {
    setWorkspaceRoot(undefined);
    const scanner = new WorkspaceScanner();
    await expect(scanner.hasGitHubDirectory()).resolves.toBe(false);
  });

  it('hasGitHubDirectory retorna false quando .github não existe', async () => {
    const workspace = await createTempWorkspace({});
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const scanner = new WorkspaceScanner();
    await expect(scanner.hasGitHubDirectory()).resolves.toBe(false);
  });

  it('hasGitHubDirectory retorna true quando .github existe', async () => {
    const workspace = await createTempWorkspace({
      '.github/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const scanner = new WorkspaceScanner();
    await expect(scanner.hasGitHubDirectory()).resolves.toBe(true);
  });

  // ─── detectProjectProfile ─────────────────────────────────────────────────

  it('retorna [] sem workspace aberto', async () => {
    setWorkspaceRoot(undefined);
    const scanner = new WorkspaceScanner();
    await expect(scanner.detectProjectProfile()).resolves.toEqual([]);
  });

  it('retorna [] sem package.json e sem docker/terraform', async () => {
    const workspace = await createTempWorkspace({});
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const scanner = new WorkspaceScanner();
    const profiles = await scanner.detectProjectProfile();
    expect(profiles).toHaveLength(0);
  });

  it('detecta Frontend App (react)', async () => {
    const workspace = await createTempWorkspace({
      'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }),
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const scanner = new WorkspaceScanner();
    const profiles = await scanner.detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Frontend App')).toBe(true);
    expect(profiles.some(p => p.bundleId === 'bundle-architecture-backend')).toBe(true);
  });

  it('detecta Frontend App (next)', async () => {
    const workspace = await createTempWorkspace({
      'package.json': JSON.stringify({ dependencies: { next: '^14.0.0' } }),
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Frontend App')).toBe(true);
  });

  it('detecta Frontend App (vue)', async () => {
    const workspace = await createTempWorkspace({
      'package.json': JSON.stringify({ dependencies: { vue: '^3.0.0' } }),
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Frontend App')).toBe(true);
  });

  it('detecta Frontend App (@angular/core)', async () => {
    const workspace = await createTempWorkspace({
      'package.json': JSON.stringify({ devDependencies: { '@angular/core': '^17.0.0' } }),
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Frontend App')).toBe(true);
  });

  it('detecta Backend API (express)', async () => {
    const workspace = await createTempWorkspace({
      'package.json': JSON.stringify({ dependencies: { express: '^5.0.0' } }),
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Backend API')).toBe(true);
    expect(profiles.find(p => p.profile === 'Backend API')?.confidence).toBeGreaterThan(0.8);
  });

  it('detecta Backend API (@nestjs/core)', async () => {
    const workspace = await createTempWorkspace({
      'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }),
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Backend API')).toBe(true);
  });

  it('detecta Backend API (fastify)', async () => {
    const workspace = await createTempWorkspace({
      'package.json': JSON.stringify({ dependencies: { fastify: '^4.0.0' } }),
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Backend API')).toBe(true);
  });

  it('detecta Infra & Cloud via Dockerfile', async () => {
    const workspace = await createTempWorkspace({
      'Dockerfile': 'FROM node:20',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Infra & Cloud')).toBe(true);
    expect(profiles.some(p => p.bundleId === 'bundle-aws-platform')).toBe(true);
  });

  it('detecta Infra & Cloud via docker-compose.yml', async () => {
    const workspace = await createTempWorkspace({
      'docker-compose.yml': 'version: "3"',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Infra & Cloud')).toBe(true);
  });

  it('detecta Infra & Cloud via main.tf (terraform)', async () => {
    const workspace = await createTempWorkspace({
      'main.tf': 'provider "aws" {}',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Infra & Cloud')).toBe(true);
  });

  it('adiciona Full Stack quando múltiplos perfis detectados', async () => {
    const workspace = await createTempWorkspace({
      'package.json': JSON.stringify({ dependencies: { express: '^5.0.0', react: '^19.0.0' } }),
      'Dockerfile': 'FROM node:20',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Full Stack')).toBe(true);
  });

  it('lida silenciosamente com package.json com JSON inválido', async () => {
    const workspace = await createTempWorkspace({
      'package.json': '{ invalid json',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const scanner = new WorkspaceScanner();
    // não deve lançar, apenas ignorar o arquivo
    await expect(scanner.detectProjectProfile()).resolves.not.toThrow();
  });

  // ─── Novos heurísticos: Python, Go, Rust, Java, AWS, K8s ─────────────────

  it('detecta Python via pyproject.toml', async () => {
    const workspace = await createTempWorkspace({ 'pyproject.toml': '[build-system]' });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Python Service')).toBe(true);
    expect(profiles.find(p => p.profile === 'Python Service')?.detectedSignals).toContain('pyproject.toml');
  });

  it('detecta Python via requirements.txt', async () => {
    const workspace = await createTempWorkspace({ 'requirements.txt': 'fastapi==0.110.0' });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Python Service')).toBe(true);
  });

  it('detecta Go via go.mod', async () => {
    const workspace = await createTempWorkspace({ 'go.mod': 'module example.com/myapp' });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Go Service')).toBe(true);
    expect(profiles.find(p => p.profile === 'Go Service')?.bundleId).toBe('bundle-architecture-backend');
  });

  it('detecta Rust via Cargo.toml', async () => {
    const workspace = await createTempWorkspace({ 'Cargo.toml': '[package]\nname = "myapp"' });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Rust Project')).toBe(true);
  });

  it('detecta Java via pom.xml', async () => {
    const workspace = await createTempWorkspace({ 'pom.xml': '<project></project>' });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Java / JVM')).toBe(true);
    expect(profiles.find(p => p.profile === 'Java / JVM')?.detectedSignals).toContain('pom.xml');
  });

  it('detecta Java via build.gradle', async () => {
    const workspace = await createTempWorkspace({ 'build.gradle': 'plugins { id "java" }' });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Java / JVM')).toBe(true);
  });

  it('detecta AWS Serverless via cdk.json', async () => {
    const workspace = await createTempWorkspace({ 'cdk.json': '{ "app": "npx ts-node bin/app.ts" }' });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    const awsProfile = profiles.find(p => p.profile === 'AWS Serverless / IaC');
    expect(awsProfile).toBeDefined();
    expect(awsProfile?.bundleId).toBe('bundle-aws-platform');
    expect(awsProfile?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('detecta AWS Serverless via serverless.yml', async () => {
    const workspace = await createTempWorkspace({ 'serverless.yml': 'service: my-service' });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'AWS Serverless / IaC')).toBe(true);
  });

  it('detecta Kubernetes via k8s/ directory', async () => {
    const workspace = await createTempWorkspace({ 'k8s/deployment.yaml': 'apiVersion: apps/v1' });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Kubernetes / Helm')).toBe(true);
    expect(profiles.find(p => p.profile === 'Kubernetes / Helm')?.bundleId).toBe('bundle-aws-platform');
  });

  it('detecta Kubernetes via helm/ directory', async () => {
    const workspace = await createTempWorkspace({ 'helm/Chart.yaml': 'apiVersion: v2' });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    expect(profiles.some(p => p.profile === 'Kubernetes / Helm')).toBe(true);
  });

  // ─── Campo reason / detectedSignals ─────────────────────────────────────────

  it('popula reason e detectedSignals no resultado', async () => {
    const workspace = await createTempWorkspace({
      'package.json': JSON.stringify({ dependencies: { express: '^5.0.0' } }),
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    const backendProfile = profiles.find(p => p.profile === 'Backend API');
    expect(backendProfile?.reason).toBeTruthy();
    expect(typeof backendProfile?.reason).toBe('string');
    expect(Array.isArray(backendProfile?.detectedSignals)).toBe(true);
    expect(backendProfile?.detectedSignals.length).toBeGreaterThan(0);
    expect(backendProfile?.detectedSignals).toContain('express');
  });

  it('Infra & Cloud NÃO aparece quando AWS heuristic já foi ativado (sem duplicata)', async () => {
    const workspace = await createTempWorkspace({
      'cdk.json':    '{}',
      'Dockerfile':  'FROM node:20',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const profiles = await new WorkspaceScanner().detectProjectProfile();
    // AWS heuristic should take priority; "Infra & Cloud" shouldn't also appear
    const infraProfiles = profiles.filter(p => p.profile === 'Infra & Cloud');
    expect(infraProfiles.length).toBe(0);
  });
});
