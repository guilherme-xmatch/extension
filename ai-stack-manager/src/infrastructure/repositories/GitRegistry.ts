import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Package } from '../../domain/entities/Package';
import { Bundle } from '../../domain/entities/Bundle';
import { IPackageRepository } from '../../domain/interfaces';
import { LocalRegistry } from './LocalRegistry'; // Fallback
import { PackageType } from '../../domain/value-objects/PackageType';
import { AgentCategory } from '../../domain/value-objects/AgentCategory';
import { PackageTag } from '../../domain/entities/Package';

const execAsync = promisify(exec);

export class GitRegistry implements IPackageRepository {
  private _cache: Package[] = [];
  private _bundlesCache: Bundle[] = [];
  private _initialized = false;
  private readonly _fallbackRegistry = new LocalRegistry();

  private get cacheDir(): string {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    return path.join(home, '.descomplicai', 'registry');
  }

  private get repoDir(): string {
    return path.join(this.cacheDir, 'repo');
  }

  private get registryUrl(): string {
    const config = vscode.workspace.getConfiguration('descomplicai');
    return (config.get<string>('registryUrl') || '').trim();
  }

  public async sync(): Promise<void> {
    const url = this.registryUrl;
    if (!url) {
      await this.loadFallback();
      return;
    }

    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });

      if (this.isJsonEndpoint(url)) {
        await this.loadFromJsonEndpoint(url);
      } else {
        await this.ensureLocalClone(url);
        await this.loadFromDisk(this.repoDir);
      }

      this._initialized = true;
    } catch (e) {
      console.error('Falha ao sincronizar o GitRegistry. Usando fallback local.', e);
      await this.loadFallback();
    }
  }

  private async loadFallback(): Promise<void> {
    this._cache = await this._fallbackRegistry.getAll();
    this._bundlesCache = await this._fallbackRegistry.getAllBundles();
    this._initialized = true;
  }

  private async ensureLocalClone(url: string): Promise<void> {
    if (!fs.existsSync(this.repoDir) || !fs.existsSync(path.join(this.repoDir, '.git'))) {
      fs.rmSync(this.repoDir, { recursive: true, force: true });
      await execAsync(`git clone --depth 1 ${this.quote(url)} ${this.quote(this.repoDir)}`);
      return;
    }

    try {
      const { stdout } = await execAsync('git config --get remote.origin.url', { cwd: this.repoDir });
      if (stdout.trim() !== url.trim()) {
        fs.rmSync(this.repoDir, { recursive: true, force: true });
        await execAsync(`git clone --depth 1 ${this.quote(url)} ${this.quote(this.repoDir)}`);
        return;
      }

      await execAsync('git pull --ff-only', { cwd: this.repoDir });
    } catch {
      fs.rmSync(this.repoDir, { recursive: true, force: true });
      await execAsync(`git clone --depth 1 ${this.quote(url)} ${this.quote(this.repoDir)}`);
    }
  }

  private async loadFromJsonEndpoint(url: string): Promise<void> {
    const payload = await this.fetchJson(url);
    const manifest = typeof payload === 'object' && payload ? payload as Record<string, unknown> : {};
    const rawPackages = Array.isArray(manifest.packages) ? manifest.packages : [];
    const rawBundles = Array.isArray(manifest.bundles) ? manifest.bundles : [];

    this._cache = rawPackages
      .map(pkg => this.packageFromManifest(pkg))
      .filter((pkg): pkg is Package => Boolean(pkg));

    this._bundlesCache = rawBundles
      .map(bundle => this.bundleFromManifest(bundle))
      .filter((bundle): bundle is Bundle => Boolean(bundle));

    if (this._cache.length === 0) {
      throw new Error('Registry JSON não contém pacotes válidos.');
    }
  }

  private async loadFromDisk(rootDir: string): Promise<void> {
    const packages: Package[] = [];

    packages.push(...this.loadAgents(rootDir));
    packages.push(...this.loadSkills(rootDir));
    packages.push(...this.loadInstructions(rootDir));
    packages.push(...this.loadPrompts(rootDir));
    packages.push(...this.loadMcpPackages(rootDir));

    if (packages.length === 0) {
      throw new Error('Nenhum pacote válido foi encontrado no registry remoto.');
    }

    this._cache = packages;
    this._bundlesCache = this.loadBundles(rootDir);
  }

  private loadAgents(rootDir: string): Package[] {
    const agentsDir = path.join(rootDir, '.github', 'agents');
    if (!fs.existsSync(agentsDir)) { return []; }

    return this.collectFiles(agentsDir, file => file.endsWith('.agent.md')).map(filePath => {
      const relativePath = this.toRelativePath(rootDir, filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      const frontmatter = this.parseFrontmatter(content);
      const rawName = this.asString(frontmatter['name']) || path.basename(filePath, '.agent.md');
      const normalizedName = this.slugify(rawName);
      const description = this.asString(frontmatter['description']) || this.extractBodyExcerpt(content) || `${this.toDisplayName(normalizedName)} agent`;
      const tools = this.asStringArray(frontmatter['tools']);
      const delegatesTo = this.asStringArray(frontmatter['agents']);
      const category = this.inferAgentCategory(normalizedName, description);

      return Package.create({
        id: `agent-${normalizedName}`,
        name: normalizedName,
        displayName: this.toDisplayName(rawName),
        description,
        type: PackageType.Agent,
        version: this.asString(frontmatter['version']) || '1.0.0',
        tags: this.inferTags(`${normalizedName} ${description}`, 'agent'),
        author: this.registryAuthor,
        files: [{ relativePath, content }],
        dependencies: delegatesTo.map(delegate => delegate.startsWith('agent-') ? delegate : `agent-${this.slugify(delegate)}`),
        agentMeta: {
          category,
          tools,
          delegatesTo,
          workflowPhase: this.inferWorkflowPhase(category, normalizedName),
          userInvocable: this.asBoolean(frontmatter['user-invocable'], true),
          relatedSkills: [],
        },
      });
    });
  }

  private loadSkills(rootDir: string): Package[] {
    const skillsDir = path.join(rootDir, '.github', 'skills');
    if (!fs.existsSync(skillsDir)) { return []; }

    return this.collectFiles(skillsDir, file => path.basename(file) === 'SKILL.md').map(filePath => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const frontmatter = this.parseFrontmatter(content);
      const skillDir = path.basename(path.dirname(filePath));
      const rawName = this.asString(frontmatter['name']) || skillDir;
      const normalizedName = this.slugify(rawName);
      const description = this.asString(frontmatter['description']) || this.extractBodyExcerpt(content) || `${this.toDisplayName(normalizedName)} skill`;

      return Package.create({
        id: `skill-${normalizedName}`,
        name: normalizedName,
        displayName: this.toDisplayName(rawName),
        description,
        type: PackageType.Skill,
        version: this.asString(frontmatter['version']) || '1.0.0',
        tags: this.inferTags(`${normalizedName} ${description}`, 'skill'),
        author: this.registryAuthor,
        files: [{ relativePath: this.toRelativePath(rootDir, filePath), content }],
      });
    });
  }

  private loadInstructions(rootDir: string): Package[] {
    const instructionsDir = path.join(rootDir, '.github', 'instructions');
    if (!fs.existsSync(instructionsDir)) { return []; }

    return this.collectFiles(instructionsDir, file => file.endsWith('.instructions.md')).map(filePath => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const name = path.basename(filePath, '.instructions.md');
      return Package.create({
        id: `instruction-${this.slugify(name)}`,
        name: this.slugify(name),
        displayName: this.toDisplayName(name),
        description: this.extractBodyExcerpt(content) || `Instruções para ${this.toDisplayName(name)}`,
        type: PackageType.Instruction,
        version: '1.0.0',
        tags: ['core', 'workflow'],
        author: this.registryAuthor,
        files: [{ relativePath: this.toRelativePath(rootDir, filePath), content }],
      });
    });
  }

  private loadPrompts(rootDir: string): Package[] {
    const promptsDir = path.join(rootDir, '.github', 'prompts');
    if (!fs.existsSync(promptsDir)) { return []; }

    return this.collectFiles(promptsDir, file => file.endsWith('.prompt.md')).map(filePath => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const frontmatter = this.parseFrontmatter(content);
      const rawName = this.asString(frontmatter['name']) || path.basename(filePath, '.prompt.md');
      const normalizedName = this.slugify(rawName);
      const description = this.asString(frontmatter['description']) || this.extractBodyExcerpt(content) || `${this.toDisplayName(normalizedName)} prompt`;

      return Package.create({
        id: `prompt-${normalizedName}`,
        name: normalizedName,
        displayName: this.toDisplayName(rawName),
        description,
        type: PackageType.Prompt,
        version: this.asString(frontmatter['version']) || '1.0.0',
        tags: ['workflow'],
        author: this.registryAuthor,
        files: [{ relativePath: this.toRelativePath(rootDir, filePath), content }],
      });
    });
  }

  private loadMcpPackages(rootDir: string): Package[] {
    const mcpPath = path.join(rootDir, '.vscode', 'mcp.json');
    if (!fs.existsSync(mcpPath)) { return []; }

    try {
      const content = fs.readFileSync(mcpPath, 'utf-8');
      const parsed = this.parseJsonWithComments(content) as { servers?: Record<string, unknown>; mcpServers?: Record<string, unknown> };
      const servers = parsed.servers || parsed.mcpServers || {};

      return Object.entries(servers).map(([serverName, serverConfig]) => {
        const displayName = `${this.toDisplayName(serverName)} MCP`;
        const packageContent = JSON.stringify({ servers: { [serverName]: serverConfig } }, null, 2);
        const description = this.describeMcpServer(serverName, serverConfig);

        return Package.create({
          id: `mcp-${this.slugify(serverName)}`,
          name: `${this.slugify(serverName)}-mcp`,
          displayName,
          description,
          type: PackageType.MCP,
          version: '1.0.0',
          tags: this.inferTags(`${serverName} ${description}`, 'mcp'),
          author: this.registryAuthor,
          files: [{ relativePath: '.vscode/mcp.json', content: packageContent }],
        });
      });
    } catch {
      return [];
    }
  }

  private loadBundles(rootDir: string): Bundle[] {
    const candidates = [
      path.join(rootDir, 'descomplicai-registry.json'),
      path.join(rootDir, 'descomplicai.bundles.json'),
      path.join(rootDir, '.github', 'descomplicai-registry.json'),
      path.join(rootDir, '.github', 'bundles.json'),
    ];

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) { continue; }

      try {
        const parsed = this.parseJsonWithComments(fs.readFileSync(candidate, 'utf-8')) as Record<string, unknown>;
        const rawBundles = Array.isArray(parsed.bundles) ? parsed.bundles : Array.isArray(parsed) ? parsed : [];
        const bundles = rawBundles
          .map(bundle => this.bundleFromManifest(bundle))
          .filter((bundle): bundle is Bundle => Boolean(bundle));

        if (bundles.length > 0) {
          return bundles;
        }
      } catch {
        // Ignore malformed bundle manifests and keep trying other candidates.
      }
    }

    return [];
  }

  private packageFromManifest(input: unknown): Package | undefined {
    if (!input || typeof input !== 'object') { return undefined; }

    const pkg = input as Record<string, unknown>;
    const type = this.asString(pkg.type);
    if (!type) { return undefined; }

    try {
      return Package.create({
        id: this.asString(pkg.id) || `${type}-${this.slugify(this.asString(pkg.name) || this.asString(pkg.displayName) || 'package')}`,
        name: this.slugify(this.asString(pkg.name) || this.asString(pkg.displayName) || 'package'),
        displayName: this.asString(pkg.displayName) || this.toDisplayName(this.asString(pkg.name) || 'Package'),
        description: this.asString(pkg.description) || 'Pacote remoto do registry',
        type: PackageType.fromString(type),
        version: this.asString(pkg.version) || '1.0.0',
        tags: this.asStringArray(pkg.tags).filter(this.isPackageTag),
        author: this.asString(pkg.author) || this.registryAuthor,
        files: this.asManifestFiles(pkg.files),
        dependencies: this.asStringArray(pkg.dependencies),
        agentMeta: type === 'agent'
          ? {
              category: AgentCategory.fromString(this.asString((pkg.agentMeta as Record<string, unknown> | undefined)?.category) || 'specialist'),
              tools: this.asStringArray((pkg.agentMeta as Record<string, unknown> | undefined)?.tools),
              delegatesTo: this.asStringArray((pkg.agentMeta as Record<string, unknown> | undefined)?.delegatesTo),
              workflowPhase: this.asString((pkg.agentMeta as Record<string, unknown> | undefined)?.workflowPhase) || 'EXECUTION',
              userInvocable: this.asBoolean((pkg.agentMeta as Record<string, unknown> | undefined)?.userInvocable, false),
              relatedSkills: this.asStringArray((pkg.agentMeta as Record<string, unknown> | undefined)?.relatedSkills),
            }
          : undefined,
      });
    } catch {
      return undefined;
    }
  }

  private bundleFromManifest(input: unknown): Bundle | undefined {
    if (!input || typeof input !== 'object') { return undefined; }

    const bundle = input as Record<string, unknown>;
    const packageIds = this.asStringArray(bundle.packageIds);
    if (packageIds.length === 0) { return undefined; }

    try {
      return Bundle.create({
        id: this.asString(bundle.id) || `bundle-${this.slugify(this.asString(bundle.name) || this.asString(bundle.displayName) || 'bundle')}`,
        name: this.slugify(this.asString(bundle.name) || this.asString(bundle.displayName) || 'bundle'),
        displayName: this.asString(bundle.displayName) || this.toDisplayName(this.asString(bundle.name) || 'Bundle'),
        description: this.asString(bundle.description) || 'Bundle remoto do registry',
        version: this.asString(bundle.version) || '1.0.0',
        packageIds,
        color: this.asString(bundle.color) || '#EC7000',
      });
    } catch {
      return undefined;
    }
  }

  private asManifestFiles(input: unknown): Array<{ relativePath: string; content: string }> {
    if (!Array.isArray(input)) { return []; }
    return input.flatMap(file => {
      if (!file || typeof file !== 'object') { return []; }
      const item = file as Record<string, unknown>;
      const relativePath = this.asString(item.relativePath);
      const content = this.asString(item.content);
      return relativePath && typeof content === 'string' ? [{ relativePath, content }] : [];
    });
  }

  private collectFiles(baseDir: string, predicate: (filePath: string) => boolean): string[] {
    if (!fs.existsSync(baseDir)) { return []; }

    const results: string[] = [];
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      const fullPath = path.join(baseDir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.collectFiles(fullPath, predicate));
      } else if (predicate(fullPath)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  private parseFrontmatter(content: string): Record<string, unknown> {
    const lines = content.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') { return {}; }

    const result: Record<string, unknown> = {};
    let index = 1;

    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === '---') {
        break;
      }

      const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (!match) {
        index++;
        continue;
      }

      const [, key, rawValue] = match;

      if (rawValue === '>' || rawValue === '|') {
        const parts: string[] = [];
        index++;
        while (index < lines.length && (lines[index].trim() === '' || /^\s+/.test(lines[index]))) {
          parts.push(lines[index].replace(/^\s+/, ''));
          index++;
        }
        result[key] = parts.join(rawValue === '>' ? ' ' : '\n').trim();
        continue;
      }

      if (rawValue === '') {
        const values: string[] = [];
        index++;
        while (index < lines.length) {
          const current = lines[index].trim();
          if (current === '') {
            index++;
            continue;
          }
          if (!current.startsWith('- ')) {
            break;
          }
          values.push(this.unquote(current.slice(2).trim()));
          index++;
        }
        result[key] = values;
        continue;
      }

      result[key] = this.parseScalar(rawValue);
      index++;
    }

    return result;
  }

  private parseScalar(value: string): unknown {
    const trimmed = value.trim();
    if (trimmed === 'true') { return true; }
    if (trimmed === 'false') { return false; }
    if (trimmed === '[]') { return []; }
    if (/^\[(.*)\]$/.test(trimmed)) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) { return []; }
      return inner.split(',').map(item => this.unquote(item.trim())).filter(Boolean);
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
    return this.unquote(trimmed);
  }

  private extractBodyExcerpt(content: string): string {
    const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/m, '');
    const lines = withoutFrontmatter
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    return lines[0] || '';
  }

  private parseJsonWithComments(content: string): unknown {
    const sanitized = content
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    return JSON.parse(sanitized);
  }

  private async fetchJson(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`Falha ao buscar registry remoto (${response.statusCode ?? 'sem status'}).`));
          response.resume();
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
          try {
            resolve(this.parseJsonWithComments(body));
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', reject);
    });
  }

  private get registryAuthor(): string {
    const match = /github\.com[/:]([^/]+)\//i.exec(this.registryUrl);
    return match?.[1] || 'External Registry';
  }

  private describeMcpServer(serverName: string, serverConfig: unknown): string {
    if (!serverConfig || typeof serverConfig !== 'object') {
      return `${this.toDisplayName(serverName)} MCP server`;
    }

    const config = serverConfig as Record<string, unknown>;
    if (typeof config.url === 'string') {
      return `${this.toDisplayName(serverName)} MCP remoto em ${config.url}`;
    }
    if (typeof config.command === 'string') {
      return `${this.toDisplayName(serverName)} MCP via comando ${config.command}`;
    }
    return `${this.toDisplayName(serverName)} MCP server`;
  }

  private inferAgentCategory(name: string, description: string): AgentCategory {
    const text = `${name} ${description}`.toLowerCase();
    if (text.includes('orchestr')) { return AgentCategory.Orchestrator; }
    if (text.includes('planner') || text.includes('planej')) { return AgentCategory.Planner; }
    if (text.includes('review') || text.includes('critic') || text.includes('test') || text.includes('guard')) { return AgentCategory.Guardian; }
    if (text.includes('memory') || text.includes('memória') || text.includes('remember')) { return AgentCategory.Memory; }
    return AgentCategory.Specialist;
  }

  private inferWorkflowPhase(category: AgentCategory, name: string): string {
    if (category.equals(AgentCategory.Orchestrator)) { return 'TRIAGE'; }
    if (category.equals(AgentCategory.Planner)) { return 'PLAN'; }
    if (category.equals(AgentCategory.Memory)) { return 'REMEMBER'; }
    const lowered = name.toLowerCase();
    if (lowered.includes('architect')) { return 'DESIGN'; }
    if (lowered.includes('test')) { return 'VALIDATION'; }
    if (lowered.includes('review') || lowered.includes('critic')) { return 'CRITIC'; }
    return 'EXECUTION';
  }

  private inferTags(text: string, kind: 'agent' | 'skill' | 'mcp' | 'instruction' | 'prompt'): PackageTag[] {
    const lowered = text.toLowerCase();
    const tags = new Set<PackageTag>();

    if (kind === 'instruction') {
      tags.add('core');
      tags.add('workflow');
    }
    if (kind === 'prompt') {
      tags.add('workflow');
    }
    if (kind === 'mcp') {
      tags.add('core');
    }

    if (kind === 'agent') {
      tags.add('workflow');
    }

    const keywordMap: Array<[PackageTag, RegExp]> = [
      ['backend', /backend|api|node|server/],
      ['frontend', /frontend|react|next|ui|css/],
      ['database', /database|postgres|sql|redis|db/],
      ['devops', /devops|docker|kubernetes|terraform|pipeline/],
      ['cloud', /cloud|azure|aws|gcp/],
      ['security', /security|review|auth|token|owasp/],
      ['testing', /test|qa|validation/],
      ['observability', /observability|monitor|logging|apm|metrics/],
      ['architecture', /architect|design|adr/],
      ['ai', /ai|copilot|agent|llm/],
      ['memory', /memory|remember|recall/],
      ['workflow', /workflow|plan|triage|prompt|instruction/],
      ['core', /core|orchestr|catalog|registry/],
      ['specialist', /specialist|expert/],
    ];

    for (const [tag, pattern] of keywordMap) {
      if (pattern.test(lowered)) {
        tags.add(tag);
      }
    }

    if (tags.size === 0) {
      tags.add('core');
    }

    return [...tags].slice(0, 5);
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map(item => this.asString(item)).filter(Boolean);
    }
    if (typeof value === 'string') {
      return [value.trim()].filter(Boolean);
    }
    return [];
  }

  private asBoolean(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  private isPackageTag = (value: string): value is PackageTag => {
    return [
      'backend', 'frontend', 'database', 'devops', 'cloud',
      'security', 'testing', 'observability', 'architecture',
      'ai', 'memory', 'workflow', 'core', 'specialist',
    ].includes(value);
  };

  private toRelativePath(rootDir: string, filePath: string): string {
    return path.relative(rootDir, filePath).replace(/\\/g, '/');
  }

  private toDisplayName(value: string): string {
    return value
      .replace(/\.agent$|\.prompt$|\.instructions$/g, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-') || 'package';
  }

  private unquote(value: string): string {
    return value.replace(/^['"]|['"]$/g, '').trim();
  }

  private isJsonEndpoint(url: string): boolean {
    return /\.json(\?|$)/i.test(url) || /raw\.githubusercontent\.com/i.test(url);
  }

  private quote(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  async getAll(): Promise<Package[]> {
    if (!this._initialized) {
      await this.sync();
    }
    return this._cache.length > 0 ? this._cache : this._fallbackRegistry.getAll();
  }

  async findById(id: string): Promise<Package | undefined> {
    const all = await this.getAll();
    return all.find(p => p.id === id);
  }

  async search(query: string): Promise<Package[]> {
    const all = await this.getAll();
    return all.filter(p => p.matchesQuery(query));
  }

  async getAgentNetwork(agentId: string): Promise<Package[]> {
    return this._fallbackRegistry.getAgentNetwork(agentId);
  }

  async getRelatedSkills(agentId: string): Promise<Package[]> {
    return this._fallbackRegistry.getRelatedSkills(agentId);
  }

  async getAllBundles(): Promise<Bundle[]> {
    if (!this._initialized) {
      await this.sync();
    }
    return this._bundlesCache.length > 0 ? this._bundlesCache : this._fallbackRegistry.getAllBundles();
  }

  async findBundleById(id: string): Promise<Bundle | undefined> {
    const all = await this.getAllBundles();
    return all.find(b => b.id === id);
  }
}
