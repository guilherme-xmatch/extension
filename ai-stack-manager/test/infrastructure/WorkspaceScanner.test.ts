import { WorkspaceScanner } from '../../src/infrastructure/services/WorkspaceScanner';
import { Package } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { setWorkspaceRoot } from '../setup/vscode.mock';
import { createTempWorkspace } from '../setup/tempWorkspace';

describe('WorkspaceScanner', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    await cleanup?.();
    cleanup = undefined;
  });

  it('detecta status de instalação de pacote comum', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/backend-specialist.agent.md': '# agent',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const scanner = new WorkspaceScanner();
    const pkg = Package.create({
      id: 'agent-backend-specialist',
      name: 'backend-specialist',
      displayName: 'Backend Specialist',
      description: 'Backend',
      type: PackageType.Agent,
      version: '1.0.0',
      tags: ['backend'],
      author: 'Community',
      files: [{ relativePath: '.github/agents/backend-specialist.agent.md', content: '# agent' }],
    });

    await expect(scanner.getInstallStatus(pkg)).resolves.toBe('installed');
  });

  it('mapeia bundles reais na detecção de perfil', async () => {
    const workspace = await createTempWorkspace({
      'package.json': JSON.stringify({ dependencies: { express: '^5.0.0', react: '^19.0.0' } }),
      'Dockerfile': 'FROM node:20',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const scanner = new WorkspaceScanner();
    const profiles = await scanner.detectProjectProfile();

    expect(profiles.some(profile => profile.bundleId === 'bundle-architecture-backend')).toBe(true);
    expect(profiles.some(profile => profile.bundleId === 'bundle-aws-platform')).toBe(true);
  });
});