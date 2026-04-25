import { promises as fs } from 'fs';
import * as path from 'path';
import { FileInstaller } from '../../src/infrastructure/services/FileInstaller';
import { Package } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { setWorkspaceRoot, queueWarningMessageResponse } from '../setup/vscode.mock';
import { createTempWorkspace } from '../setup/tempWorkspace';

describe('FileInstaller', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    await cleanup?.();
    cleanup = undefined;
  });

  it('mescla servidores MCP preservando o conteúdo existente', async () => {
    const workspace = await createTempWorkspace({
      '.vscode/mcp.json': JSON.stringify({ servers: { existing: { command: 'node' } } }, null, 2),
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const installer = new FileInstaller();
    const pkg = Package.create({
      id: 'mcp-github',
      name: 'github-mcp',
      displayName: 'GitHub MCP',
      description: 'MCP',
      type: PackageType.MCP,
      version: '1.0.0',
      tags: ['mcp'],
      author: 'Community',
      files: [{ relativePath: '.vscode/mcp.json', content: JSON.stringify({ servers: { github: { command: 'npx' } } }) }],
    });

    await installer.install(pkg);

    const content = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode', 'mcp.json'), 'utf-8'));
    expect(content.servers.existing).toBeTruthy();
    expect(content.servers.github).toBeTruthy();
  });

  it('deduplica pacotes em installMany', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);
    queueWarningMessageResponse('Overwrite');

    const installer = new FileInstaller();
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

    await installer.installMany([pkg, pkg]);
    const content = await fs.readFile(path.join(workspace.root, '.github', 'agents', 'backend-specialist.agent.md'), 'utf-8');
    expect(content).toContain('# agent');
  });
});