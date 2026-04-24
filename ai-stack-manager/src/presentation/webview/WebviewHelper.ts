/**
 * @module presentation/webview/WebviewHelper
 * @description Shared utility for generating webview HTML with Itaú design system.
 * Handles theme-aware CSS, nonce generation, and resource URI resolution.
 */

import * as vscode from 'vscode';

/** Itaú Design Tokens */
export const ITAU_TOKENS = {
  colors: {
    primary: '#EC7000',
    primaryLight: '#FF9A3C',
    primaryDark: '#C45D00',
    navy: '#003366',
    navyLight: '#1B3A5C',
    navyDark: '#001F3F',
    success: '#00C853',
    warning: '#FFB300',
    error: '#FF5252',
    info: '#448AFF',
    agent: '#EC7000',
    skill: '#448AFF',
    mcp: '#00C853',
    instruction: '#AB47BC',
    prompt: '#FFB300',
  },
};

export class WebviewHelper {

  /** Generate a cryptographic nonce for Content Security Policy */
  static getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /** Build the full HTML document for a webview */
  static buildHtml(params: {
    webview: vscode.Webview;
    extensionUri: vscode.Uri;
    title: string;
    bodyContent: string;
    scriptContent?: string;
  }): string {
    const { webview, title, bodyContent, scriptContent } = params;
    const nonce = WebviewHelper.getNonce();

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(params.extensionUri, 'media', 'webview', 'main.css')
    );
    const animationsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(params.extensionUri, 'media', 'webview', 'animations.css')
    );

    return /*html*/`<!DOCTYPE html>
<html lang="pt-BR" data-vscode-theme-kind="">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <title>${title}</title>
  <link rel="stylesheet" href="${styleUri}">
  <link rel="stylesheet" href="${animationsUri}">
  <style nonce="${nonce}">
    :root {
      --itau-primary: ${ITAU_TOKENS.colors.primary};
      --itau-primary-light: ${ITAU_TOKENS.colors.primaryLight};
      --itau-primary-dark: ${ITAU_TOKENS.colors.primaryDark};
      --itau-navy: ${ITAU_TOKENS.colors.navy};
      --itau-navy-light: ${ITAU_TOKENS.colors.navyLight};
      --itau-navy-dark: ${ITAU_TOKENS.colors.navyDark};
      --itau-success: ${ITAU_TOKENS.colors.success};
      --itau-warning: ${ITAU_TOKENS.colors.warning};
      --itau-error: ${ITAU_TOKENS.colors.error};
      --itau-info: ${ITAU_TOKENS.colors.info};
      --type-agent: ${ITAU_TOKENS.colors.agent};
      --type-skill: ${ITAU_TOKENS.colors.skill};
      --type-mcp: ${ITAU_TOKENS.colors.mcp};
      --type-instruction: ${ITAU_TOKENS.colors.instruction};
      --type-prompt: ${ITAU_TOKENS.colors.prompt};
    }
  </style>
</head>
<body>
  ${bodyContent}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    ${scriptContent ?? ''}
  </script>
</body>
</html>`;
  }
}
