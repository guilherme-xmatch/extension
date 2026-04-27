/**
 * @module infrastructure/repositories/CatalogFetcher
 * @description Gerencia todas as operações de rede e Git para busca de dados do catálogo.
 * Encapsula validação de segurança de URLs, busca HTTPS e gerenciamento de clone local.
 * Injete esta classe para simular chamadas de rede em testes.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AppLogger } from '../services/AppLogger';
import { CatalogManifestParser } from './CatalogManifestParser';

const execAsync = promisify(exec);

export class CatalogFetcher {
  static readonly TRUSTED_REGISTRY_PREFIXES = [
    'https://github.com/guilherme-xmatch/DescomplicAI',
    'https://raw.githubusercontent.com/guilherme-xmatch/DescomplicAI',
  ];

  private readonly _logger = AppLogger.getInstance();

  constructor(private readonly allowUnsafeUrls: boolean = false) {}

  normalizeRepoUrl(value: string): string {
    return value.replace(/\.git$/i, '');
  }

  isSafeRemoteUrl(value: string): boolean {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') { return false; }
      if (this.allowUnsafeUrls) { return true; }
      const normalized = this.normalizeRepoUrl(`${url.origin}${url.pathname}`);
      return CatalogFetcher.TRUSTED_REGISTRY_PREFIXES.some(prefix =>
        normalized.startsWith(this.normalizeRepoUrl(prefix)));
    } catch {
      return false;
    }
  }

  assertTrustedRegistryUrl(url: string): void {
    if (!this.isSafeRemoteUrl(url)) {
      throw new Error('A URL do catálogo não é confiável. Ative "descomplicai.allowUnsafeRegistryUrls" apenas se souber o que está fazendo.');
    }
  }

  isLocalPath(value: string): boolean {
    if (!value) { return false; }
    if (value.startsWith('file://')) { return true; }
    return path.isAbsolute(value) || fs.existsSync(value);
  }

  isJsonEndpoint(url: string): boolean {
    return /\.json(\?|$)/i.test(url) || /raw\.githubusercontent\.com/i.test(url);
  }

  normalizeLocalPath(value: string): string {
    if (value.startsWith('file://')) {
      return decodeURIComponent(new URL(value).pathname).replace(/^\//, process.platform === 'win32' ? '' : '/');
    }
    return value;
  }

  async fetchJson(url: string): Promise<unknown> {
    if (!this.isSafeRemoteUrl(url)) {
      throw new Error(`URL remota não confiável ou sem HTTPS: ${url}`);
    }

    return new Promise((resolve, reject) => {
      https.get(url, response => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`Falha ao buscar catálogo remoto (${response.statusCode ?? 'sem status'}).`));
          response.resume();
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
          try { resolve(CatalogManifestParser.parseJsonWithComments(body)); }
          catch (error) { reject(error); }
        });
      }).on('error', reject);
    });
  }

  async ensureLocalClone(url: string, repoDir: string): Promise<void> {
    const gitDir = path.join(repoDir, '.git');
    if (!fs.existsSync(repoDir) || !fs.existsSync(gitDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
      await execAsync(`git clone --depth 1 ${this.quote(url)} ${this.quote(repoDir)}`);
      return;
    }

    try {
      const { stdout } = await execAsync('git config --get remote.origin.url', { cwd: repoDir });
      if (stdout.trim() !== url.trim()) {
        fs.rmSync(repoDir, { recursive: true, force: true });
        await execAsync(`git clone --depth 1 ${this.quote(url)} ${this.quote(repoDir)}`);
        return;
      }
      await execAsync('git pull --ff-only', { cwd: repoDir });
    } catch (error) {
      this._logger.warn('Falha ao atualizar clone local. Recriando cache.', { url, error });
      fs.rmSync(repoDir, { recursive: true, force: true });
      await execAsync(`git clone --depth 1 ${this.quote(url)} ${this.quote(repoDir)}`);
    }
  }

  private quote(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
}
