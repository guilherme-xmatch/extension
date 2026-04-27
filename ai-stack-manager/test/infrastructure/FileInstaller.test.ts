import { promises as fs } from 'fs';
import * as path from 'path';
import { FileInstaller } from '../../src/infrastructure/services/FileInstaller';
import { Package } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { setWorkspaceRoot, queueWarningMessageResponse } from '../setup/vscode.mock';
import { createTempWorkspace } from '../setup/tempWorkspace';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeAgentPkg(): Package {
  return Package.create({
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
}

describe('FileInstaller', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    await cleanup?.();
    cleanup = undefined;
  });

  // ─── install (MCP merge) ────────────────────────────────────────────────────

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

  // ─── installMany ────────────────────────────────────────────────────────────

  it('deduplica pacotes em installMany', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);
    queueWarningMessageResponse('Overwrite');

    const installer = new FileInstaller();
    const pkg = makeAgentPkg();

    await installer.installMany([pkg, pkg]);
    const content = await fs.readFile(path.join(workspace.root, '.github', 'agents', 'backend-specialist.agent.md'), 'utf-8');
    expect(content).toContain('# agent');
  });

  // ─── install (agent file) ───────────────────────────────────────────────────

  it('instala um agente criando o arquivo no workspace', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const installer = new FileInstaller();
    await installer.install(makeAgentPkg());

    const filePath = path.join(workspace.root, '.github', 'agents', 'backend-specialist.agent.md');
    await expect(fs.access(filePath)).resolves.not.toThrow();
  });

  // ─── uninstall ──────────────────────────────────────────────────────────────

  it('desinstala agente quando usuário confirma "Remove"', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/backend-specialist.agent.md': '# agent',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);
    queueWarningMessageResponse('Remover'); // confirmação do diálogo modal

    const installer = new FileInstaller();
    await installer.uninstall(makeAgentPkg());

    const filePath = path.join(workspace.root, '.github', 'agents', 'backend-specialist.agent.md');
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('mantém arquivos quando usuário cancela desinstalação', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/backend-specialist.agent.md': '# agent',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);
    queueWarningMessageResponse('Cancel'); // usuário cancela

    const installer = new FileInstaller();
    await installer.uninstall(makeAgentPkg());

    const filePath = path.join(workspace.root, '.github', 'agents', 'backend-specialist.agent.md');
    await expect(fs.access(filePath)).resolves.not.toThrow(); // arquivo intacto
  });

  // ─── sem workspace aberto ───────────────────────────────────────────────────

  it('install lança erro quando nenhum workspace está aberto', async () => {
    setWorkspaceRoot(undefined);
    const installer = new FileInstaller();
    await expect(installer.install(makeAgentPkg())).rejects.toThrow(/Nenhuma pasta de workspace/i);
  });

  it('uninstall lança erro quando nenhum workspace está aberto', async () => {
    setWorkspaceRoot(undefined);
    const installer = new FileInstaller();
    await expect(installer.uninstall(makeAgentPkg())).rejects.toThrow(/Nenhuma pasta de workspace/i);
  });

  it('installMany lança erro quando nenhum workspace está aberto', async () => {
    setWorkspaceRoot(undefined);
    const installer = new FileInstaller();
    await expect(installer.installMany([makeAgentPkg()])).rejects.toThrow(/Nenhuma pasta de workspace/i);
  });

  // ─── onProgress callback ─────────────────────────────────────────────────────

  it('install invoca onProgress no início e no fim', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const progress: Array<{ current: number; total: number }> = [];
    const installer = new FileInstaller();
    await installer.install(makeAgentPkg(), { onProgress: (p) => progress.push(p) });

    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatchObject({ current: 0, total: 1 });
    expect(progress[1]).toMatchObject({ current: 1, total: 1 });
  });

  it('uninstall invoca onProgress quando usuário confirma', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/backend-specialist.agent.md': '# agent',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);
    queueWarningMessageResponse('Remover');

    const progress: Array<{ current: number; total: number }> = [];
    const installer = new FileInstaller();
    await installer.uninstall(makeAgentPkg(), { onProgress: (p) => progress.push(p) });

    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatchObject({ current: 0, total: 1 });
    expect(progress[1]).toMatchObject({ current: 1, total: 1 });
  });

  it('installMany invoca onProgress para cada pacote único', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const progress: Array<{ current: number; total: number }> = [];
    const installer = new FileInstaller();
    await installer.installMany([makeAgentPkg()], { onProgress: (p) => progress.push(p) });

    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect(progress[0]).toMatchObject({ current: 1, total: 1 });
  });

  // ─── IInstallTracker ─────────────────────────────────────────────────────────

  it('install chama trackInstall quando tracker é fornecido', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const tracked: string[] = [];
    const tracker = { trackInstall: async (pkg: Package) => { tracked.push(pkg.id); } };

    const installer = new FileInstaller(tracker);
    await installer.install(makeAgentPkg());

    expect(tracked).toContain('agent-backend-specialist');
  });

  it('installMany chama trackInstall para cada pacote único quando tracker é fornecido', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const tracked: string[] = [];
    const tracker = { trackInstall: async (pkg: Package) => { tracked.push(pkg.id); } };

    const installer = new FileInstaller(tracker);
    await installer.installMany([makeAgentPkg()]);

    expect(tracked).toContain('agent-backend-specialist');
  });
});