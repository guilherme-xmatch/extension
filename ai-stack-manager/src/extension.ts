/**
 * @module extension
 * @description Entry point for DescomplicAI VS Code extension.
 */

import * as vscode from 'vscode';
import * as path from 'path';

// Domain
import { InstallStatus, Package } from './domain/entities/Package';

// Infrastructure
import { GitRegistry } from './infrastructure/repositories/GitRegistry';
import { WorkspaceScanner } from './infrastructure/services/WorkspaceScanner';
import { FileInstaller } from './infrastructure/services/FileInstaller';
import { HealthCheckerService } from './infrastructure/services/HealthChecker';
import { PublishService } from './infrastructure/services/PublishService';
import { GitHubMetricsService } from './infrastructure/services/GitHubMetricsService';
import { OperationCoordinator } from './infrastructure/services/OperationCoordinator';

// Presentation
import { CatalogViewProvider } from './presentation/providers/CatalogViewProvider';
import { InstalledViewProvider } from './presentation/providers/InstalledViewProvider';
import { HealthViewProvider } from './presentation/providers/HealthViewProvider';
import { WorkflowPanel } from './presentation/panels/WorkflowPanel';
import { InsightsPanel } from './presentation/panels/InsightsPanel';
import { ConfigPanel } from './presentation/panels/ConfigPanel';
import { InsightsGenerator } from './infrastructure/services/InsightsGenerator';
import { StatusBarManager } from './infrastructure/services/StatusBarManager';
import { AppLogger } from './infrastructure/services/AppLogger';

export function activate(context: vscode.ExtensionContext): void {
  const logger = AppLogger.getInstance();
  const registry = new GitRegistry();
  const scanner = new WorkspaceScanner();
  const metricsService = new GitHubMetricsService();
  const installer = new FileInstaller(metricsService);
  const healthChecker = new HealthCheckerService(registry, scanner);
  const publishService = new PublishService();
  const insightsGenerator = new InsightsGenerator(registry, scanner);
  const operations = new OperationCoordinator();

  void registry.sync().catch(error => {
    logger.error('Falha na sincronização inicial do catálogo.', { error });
  });

  // ─── Sidebar Providers ───────────────────────
  const catalogProvider = new CatalogViewProvider(context.extensionUri, registry, scanner, installer, operations);
  const installedProvider = new InstalledViewProvider(context.extensionUri, registry, scanner, installer, operations);
  const healthProvider = new HealthViewProvider(context.extensionUri, healthChecker, operations);

  const statusBar = StatusBarManager.getInstance();
  statusBar.bindToCoordinator(operations);

  operations.setRefreshHandler(async (targets) => {
    for (const target of targets) {
      if (target === 'catalog') {
        await catalogProvider.refresh();
      }
      if (target === 'installed') {
        await installedProvider.refresh();
      }
      if (target === 'health') {
        await healthProvider.refresh();
      }
    }
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CatalogViewProvider.viewType, catalogProvider),
    vscode.window.registerWebviewViewProvider(InstalledViewProvider.viewType, installedProvider),
    vscode.window.registerWebviewViewProvider(HealthViewProvider.viewType, healthProvider),
    statusBar,
    logger,
    operations,
  );

  const resolvePackagesForInstall = async (pkg: Package): Promise<Package[]> => {
    const config = vscode.workspace.getConfiguration('descomplicai');
    const autoResolve = config.get<boolean>('autoResolveDependencies', true);
    if (!autoResolve || pkg.dependencies.length === 0) {
      return [pkg];
    }

    const resolved = new Map<string, Package>();
    const visited = new Set<string>();

    const visit = async (current: Package): Promise<void> => {
      if (visited.has(current.id)) { return; }
      visited.add(current.id);
      resolved.set(current.id, current);

      for (const dependencyId of current.dependencies) {
        const dependency = await registry.findById(dependencyId);
        if (dependency) {
          await visit(dependency);
        }
      }
    };

    await visit(pkg);
    if (resolved.size <= 1) {
      return [pkg];
    }

    const choice = await vscode.window.showInformationMessage(
      `"${pkg.displayName}" possui ${resolved.size - 1} dependência(s). Deseja instalar o pacote completo?`,
      { modal: true },
      `Instalar com dependências (${resolved.size})`,
      'Apenas este pacote',
    );

    if (choice?.startsWith('Instalar com dependências')) {
      return [...resolved.values()];
    }

    return [pkg];
  };

  // ─── Commands ────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('dai.install', async () => {
      const packages = await registry.getAll();
      const items: Array<{ label: string; description: string; detail: string; id: string }> = packages.map((p: Package) => ({
        label: `${p.categoryEmoji || p.typeIcon} ${p.displayName}`,
        description: p.agentMeta?.category.label ?? p.type.label,
        detail: p.description,
        id: p.id,
      }));
      const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Selecione um pacote para instalar...', matchOnDescription: true, matchOnDetail: true });
      if (selected) {
        const pkg = await registry.findById(selected.id);
        if (pkg) { 
          const packagesToInstall = await resolvePackagesForInstall(pkg);
          await operations.run({
            kind: packagesToInstall.length > 1 ? 'bundle-install' : 'package-install',
            label: packagesToInstall.length > 1 ? `Instalando ${packagesToInstall.length} pacotes` : `Instalando ${pkg.displayName}`,
            targetId: pkg.id,
            refreshTargets: ['catalog', 'installed'],
          }, async (operation) => {
            if (packagesToInstall.length > 1) {
              await installer.installMany(packagesToInstall, {
                onProgress: (progress) => {
                  operation.setProgress((progress.current / progress.total) * 100, progress.label);
                },
              });
              return;
            }

            operation.setProgress(10, pkg.displayName);
            await installer.install(pkg, {
              onProgress: () => operation.setProgress(100, pkg.displayName),
            });
          });
        }
      }
    }),

    vscode.commands.registerCommand('dai.uninstall', async () => {
      const packages = await registry.getAll();
      const installed: Array<{ label: string; description: string; id: string }> = [];
      for (const pkg of packages) {
        const status = await scanner.getInstallStatus(pkg);
        if (status === InstallStatus.Installed || status === InstallStatus.Partial) {
          installed.push({ label: `$(trash) ${pkg.displayName}`, description: pkg.type.label, id: pkg.id });
        }
      }
      if (installed.length === 0) { vscode.window.showInformationMessage('Nenhum pacote instalado.'); return; }
      const selected = await vscode.window.showQuickPick(installed, { placeHolder: 'Selecione um pacote para desinstalar...' });
      if (selected) {
        const pkg = await registry.findById(selected.id);
        if (pkg) {
          await operations.run({
            kind: 'package-uninstall',
            label: `Removendo ${pkg.displayName}`,
            targetId: pkg.id,
            refreshTargets: ['catalog', 'installed'],
          }, async (operation) => {
            operation.setProgress(10, pkg.displayName);
            await installer.uninstall(pkg, {
              onProgress: () => operation.setProgress(100, pkg.displayName),
            });
          });
        }
      }
    }),

    vscode.commands.registerCommand('dai.healthCheck', async () => { await healthProvider.refresh(); }),
    vscode.commands.registerCommand('dai.refresh', async () => { 
      await operations.run({
        kind: 'catalog-sync',
        label: 'Sincronizando catálogo',
        refreshTargets: ['catalog', 'installed'],
      }, async (operation) => {
        operation.setProgress(25, 'Sincronizando catálogo');
        await registry.sync();
        operation.setProgress(100, 'Sincronização concluída');
      });
    }),

    vscode.commands.registerCommand('dai.installBundle', async () => {
      const bundles = await registry.getAllBundles();
      const items: Array<{ label: string; description: string; detail: string; id: string }> = bundles.map((b: import('./domain/entities/Bundle').Bundle) => ({ label: `$(package) ${b.displayName}`, description: `${b.packageCount} pacotes`, detail: b.description, id: b.id }));
      const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Selecione um bundle para instalar...', matchOnDetail: true });
      if (selected) {
        const bundle = await registry.findBundleById(selected.id);
        if (bundle) {
          const packages: import('./domain/entities/Package').Package[] = [];
          for (const pkgId of bundle.packageIds) { const pkg = await registry.findById(pkgId); if (pkg) { packages.push(pkg); } }
          if (packages.length > 0) { 
            await operations.run({
              kind: 'bundle-install',
              label: `Instalando bundle ${bundle.displayName}`,
              targetId: bundle.id,
              refreshTargets: ['catalog', 'installed'],
            }, async (operation) => {
              await installer.installMany(packages, {
                onProgress: (progress) => {
                  operation.setProgress((progress.current / progress.total) * 100, progress.label);
                },
              });
            });
          }
        }
      }
    }),

    vscode.commands.registerCommand('dai.scaffold', async () => {
      const typeChoice = await vscode.window.showQuickPick(
        [
          { label: '$(hubot) Agent', value: 'agent' },
          { label: '$(mortar-board) Skill', value: 'skill' },
          { label: '$(book) Instruction', value: 'instruction' },
          { label: '$(comment-discussion) Prompt', value: 'prompt' },
        ],
        { placeHolder: 'Qual tipo de pacote você quer criar?' },
      );
      if (!typeChoice) { return; }
      const name = await vscode.window.showInputBox({ prompt: `Nome para o novo ${typeChoice.value}`, placeHolder: 'ex. meu-agent-customizado', validateInput: (v) => { if (!v) { return 'Obrigatório'; } if (!/^[a-z0-9-]+$/.test(v)) { return 'apenas letras minúsculas e hífens'; } return null; } });
      if (!name) { return; }
      const description = await vscode.window.showInputBox({ prompt: `Descrição para "${name}"`, placeHolder: 'Breve descrição...' });
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) { vscode.window.showErrorMessage('Nenhum workspace aberto.'); return; }

      const templates: Record<string, { path: string; content: string }> = {
        agent: { path: `.github/agents/${name}.agent.md`, content: `---\nname: ${name}\ndescription: >\n  ${description ?? 'Agent customizado.'}\ntools:\n  - read\n  - edit\n  - search\nagents: []\nuser-invocable: false\n---\n\n# ${name}\n\n${description ?? 'Agent customizado.'}\n` },
        skill: { path: `.github/skills/${name}/SKILL.md`, content: `---\nname: ${name}\ndescription: "${description ?? 'Skill customizada.'}"\n---\n\n# ${name}\n\n> ${description ?? 'Skill customizada.'}\n` },
        instruction: { path: `.github/instructions/${name}.instructions.md`, content: `---\napplyTo: "*"\n---\n# ${name}\n\n${description ?? 'Instruction customizada.'}\n` },
        prompt: { path: `.github/prompts/${name}.prompt.md`, content: `---\ndescription: "${description ?? 'Prompt customizado.'}"\nagent: agent\n---\n\n# ${name}\n\n${description ?? 'Prompt customizado.'}\n` },
      };
      const template = templates[typeChoice.value];
      if (!template) { return; }

      const fullPath = vscode.Uri.file(`${root}/${template.path}`);
      const dirPath = vscode.Uri.file(path.dirname(fullPath.fsPath));
      await vscode.workspace.fs.createDirectory(dirPath);
      await vscode.workspace.fs.writeFile(fullPath, Buffer.from(template.content, 'utf-8'));
      const doc = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`✨ Criado ${typeChoice.value}: ${name}`);
      await catalogProvider.refresh(); await installedProvider.refresh();
    }),

    vscode.commands.registerCommand('dai.openWorkflow', async () => {
      WorkflowPanel.createOrShow(context.extensionUri);
    }),

    vscode.commands.registerCommand('dai.openInsights', async () => {
      InsightsPanel.createOrShow(context.extensionUri, insightsGenerator);
    }),

    vscode.commands.registerCommand('dai.configureAgent', async (agentId?: string) => {
      if (!agentId) {
        const packages = await registry.getAll();
        const agents = packages.filter((p: Package) => p.type.value === 'agent');
        const items: Array<{ label: string; description: string; id: string }> = agents.map((p: Package) => ({ label: `${p.categoryEmoji} ${p.displayName}`, description: p.id, id: p.id }));
        const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Selecione um agente para configurar...' });
        if (selected) { agentId = selected.id; }
      }
      
      if (agentId) {
        const pkg = await registry.findById(agentId);
        if (pkg) {
          ConfigPanel.createOrShow(context.extensionUri, pkg);
        }
      }
    }),

    vscode.commands.registerCommand('dai.publishPackage', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Gerar contribuição',
        filters: {
          'MCP JSON': ['json']
        }
      });
      if (uris && uris[0]) {
        await operations.run({
          kind: 'package-publish',
          label: 'Gerando artefato de contribuição',
          targetId: uris[0].fsPath,
          refreshTargets: ['catalog'],
        }, async (operation) => {
          operation.setProgress(15, 'Lendo MCP');
          await publishService.publishPackage(uris[0]);
          operation.setProgress(100, 'Artefato gerado');
        });
      }
    }),

    vscode.commands.registerCommand('dai.importCustomMcp', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Importar MCP',
        filters: {
          'MCP JSON': ['json']
        }
      });

      if (!uris?.[0]) { return; }

      await operations.run({
        kind: 'custom-mcp-import',
        label: 'Importando MCP customizado',
        targetId: uris[0].fsPath,
        refreshTargets: ['catalog', 'installed'],
      }, async (operation) => {
        operation.setProgress(10, 'Lendo contribuição MCP');
        const packages = await publishService.importCustomMcp(uris[0], registry);
        if (packages.length === 0) { return; }

        if (packages.length > 1) {
          await installer.installMany(packages, {
            onProgress: (progress) => {
              operation.setProgress((progress.current / progress.total) * 100, progress.label);
            },
          });
          return;
        }

        await installer.install(packages[0], {
          onProgress: () => operation.setProgress(100, packages[0].displayName),
        });
      });
    }),
  );

  // ─── Chat Participant @stack ─────────────────
  try {
    const handler: vscode.ChatRequestHandler = async (request, _chatContext, stream, _token) => {
      const cmd = request.command;
      const prompt = request.prompt.trim();

      if (cmd === 'recommend' || (!cmd && prompt.toLowerCase().includes('recommend'))) {
        stream.markdown('## 📊 Análise do Workspace\n\n');
        stream.markdown('Baseado no seu projeto, aqui estão os **pacotes recomendados**:\n\n');
        const allPkgs = await registry.getAll();
        const bundles = await registry.getAllBundles();
        stream.markdown('### 🚀 Começo Rápido (Bundles)\n');
        for (const b of bundles) { stream.markdown(`- **${b.displayName}** — ${b.description} (${b.packageCount} pacotes)\n`); }
        stream.markdown('\n### ⚡ Agents Individuais\n');
        for (const p of allPkgs.filter((p: Package) => p.isAgent)) { stream.markdown(`- ${p.categoryEmoji} **${p.displayName}** — ${p.description}\n`); }
        stream.markdown('\n> 💡 Use `/install <nome>` para instalar qualquer pacote.\n');
        return;
      }

      if (cmd === 'explain') {
        const pkg = (await registry.getAll()).find((p: Package) => p.name.includes(prompt.toLowerCase()) || p.displayName.toLowerCase().includes(prompt.toLowerCase()));
        if (!pkg) { stream.markdown(`❌ Pacote "${prompt}" não encontrado. Tente \`/recommend\` para ver todos os pacotes.`); return; }
        stream.markdown(`## ${pkg.categoryEmoji || '📦'} ${pkg.displayName}\n\n`);
        stream.markdown(`**Tipo:** ${pkg.agentMeta?.category.label ?? pkg.type.label}\n\n`);
        stream.markdown(`**Descrição:** ${pkg.description}\n\n`);
        if (pkg.agentMeta) {
          stream.markdown(`**Ferramentas:** ${pkg.agentMeta.tools.join(', ')}\n\n`);
          stream.markdown(`**Fase no Workflow:** ${pkg.agentMeta.workflowPhase}\n\n`);
          stream.markdown(`**Complexidade:** ${pkg.complexityScore}/100\n\n`);
          if (pkg.agentMeta.delegatesTo.length > 0) {
            stream.markdown(`**Rede de Agents (${pkg.agentMeta.delegatesTo.length}):**\n`);
            for (const d of pkg.agentMeta.delegatesTo) { stream.markdown(`- ${d}\n`); }
          }
          if (pkg.agentMeta.relatedSkills.length > 0) {
            stream.markdown(`\n**Skills Relacionadas:**\n`);
            for (const s of pkg.agentMeta.relatedSkills) { stream.markdown(`- ${s}\n`); }
          }
        }
        return;
      }

      if (cmd === 'workflow') {
        stream.markdown('## 🔄 Pipeline de Workflow de Agents\n\n');
        stream.markdown('Você também pode visualizar este workflow de forma interativa executando o comando `DescomplicAI: Abrir Visualizador de Workflow`.\n\n');
        stream.markdown('```\n');
        stream.markdown('TRIAGE (🧠 orchestrator)\n');
        stream.markdown('  ↓\n');
        stream.markdown('PLAN (📐 planner) — opcional para tarefas simples\n');
        stream.markdown('  ↓\n');
        stream.markdown('DESIGN (🏛️ code-architect) — opcional\n');
        stream.markdown('  ↓\n');
        stream.markdown('EXECUTION (⚡ backend/frontend/database/devops)\n');
        stream.markdown('  ↓\n');
        stream.markdown('VALIDATION (🧪 test-engineer) — opcional para documentação\n');
        stream.markdown('  ↓\n');
        stream.markdown('CRITIC (🛡️ code-reviewer) — para alterações complexas\n');
        stream.markdown('  ↓\n');
        stream.markdown('DELIVER (🧠 orchestrator)\n');
        stream.markdown('  ↓\n');
        stream.markdown('REMEMBER (💾 mempalace) — extração de memória\n');
        stream.markdown('```\n\n');
        stream.markdown('> Cada etapa pode ser pulada pelo orchestrator dependendo da complexidade da tarefa.\n');
        return;
      }

      if (cmd === 'health') {
        const report = await healthChecker.check();
        stream.markdown(`## 🩺 Health Check: ${report.statusEmoji} ${report.statusLabel}\n\n`);
        stream.markdown(`**Score:** ${report.score}/100 | **Tempo de Scan:** ${report.scanDurationMs}ms\n\n`);
        if (report.findings.length > 0) {
          for (const f of report.findings) {
            const icon = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : f.severity === 'ok' ? '🟢' : '🔵';
            stream.markdown(`${icon} **${f.title}** — ${f.message}\n`);
            if (f.fix) { stream.markdown(`  💡 ${f.fix}\n`); }
            stream.markdown('\n');
          }
        }
        return;
      }

      if (cmd === 'install') {
        stream.markdown(`Para instalar "${prompt}", use a **barra lateral do DescomplicAI** ou execute:\n\n`);
        stream.markdown('```\nDescomplicAI: Instalar Pacote\n```\n\n');
        stream.markdown('na Command Palette (`Ctrl+Shift+P`).\n');
        return;
      }

      // Default: help
      stream.markdown('## 🧠 DescomplicAI\n\n');
      stream.markdown('Eu posso ajudar você a gerenciar sua infraestrutura de AI agents:\n\n');
      stream.markdown('- `/recommend` — Sugere pacotes e agents para o seu projeto\n');
      stream.markdown('- `/explain <nome>` — Explica um agent ou pacote específico em detalhes\n');
      stream.markdown('- `/workflow` — Mostra o pipeline e fluxo de trabalho dos agents\n');
      stream.markdown('- `/health` — Executa o health check da sua infraestrutura\n');
      stream.markdown('- `/install <nome>` — Ajuda na instalação de um pacote\n');
    };

    const participant = vscode.chat.createChatParticipant('dai.stack', handler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', 'sidebar-icon.svg');
    context.subscriptions.push(participant);
  } catch (error) {
    logger.warn('API de chat não disponível nesta versão do VS Code.', { error });
    // Chat API may not be available in all VS Code versions
  }

  // ─── Auto Health Check ───────────────────────
  const config = vscode.workspace.getConfiguration('descomplicai');
  if (config.get<boolean>('autoHealthCheck', true)) {
    setTimeout(() => {
      void healthProvider.refresh().catch(error => {
        logger.warn('Falha no auto health check.', { error });
      });
    }, 3000);
  }

  const hasShownWelcome = context.globalState.get<boolean>('descomplicai.welcomeShown', false);
  if (config.get<boolean>('showWelcome', true) && !hasShownWelcome) {
    void context.globalState.update('descomplicai.welcomeShown', true);
    vscode.window.showInformationMessage('🧠 DescomplicAI ativado! Abra a barra lateral para gerenciar seus AI agents.', 'Abrir Catálogo').then((choice) => {
      if (choice === 'Abrir Catálogo') { vscode.commands.executeCommand('dai-catalog.focus'); }
    });
  }
}

export function deactivate(): void {}
