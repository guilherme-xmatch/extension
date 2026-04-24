import * as vscode from 'vscode';
import { WebviewHelper } from '../webview/WebviewHelper';
import { Package } from '../../domain/entities/Package';

export class ConfigPanel {
  public static currentPanel: ConfigPanel | undefined;
  public static readonly viewType = 'dai.configPanel';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _pkg: Package;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, pkg: Package) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._pkg = pkg;

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'saveConfig':
            await this.saveConfig(message.config);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public static createOrShow(extensionUri: vscode.Uri, pkg: Package) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

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
      }
    );

    ConfigPanel.currentPanel = new ConfigPanel(panel, extensionUri, pkg);
  }

  private async saveConfig(config: any) {
    try {
      const configuration = vscode.workspace.getConfiguration('descomplicai');
      await configuration.update('llmProvider', config.llmProvider, vscode.ConfigurationTarget.Global);
      await configuration.update('temperature', parseFloat(config.temperature), vscode.ConfigurationTarget.Global);
      
      vscode.window.showInformationMessage(`✅ Configurações salvas para ${this._pkg.displayName}!`);
    } catch (e) {
      vscode.window.showErrorMessage('Erro ao salvar as configurações.');
    }
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
    const webview = this._panel.webview;
    const title = `Configuração: ${this._pkg.displayName}`;
    
    const configuration = vscode.workspace.getConfiguration('descomplicai');
    const currentProvider = configuration.get<string>('llmProvider') || 'Azure OpenAI';
    const currentTemp = configuration.get<number>('temperature') || 0.2;

    const bodyContent = /*html*/`
      <div class="dai-container">
        <header class="dai-header">
          <div class="dai-header-icon">${this._pkg.categoryEmoji || '⚙️'}</div>
          <div>
            <h1>Configurar ${this._pkg.displayName}</h1>
            <p>Ajuste os parâmetros de execução e segurança do agente.</p>
          </div>
        </header>

        <div class="dai-section animate-slide-in">
          <div class="dai-section-header">
            <span class="dai-section-title">Parâmetros de IA</span>
          </div>

          <div class="dai-form-group">
            <label class="dai-form-label">LLM Provider</label>
            <select id="llmProvider" class="dai-input">
              <option value="Azure OpenAI" ${currentProvider === 'Azure OpenAI' ? 'selected' : ''}>Azure OpenAI (Itaú Cloud)</option>
              <option value="Anthropic Claude" ${currentProvider === 'Anthropic Claude' ? 'selected' : ''}>Anthropic Claude 3.5</option>
              <option value="Local Llama 3" ${currentProvider === 'Local Llama 3' ? 'selected' : ''}>Local Llama 3 (Ollama)</option>
            </select>
            <p class="dai-form-hint">O provedor base de inteligência que executará este agente.</p>
          </div>

          <div class="dai-form-group">
            <label class="dai-form-label">Temperatura / Criatividade (<span id="tempValue">${currentTemp}</span>)</label>
            <input type="range" id="temperature" class="dai-slider" min="0" max="1" step="0.1" value="${currentTemp}">
            <p class="dai-form-hint">Valores baixos tornam o agente determinístico. Valores altos aumentam a criatividade.</p>
          </div>

          <div class="dai-form-group">
            <label class="dai-form-label">Token Limit</label>
            <input type="number" id="tokenLimit" class="dai-input" value="4096">
            <p class="dai-form-hint">Limite máximo de tokens por requisição (Input + Output).</p>
          </div>
        </div>

        <div class="dai-section animate-slide-in" style="--delay: 0.1s">
          <div class="dai-section-header">
            <span class="dai-section-title">Segurança & Permissões</span>
          </div>

          <div class="dai-form-group dai-toggle-group">
            <div class="dai-toggle-text">
              <label class="dai-form-label">Auto-Aprovação de Comandos no Terminal</label>
              <p class="dai-form-hint">Se ativo, o agente poderá rodar comandos sem confirmação.</p>
            </div>
            <label class="dai-switch">
              <input type="checkbox" id="autoApprove" ${this._pkg.agentMeta?.category.value === 'guardian' ? 'checked' : ''}>
              <span class="dai-slider-switch"></span>
            </label>
          </div>

          <div class="dai-form-group dai-toggle-group">
            <div class="dai-toggle-text">
              <label class="dai-form-label">Acesso ao File System Externo</label>
              <p class="dai-form-hint">Permite leitura fora do escopo do Workspace.</p>
            </div>
            <label class="dai-switch">
              <input type="checkbox" id="fsAccess">
              <span class="dai-slider-switch"></span>
            </label>
          </div>
        </div>

        <div class="dai-actions animate-slide-in" style="--delay: 0.2s">
          <button id="saveBtn" class="dai-btn dai-btn-primary" style="width: 100%">Salvar Configurações</button>
        </div>
      </div>
    `;

    const scriptContent = /*js*/`
      document.getElementById('temperature').addEventListener('input', (e) => {
        document.getElementById('tempValue').innerText = e.target.value;
      });

      document.getElementById('saveBtn').addEventListener('click', () => {
        const config = {
          llmProvider: document.getElementById('llmProvider').value,
          temperature: document.getElementById('temperature').value,
          tokenLimit: document.getElementById('tokenLimit').value,
          autoApprove: document.getElementById('autoApprove').checked,
          fsAccess: document.getElementById('fsAccess').checked
        };
        
        vscode.postMessage({
          command: 'saveConfig',
          config: config
        });
      });
    `;

    this._panel.webview.html = WebviewHelper.buildHtml({
      webview: this._panel.webview,
      extensionUri: this._extensionUri,
      title: title,
      bodyContent: bodyContent,
      scriptContent: scriptContent
    });
  }
}
