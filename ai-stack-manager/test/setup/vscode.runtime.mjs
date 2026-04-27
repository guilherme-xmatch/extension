import { promises as fs } from 'fs';
import path from 'path';
import { beforeEach, vi } from 'vitest';

if (!globalThis.__VSCODE_MOCK_STATE__) {
  globalThis.__VSCODE_MOCK_STATE__ = {
    workspaceRoot: undefined,
    configuration: new Map(),
    infoResponses: [],
    warningResponses: [],
    logs: [],
    registeredCommands: new Map(),
    registeredWebviewProviders: new Map(),
    executedCommands: [],
    authSession: undefined,
  };
}

const state = globalThis.__VSCODE_MOCK_STATE__;

class MockEventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter((item) => item !== listener); } };
    };
  }

  fire(data) {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }

  dispose() {
    this.listeners = [];
  }
}

class MockUri {
  constructor(fsPath) {
    this.fsPath = fsPath;
  }

  toString() {
    return this.fsPath;
  }

  static file(fsPath) {
    return new MockUri(path.resolve(fsPath));
  }

  static parse(value) {
    if (value.startsWith('file://')) {
      return new MockUri(new URL(value).pathname);
    }

    return new MockUri(value);
  }

  static joinPath(base, ...segments) {
    return new MockUri(path.join(base.fsPath, ...segments));
  }
}

const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

const workspaceFs = {
  stat: vi.fn(async (uri) => {
    const stats = await fs.stat(uri.fsPath);
    return { type: stats.isDirectory() ? FileType.Directory : FileType.File };
  }),
  readFile: vi.fn(async (uri) => fs.readFile(uri.fsPath)),
  writeFile: vi.fn(async (uri, content) => {
    await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
    await fs.writeFile(uri.fsPath, Buffer.from(content));
  }),
  createDirectory: vi.fn(async (uri) => {
    await fs.mkdir(uri.fsPath, { recursive: true });
  }),
  readDirectory: vi.fn(async (uri) => {
    const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
    return entries.map((entry) => [entry.name, entry.isDirectory() ? FileType.Directory : FileType.File]);
  }),
  delete: vi.fn(async (uri) => {
    await fs.rm(uri.fsPath, { recursive: true, force: true });
  }),
};

function getConfigurationValue(section, key, defaultValue) {
  const composite = `${section}.${key}`;
  return state.configuration.has(composite)
    ? state.configuration.get(composite)
    : defaultValue;
}

function createWebview() {
  const emitter = new MockEventEmitter();
  return {
    html: '',
    options: {},
    cspSource: 'vscode-resource://test',
    asWebviewUri: (uri) => uri,
    postMessage: vi.fn(async () => true),
    onDidReceiveMessage: emitter.event,
    __fireMessage: (value) => emitter.fire(value),
  };
}

vi.mock('vscode', () => {
  const window = {
    activeTextEditor: undefined,
    createOutputChannel: vi.fn(() => ({
      debug: (message) => state.logs.push({ level: 'debug', message }),
      info: (message) => state.logs.push({ level: 'info', message }),
      warn: (message) => state.logs.push({ level: 'warn', message }),
      error: (message) => state.logs.push({ level: 'error', message }),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
    createStatusBarItem: vi.fn(() => ({
      text: '',
      tooltip: '',
      command: undefined,
      backgroundColor: undefined,
      show: vi.fn(),
      dispose: vi.fn(),
    })),
    registerWebviewViewProvider: vi.fn((viewType, provider) => {
      state.registeredWebviewProviders.set(viewType, provider);
      return { dispose: () => state.registeredWebviewProviders.delete(viewType) };
    }),
    createWebviewPanel: vi.fn((_viewType, title) => {
      const webview = createWebview();
      const disposeEmitter = new MockEventEmitter();
      let disposed = false;
      return {
        title,
        webview,
        reveal: vi.fn(),
        onDidDispose: disposeEmitter.event,
        // Idempotent — mirrors real VS Code: calling dispose() a second time
        // (e.g. triggered by onDidDispose re-entry) is a no-op and does NOT
        // re-fire the event, preventing infinite recursion in panel.dispose().
        dispose: vi.fn(() => {
          if (disposed) { return; }
          disposed = true;
          disposeEmitter.fire();
        }),
      };
    }),
    showInformationMessage: vi.fn(async () => state.infoResponses.shift()),
    showWarningMessage: vi.fn(async () => state.warningResponses.shift()),
    showErrorMessage: vi.fn(async () => undefined),
    showTextDocument: vi.fn(async (document) => ({ document })),
    withProgress: vi.fn(async (_options, task) => task({ report: vi.fn() })),
    registerUriHandler: vi.fn(() => ({ dispose: vi.fn() })),
  };

  const workspace = {
    get workspaceFolders() {
      if (!state.workspaceRoot) {
        return undefined;
      }

      return [{ uri: MockUri.file(state.workspaceRoot), name: path.basename(state.workspaceRoot), index: 0 }];
    },
    fs: workspaceFs,
    getConfiguration: vi.fn((section) => ({
      get: (key, defaultValue) => getConfigurationValue(section, key, defaultValue),
      update: async (key, value) => {
        state.configuration.set(`${section}.${key}`, value);
      },
    })),
    openTextDocument: vi.fn(async (value) => ({ uri: typeof value === 'string' ? MockUri.file(value) : value })),
    createFileSystemWatcher: vi.fn((pattern) => {
      const createEmitter = new MockEventEmitter();
      const changeEmitter = new MockEventEmitter();
      const deleteEmitter = new MockEventEmitter();
      return {
        pattern,
        onDidCreate: createEmitter.event,
        onDidChange: changeEmitter.event,
        onDidDelete: deleteEmitter.event,
        dispose: vi.fn(),
        /** Test helper — fire a create event. */
        __fireCreate: (uri) => createEmitter.fire(uri),
        /** Test helper — fire a change event. */
        __fireChange: (uri) => changeEmitter.fire(uri),
        /** Test helper — fire a delete event. */
        __fireDelete: (uri) => deleteEmitter.fire(uri),
      };
    }),
  };

  return {
    Uri: MockUri,
    EventEmitter: MockEventEmitter,
    ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
    FileType,
    ProgressLocation: { Notification: 15 },
    StatusBarAlignment: { Right: 2 },
    ConfigurationTarget: { Global: 1 },
    ViewColumn: { One: 1 },
    workspace,
    window,
    env: {
      openExternal: vi.fn(async () => true),
    },
    commands: {
      registerCommand: vi.fn((command, callback) => {
        state.registeredCommands.set(command, callback);
        return { dispose: () => state.registeredCommands.delete(command) };
      }),
      executeCommand: vi.fn(async (command, ...args) => {
        state.executedCommands.push({ command, args });
      }),
    },
    authentication: {
      getSession: vi.fn(async () => state.authSession),
    },
    chat: {
      createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })),
    },
  };
});

beforeEach(() => {
  state.workspaceRoot = undefined;
  state.configuration.clear();
  state.infoResponses.length = 0;
  state.warningResponses.length = 0;
  state.logs.length = 0;
  state.registeredCommands.clear();
  state.registeredWebviewProviders.clear();
  state.executedCommands.length = 0;
  state.authSession = undefined;
  vi.clearAllMocks();
});
