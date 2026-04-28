import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { UxDiagnosticsService } from '../../src/infrastructure/services/UxDiagnosticsService';
import { setConfigurationValue } from '../setup/vscode.mock';
import { AppLogger } from '../../src/infrastructure/services/AppLogger';

function createExtensionContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: <T>(key: string, defaultValue?: T): T =>
        store.has(key) ? (store.get(key) as T) : (defaultValue as T),
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      },
    },
  } as unknown as vscode.ExtensionContext;
}

describe('UxDiagnosticsService', () => {
  beforeEach(() => {
    setConfigurationValue('descomplicai.uxDiagnostics.enabled', true);
  });

  afterEach(() => {
    try {
      UxDiagnosticsService.getInstance().dispose();
    } catch {
      /* noop */
    }
    try {
      AppLogger.getInstance().dispose();
    } catch {
      /* noop */
    }
  });

  it('agrega sinais de atrito e os expõe no resumo de insights', () => {
    const service = UxDiagnosticsService.getInstance();
    service.initialize(createExtensionContext());

    service.track('panel.config.saveFailed', {
      surface: 'panel',
      category: 'validation',
    });

    const summary = service.getInsightsSummary();

    expect(summary.enabled).toBe(true);
    expect(summary.trackedFlows).toBe(1);
    expect(summary.regressions[0]).toMatchObject({
      id: 'panel.config.saveFailed',
      severity: 'error',
      count: 1,
    });
  });

  it('detecta ações repetidas quando o limite configurado é atingido', () => {
    const service = UxDiagnosticsService.getInstance();
    service.initialize(createExtensionContext());

    service.track('panel.stackDiff.copyMarkdown', { surface: 'panel' });
    service.track('panel.stackDiff.copyMarkdown', { surface: 'panel' });
    service.track('panel.stackDiff.copyMarkdown', { surface: 'panel' });

    const summary = service.getInsightsSummary();

    expect(summary.repeatedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'panel.stackDiff.copyMarkdown',
          threshold: 3,
          count: 3,
        }),
      ]),
    );
  });

  it('retorna resumo desativado quando a configuração local de diagnósticos está off', () => {
    setConfigurationValue('descomplicai.uxDiagnostics.enabled', false);

    const service = UxDiagnosticsService.getInstance();
    service.initialize(createExtensionContext());
    service.track('command.install.empty', { surface: 'command-palette' });

    const summary = service.getInsightsSummary();

    expect(summary).toMatchObject({
      enabled: false,
      trackedFlows: 0,
      regressions: [],
      repeatedActions: [],
    });
  });

  it('categoriza erros conhecidos sem persistir mensagem sensível', () => {
    expect(UxDiagnosticsService.categorizeError(new Error('ENOENT: file not found'))).toBe(
      'filesystem',
    );
    expect(
      UxDiagnosticsService.categorizeError(
        new Error('Selecione um provedor de LLM válido antes de salvar.'),
      ),
    ).toBe('validation');
  });
});
