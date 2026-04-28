import * as vscode from 'vscode';
import {
  UxDiagnosticsSummary,
  UxRegressionSignal,
  UxRepeatedAction,
} from '../../domain/entities/InsightsReport';
import { AppLogger } from './AppLogger';

export type UxDiagnosticSurface =
  | 'command-palette'
  | 'modal'
  | 'panel'
  | 'notification'
  | 'background'
  | 'deep-link';

export type UxDiagnosticCategory =
  | 'validation'
  | 'workspace'
  | 'filesystem'
  | 'network'
  | 'permission'
  | 'unknown';

type UxDiagnosticContext = {
  surface?: UxDiagnosticSurface;
  category?: UxDiagnosticCategory;
  step?: number;
};

type PersistedCounter = {
  count: number;
  lastOccurredAt: number;
  lastContext?: UxDiagnosticContext;
};

type PersistedState = {
  version: 1;
  counters: Record<string, PersistedCounter>;
  repeatWindows: Record<string, number[]>;
};

type EventDefinition = {
  title: string;
  summary: string;
  severity: 'info' | 'warning' | 'error';
  kind: 'usage' | 'friction';
  repeatRule?: {
    threshold: number;
    windowMs: number;
    title: string;
    summary: string;
  };
};

const UX_EVENT_DEFINITIONS = {
  'command.install.empty': {
    title: 'Instalação aberta sem itens disponíveis',
    summary:
      'O comando de instalação foi acionado, mas o catálogo não expôs pacotes selecionáveis.',
    severity: 'warning',
    kind: 'friction',
  },
  'command.install.cancelled': {
    title: 'Seleção de instalação cancelada',
    summary: 'O seletor de pacotes foi fechado antes de uma escolha ser confirmada.',
    severity: 'info',
    kind: 'friction',
  },
  'command.uninstall.empty': {
    title: 'Remoção sem pacotes instalados',
    summary:
      'O fluxo de remoção foi aberto, mas o workspace não tinha pacotes ativos para remover.',
    severity: 'warning',
    kind: 'friction',
  },
  'command.uninstall.cancelled': {
    title: 'Seleção de remoção cancelada',
    summary: 'O seletor de pacotes instalados foi fechado sem confirmação.',
    severity: 'info',
    kind: 'friction',
  },
  'command.installBundle.empty': {
    title: 'Instalação de bundle sem bundles disponíveis',
    summary: 'O comando de bundles foi acionado, mas o catálogo atual não oferecia bundles.',
    severity: 'warning',
    kind: 'friction',
  },
  'command.installBundle.cancelled': {
    title: 'Seleção de bundle cancelada',
    summary: 'O seletor de bundles foi fechado sem uma confirmação de instalação.',
    severity: 'info',
    kind: 'friction',
  },
  'command.configureAgent.empty': {
    title: 'Configuração sem agentes disponíveis',
    summary:
      'O comando de configuração foi aberto, mas não havia agentes selecionáveis no catálogo.',
    severity: 'warning',
    kind: 'friction',
  },
  'command.configureAgent.cancelled': {
    title: 'Seleção de agente cancelada',
    summary: 'O seletor de agentes foi fechado antes da abertura do painel de configuração.',
    severity: 'info',
    kind: 'friction',
  },
  'command.stackDiff.empty': {
    title: 'Stack Diff sem bundles disponíveis',
    summary: 'A comparação foi solicitada, mas o catálogo atual não oferecia bundles para análise.',
    severity: 'warning',
    kind: 'friction',
  },
  'command.stackDiff.cancelled': {
    title: 'Seleção de bundle para diff cancelada',
    summary: 'O seletor de bundle do Stack Diff foi fechado sem escolha.',
    severity: 'info',
    kind: 'friction',
  },
  'command.publishPackage.cancelled': {
    title: 'Publicação interrompida antes da seleção de arquivo',
    summary: 'O fluxo de contribuição foi aberto, mas nenhum documento MCP foi selecionado.',
    severity: 'info',
    kind: 'friction',
  },
  'command.importCustomMcp.cancelled': {
    title: 'Importação interrompida antes da seleção de arquivo',
    summary: 'O fluxo de importação foi iniciado, mas o documento MCP não foi escolhido.',
    severity: 'info',
    kind: 'friction',
  },
  'modal.dependencies.cancelled': {
    title: 'Modal de dependências cancelado',
    summary: 'A confirmação para instalar dependências adicionais foi fechada sem escolha.',
    severity: 'warning',
    kind: 'friction',
  },
  'modal.dependencies.packageOnly': {
    title: 'Instalação limitada ao pacote principal',
    summary: 'O usuário optou por instalar apenas o pacote principal, sem dependências sugeridas.',
    severity: 'info',
    kind: 'usage',
  },
  'modal.networkInstall.cancelled': {
    title: 'Instalação de rede cancelada',
    summary: 'O diálogo de instalação de rede foi fechado sem aplicar alterações.',
    severity: 'warning',
    kind: 'friction',
  },
  'modal.networkInstall.packageOnly': {
    title: 'Rede reduzida ao agent principal',
    summary: 'A instalação em rede foi reduzida para o agent principal apenas.',
    severity: 'info',
    kind: 'usage',
  },
  'panel.scaffold.abandoned': {
    title: 'Wizard abandonado antes da criação',
    summary: 'O painel de scaffold foi fechado antes de concluir a criação do pacote.',
    severity: 'warning',
    kind: 'friction',
  },
  'panel.scaffold.createFailed': {
    title: 'Falha ao criar pacote pelo wizard',
    summary: 'A criação do pacote falhou depois de o wizard já ter coletado os dados necessários.',
    severity: 'error',
    kind: 'friction',
  },
  'panel.config.saveFailed': {
    title: 'Falha ao salvar configuração de agente',
    summary: 'O painel de configuração encontrou um erro ao persistir preferências do agente.',
    severity: 'error',
    kind: 'friction',
  },
  'panel.stackDiff.copyMarkdown': {
    title: 'Relatório do Stack Diff copiado',
    summary: 'O relatório do Stack Diff foi copiado para a área de transferência.',
    severity: 'info',
    kind: 'usage',
    repeatRule: {
      threshold: 3,
      windowMs: 10 * 60 * 1000,
      title: 'Cópias repetidas do Stack Diff',
      summary:
        'A mesma ação de compartilhamento foi repetida várias vezes em sequência, o que pode indicar ausência de um destino mais adequado para o relatório.',
    },
  },
  'panel.stackDiff.exportMarkdown': {
    title: 'Relatório do Stack Diff exportado',
    summary: 'O relatório do Stack Diff foi aberto como documento Markdown.',
    severity: 'info',
    kind: 'usage',
    repeatRule: {
      threshold: 3,
      windowMs: 10 * 60 * 1000,
      title: 'Exports repetidos do Stack Diff',
      summary:
        'O relatório do Stack Diff foi exportado repetidamente em um curto intervalo, sugerindo necessidade de um fluxo de saída mais direto.',
    },
  },
  'service.publishPackage.failed': {
    title: 'Falha ao gerar contribuição',
    summary: 'O fluxo de publicação não conseguiu gerar os artefatos esperados de contribuição.',
    severity: 'error',
    kind: 'friction',
  },
  'service.importCustomMcp.failed': {
    title: 'Falha ao importar MCP customizado',
    summary:
      'A importação de MCP customizado terminou com erro antes de atualizar o catálogo local.',
    severity: 'error',
    kind: 'friction',
  },
  'service.registrySync.failed': {
    title: 'Sincronização remota do catálogo falhou',
    summary:
      'O catálogo remoto precisou cair para o modo local/customizado após erro de sincronização.',
    severity: 'error',
    kind: 'friction',
  },
} as const satisfies Record<string, EventDefinition>;

export type UxDiagnosticEvent = keyof typeof UX_EVENT_DEFINITIONS;

function createDefaultState(): PersistedState {
  return {
    version: 1,
    counters: {},
    repeatWindows: {},
  };
}

export class UxDiagnosticsService implements vscode.Disposable {
  private static readonly STORAGE_KEY = 'descomplicai.uxDiagnostics';
  private static _instance?: UxDiagnosticsService;

  private readonly _logger = AppLogger.getInstance();
  private _context?: vscode.ExtensionContext;
  private _state: PersistedState = createDefaultState();

  public static getInstance(): UxDiagnosticsService {
    if (!UxDiagnosticsService._instance) {
      UxDiagnosticsService._instance = new UxDiagnosticsService();
    }
    return UxDiagnosticsService._instance;
  }

  public initialize(context: vscode.ExtensionContext): void {
    this._context = context;
    this._state = this.loadState();
  }

  public track(event: UxDiagnosticEvent, context: UxDiagnosticContext = {}): void {
    if (!this.isEnabled() || !this._context) {
      return;
    }

    const now = Date.now();
    const current = this._state.counters[event] ?? {
      count: 0,
      lastOccurredAt: now,
    };

    this._state.counters[event] = {
      count: current.count + 1,
      lastOccurredAt: now,
      lastContext: this.normalizeContext(context),
    };

    const definition = UX_EVENT_DEFINITIONS[event];
    const repeatRule = 'repeatRule' in definition ? definition.repeatRule : undefined;
    if (repeatRule) {
      const timestamps = (this._state.repeatWindows[event] ?? []).filter(
        (timestamp) => now - timestamp <= repeatRule.windowMs,
      );
      timestamps.push(now);
      this._state.repeatWindows[event] = timestamps;
    }

    this.persistState();
    this._logger.debug('UX_DIAGNOSTIC_EVENT', {
      event,
      count: this._state.counters[event].count,
      context: this._state.counters[event].lastContext,
    });
  }

  public getInsightsSummary(limit = 4): UxDiagnosticsSummary {
    if (!this.isEnabled() || !this._context) {
      return {
        enabled: false,
        trackedFlows: 0,
        regressions: [],
        repeatedActions: [],
      };
    }

    const regressions = Object.entries(this._state.counters)
      .map(([event, counter]) => this.toRegressionSignal(event as UxDiagnosticEvent, counter))
      .filter((value): value is UxRegressionSignal => Boolean(value))
      .sort((left, right) => {
        const severityDelta =
          this.weightSeverity(right.severity) - this.weightSeverity(left.severity);
        if (severityDelta !== 0) {
          return severityDelta;
        }
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return (right.lastOccurredAt ?? '').localeCompare(left.lastOccurredAt ?? '');
      })
      .slice(0, limit);

    const repeatedActions = (Object.keys(UX_EVENT_DEFINITIONS) as UxDiagnosticEvent[])
      .map((event) => this.toRepeatedAction(event))
      .filter((value): value is UxRepeatedAction => Boolean(value))
      .sort((left, right) => right.count - left.count);

    return {
      enabled: true,
      trackedFlows: Object.keys(this._state.counters).length,
      regressions,
      repeatedActions,
    };
  }

  public dispose(): void {
    this._context = undefined;
    this._state = createDefaultState();
    UxDiagnosticsService._instance = undefined;
  }

  public static categorizeError(error: unknown): UxDiagnosticCategory {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (
      message.includes('workspace') ||
      message.includes('pasta de workspace') ||
      message.includes('nenhuma pasta')
    ) {
      return 'workspace';
    }

    if (
      message.includes('eacces') ||
      message.includes('permission') ||
      message.includes('permiss')
    ) {
      return 'permission';
    }

    if (
      message.includes('enoent') ||
      message.includes('not found') ||
      message.includes('não encontrado') ||
      message.includes('nao encontrado')
    ) {
      return 'filesystem';
    }

    if (
      message.includes('fetch') ||
      message.includes('github api') ||
      message.includes('network') ||
      message.includes('socket') ||
      message.includes('timeout') ||
      message.includes('sincronizar o catálogo') ||
      message.includes('sincronizar o catalogo')
    ) {
      return 'network';
    }

    if (
      message.includes('temperatura') ||
      message.includes('token limit') ||
      message.includes('provedor') ||
      message.includes('válido') ||
      message.includes('valido')
    ) {
      return 'validation';
    }

    return 'unknown';
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('descomplicai')
      .get<boolean>('uxDiagnostics.enabled', true);
  }

  private normalizeContext(context: UxDiagnosticContext): UxDiagnosticContext | undefined {
    const normalized: UxDiagnosticContext = {};
    if (context.surface) {
      normalized.surface = context.surface;
    }
    if (context.category) {
      normalized.category = context.category;
    }
    if (typeof context.step === 'number' && Number.isFinite(context.step)) {
      normalized.step = context.step;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  private loadState(): PersistedState {
    if (!this._context) {
      return createDefaultState();
    }

    const stored = this._context.globalState.get<Partial<PersistedState>>(
      UxDiagnosticsService.STORAGE_KEY,
      createDefaultState(),
    );

    const nextState = createDefaultState();
    if (!stored || typeof stored !== 'object') {
      return nextState;
    }

    const counters = stored.counters;
    if (counters && typeof counters === 'object') {
      for (const [key, value] of Object.entries(counters)) {
        if (
          !UX_EVENT_DEFINITIONS[key as UxDiagnosticEvent] ||
          !value ||
          typeof value !== 'object'
        ) {
          continue;
        }
        const counter = value as Partial<PersistedCounter>;
        if (typeof counter.count !== 'number' || typeof counter.lastOccurredAt !== 'number') {
          continue;
        }
        nextState.counters[key] = {
          count: counter.count,
          lastOccurredAt: counter.lastOccurredAt,
          lastContext: this.normalizeContext(counter.lastContext ?? {}),
        };
      }
    }

    const repeatWindows = stored.repeatWindows;
    if (repeatWindows && typeof repeatWindows === 'object') {
      for (const [key, timestamps] of Object.entries(repeatWindows)) {
        if (!UX_EVENT_DEFINITIONS[key as UxDiagnosticEvent] || !Array.isArray(timestamps)) {
          continue;
        }
        nextState.repeatWindows[key] = timestamps.filter((value) => typeof value === 'number');
      }
    }

    return nextState;
  }

  private persistState(): void {
    if (!this._context) {
      return;
    }
    void this._context.globalState.update(UxDiagnosticsService.STORAGE_KEY, this._state);
  }

  private toRegressionSignal(
    event: UxDiagnosticEvent,
    counter: PersistedCounter,
  ): UxRegressionSignal | undefined {
    const definition = UX_EVENT_DEFINITIONS[event];
    if (!definition || definition.kind !== 'friction') {
      return undefined;
    }

    return {
      id: event,
      title: definition.title,
      summary: this.buildSummary(definition.summary, counter),
      severity: definition.severity,
      count: counter.count,
      lastOccurredAt: this.formatTimestamp(counter.lastOccurredAt),
    };
  }

  private toRepeatedAction(event: UxDiagnosticEvent): UxRepeatedAction | undefined {
    const definition = UX_EVENT_DEFINITIONS[event];
    const repeatRule = 'repeatRule' in definition ? definition.repeatRule : undefined;
    if (!repeatRule) {
      return undefined;
    }

    const timestamps = (this._state.repeatWindows[event] ?? []).filter(
      (timestamp) => Date.now() - timestamp <= repeatRule.windowMs,
    );
    this._state.repeatWindows[event] = timestamps;

    if (timestamps.length < repeatRule.threshold) {
      return undefined;
    }

    return {
      id: event,
      title: repeatRule.title,
      summary: repeatRule.summary,
      count: timestamps.length,
      threshold: repeatRule.threshold,
      lastOccurredAt: this.formatTimestamp(timestamps[timestamps.length - 1]),
    };
  }

  private buildSummary(baseSummary: string, counter: PersistedCounter): string {
    const fragments: string[] = [];
    if (counter.lastContext?.step) {
      fragments.push(`Última etapa observada: ${counter.lastContext.step}`);
    }
    if (counter.lastContext?.category) {
      fragments.push(`Categoria: ${this.describeCategory(counter.lastContext.category)}`);
    }
    if (counter.lastContext?.surface) {
      fragments.push(`Origem: ${this.describeSurface(counter.lastContext.surface)}`);
    }
    return fragments.length > 0 ? `${baseSummary} ${fragments.join(' · ')}.` : baseSummary;
  }

  private formatTimestamp(value: number | undefined): string | undefined {
    if (typeof value !== 'number') {
      return undefined;
    }
    return new Date(value).toLocaleString('pt-BR');
  }

  private describeCategory(category: UxDiagnosticCategory): string {
    const labels: Record<UxDiagnosticCategory, string> = {
      validation: 'validação',
      workspace: 'workspace',
      filesystem: 'sistema de arquivos',
      network: 'rede',
      permission: 'permissão',
      unknown: 'indefinida',
    };
    return labels[category];
  }

  private describeSurface(surface: UxDiagnosticSurface): string {
    const labels: Record<UxDiagnosticSurface, string> = {
      'command-palette': 'command palette',
      modal: 'modal',
      panel: 'painel',
      notification: 'notificação',
      background: 'processo em segundo plano',
      'deep-link': 'deep link',
    };
    return labels[surface];
  }

  private weightSeverity(severity: UxRegressionSignal['severity']): number {
    switch (severity) {
      case 'error':
        return 3;
      case 'warning':
        return 2;
      default:
        return 1;
    }
  }
}
