import * as vscode from 'vscode';
import { WebviewHelper } from '../webview/WebviewHelper';
import { Package } from '../../domain/entities/Package';
import { AppLogger } from '../../infrastructure/services/AppLogger';
import { UxDiagnosticsService } from '../../infrastructure/services/UxDiagnosticsService';

type ConfigPanelFormConfig = {
  llmProvider?: string;
  temperature?: string;
  tokenLimit?: string;
  autoApprove?: boolean;
  fsAccess?: boolean;
};

type ConfigPanelMessage = { command: 'saveConfig'; config: ConfigPanelFormConfig };

function isConfigPanelMessage(value: unknown): value is ConfigPanelMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const message = value as Record<string, unknown>;
  return message.command === 'saveConfig';
}

export class ConfigPanel {
  public static currentPanel: ConfigPanel | undefined;
  public static readonly viewType = 'dai.configPanel';
  private static readonly minimumTokenLimit = 256;
  private static readonly maximumTokenLimit = 128000;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _pkg: Package;
  private _initialized = false;
  private readonly _logger = AppLogger.getInstance();

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, pkg: Package) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._pkg = pkg;

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        if (!isConfigPanelMessage(message)) {
          return;
        }
        switch (message.command) {
          case 'saveConfig':
            await this.saveConfig(message.config);
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public static createOrShow(extensionUri: vscode.Uri, pkg: Package) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ConfigPanel.currentPanel) {
      ConfigPanel.currentPanel._pkg = pkg;
      ConfigPanel.currentPanel._update();
      ConfigPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ConfigPanel.viewType,
      `Configuração: ${pkg.displayName}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        retainContextWhenHidden: true,
      },
    );

    ConfigPanel.currentPanel = new ConfigPanel(panel, extensionUri, pkg);
  }

  private async saveConfig(config: ConfigPanelMessage['config']) {
    try {
      const normalizedConfig = this.normalizeConfig(config);
      const configuration = vscode.workspace.getConfiguration('descomplicai');
      await Promise.all([
        configuration.update(
          'llmProvider',
          normalizedConfig.llmProvider,
          vscode.ConfigurationTarget.Global,
        ),
        configuration.update(
          'temperature',
          normalizedConfig.temperature,
          vscode.ConfigurationTarget.Global,
        ),
        configuration.update(
          'tokenLimit',
          normalizedConfig.tokenLimit,
          vscode.ConfigurationTarget.Global,
        ),
        configuration.update(
          'autoApproveTerminal',
          normalizedConfig.autoApprove,
          vscode.ConfigurationTarget.Global,
        ),
        configuration.update(
          'allowExternalFsAccess',
          normalizedConfig.fsAccess,
          vscode.ConfigurationTarget.Global,
        ),
      ]);

      WebviewHelper.postNotification(this._panel.webview, {
        kind: 'success',
        title: 'Configurações salvas',
        message: `${this._pkg.displayName} recebeu os parâmetros mais recentes.`,
      });
      vscode.window.showInformationMessage(
        `As configurações de ${this._pkg.displayName} foram salvas.`,
      );
    } catch (error) {
      this._logger.error('CONFIG_SAVE_FAILED', { packageId: this._pkg.id, error });
      UxDiagnosticsService.getInstance().track('panel.config.saveFailed', {
        surface: 'panel',
        category: UxDiagnosticsService.categorizeError(error),
      });
      const message = error instanceof Error ? error.message : 'Erro ao salvar as configurações.';
      WebviewHelper.postNotification(this._panel.webview, {
        kind: 'error',
        title: 'Falha ao salvar',
        message,
      });
      vscode.window.showErrorMessage(`Não foi possível salvar as configurações. ${message}`);
    }
  }

  private normalizeConfig(config: ConfigPanelFormConfig): {
    llmProvider: string;
    temperature: number;
    tokenLimit: number;
    autoApprove: boolean;
    fsAccess: boolean;
  } {
    const llmProvider = (config.llmProvider ?? '').trim();
    const temperature = Number.parseFloat(config.temperature ?? '0.2');
    const tokenLimit = Number.parseInt(config.tokenLimit ?? '4096', 10);

    if (!llmProvider) {
      throw new Error('Selecione um provedor de LLM válido antes de salvar.');
    }
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
      throw new Error('Defina uma temperatura entre 0.0 e 1.0.');
    }
    if (
      !Number.isInteger(tokenLimit) ||
      tokenLimit < ConfigPanel.minimumTokenLimit ||
      tokenLimit > ConfigPanel.maximumTokenLimit
    ) {
      throw new Error(
        `Use um token limit entre ${ConfigPanel.minimumTokenLimit} e ${ConfigPanel.maximumTokenLimit}.`,
      );
    }

    return {
      llmProvider,
      temperature,
      tokenLimit,
      autoApprove: Boolean(config.autoApprove),
      fsAccess: Boolean(config.fsAccess),
    };
  }

  public dispose() {
    ConfigPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    const title = `Configuração: ${this._pkg.displayName}`;
    this._panel.title = title;

    const configuration = vscode.workspace.getConfiguration('descomplicai');
    const currentProvider = configuration.get<string>('llmProvider') || 'Azure OpenAI';
    const currentTemp = configuration.get<number>('temperature') || 0.2;
    const currentTokenLimit = configuration.get<number>('tokenLimit') || 4096;
    const currentAutoApprove = configuration.get<boolean>('autoApproveTerminal') || false;
    const currentFsAccess = configuration.get<boolean>('allowExternalFsAccess') || false;

    const bodyContent = /*html*/ `
      <div class="dai-container">
        <header class="dai-header">
          <div class="dai-header-icon">${this._pkg.categoryEmoji || '⚙️'}</div>
          <div>
            <h1>Configurar ${this._pkg.displayName}</h1>
            <p>Ajuste os parâmetros de execução e segurança do agente.</p>
          </div>
        </header>

        <div class="dai-form-summary ${this._initialized ? '' : 'animate-slide-in'}" id="config-summary" role="status" aria-live="polite" data-tone="success">
          <span class="dai-form-summary-icon" aria-hidden="true">OK</span>
          <div class="dai-form-summary-copy">
            <span class="dai-form-summary-title">Configuração pronta</span>
            <span class="dai-form-summary-message">Revise os parâmetros abaixo. Campos obrigatórios são verificados em tempo real.</span>
          </div>
        </div>

        <div class="dai-section ${this._initialized ? '' : 'animate-slide-in'}">
          <div class="dai-section-header">
            <span class="dai-section-title">Parâmetros de IA</span>
            <span class="dai-status-pill dai-status-pill-idle">Validação inline</span>
          </div>

          <div class="dai-form-group">
            <label class="dai-form-label" for="llmProvider">LLM Provider</label>
            <select id="llmProvider" class="dai-input" aria-describedby="llmProvider-hint llmProvider-error">
              <option value="Azure OpenAI" ${currentProvider === 'Azure OpenAI' ? 'selected' : ''}>Azure OpenAI (Itaú Cloud)</option>
              <option value="Anthropic Claude" ${currentProvider === 'Anthropic Claude' ? 'selected' : ''}>Anthropic Claude 3.5</option>
              <option value="Local Llama 3" ${currentProvider === 'Local Llama 3' ? 'selected' : ''}>Local Llama 3 (Ollama)</option>
            </select>
            <p class="dai-form-hint" id="llmProvider-hint">O provedor base de inteligência que executará este agente.</p>
            <p class="dai-field-error" id="llmProvider-error" role="alert"></p>
          </div>

          <div class="dai-form-group">
            <label class="dai-form-label" for="temperature">Temperatura / Criatividade (<span id="tempValue">${currentTemp}</span>)</label>
            <input type="range" id="temperature" class="dai-slider" min="0" max="1" step="0.1" value="${currentTemp}" aria-describedby="temperature-hint temperature-error">
            <p class="dai-form-hint" id="temperature-hint">Valores baixos tornam o agente determinístico. Valores altos aumentam a criatividade.</p>
            <p class="dai-field-error" id="temperature-error" role="alert"></p>
          </div>

          <div class="dai-form-group">
            <label class="dai-form-label" for="tokenLimit">Token Limit</label>
            <input type="number" id="tokenLimit" class="dai-input" value="${currentTokenLimit}" min="${ConfigPanel.minimumTokenLimit}" max="${ConfigPanel.maximumTokenLimit}" step="1" aria-describedby="tokenLimit-hint tokenLimit-error">
            <p class="dai-form-hint" id="tokenLimit-hint">Limite máximo de tokens por requisição (Input + Output).</p>
            <p class="dai-field-error" id="tokenLimit-error" role="alert"></p>
          </div>
        </div>

        <div class="dai-section ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.1s">
          <div class="dai-section-header">
            <span class="dai-section-title">Segurança & Permissões</span>
            <span class="dai-status-pill dai-status-pill-warning">Aplicar com critério</span>
          </div>

          <div class="dai-form-group dai-toggle-group">
            <div class="dai-toggle-text">
              <label class="dai-form-label">Auto-Aprovação de Comandos no Terminal</label>
              <p class="dai-form-hint">Se ativo, o agente poderá rodar comandos sem confirmação.</p>
            </div>
            <label class="dai-switch">
              <input type="checkbox" id="autoApprove" ${currentAutoApprove ? 'checked' : ''}>
              <span class="dai-slider-switch"></span>
            </label>
          </div>

          <div class="dai-form-group dai-toggle-group">
            <div class="dai-toggle-text">
              <label class="dai-form-label">Acesso ao File System Externo</label>
              <p class="dai-form-hint">Permite leitura fora do escopo do Workspace.</p>
            </div>
            <label class="dai-switch">
              <input type="checkbox" id="fsAccess" ${currentFsAccess ? 'checked' : ''}>
              <span class="dai-slider-switch"></span>
            </label>
          </div>
        </div>

        <div class="dai-actions ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.2s">
          <button id="saveBtn" class="dai-btn dai-btn-primary" style="width: 100%">Salvar Configurações</button>
        </div>
      </div>
    `;

    const scriptContent = /*js*/ `
      const render = (state) => state.html || '<div class="dai-container"></div>';
      const bind = (_state, app) => {
        const minTokenLimit = ${ConfigPanel.minimumTokenLimit};
        const maxTokenLimit = ${ConfigPanel.maximumTokenLimit};

        const getField = (id) => app.root.querySelector('#' + id);
        const getError = (id) => app.root.querySelector('#' + id + '-error');
        const summary = app.root.querySelector('#config-summary');
        const summaryTitle = summary?.querySelector('.dai-form-summary-title');
        const summaryMessage = summary?.querySelector('.dai-form-summary-message');
        const summaryIcon = summary?.querySelector('.dai-form-summary-icon');
        const saveBtn = app.root.querySelector('#saveBtn');

        const values = () => ({
          llmProvider: getField('llmProvider')?.value || '',
          temperature: getField('temperature')?.value || '0.2',
          tokenLimit: getField('tokenLimit')?.value || '4096',
          autoApprove: Boolean(getField('autoApprove')?.checked),
          fsAccess: Boolean(getField('fsAccess')?.checked),
        });

        const setError = (id, message) => {
          const field = getField(id);
          const error = getError(id);
          if (!field || !error) { return; }
          if (message) {
            field.setAttribute('aria-invalid', 'true');
            field.classList.add('dai-input-invalid');
            error.textContent = message;
            error.classList.add('visible');
            return;
          }
          field.removeAttribute('aria-invalid');
          field.classList.remove('dai-input-invalid');
          error.textContent = '';
          error.classList.remove('visible');
        };

        const updateSummary = (errors) => {
          if (!summary || !summaryTitle || !summaryMessage || !summaryIcon) { return; }
          summary.classList.add('visible');
          if (errors.length > 0) {
            summary.dataset.tone = 'warning';
            summaryTitle.textContent = 'Revise os campos antes de salvar';
            summaryMessage.textContent = errors.join(' • ');
            summaryIcon.textContent = '!';
            return;
          }
          summary.dataset.tone = 'success';
          summaryTitle.textContent = 'Configuração pronta';
          summaryMessage.textContent = 'Todos os campos obrigatórios passaram na validação local.';
          summaryIcon.textContent = 'OK';
        };

        const validate = () => {
          const current = values();
          const errors = [];
          if (!String(current.llmProvider).trim()) {
            const message = 'Selecione um provedor de LLM.';
            setError('llmProvider', message);
            errors.push(message);
          } else {
            setError('llmProvider', '');
          }

          const temperature = Number.parseFloat(current.temperature);
          if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
            const message = 'Use uma temperatura entre 0.0 e 1.0.';
            setError('temperature', message);
            errors.push(message);
          } else {
            setError('temperature', '');
          }

          const tokenLimit = Number.parseInt(current.tokenLimit, 10);
          if (!Number.isInteger(tokenLimit) || tokenLimit < minTokenLimit || tokenLimit > maxTokenLimit) {
            const message = 'Use um token limit entre ' + minTokenLimit + ' e ' + maxTokenLimit + '.';
            setError('tokenLimit', message);
            errors.push(message);
          } else {
            setError('tokenLimit', '');
          }

          if (saveBtn) { saveBtn.disabled = errors.length > 0; }
          updateSummary(errors);
          return { errors, current };
        };

        const syncTemperatureLabel = () => {
          const value = getField('temperature')?.value || '0.2';
          const tempEl = app.root.querySelector('#tempValue');
          if (tempEl) { tempEl.textContent = value; }
        };

        ['llmProvider', 'temperature', 'tokenLimit', 'autoApprove', 'fsAccess'].forEach((id) => {
          const field = getField(id);
          if (!field) { return; }
          const eventName = field.type === 'checkbox' || field.tagName === 'SELECT' ? 'change' : 'input';
          field.addEventListener(eventName, () => {
            syncTemperatureLabel();
            validate();
          });
          if (eventName !== 'input') {
            field.addEventListener('input', () => {
              syncTemperatureLabel();
              validate();
            });
          }
        });

        syncTemperatureLabel();
        validate();

        saveBtn?.addEventListener('click', () => {
          const result = validate();
          if (result.errors.length > 0) {
            const firstInvalid = app.root.querySelector('[aria-invalid="true"]');
            firstInvalid?.focus();
            app.notify({
              kind: 'warning',
              title: 'Revise os campos obrigatórios',
              message: result.errors[0],
            });
            return;
          }
          app.postMessage({ command: 'saveConfig', config: result.current });
        });
      };
    `;

    const state = { html: bodyContent };
    if (!this._initialized) {
      this._panel.webview.html = WebviewHelper.buildStatefulHtml({
        webview: this._panel.webview,
        extensionUri: this._extensionUri,
        title,
        initialState: state,
        scriptContent,
      });
      this._initialized = true;
      return;
    }

    WebviewHelper.postState(this._panel.webview, state);
  }
}
