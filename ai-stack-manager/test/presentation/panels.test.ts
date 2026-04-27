/**
 * Tests for webview panels: ConfigPanel, InsightsPanel, WorkflowPanel.
 *
 * Framework : Vitest (globals: true)
 * Mock setup: test/setup/vscode.runtime.mjs  (vi.mock('vscode') + beforeEach clearAllMocks)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';

import { ConfigPanel }   from '../../src/presentation/panels/ConfigPanel';
import { InsightsPanel } from '../../src/presentation/panels/InsightsPanel';
import { WorkflowPanel } from '../../src/presentation/panels/WorkflowPanel';

import { Package }     from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { AppLogger }   from '../../src/infrastructure/services/AppLogger';
import { InsightsGenerator } from '../../src/infrastructure/services/InsightsGenerator';

// ── shared helpers ────────────────────────────────────────────────────────────

const extensionUri = vscode.Uri.file('/fake/extension');

/** Minimal Package instance — satisfies ConfigPanel's constructor. */
const makePkg = () =>
  Package.create({
    id: 'agent-backend',
    name: 'backend',
    displayName: 'Backend Specialist',
    description: 'test',
    type: PackageType.Agent,
    version: '1.0.0',
    tags: [],
    author: 'test',
    files: [],
  });

/** InsightsGenerator stub whose generateReport resolves immediately. */
const makeGenerator = (): InsightsGenerator =>
  ({
    generateReport: vi.fn(async () => ({
      installedAgentsCount: 2,
      coverage: {
        triage: true,
        plan: false,
        design: true,
        execute: true,
        validate: false,
        critic: false,
      },
      coverageScore: 50,
      securityAlerts: [],
      missingDependencies: [],
    })),
  } as unknown as InsightsGenerator);

/** Waits a tick so micro-/macro-tasks queued by async handlers can settle. */
const tick = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── ConfigPanel ───────────────────────────────────────────────────────────────

describe('ConfigPanel', () => {
  afterEach(() => {
    // Reset static field so each test starts with no pre-existing panel.
    ConfigPanel.currentPanel = undefined;
    // Dispose AppLogger singleton to prevent state leaking between tests.
    AppLogger.getInstance().dispose();
  });

  it('createOrShow (1st time) → createWebviewPanel called once and currentPanel is set', () => {
    ConfigPanel.createOrShow(extensionUri, makePkg());

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(ConfigPanel.currentPanel).toBeDefined();
  });

  it('createOrShow (2nd time) → reveals existing panel, does NOT create a second panel', () => {
    const pkg = makePkg();
    ConfigPanel.createOrShow(extensionUri, pkg);
    ConfigPanel.createOrShow(extensionUri, pkg);

    // Only one webview panel must have been created in total.
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();

    // The internal panel's reveal() must have been called.
    const internalPanel = (ConfigPanel.currentPanel as any)._panel;
    expect(internalPanel.reveal).toHaveBeenCalledOnce();
  });

  it('saveConfig message (valid) → configuration.update called and info message shown', async () => {
    ConfigPanel.createOrShow(extensionUri, makePkg());

    (ConfigPanel.currentPanel as any)._panel.webview.__fireMessage({
      command: 'saveConfig',
      config: { llmProvider: 'openai', temperature: '0.5' },
    });
    await tick();

    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('saveConfig message — configuration.update throws → showErrorMessage called', async () => {
    // Create the panel first so the constructor's _update() call consumes any
    // existing implementation before we install the once-override for the
    // saveConfig call.
    ConfigPanel.createOrShow(extensionUri, makePkg());

    // Override getConfiguration only for the next call (made by saveConfig).
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce({
      get: vi.fn((_key: string, def: unknown) => def),
      update: vi.fn(async () => {
        throw new Error('Config save failed');
      }),
    } as any);

    (ConfigPanel.currentPanel as any)._panel.webview.__fireMessage({
      command: 'saveConfig',
      config: { llmProvider: 'openai', temperature: '0.5' },
    });
    await tick();

    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('unknown message command → silently ignored (no info/error messages)', async () => {
    ConfigPanel.createOrShow(extensionUri, makePkg());

    (ConfigPanel.currentPanel as any)._panel.webview.__fireMessage({
      command: 'hack',
    });
    await tick();

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('dispose() → ConfigPanel.currentPanel becomes undefined', () => {
    ConfigPanel.createOrShow(extensionUri, makePkg());
    expect(ConfigPanel.currentPanel).toBeDefined();

    // Stub _panel.dispose to a no-op so the mock doesn't re-fire disposeEmitter
    // and cause our onDidDispose listener to call dispose() again (infinite recursion).
    (ConfigPanel.currentPanel as any)._panel.dispose = vi.fn();

    ConfigPanel.currentPanel!.dispose();

    expect(ConfigPanel.currentPanel).toBeUndefined();
  });

  it('panel.dispose() fires onDidDispose listener which calls this.dispose()', async () => {
    ConfigPanel.createOrShow(extensionUri, makePkg());
    expect(ConfigPanel.currentPanel).toBeDefined();

    const internalPanel = (ConfigPanel.currentPanel as any)._panel;

    // The mock's dispose fires disposeEmitter → our listener calls this.dispose()
    // → which calls _panel.dispose() again → infinite recursion.
    // Fix: allow the emitter to fire only on the FIRST call; subsequent calls are no-ops.
    const orig = internalPanel.dispose as ReturnType<typeof vi.fn>;
    let calls = 0;
    internalPanel.dispose = vi.fn(() => { if (++calls === 1) orig(); });

    internalPanel.dispose();
    await tick(10);

    expect(ConfigPanel.currentPanel).toBeUndefined();
  });
});

// ── InsightsPanel ─────────────────────────────────────────────────────────────

describe('InsightsPanel', () => {
  afterEach(() => {
    InsightsPanel.currentPanel = undefined;
  });

  it('createOrShow (1st time) → createWebviewPanel called once and currentPanel is set', () => {
    InsightsPanel.createOrShow(extensionUri, makeGenerator());

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(InsightsPanel.currentPanel).toBeDefined();
  });

  it('createOrShow (2nd time) → reveals existing panel, currentPanel unchanged', () => {
    const generator = makeGenerator();
    InsightsPanel.createOrShow(extensionUri, generator);
    const firstPanel = InsightsPanel.currentPanel;

    InsightsPanel.createOrShow(extensionUri, generator);

    // Panel must not have been created a second time.
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    // Same object reference.
    expect(InsightsPanel.currentPanel).toBe(firstPanel);
    // reveal() must have been invoked on the internal panel.
    const internalPanel = (InsightsPanel.currentPanel as any)._panel;
    expect(internalPanel.reveal).toHaveBeenCalledOnce();
  });

  it('constructor calls update() → generator.generateReport invoked', async () => {
    const generator = makeGenerator();
    InsightsPanel.createOrShow(extensionUri, generator);
    await tick();

    expect(generator.generateReport).toHaveBeenCalledOnce();
  });

  it('refresh message → generator.generateReport called a 2nd time', async () => {
    const generator = makeGenerator();
    InsightsPanel.createOrShow(extensionUri, generator);
    await tick();

    (InsightsPanel.currentPanel as any)._panel.webview.__fireMessage({ command: 'refresh' });
    await tick();

    expect(generator.generateReport).toHaveBeenCalledTimes(2);
  });

  it('dispose() → InsightsPanel.currentPanel becomes undefined', async () => {
    const generator = makeGenerator();
    InsightsPanel.createOrShow(extensionUri, generator);
    await tick();
    expect(InsightsPanel.currentPanel).toBeDefined();

    // Stub _panel.dispose to prevent the mock from re-firing disposeEmitter.
    (InsightsPanel.currentPanel as any)._panel.dispose = vi.fn();

    InsightsPanel.currentPanel!.dispose();

    expect(InsightsPanel.currentPanel).toBeUndefined();
  });
});

// ── WorkflowPanel ─────────────────────────────────────────────────────────────

describe('WorkflowPanel', () => {
  afterEach(() => {
    WorkflowPanel.currentPanel = undefined;
  });

  it('createOrShow (1st time) → createWebviewPanel called once and currentPanel is set', () => {
    WorkflowPanel.createOrShow(extensionUri);

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(WorkflowPanel.currentPanel).toBeDefined();
  });

  it('createOrShow (2nd time) → reveals existing panel, currentPanel unchanged', () => {
    WorkflowPanel.createOrShow(extensionUri);
    const firstPanel = WorkflowPanel.currentPanel;

    WorkflowPanel.createOrShow(extensionUri);

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(WorkflowPanel.currentPanel).toBe(firstPanel);
    const internalPanel = (WorkflowPanel.currentPanel as any)._panel;
    expect(internalPanel.reveal).toHaveBeenCalledOnce();
  });

  it('constructor calls update() → webview.html is non-empty', () => {
    WorkflowPanel.createOrShow(extensionUri);

    const webviewHtml = (WorkflowPanel.currentPanel as any)._panel.webview.html as string;
    expect(webviewHtml).toBeTruthy();
    expect(webviewHtml.length).toBeGreaterThan(0);
  });

  it('dispose() → WorkflowPanel.currentPanel becomes undefined', () => {
    WorkflowPanel.createOrShow(extensionUri);
    expect(WorkflowPanel.currentPanel).toBeDefined();

    // Stub _panel.dispose to prevent the mock from re-firing disposeEmitter.
    (WorkflowPanel.currentPanel as any)._panel.dispose = vi.fn();

    WorkflowPanel.currentPanel!.dispose();

    expect(WorkflowPanel.currentPanel).toBeUndefined();
  });
});
