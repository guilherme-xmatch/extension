import * as vscode from 'vscode';
import { activate } from '../../src/extension';
import { getRegisteredCommands, setConfigurationValue, setWorkspaceRoot } from '../setup/vscode.mock';
import { createTempWorkspace } from '../setup/tempWorkspace';

describe('extension activation', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    await cleanup?.();
    cleanup = undefined;
  });

  it('registra comandos principais sem crash', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);
    setConfigurationValue('descomplicai.registryUrl', '');
    setConfigurationValue('descomplicai.autoHealthCheck', false);
    setConfigurationValue('descomplicai.showWelcome', false);

    const context = {
      extensionUri: vscode.Uri.file(workspace.root),
      subscriptions: [] as { dispose(): void }[],
      globalState: {
        get: () => false,
        update: async () => undefined,
      },
    } as unknown as vscode.ExtensionContext;

    activate(context);

    expect(getRegisteredCommands()).toEqual(expect.arrayContaining([
      'dai.install',
      'dai.uninstall',
      'dai.healthCheck',
      'dai.refresh',
      'dai.installBundle',
      'dai.importCustomMcp',
    ]));
  });
});