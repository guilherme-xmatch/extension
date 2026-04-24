/**
 * @module presentation/panels/WorkflowPanel
 * @description Webview panel for the interactive agent workflow visualizer.
 * Renders a Mermaid.js state diagram of the ZM1 orchestrator pipeline.
 */

import * as vscode from 'vscode';
import { WebviewHelper } from '../webview/WebviewHelper';

export class WorkflowPanel {
  public static currentPanel: WorkflowPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this.update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (WorkflowPanel.currentPanel) {
      WorkflowPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'daiWorkflow',
      'DescomplicAI: Workflow',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      }
    );

    WorkflowPanel.currentPanel = new WorkflowPanel(panel, extensionUri);
  }

  public dispose(): void {
    WorkflowPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  private update(): void {
    const webview = this._panel.webview;
    this._panel.webview.html = this.getHtmlForWebview(webview);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const mainCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'main.css'));
    const animCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'animations.css'));

    return /*html*/`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DescomplicAI Workflow</title>
  <link href="${mainCssUri}" rel="stylesheet">
  <link href="${animCssUri}" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body {
      padding: 0;
      margin: 0;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    
    .workflow-header {
      padding: 20px 32px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--vscode-editor-background);
      z-index: 10;
    }
    
    .workflow-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0;
    }
    
    .workflow-subtitle {
      color: var(--vscode-descriptionForeground);
      margin: 4px 0 0 0;
      font-size: 0.9rem;
    }
    
    .mermaid-container {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: auto;
      background-image: radial-gradient(var(--border-color) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    
    .mermaid {
      background: var(--vscode-editor-background);
      padding: 32px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      border: 1px solid var(--border-color);
      transform: scale(1);
      transition: transform 0.2s ease;
    }
    
    .legend {
      position: absolute;
      bottom: 24px;
      left: 24px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--border-color);
      padding: 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    
    .legend-title {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
      color: var(--vscode-descriptionForeground);
    }
    
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      margin-top: 4px;
    }
    
    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 3px;
    }
    
    .zoom-controls {
      position: absolute;
      bottom: 24px;
      right: 24px;
      display: flex;
      gap: 8px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--border-color);
      padding: 4px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="workflow-header">
    <div class="dai-stack-icon" style="width: 40px; height: 40px;">
      <div class="dai-stack-layer dai-layer-1" style="width: 30px; height: 30px;"></div>
      <div class="dai-stack-layer dai-layer-2" style="width: 30px; height: 30px;"></div>
      <div class="dai-stack-layer dai-layer-3" style="width: 30px; height: 30px;"></div>
    </div>
    <div>
      <h1 class="workflow-title">Pipeline do ZM1 Orchestrator</h1>
      <p class="workflow-subtitle">Rede determinística de agents autônomos</p>
    </div>
  </div>

  <div class="mermaid-container" id="zoom-container">
    <div class="mermaid">
      stateDiagram-v2
        %% Estilos
        classDef orch fill:#EC7000,stroke:#FFF,stroke-width:2px,color:#FFF,font-weight:bold
        classDef plan fill:#448AFF,stroke:#FFF,stroke-width:2px,color:#FFF,font-weight:bold
        classDef spec fill:#AB47BC,stroke:#FFF,stroke-width:2px,color:#FFF,font-weight:bold
        classDef guard fill:#00C853,stroke:#FFF,stroke-width:2px,color:#FFF,font-weight:bold
        
        %% Pipeline Principal
        [*] --> TRIAGE : Nova Task
        TRIAGE --> PLAN : Requer Decomposição?
        TRIAGE --> EXECUTE : Task Simples
        
        PLAN --> DESIGN : Arquitetura Nova?
        PLAN --> EXECUTE : Tasks Prontas
        
        DESIGN --> EXECUTE : ADR Aprovada
        
        state EXECUTE {
            Backend_Specialist
            Frontend_Specialist
            DB_Specialist
            DevOps_Specialist
        }
        
        EXECUTE --> VALIDATE : Deploy/Testes
        
        VALIDATE --> CRITIC : Necessita Review Crítico?
        VALIDATE --> EXECUTE : Testes Falharam
        VALIDATE --> DELIVER : Aprovado (Low Risk)
        
        CRITIC --> EXECUTE : Refatoração Exigida
        CRITIC --> DELIVER : LGTM (Aprovado)
        
        DELIVER --> REMEMBER : Extrair Aprendizados
        REMEMBER --> [*] : Sucesso
        
        %% Atribuição de classes
        class TRIAGE orch
        class DELIVER orch
        class PLAN plan
        class DESIGN spec
        class Backend_Specialist spec
        class Frontend_Specialist spec
        class DB_Specialist spec
        class DevOps_Specialist spec
        class VALIDATE guard
        class CRITIC guard
        class REMEMBER plan
    </div>
  </div>

  <div class="legend animate-slide-in" style="--delay: 0.5s">
    <div class="legend-title">Categoria do Agent</div>
    <div class="legend-item"><div class="legend-color" style="background: #EC7000"></div> Orchestrator</div>
    <div class="legend-item"><div class="legend-color" style="background: #448AFF"></div> Planner / Memory</div>
    <div class="legend-item"><div class="legend-color" style="background: #AB47BC"></div> Specialist</div>
    <div class="legend-item"><div class="legend-color" style="background: #00C853"></div> Guardian</div>
  </div>

  <div class="zoom-controls animate-slide-in" style="--delay: 0.6s">
    <button class="dai-btn dai-btn-ghost dai-btn-sm" id="zoom-out">-</button>
    <button class="dai-btn dai-btn-ghost dai-btn-sm" id="zoom-reset">100%</button>
    <button class="dai-btn dai-btn-ghost dai-btn-sm" id="zoom-in">+</button>
  </div>

  <script>
    // Inicializar Mermaid com tema adaptado ao VS Code
    const isDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
    
    mermaid.initialize({
      startOnLoad: true,
      theme: 'base',
      themeVariables: {
        background: 'transparent',
        primaryColor: 'var(--vscode-editor-background)',
        primaryTextColor: 'var(--vscode-editor-foreground)',
        primaryBorderColor: 'var(--vscode-editor-foreground)',
        lineColor: 'var(--vscode-descriptionForeground)',
        secondaryColor: 'var(--vscode-button-background)',
        tertiaryColor: 'var(--vscode-editor-background)'
      },
      state: {
        useMaxWidth: false,
      }
    });

    // Controles de Zoom simples
    let scale = 1;
    const mermaidEl = document.querySelector('.mermaid');
    
    document.getElementById('zoom-in').addEventListener('click', () => {
      scale = Math.min(scale + 0.1, 2);
      mermaidEl.style.transform = \`scale(\${scale})\`;
    });
    
    document.getElementById('zoom-out').addEventListener('click', () => {
      scale = Math.max(scale - 0.1, 0.5);
      mermaidEl.style.transform = \`scale(\${scale})\`;
    });
    
    document.getElementById('zoom-reset').addEventListener('click', () => {
      scale = 1;
      mermaidEl.style.transform = \`scale(\${scale})\`;
    });
  </script>
</body>
</html>`;
  }
}
