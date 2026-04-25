import * as path from 'path';
import { GitRegistry } from '../../src/infrastructure/repositories/GitRegistry';
import { setConfigurationValue, setWorkspaceRoot } from '../setup/vscode.mock';
import { createTempWorkspace } from '../setup/tempWorkspace';

describe('GitRegistry', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    await cleanup?.();
    cleanup = undefined;
  });

  it('carrega catálogo local manifest-driven', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);
    setConfigurationValue('descomplicai.registryUrl', path.join(process.cwd(), 'test', 'fixtures', 'catalog'));

    const registry = new GitRegistry();
    const packages = await registry.getAll();
    const bundles = await registry.getAllBundles();

    expect(packages.some(pkg => pkg.id === 'agent-backend-specialist')).toBe(true);
    expect(packages.some(pkg => pkg.id === 'mcp-github')).toBe(true);
    expect(bundles.some(bundle => bundle.id === 'bundle-architecture-backend')).toBe(true);
  });

  it('bloqueia registry remoto inseguro e faz fallback local', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);
    setConfigurationValue('descomplicai.registryUrl', 'http://malicious.example.com/catalog.json');

    const registry = new GitRegistry();
    const packages = await registry.getAll();

    expect(packages).toEqual([]);
  });
});