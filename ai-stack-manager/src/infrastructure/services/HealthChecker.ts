/**
 * @module infrastructure/services/HealthChecker
 * @description Validates the integrity of AI infrastructure in the workspace.
 * Checks cross-references between agents, skills, MCPs, and instructions.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { IHealthChecker, IPackageRepository, IWorkspaceScanner } from '../../domain/interfaces';
import { InstallStatus } from '../../domain/entities/Package';
import { HealthReport, HealthFinding, HealthSeverity } from '../../domain/entities/HealthReport';
import { AppLogger } from './AppLogger';

export class HealthCheckerService implements IHealthChecker {
  private readonly _logger = AppLogger.getInstance();

  constructor(
    private readonly _registry?: IPackageRepository,
    private readonly _scanner?: IWorkspaceScanner,
  ) {}

  private get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  async check(): Promise<HealthReport> {
    const startTime = Date.now();
    const findings: HealthFinding[] = [];

    const root = this.workspaceRoot;
    if (!root) {
      findings.push({
        id: 'no-workspace',
        severity: HealthSeverity.Error,
        category: 'general',
        title: 'No workspace open',
        message: 'Open a workspace folder to run health checks.',
        autoFixable: false,
      });
      return HealthReport.create(findings, Date.now() - startTime);
    }

    // Run all checks in parallel for performance
    const [
      githubCheck,
      agentChecks,
      skillChecks,
      mcpChecks,
      instructionChecks,
      catalogMetadataChecks,
    ] = await Promise.all([
      this.checkGitHubDir(root),
      this.checkAgents(root),
      this.checkSkills(root),
      this.checkMCPConfig(root),
      this.checkInstructions(root),
      this.checkCatalogMetadata(),
    ]);

    findings.push(...githubCheck, ...agentChecks, ...skillChecks, ...mcpChecks, ...instructionChecks, ...catalogMetadataChecks);

    // Add positive finding if everything is good
    if (findings.length === 0) {
      findings.push({
        id: 'all-good',
        severity: HealthSeverity.Ok,
        category: 'general',
        title: 'All checks passed',
        message: 'Your AI infrastructure is healthy! 🎉',
        autoFixable: false,
      });
    }

    return HealthReport.create(findings, Date.now() - startTime);
  }

  // ─── Individual Checks ───────────────────────

  private async checkGitHubDir(root: string): Promise<HealthFinding[]> {
    const findings: HealthFinding[] = [];

    const hasGitHub = await this.dirExists(path.join(root, '.github'));
    if (!hasGitHub) {
      findings.push({
        id: 'no-github-dir',
        severity: HealthSeverity.Warning,
        category: 'general',
        title: 'No .github directory',
        message: 'Create a .github directory to start using agents and skills.',
        fix: 'Install any agent or skill to auto-create the directory.',
        autoFixable: true,
      });
    }

    const hasVscode = await this.dirExists(path.join(root, '.vscode'));
    if (!hasVscode) {
      findings.push({
        id: 'no-vscode-dir',
        severity: HealthSeverity.Info,
        category: 'general',
        title: 'No .vscode directory',
        message: 'Create a .vscode directory for MCP server configuration.',
        autoFixable: true,
      });
    }

    return findings;
  }

  private async checkAgents(root: string): Promise<HealthFinding[]> {
    const findings: HealthFinding[] = [];
    const agentsDir = path.join(root, '.github', 'agents');

    if (!(await this.dirExists(agentsDir))) { return findings; }

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(agentsDir));
      const agentFiles = entries.filter(([name]) => name.endsWith('.agent.md'));

      if (agentFiles.length === 0) {
        findings.push({
          id: 'empty-agents-dir',
          severity: HealthSeverity.Warning,
          category: 'agent',
          title: 'Empty agents directory',
          message: 'The .github/agents/ directory exists but contains no agent files.',
          fix: 'Install agents from the catalog.',
          autoFixable: false,
        });
      }

      // Check each agent for basic structure
      for (const [fileName] of agentFiles) {
        const filePath = path.join(agentsDir, fileName);
        try {
          const content = await this.readFile(filePath);
          if (!content.includes('---')) {
            findings.push({
              id: `agent-no-frontmatter-${fileName}`,
              severity: HealthSeverity.Error,
              category: 'agent',
              title: `Agent missing frontmatter: ${fileName}`,
              message: `The agent file "${fileName}" is missing YAML frontmatter (---).`,
              filePath,
              autoFixable: false,
            });
          }
          if (!content.includes('name:')) {
            findings.push({
              id: `agent-no-name-${fileName}`,
              severity: HealthSeverity.Warning,
              category: 'agent',
              title: `Agent missing name: ${fileName}`,
              message: `The agent file "${fileName}" doesn't declare a name in frontmatter.`,
              filePath,
              autoFixable: false,
            });
          }
        } catch (error) {
          this._logger.warn('HEALTH_AGENT_FILE_READ_FAILED', { filePath, error });
        }
      }
    } catch (error) {
      this._logger.warn('HEALTH_AGENTS_SCAN_FAILED', { agentsDir, error });
    }

    return findings;
  }

  private async checkSkills(root: string): Promise<HealthFinding[]> {
    const findings: HealthFinding[] = [];
    const skillsDir = path.join(root, '.github', 'skills');

    if (!(await this.dirExists(skillsDir))) { return findings; }

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(skillsDir));
      const skillDirs = entries.filter(([, type]) => type === vscode.FileType.Directory);

      for (const [dirName] of skillDirs) {
        const skillFile = path.join(skillsDir, dirName, 'SKILL.md');
        const exists = await this.fileExists(skillFile);

        if (!exists) {
          findings.push({
            id: `skill-no-skillmd-${dirName}`,
            severity: HealthSeverity.Error,
            category: 'skill',
            title: `Skill missing SKILL.md: ${dirName}`,
            message: `The skill directory "${dirName}" doesn't contain a SKILL.md file.`,
            filePath: path.join(skillsDir, dirName),
            autoFixable: false,
          });
        }
      }
    } catch (error) {
      this._logger.warn('HEALTH_SKILLS_SCAN_FAILED', { skillsDir, error });
    }

    return findings;
  }

  private async checkMCPConfig(root: string): Promise<HealthFinding[]> {
    const findings: HealthFinding[] = [];
    const mcpPath = path.join(root, '.vscode', 'mcp.json');

    if (!(await this.fileExists(mcpPath))) {
      // Only warn if agents exist (agents likely need MCPs)
      const hasAgents = await this.dirExists(path.join(root, '.github', 'agents'));
      if (hasAgents) {
        findings.push({
          id: 'no-mcp-config',
          severity: HealthSeverity.Info,
          category: 'mcp',
          title: 'No MCP configuration',
          message: 'Consider adding .vscode/mcp.json to configure MCP servers for your agents.',
          autoFixable: false,
        });
      }
      return findings;
    }

    try {
      const content = await this.readFile(mcpPath);
      // Basic JSON validation
      JSON.parse(content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
    } catch (error) {
      this._logger.warn('HEALTH_MCP_JSON_INVALID', { mcpPath, error });
      findings.push({
        id: 'mcp-invalid-json',
        severity: HealthSeverity.Error,
        category: 'mcp',
        title: 'Invalid mcp.json',
        message: 'The .vscode/mcp.json file contains invalid JSON.',
        filePath: mcpPath,
        autoFixable: false,
      });
    }

    return findings;
  }

  private async checkInstructions(root: string): Promise<HealthFinding[]> {
    const findings: HealthFinding[] = [];
    const instructionsDir = path.join(root, '.github', 'instructions');

    if (!(await this.dirExists(instructionsDir))) { return findings; }

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(instructionsDir));
      const instructionFiles = entries.filter(([name]) => name.endsWith('.instructions.md'));

      for (const [fileName] of instructionFiles) {
        const filePath = path.join(instructionsDir, fileName);
        try {
          const content = await this.readFile(filePath);
          if (!content.includes('applyTo:')) {
            findings.push({
              id: `instruction-no-applyto-${fileName}`,
              severity: HealthSeverity.Warning,
              category: 'instruction',
              title: `Instruction missing applyTo: ${fileName}`,
              message: `The instruction "${fileName}" doesn't specify applyTo scope.`,
              filePath,
              autoFixable: false,
            });
          }
        } catch (error) {
          this._logger.warn('HEALTH_INSTRUCTION_FILE_READ_FAILED', { filePath, error });
        }
      }
    } catch (error) {
      this._logger.warn('HEALTH_INSTRUCTIONS_SCAN_FAILED', { instructionsDir, error });
    }

    return findings;
  }

  private async checkCatalogMetadata(): Promise<HealthFinding[]> {
    if (!this._registry || !this._scanner) { return []; }

    const findings: HealthFinding[] = [];
    const packages = await this._registry.getAll();

    for (const pkg of packages) {
      const status = await this._scanner.getInstallStatus(pkg);
      if (status !== InstallStatus.Installed && status !== InstallStatus.Partial) {
        continue;
      }

      if (pkg.isOfficial && !pkg.source.manifestPath) {
        findings.push({
          id: `catalog-manifest-missing-${pkg.id}`,
          severity: HealthSeverity.Warning,
          category: pkg.type.value as 'agent' | 'skill' | 'mcp' | 'instruction' | 'general',
          title: `Manifest ausente para ${pkg.displayName}`,
          message: 'O pacote instalado não informa o caminho do manifest público no catálogo oficial.',
          fix: 'Atualize o manifesto do pacote no repositório DescomplicAI.',
          autoFixable: false,
        });
      }

      if (!pkg.installStrategy.targets.length) {
        findings.push({
          id: `install-targets-missing-${pkg.id}`,
          severity: HealthSeverity.Error,
          category: pkg.type.value as 'agent' | 'skill' | 'mcp' | 'instruction' | 'general',
          title: `Targets de instalação ausentes: ${pkg.displayName}`,
          message: 'O pacote não define targets de instalação no novo schema público.',
          fix: 'Adicione install.targets ao manifest.json correspondente.',
          autoFixable: false,
        });
      }

      if (!pkg.ui.longDescription) {
        findings.push({
          id: `ui-details-missing-${pkg.id}`,
          severity: HealthSeverity.Info,
          category: pkg.type.value as 'agent' | 'skill' | 'mcp' | 'instruction' | 'general',
          title: `Detalhes públicos incompletos: ${pkg.displayName}`,
          message: 'O pacote está sem descrição longa para a UI pública do catálogo.',
          fix: 'Preencha ui.longDescription ou details.md no repositório oficial.',
          autoFixable: false,
        });
      }

      if (pkg.type.value === 'mcp' && pkg.installStrategy.kind !== 'mcp-merge') {
        findings.push({
          id: `mcp-merge-strategy-${pkg.id}`,
          severity: HealthSeverity.Warning,
          category: 'mcp',
          title: `Estratégia MCP inconsistente: ${pkg.displayName}`,
          message: 'Pacotes MCP devem usar strategy "mcp-merge" para preservar o .vscode/mcp.json do workspace.',
          fix: 'Atualize o manifest do MCP para usar install.strategy = mcp-merge.',
          autoFixable: false,
        });
      }
    }

    return findings;
  }

  // ─── Helpers ─────────────────────────────────

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return stat.type === vscode.FileType.File;
    } catch (error) {
      this._logger.debug('HEALTH_FILE_NOT_FOUND', { filePath, error });
      return false;
    }
  }

  private async dirExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
      return stat.type === vscode.FileType.Directory;
    } catch (error) {
      this._logger.debug('HEALTH_DIR_NOT_FOUND', { dirPath, error });
      return false;
    }
  }

  private async readFile(filePath: string): Promise<string> {
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    return Buffer.from(content).toString('utf-8');
  }
}
