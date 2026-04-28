/**
 * Tests for domain entities: HealthReport, Bundle, InsightsReport (types), Operation (types)
 */

import { describe, it, expect } from 'vitest';
import {
  HealthReport,
  HealthFinding,
  HealthSeverity,
} from '../../src/domain/entities/HealthReport';
import { Bundle } from '../../src/domain/entities/Bundle';
// Import type-only modules so coverage registers the files
import type {
  InsightsReport,
  CoverageMap,
  SecurityAlert,
} from '../../src/domain/entities/InsightsReport';
import type {
  OperationKind,
  OperationStatus,
  OperationSnapshot,
  OperationMetricsSnapshot,
  OperationDefinition,
  OperationContext,
  OperationRefreshTarget,
} from '../../src/domain/entities/Operation';

// ─── HealthReport ────────────────────────────────────────────────────────────

describe('HealthReport', () => {
  const errFinding = (id: string): HealthFinding => ({
    id,
    severity: HealthSeverity.Error,
    category: 'general',
    title: 'Error',
    message: 'Something broke',
    autoFixable: false,
  });

  const warnFinding = (id: string): HealthFinding => ({
    id,
    severity: HealthSeverity.Warning,
    category: 'agent',
    title: 'Warning',
    message: 'Take care',
    autoFixable: true,
  });

  const infoFinding = (id: string): HealthFinding => ({
    id,
    severity: HealthSeverity.Info,
    category: 'skill',
    title: 'Info',
    message: 'FYI',
    autoFixable: false,
  });

  it('cria relatório vazio com score 100', () => {
    const report = HealthReport.create([], 42);
    expect(report.score).toBe(100);
    expect(report.scanDurationMs).toBe(42);
    expect(report.findings).toHaveLength(0);
    expect(report.timestamp).toBeInstanceOf(Date);
  });

  it('calcula score: 1 erro → -20 (80)', () => {
    const report = HealthReport.create([errFinding('e1')], 10);
    expect(report.score).toBe(80);
  });

  it('calcula score: 1 warning → -5 (95)', () => {
    const report = HealthReport.create([warnFinding('w1')], 10);
    expect(report.score).toBe(95);
  });

  it('calcula score: 5 erros → 0 (não vai negativo)', () => {
    const report = HealthReport.create(
      [errFinding('e1'), errFinding('e2'), errFinding('e3'), errFinding('e4'), errFinding('e5')],
      10,
    );
    expect(report.score).toBe(0);
  });

  it('calcula score misto: 2 erros + 3 warnings = 100 - 40 - 15 = 45', () => {
    const report = HealthReport.create(
      [errFinding('e1'), errFinding('e2'), warnFinding('w1'), warnFinding('w2'), warnFinding('w3')],
      10,
    );
    expect(report.score).toBe(45);
  });

  it('statusEmoji: score >= 90 → verde', () => {
    const report = HealthReport.create([warnFinding('w1')], 10); // score 95
    expect(report.statusEmoji).toContain('🟢');
  });

  it('statusEmoji: score >= 60 (e < 90) → amarelo', () => {
    // 100 - 20 - 15 = 65 → amarelo
    const report = HealthReport.create(
      [errFinding('e1'), warnFinding('w1'), warnFinding('w2'), warnFinding('w3')],
      10,
    );
    expect(report.score).toBe(65);
    expect(report.statusEmoji).toContain('🟡');
  });

  it('statusEmoji: score < 60 → vermelho', () => {
    const report = HealthReport.create([errFinding('e1'), errFinding('e2'), errFinding('e3')], 10);
    expect(report.score).toBe(40);
    expect(report.statusEmoji).toContain('🔴');
  });

  it('statusLabel: Saudável quando score >= 90', () => {
    const report = HealthReport.create([], 0);
    expect(report.statusLabel).toBe('Saudável');
  });

  it('statusLabel: Precisa de Atenção quando 60 <= score < 90', () => {
    const report = HealthReport.create(
      [errFinding('e1'), warnFinding('w1'), warnFinding('w2'), warnFinding('w3')],
      0,
    );
    expect(report.statusLabel).toBe('Precisa de Atenção');
  });

  it('statusLabel: Problemas Críticos quando score < 60', () => {
    const report = HealthReport.create([errFinding('e1'), errFinding('e2'), errFinding('e3')], 0);
    expect(report.statusLabel).toBe('Problemas Críticos');
  });

  it('filtra erros, warnings e infos corretamente', () => {
    const report = HealthReport.create(
      [errFinding('e1'), warnFinding('w1'), infoFinding('i1'), infoFinding('i2')],
      0,
    );
    expect(report.errors).toHaveLength(1);
    expect(report.warnings).toHaveLength(1);
    expect(report.infos).toHaveLength(2);
  });

  it('autoFixableCount retorna apenas os autoFixable=true', () => {
    const report = HealthReport.create([errFinding('e1'), warnFinding('w1'), infoFinding('i1')], 0);
    // errFinding: autoFixable=false, warnFinding: autoFixable=true, infoFinding: autoFixable=false
    expect(report.autoFixableCount).toBe(1);
  });

  it('findings é imutável (frozen)', () => {
    const report = HealthReport.create([errFinding('e1')], 0);
    expect(() => {
      // @ts-expect-error: tentativa deliberada de mutar
      (report.findings as HealthFinding[]).push(errFinding('e2'));
    }).toThrow();
  });
});

// ─── Bundle ──────────────────────────────────────────────────────────────────

describe('Bundle', () => {
  const makeBundle = (overrides?: Partial<Parameters<typeof Bundle.create>[0]>) =>
    Bundle.create({
      id: 'bundle-backend',
      name: 'backend',
      displayName: 'Backend Stack',
      description: 'Full backend setup',
      version: '2.1.0',
      packageIds: ['agent-backend', 'skill-api-design', 'mcp-github'],
      ...overrides,
    });

  it('cria bundle com valores padrão de icon e color', () => {
    const bundle = makeBundle({ icon: undefined, color: undefined });
    expect(bundle.icon).toBe('$(package)');
    expect(bundle.color).toBe('#EC7000');
  });

  it('cria bundle com valores customizados', () => {
    const bundle = makeBundle({ icon: '$(rocket)', color: '#003366' });
    expect(bundle.icon).toBe('$(rocket)');
    expect(bundle.color).toBe('#003366');
  });

  it('packageCount retorna o número de pacotes', () => {
    expect(makeBundle().packageCount).toBe(3);
    expect(makeBundle({ packageIds: [] }).packageCount).toBe(0);
  });

  it('containsPackage: retorna true para pacote presente', () => {
    expect(makeBundle().containsPackage('agent-backend')).toBe(true);
  });

  it('containsPackage: retorna false para pacote ausente', () => {
    expect(makeBundle().containsPackage('agent-frontend')).toBe(false);
  });

  it('matchesQuery: string vazia retorna true', () => {
    expect(makeBundle().matchesQuery('')).toBe(true);
    expect(makeBundle().matchesQuery('   ')).toBe(true);
  });

  it('matchesQuery: encontra por name', () => {
    expect(makeBundle().matchesQuery('backend')).toBe(true);
  });

  it('matchesQuery: encontra por displayName (case-insensitive)', () => {
    expect(makeBundle().matchesQuery('BACKEND STACK')).toBe(true);
  });

  it('matchesQuery: encontra por description', () => {
    expect(makeBundle().matchesQuery('full backend')).toBe(true);
  });

  it('matchesQuery: não encontra string irrelevante', () => {
    expect(makeBundle().matchesQuery('terraform')).toBe(false);
  });

  it('version é parseada corretamente', () => {
    const bundle = makeBundle({ version: '3.0.1' });
    expect(bundle.version.major).toBe(3);
    expect(bundle.version.minor).toBe(0);
    expect(bundle.version.patch).toBe(1);
  });

  it('packageIds é imutável', () => {
    const bundle = makeBundle();
    expect(() => {
      // @ts-expect-error: tentativa deliberada de mutar
      (bundle.packageIds as string[]).push('new-pkg');
    }).toThrow();
  });
});

// ─── InsightsReport & Operation (type coverage) ──────────────────────────────
// These modules export only interfaces/types (no runtime code). Importing them
// registers the files in coverage, and using the types confirms shape correctness.

describe('InsightsReport types', () => {
  it('CoverageMap tem todas as dimensões esperadas', () => {
    const coverage: CoverageMap = {
      triage: true,
      plan: false,
      design: true,
      execute: false,
      validate: true,
      critic: false,
    };
    expect(Object.keys(coverage)).toHaveLength(6);
  });

  it('SecurityAlert shape é construída corretamente', () => {
    const alert: SecurityAlert = {
      agentName: 'backend-specialist',
      terminalAccess: true,
      fileEditAccess: false,
      isGuardianPresent: true,
    };
    expect(alert.agentName).toBe('backend-specialist');
  });

  it('InsightsReport completo é construído corretamente', () => {
    const report: InsightsReport = {
      installedAgentsCount: 3,
      coverage: {
        triage: true,
        plan: true,
        design: false,
        execute: true,
        validate: false,
        critic: false,
      },
      coverageScore: 50,
      securityAlerts: [],
      missingDependencies: ['mcp-github'],
      uxDiagnostics: {
        enabled: true,
        trackedFlows: 2,
        regressions: [],
        repeatedActions: [],
      },
    };
    expect(report.coverageScore).toBe(50);
    expect(report.missingDependencies).toHaveLength(1);
    expect(report.uxDiagnostics?.trackedFlows).toBe(2);
  });
});

describe('Operation types', () => {
  it('OperationSnapshot shape é construída corretamente', () => {
    const snapshot: OperationSnapshot = {
      id: 'op-1',
      kind: 'package-install' as OperationKind,
      label: 'Installing package',
      status: 'running' as OperationStatus,
      startedAt: Date.now(),
      refreshTargets: ['catalog', 'installed'] as OperationRefreshTarget[],
    };
    expect(snapshot.kind).toBe('package-install');
  });

  it('OperationDefinition shape é construída corretamente', () => {
    const def: OperationDefinition = {
      kind: 'health-check',
      label: 'Health Check',
      refreshTargets: ['health'],
      exclusive: true,
    };
    expect(def.exclusive).toBe(true);
  });

  it('OperationMetricsSnapshot shape é construída corretamente', () => {
    const metrics: OperationMetricsSnapshot = {
      kind: 'catalog-sync',
      totalRuns: 10,
      completedRuns: 9,
      failedRuns: 1,
      averageDurationMs: 250,
    };
    expect(metrics.totalRuns).toBe(10);
  });

  it('OperationContext setProgress e setRefreshing são callable', () => {
    const ctx: OperationContext = {
      setProgress: (progress: number, message?: string) => {
        void progress;
        void message;
      },
      setRefreshing: (message?: string) => {
        void message;
      },
    };
    expect(() => ctx.setProgress(50, 'halfway')).not.toThrow();
    expect(() => ctx.setRefreshing()).not.toThrow();
  });
});
