import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { WorkspaceFileWatcher } from '../../src/infrastructure/services/WorkspaceFileWatcher.js';

// ─── Helper: extract mock watchers created by the service ───────────────────

type MockWatcher = {
  pattern: string;
  onDidCreate: vscode.Event<vscode.Uri>;
  onDidChange: vscode.Event<vscode.Uri>;
  onDidDelete: vscode.Event<vscode.Uri>;
  dispose: ReturnType<typeof vi.fn>;
  __fireCreate: (uri: vscode.Uri) => void;
  __fireChange: (uri: vscode.Uri) => void;
  __fireDelete: (uri: vscode.Uri) => void;
};

function getMockWatchers(): MockWatcher[] {
  const mockFn = vscode.workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>;
  return mockFn.mock.results.map((r) => r.value as MockWatcher);
}

const DUMMY_URI = vscode.Uri.file('/workspace/agents/my-agent.agent.md');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WorkspaceFileWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates 5 file system watchers for DescomplicAI file patterns', () => {
    const cb = vi.fn(async () => {});
    const watcher = new WorkspaceFileWatcher(cb, 500);

    const watchers = getMockWatchers();
    expect(watchers).toHaveLength(5);

    const patterns = watchers.map((w) => w.pattern);
    expect(patterns).toContain('**/*.agent.md');
    expect(patterns).toContain('**/SKILL.md');
    expect(patterns).toContain('**/*.instructions.md');
    expect(patterns).toContain('**/mcp.json');
    expect(patterns).toContain('**/*.prompt.md');

    watcher.dispose();
  });

  it('fires the callback once after debounce when a single create event occurs', async () => {
    const cb = vi.fn(async () => {});
    const watcher = new WorkspaceFileWatcher(cb, 500);
    const [firstWatcher] = getMockWatchers();

    firstWatcher.__fireCreate(DUMMY_URI);

    // Should NOT have fired before the debounce window
    expect(cb).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(cb).toHaveBeenCalledTimes(1);

    watcher.dispose();
  });

  it('fires the callback once (not twice) when two events fire within the debounce window', async () => {
    const cb = vi.fn(async () => {});
    const watcher = new WorkspaceFileWatcher(cb, 500);
    const [firstWatcher] = getMockWatchers();

    firstWatcher.__fireCreate(DUMMY_URI);
    await vi.advanceTimersByTimeAsync(200);  // within debounce
    firstWatcher.__fireChange(DUMMY_URI);

    await vi.advanceTimersByTimeAsync(500);  // completes second debounce
    expect(cb).toHaveBeenCalledTimes(1);

    watcher.dispose();
  });

  it('fires the callback again for a second burst after the debounce settles', async () => {
    const cb = vi.fn(async () => {});
    const watcher = new WorkspaceFileWatcher(cb, 500);
    const [firstWatcher] = getMockWatchers();

    // First burst
    firstWatcher.__fireCreate(DUMMY_URI);
    await vi.advanceTimersByTimeAsync(500);
    expect(cb).toHaveBeenCalledTimes(1);

    // Second burst
    firstWatcher.__fireDelete(DUMMY_URI);
    await vi.advanceTimersByTimeAsync(500);
    expect(cb).toHaveBeenCalledTimes(2);

    watcher.dispose();
  });

  it('fires callback when a change event comes from any of the 5 watchers', async () => {
    const cb = vi.fn(async () => {});
    const watcher = new WorkspaceFileWatcher(cb, 500);
    const watchers = getMockWatchers();

    // Fire an event from each watcher (one burst per watcher, settling each time)
    for (const w of watchers) {
      w.__fireChange(DUMMY_URI);
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(cb).toHaveBeenCalledTimes(5);

    watcher.dispose();
  });

  it('collapses events from multiple watchers within the same debounce window', async () => {
    const cb = vi.fn(async () => {});
    const watcher = new WorkspaceFileWatcher(cb, 500);
    const watchers = getMockWatchers();

    // Fire all watchers rapidly (no timer advance between them)
    for (const w of watchers) {
      w.__fireCreate(DUMMY_URI);
    }

    await vi.advanceTimersByTimeAsync(500);
    expect(cb).toHaveBeenCalledTimes(1);

    watcher.dispose();
  });

  it('does NOT fire the callback after dispose() cancels a pending timer', async () => {
    const cb = vi.fn(async () => {});
    const watcher = new WorkspaceFileWatcher(cb, 500);
    const [firstWatcher] = getMockWatchers();

    firstWatcher.__fireCreate(DUMMY_URI);
    await vi.advanceTimersByTimeAsync(200);  // timer pending...

    watcher.dispose();  // cancel before it fires

    await vi.advanceTimersByTimeAsync(500);
    expect(cb).not.toHaveBeenCalled();
  });

  it('calls dispose() on all 5 underlying vscode watchers', () => {
    const cb = vi.fn(async () => {});
    const watcher = new WorkspaceFileWatcher(cb, 500);
    const watchers = getMockWatchers();

    watcher.dispose();

    for (const w of watchers) {
      expect(w.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('is safe to call dispose() multiple times without throwing', () => {
    const cb = vi.fn(async () => {});
    const watcher = new WorkspaceFileWatcher(cb, 500);

    expect(() => {
      watcher.dispose();
      watcher.dispose();
    }).not.toThrow();
  });
});
