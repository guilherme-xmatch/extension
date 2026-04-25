import * as vscode from 'vscode';
import * as https from 'https';
import { Package } from '../../domain/entities/Package';
import { IInstallTracker } from '../../domain/interfaces';

interface GitHubUser {
  login?: string;
}

export class GitHubMetricsService implements IInstallTracker {
  private readonly authProviderId = 'github';

  async trackInstall(pkg: Package): Promise<void> {
    const config = vscode.workspace.getConfiguration('descomplicai');
    const enabled = config.get<boolean>('metrics.enabled', false);
    if (!enabled) { return; }

    const owner = config.get<string>('metrics.collectorOwner', '').trim();
    const repo = config.get<string>('metrics.collectorRepo', '').trim();
    if (!owner || !repo) { return; }

    try {
      const session = await vscode.authentication.getSession(this.authProviderId, ['read:user', 'public_repo'], { createIfNone: true });
      if (!session) { return; }

      const user = await this.fetchJson<GitHubUser>('https://api.github.com/user', session.accessToken);
      const event = {
        packageId: pkg.id,
        packageName: pkg.name,
        version: pkg.version.toString(),
        type: pkg.type.value,
        source: pkg.source,
        installedAt: new Date().toISOString(),
        installer: user.login,
      };

      await this.requestJson(
        'POST',
        `https://api.github.com/repos/${owner}/${repo}/issues`,
        session.accessToken,
        {
          title: `install:${pkg.id}:${Date.now()}`,
          body: [
            'Automated install event from DescomplicAI.',
            '',
            '```json',
            JSON.stringify(event, null, 2),
            '```',
          ].join('\n'),
          labels: ['install-event', `package:${pkg.type.value}`],
        },
      );
    } catch (error) {
      console.warn('Falha ao registrar métrica no GitHub:', error);
    }
  }

  private async fetchJson<T>(url: string, token: string): Promise<T> {
    return this.requestJson<T>('GET', url, token);
  }

  private async requestJson<T>(method: string, url: string, token: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method,
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'DescomplicAI',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      }, response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          if (!response.statusCode || response.statusCode >= 400) {
            reject(new Error(`GitHub API ${response.statusCode ?? 'unknown'}: ${data}`));
            return;
          }
          resolve((data ? JSON.parse(data) : {}) as T);
        });
      });

      req.on('error', reject);
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
}