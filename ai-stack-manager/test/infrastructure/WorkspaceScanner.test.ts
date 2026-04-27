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
});