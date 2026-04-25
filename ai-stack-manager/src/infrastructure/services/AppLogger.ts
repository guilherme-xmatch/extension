import * as vscode from 'vscode';

export class AppLogger implements vscode.Disposable {
  private static _instance?: AppLogger;

  private readonly _channel: vscode.LogOutputChannel;

  private constructor() {
    this._channel = vscode.window.createOutputChannel('DescomplicAI', { log: true });
  }

  public static getInstance(): AppLogger {
    if (!AppLogger._instance) {
      AppLogger._instance = new AppLogger();
    }

    return AppLogger._instance;
  }

  public debug(message: string, data?: unknown): void {
    this._channel.debug(this.formatMessage(message, data));
  }

  public info(message: string, data?: unknown): void {
    this._channel.info(this.formatMessage(message, data));
  }

  public warn(message: string, data?: unknown): void {
    this._channel.warn(this.formatMessage(message, data));
  }

  public error(message: string, data?: unknown): void {
    this._channel.error(this.formatMessage(message, data));
  }

  public show(preserveFocus = true): void {
    this._channel.show(preserveFocus);
  }

  public dispose(): void {
    this._channel.dispose();
    AppLogger._instance = undefined;
  }

  private formatMessage(message: string, data?: unknown): string {
    if (data === undefined) {
      return message;
    }

    return `${message} ${this.safeSerialize(data)}`;
  }

  private safeSerialize(value: unknown): string {
    try {
      return JSON.stringify(value, (_key, current) => {
        if (current instanceof Error) {
          return {
            name: current.name,
            message: current.message,
            stack: current.stack,
          };
        }

        return current;
      });
    } catch {
      return String(value);
    }
  }
}