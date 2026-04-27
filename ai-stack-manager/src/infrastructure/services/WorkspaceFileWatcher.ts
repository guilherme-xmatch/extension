import * as vscode from 'vscode';

/**
 * Padrões glob que representam arquivos de pacotes DescomplicAI.
 * Qualquer criação / alteração / exclusão nesses arquivos dispara um refresh debounced do workspace.
 */
const FILE_PATTERNS: string[] = [
  '**/*.agent.md',
  '**/SKILL.md',
  '**/*.instructions.md',
  '**/mcp.json',
  '**/*.prompt.md',
];

/**
 * Observa arquivos de pacotes DescomplicAI no workspace e dispara um callback debounced
 * sempre que qualquer um deles é criado, modificado ou excluído.
 *
 * Uso:
 * ```ts
 * const watcher = new WorkspaceFileWatcher(async () => {
 *   await catalogProvider.refresh();
 *   await installedProvider.refresh();
 * });
 * context.subscriptions.push(watcher);
 * ```
 */
export class WorkspaceFileWatcher implements vscode.Disposable {
  private readonly _disposables: vscode.Disposable[] = [];
  private _timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly _onFilesChanged: () => Promise<void>,
    private readonly _debounceMs: number = 500,
  ) {
    for (const pattern of FILE_PATTERNS) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      this._disposables.push(
        watcher,
        watcher.onDidCreate(() => { this._schedule(); }),
        watcher.onDidChange(() => { this._schedule(); }),
        watcher.onDidDelete(() => { this._schedule(); }),
      );
    }
  }

  /** Reinicia o timer de debounce a cada evento de arquivo. */
  private _schedule(): void {
    if (this._timer !== undefined) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => {
      this._timer = undefined;
      void this._onFilesChanged();
    }, this._debounceMs);
  }

  dispose(): void {
    if (this._timer !== undefined) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }
}
