import * as vscode from 'vscode';
import { IOperationCoordinator } from '../../domain/interfaces';
import { OperationSnapshot } from '../../domain/entities/Operation';

export class StatusBarManager {
  private static instance?: StatusBarManager;
  private statusBarItem: vscode.StatusBarItem;
  private resetTimer?: ReturnType<typeof setTimeout>;
  private operationSubscription?: vscode.Disposable;

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
    this.scheduleReset(3000);
  }

  public setError(message: string): void {
    this.statusBarItem.text = `$(error) ZM1: ${message}`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.scheduleReset(5000);
  }

  public bindToCoordinator(coordinator: IOperationCoordinator): void {
    this.operationSubscription?.dispose();
    this.operationSubscription = coordinator.onDidChangeCurrentOperation(snapshot => {
      if (!snapshot) {
        this.setIdle();
        return;
      }

      this.setWorking(this.describeOperation(snapshot));
    });
  }

  public dispose(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
    this.operationSubscription?.dispose();
    this.operationSubscription = undefined;
    this.statusBarItem.dispose();
    StatusBarManager.instance = undefined;
  }

  private scheduleReset(delayMs: number): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }

    this.resetTimer = setTimeout(() => {
      this.resetTimer = undefined;
      this.setIdle();
    }, delayMs);
  }

  private describeOperation(snapshot: OperationSnapshot): string {
    const progressSuffix = typeof snapshot.progress === 'number' ? ` (${snapshot.progress}%)` : '';
    const detail = snapshot.message ? ` — ${snapshot.message}` : '';
    return `${snapshot.label}${progressSuffix}${detail}`;
  }
}
