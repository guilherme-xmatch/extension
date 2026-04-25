import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StatusBarManager } from './StatusBarManager';
import { GitRegistry } from '../repositories/GitRegistry';
import { Package } from '../../domain/entities/Package';
import { PackageType } from '../../domain/value-objects/PackageType';

interface ParsedMcpDocument {
  servers: Record<string, unknown>;
  inputs: Array<{ id: string; [key: string]: unknown }>;
}

export class PublishService {
  private get contributionsDir(): string {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    return path.join(home, '.descomplicai', 'contributions');
  }

  public async importCustomMcp(fileUri: vscode.Uri, registry: GitRegistry): Promise<Package[]> {
    const statusBar = StatusBarManager.getInstance();
    statusBar.setWorking('Importando MCP customizado...');

    try {
      const document = this.readMcpDocument(fileUri.fsPath);
      const packages = Object.entries(document.servers).map(([serverName, serverConfig]) =>
        this.buildCustomMcpPackage(serverName, serverConfig, document.inputs)
      );

      for (const pkg of packages) {
        await registry.saveWorkspaceCustomPackage(pkg);
      }

      statusBar.setSuccess('MCP importado');
      return packages;
    } catch (error) {
      statusBar.setError('Falha ao importar MCP');
      throw error;
    }
  }

  public async publishPackage(fileUri: vscode.Uri): Promise<void> {
    const statusBar = StatusBarManager.getInstance();
    statusBar.setWorking('Gerando artefato de contribuição...');

    try {
      const document = this.readMcpDocument(fileUri.fsPath);
      const timestamp = Date.now();
      const artifactRoot = path.join(this.contributionsDir, `mcp-contribution-${timestamp}`);
      fs.mkdirSync(artifactRoot, { recursive: true });

      for (const [serverName, serverConfig] of Object.entries(document.servers)) {
        const slug = this.slugify(serverName);
        const packageRoot = path.join(artifactRoot, 'mcps', slug);
        fs.mkdirSync(packageRoot, { recursive: true });

        const pkg = this.buildCustomMcpPackage(serverName, serverConfig, document.inputs);
        const manifest = this.serializeContributionManifest(pkg, slug);
        const details = [
          `# ${pkg.displayName}`,
          '',
          pkg.ui.longDescription ?? pkg.description,
          '',
          '## Instalação',
          '',
          ...pkg.ui.installNotes.map(note => `- ${note}`),
          '',
          '## Highlights',
          '',
          ...pkg.ui.highlights.map(item => `- ${item}`),
        ].join('\n');
        const readme = [
          `# ${pkg.displayName}`,
          '',
          pkg.description,
          '',
          '## Tipo',
          '',
          '- MCP Server',
          '- Origem: contribuição gerada pelo AI Stack Manager',
          '',
          '## Arquivos',
          '',
          '- manifest.json',
          '- mcp.json',
          '- README.md',
          '- details.md',
        ].join('\n');

        fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
        fs.writeFileSync(path.join(packageRoot, 'mcp.json'), JSON.stringify({ servers: { [serverName]: serverConfig }, inputs: document.inputs }, null, 2), 'utf-8');
        fs.writeFileSync(path.join(packageRoot, 'README.md'), readme, 'utf-8');
        fs.writeFileSync(path.join(packageRoot, 'details.md'), details, 'utf-8');
      }

      statusBar.setSuccess('Artefato gerado');
      await vscode.window.showInformationMessage(
        'Artefato de contribuição gerado com sucesso.',
        'Abrir pasta',
        'Abrir repositório oficial',
      ).then(async choice => {
        if (choice === 'Abrir pasta') {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(artifactRoot));
        }
        if (choice === 'Abrir repositório oficial') {
          await vscode.env.openExternal(vscode.Uri.parse('https://github.com/guilherme-xmatch/DescomplicAI'));
        }
      });
    } catch (error: any) {
      statusBar.setError('Falha ao publicar');
      vscode.window.showErrorMessage(`Falha na publicação: ${error.message}`);
    }
  }

  private serializeContributionManifest(pkg: Package, slug: string): Record<string, unknown> {
    return {
      id: pkg.id,
      name: pkg.name,
      displayName: pkg.displayName,
      description: pkg.description,
      type: pkg.type.value,
      version: pkg.version.toString(),
      tags: [...pkg.tags],
      author: pkg.author,
      install: {
        strategy: 'mcp-merge',
        targets: [
          {
            source: 'mcp.json',
            target: '.vscode/mcp.json',
            mergeStrategy: 'merge-mcp-servers',
          },
        ],
      },
      source: {
        official: true,
        packagePath: `mcps/${slug}`,
        readmePath: 'README.md',
        detailsPath: 'details.md',
      },
      ui: {
        longDescription: pkg.ui.longDescription,
        highlights: [...pkg.ui.highlights],
        installNotes: [...pkg.ui.installNotes],
        badges: [...pkg.ui.badges],
        maturity: pkg.ui.maturity,
      },
      docs: {
        readmePath: 'README.md',
        detailsPath: 'details.md',
        links: [],
      },
      stats: {
        installsTotal: 0,
      },
    };
  }

  private buildCustomMcpPackage(serverName: string, serverConfig: unknown, inputs: ParsedMcpDocument['inputs']): Package {
    const slug = this.slugify(serverName);
    const description = this.describeServer(serverName, serverConfig);
    const content = JSON.stringify({ servers: { [serverName]: serverConfig }, inputs }, null, 2);

    return Package.create({
      id: `mcp-${slug}`,
      name: `${slug}-mcp`,
      displayName: `${this.toDisplayName(serverName)} MCP`,
      description,
      type: PackageType.MCP,
      version: '1.0.0',
      tags: ['mcp', 'custom', 'community'],
      author: 'Workspace Author',
      files: [{ relativePath: '.vscode/mcp.json', content }],
      source: {
        official: false,
        packagePath: `.descomplicai/custom/${slug}`,
      },
      installStrategy: {
        kind: 'mcp-merge',
        targets: [{ targetPath: '.vscode/mcp.json', mergeStrategy: 'merge-mcp-servers' }],
      },
      ui: {
        longDescription: description,
        highlights: [
          'Importado do workspace local',
          'Compatível com o catálogo público novo',
          'Pronto para contribuição via manifest',
        ],
        installNotes: [
          'O conteúdo será mesclado em .vscode/mcp.json',
          'O pacote ficará visível no catálogo como item local/customizado',
        ],
        badges: ['Custom MCP'],
        maturity: 'beta',
      },
      docs: {
        details: description,
        readme: description,
        links: [],
      },
      stats: {
        installsTotal: 0,
      },
    });
  }

  private readMcpDocument(filePath: string): ParsedMcpDocument {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = this.parseJsonWithComments(content) as {
      servers?: Record<string, unknown>;
      mcpServers?: Record<string, unknown>;
      inputs?: Array<{ id: string; [key: string]: unknown }>;
    };

    const servers = parsed.servers || parsed.mcpServers || {};
    if (Object.keys(servers).length === 0) {
      throw new Error('O arquivo mcp.json não possui servidores válidos.');
    }

    return {
      servers,
      inputs: Array.isArray(parsed.inputs)
        ? parsed.inputs.filter((input): input is { id: string; [key: string]: unknown } => Boolean(input) && typeof input.id === 'string')
        : [],
    };
  }

  private parseJsonWithComments(content: string): unknown {
    const sanitized = content
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();

    return sanitized ? JSON.parse(sanitized) : {};
  }

  private describeServer(serverName: string, serverConfig: unknown): string {
    if (serverConfig && typeof serverConfig === 'object') {
      const config = serverConfig as Record<string, unknown>;
      if (typeof config.url === 'string') {
        return `${this.toDisplayName(serverName)} expõe um MCP remoto em ${config.url}.`;
      }
      if (typeof config.command === 'string') {
        return `${this.toDisplayName(serverName)} executa localmente o comando ${config.command}.`;
      }
    }
    return `${this.toDisplayName(serverName)} é um MCP customizado importado pelo usuário.`;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-') || 'custom-mcp';
  }

  private toDisplayName(value: string): string {
    return value
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, char => char.toUpperCase());
  }
}
