type MockState = {
  workspaceRoot?: string;
  configuration: Map<string, unknown>;
  infoResponses: Array<string | undefined>;
  warningResponses: Array<string | undefined>;
  logs: Array<{ level: string; message: string }>;
  registeredCommands: Map<string, (...args: unknown[]) => unknown>;
  registeredWebviewProviders: Map<string, unknown>;
  executedCommands: Array<{ command: string; args: unknown[] }>;
  authSession?: { accessToken: string };
};

function getState(): MockState {
  return (globalThis as typeof globalThis & { __VSCODE_MOCK_STATE__: MockState }).__VSCODE_MOCK_STATE__;
}

export function setWorkspaceRoot(root: string | undefined): void {
  getState().workspaceRoot = root;
}

export function setConfigurationValue(key: string, value: unknown): void {
  getState().configuration.set(key, value);
}

export function queueInformationMessageResponse(value: string | undefined): void {
  getState().infoResponses.push(value);
}

export function queueWarningMessageResponse(value: string | undefined): void {
  getState().warningResponses.push(value);
}

export function setAuthenticationSession(accessToken: string | undefined): void {
  getState().authSession = accessToken ? { accessToken } : undefined;
}

export function getRegisteredCommands(): string[] {
  return [...getState().registeredCommands.keys()];
}

export function getLogs(): Array<{ level: string; message: string }> {
  return [...getState().logs];
}

export function resetVscodeMock(): void {
  const state = getState();
  state.workspaceRoot = undefined;
  state.configuration.clear();
  state.infoResponses.length = 0;
  state.warningResponses.length = 0;
  state.logs.length = 0;
  state.registeredCommands.clear();
  state.registeredWebviewProviders.clear();
  state.executedCommands.length = 0;
  state.authSession = undefined;
}