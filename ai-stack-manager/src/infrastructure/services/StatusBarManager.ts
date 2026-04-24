import * as vscode from 'vscode';

export class StatusBarManager {
  private static instance: StatusBarManager;
  private statusBarItem: vscode.StatusBarItem;

  private constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'dai.openInsights';
    this.statusBarItem.tooltip = 'DescomplicAI: Orquestrador ZM1';
    this.setIdle();
    this.statusBarItem.show();
  }

  public static getInstance(): StatusBarManager {
    if (!StatusBarManager.instance) {
      StatusBarManager.instance = new StatusBarManager();
    }
    return StatusBarManager.instance;
  }

  public setIdle(): void {
    this.statusBarItem.text = '$(hubot) ZM1: Idle';
    this.statusBarItem.backgroundColor = undefined;
  }

  public setWorking(task: string): void {
    this.statusBarItem.text = `$(sync~spin) ZM1: ${task}`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  public setSuccess(message: string): void {
    this.statusBarItem.text = `$(check) ZM1: ${message}`;
    this.statusBarItem.backgroundColor = undefined;
    setTimeout(() => this.setIdle(), 3000);
  }

  public setError(message: string): void {
    this.statusBarItem.text = `$(error) ZM1: ${message}`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    setTimeout(() => this.setIdle(), 5000);
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
