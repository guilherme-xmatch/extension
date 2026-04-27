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
import { ServiceContainer, TOKENS } from './infrastructure/ServiceContainer';

// Presentation
import { CatalogViewProvider } from './presentation/providers/CatalogViewProvider';
import { InstalledViewProvider } from './presentation/providers/InstalledViewProvider';
import { HealthViewProvider } from './presentation/providers/HealthViewProvider';
import { WorkflowPanel } from './presentation/panels/WorkflowPanel';
import { StackDiffPanel } from './presentation/panels/StackDiffPanel';
import { ScaffoldWizardPanel } from './presentation/panels/ScaffoldWizardPanel';
import { HealthCheckScheduler, getSchedulerIntervalMs } from './infrastructure/services/HealthCheckScheduler';
import { InsightsPanel } from './presentation/panels/InsightsPanel';
import { ConfigPanel } from './presentation/panels/ConfigPanel';
import { InsightsGenerator } from './infrastructure/services/InsightsGenerator';
import { StatusBarManager } from './infrastructure/services/StatusBarManager';
import { AppLogger } from './infrastructure/services/AppLogger';

export function activate(context: vscode.ExtensionContext): void {
  const logger = AppLogger.getInstance();

  // ─── Dependency Injection ────────────────────
  const container = new ServiceContainer()
    .register(TOKENS.Metrics,       () => new GitHubMetricsService())
    .register(TOKENS.Registry,      () => new GitRegistry())
    .register(TOKENS.Scanner,       () => new WorkspaceScanner())
    .register(TOKENS.Installer,     c  => new FileInstaller(c.resolve<GitHubMetricsService>(TOKENS.Metrics)))
    .register(TOKENS.HealthChecker, c  => new HealthCheckerService(c.resolve<GitRegistry>(TOKENS.Registry), c.resolve<WorkspaceScanner>(TOKENS.Scanner)))
    .register(TOKENS.Publish,       () => new PublishService())
    .register(TOKENS.Insights,      c  => new InsightsGenerator(c.resolve<GitRegistry>(TOKENS.Registry), c.resolve<WorkspaceScanner>(TOKENS.Scanner)))
    .register(TOKENS.Operations,    () => new OperationCoordinator());

  context.subscriptions.push({ dispose: () => container.dispose() });

  const registry         = container.resolve<GitRegistry>(TOKENS.Registry);
  const scanner          = container.resolve<WorkspaceScanner>(TOKENS.Scanner);
  const installer        = container.resolve<FileInstaller>(TOKENS.Installer);
  const healthChecker    = container.resolve<HealthCheckerService>(TOKENS.HealthChecker);
  const publishService   = container.resolve<PublishService>(TOKENS.Publish);
  const insightsGenerator = container.resolve<InsightsGenerator>(TOKENS.Insights);
  const operations       = container.resolve<OperationCoordinator>(TOKENS.Operations);
  operations.initializePersistence(context);

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
      ScaffoldWizardPanel.createOrShow(context.extensionUri);
    }),

    vscode.commands.registerCommand('dai.openWorkflow', async () => {
      WorkflowPanel.createOrShow(context.extensionUri, registry, scanner);
    }),

    vscode.commands.registerCommand('dai.stackDiff', async (targetBundleId?: string) => {
      // Allow pre-selecting a bundle (e.g. from chat /diff command)
      let bundleId = targetBundleId;
      if (!bundleId) {
        const bundles = await registry.getAllBundles();
        const items = bundles.map(b => ({
          label:       `${b.icon}  ${b.displayName}`,
          description: b.description,
          id:          b.id,
        }));
        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Selecione o bundle para comparar com seu workspace atual…',
        });
        if (!selected) { return; }
        bundleId = selected.id;
      }
      StackDiffPanel.createOrShow(context.extensionUri, registry, scanner, bundleId);
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
        // ── 1. Gather workspace intelligence in parallel ──────────────────────
        const [allPkgs, bundles, profiles, installedIds] = await Promise.all([
          registry.getAll(),
          registry.getAllBundles(),
          scanner.detectProjectProfile(),
          scanner.getInstalledPackageIds(),
        ]);

        const installedSet = new Set(installedIds);
        const statusIcon = (id: string) => installedSet.has(id) ? '✅' : '📦';

        stream.markdown('## 📊 Análise do Workspace\n\n');

        // ── 2. Show detected project profile (or generic intro) ───────────────
        if (profiles.length > 0) {
          // Sort by confidence descending, pick highest
          const sorted = [...profiles].sort((a, b) => b.confidence - a.confidence);
          const best   = sorted[0];
          const pct    = Math.round(best.confidence * 100);

          stream.markdown(`**Perfil detectado:** ${best.profile} — ${pct}% de confiança\n\n`);
          if (best.detectedSignals.length > 0) {
            const signals = best.detectedSignals.slice(0, 5).map(s => `\`${s}\``).join(', ');
            stream.markdown(`> 📁 Sinais: ${signals}\n\n`);
          }
          if (best.reason) {
            stream.markdown(`> ℹ️ ${best.reason}\n\n`);
          }

          // ── 3. Show recommended bundle with per-package install status ────────
          const recommendedBundle = bundles.find(b => b.id === best.bundleId);
          if (recommendedBundle) {
            stream.markdown(`---\n\n### 🎯 Bundle Recomendado — **${recommendedBundle.displayName}**\n\n`);
            stream.markdown(`> ${recommendedBundle.description}\n\n`);

            // Table of packages in the bundle
            stream.markdown('| Pacote | Tipo | Status |\n');
            stream.markdown('|--------|------|--------|\n');
            let installedCount = 0;
            for (const pkgId of recommendedBundle.packageIds) {
              const pkg = allPkgs.find((p: Package) => p.id === pkgId);
              if (pkg) {
                const icon   = statusIcon(pkgId);
                const isInst = installedSet.has(pkgId);
                if (isInst) { installedCount++; }
                stream.markdown(`| ${pkg.categoryEmoji || pkg.typeIcon} **${pkg.displayName}** | ${pkg.agentMeta?.category.label ?? pkg.type.label} | ${icon} ${isInst ? 'Instalado' : 'Pendente'} |\n`);
              }
            }

            const total    = recommendedBundle.packageCount;
            const pending  = total - installedCount;
            stream.markdown(`\n**Cobertura atual:** ${installedCount}/${total} pacotes instalados`);

            if (pending > 0) {
              stream.markdown(`\n\n💡 Para instalar os **${pending} pacote(s) pendente(s)**, use:\n`);
              stream.markdown('```\nDescomplicAI: Instalar Bundle\n```\n');
              stream.markdown(`na Command Palette (\`Ctrl+Shift+P\`) e selecione **${recommendedBundle.displayName}**.\n`);
            } else {
              stream.markdown(' 🎉\n\n> Você já tem todos os pacotes deste bundle instalados!\n');
            }
          }
        } else {
          // No project profile detected — show generic intro
          stream.markdown('Nenhum perfil de projeto reconhecido foi detectado.\n');
          stream.markdown('Aqui está um resumo do catálogo completo:\n\n');
        }

        // ── 4. Complete catalog listing ───────────────────────────────────────
        stream.markdown('\n---\n\n### 📦 Catálogo Completo\n\n');

        // Bundles section
        stream.markdown('#### 🚀 Bundles (pacotes combinados)\n\n');
        for (const b of bundles) {
          const bundlePkgIds = b.packageIds;
          const bundleInstalled = bundlePkgIds.filter(id => installedSet.has(id)).length;
          stream.markdown(`- **${b.displayName}** (${bundleInstalled}/${b.packageCount} instalados) — ${b.description}\n`);
        }

        // Agents section
        const agents = allPkgs.filter((p: Package) => p.isAgent);
        if (agents.length > 0) {
          stream.markdown('\n#### 🤖 Agents\n\n');
          for (const p of agents) {
            stream.markdown(`- ${statusIcon(p.id)} ${p.categoryEmoji} **${p.displayName}** — ${p.description}\n`);
          }
        }

        // Skills section
        const skills = allPkgs.filter((p: Package) => p.type.value === 'skill');
        if (skills.length > 0) {
          stream.markdown('\n#### 📐 Skills\n\n');
          for (const p of skills) {
            stream.markdown(`- ${statusIcon(p.id)} **${p.displayName}** — ${p.description}\n`);
          }
        }

        // MCPs section
        const mcps = allPkgs.filter((p: Package) => p.type.value === 'mcp');
        if (mcps.length > 0) {
          stream.markdown('\n#### 🔌 MCP Servers\n\n');
          for (const p of mcps) {
            stream.markdown(`- ${statusIcon(p.id)} **${p.displayName}** — ${p.description}\n`);
          }
        }

        const totalInstalled = installedIds.length;
        const totalAvailable = allPkgs.length;
        stream.markdown(`\n---\n\n> 📈 **${totalInstalled}/${totalAvailable}** pacotes instalados no workspace  \n`);
        stream.markdown('> 💬 Use `/explain <nome>` para detalhes sobre um pacote específico.\n');
        stream.markdown('> 📊 Use `/diff <bundle>` para comparar seu workspace com um bundle.\n');
        return;
      }

      if (cmd === 'diff') {
        // Resolve optional bundle name argument (e.g. "/diff backend")
        const allBundles = await registry.getAllBundles();
        const query      = prompt.toLowerCase().trim();
        const target     = query
          ? allBundles.find(b =>
              b.id.includes(query) ||
              b.name.toLowerCase().includes(query) ||
              b.displayName.toLowerCase().includes(query),
            )
          : undefined;

        if (query && !target) {
          stream.markdown(`❌ Bundle **"${prompt}"** não encontrado. Bundles disponíveis:\n`);
          for (const b of allBundles) {
            stream.markdown(`- **${b.displayName}** (\`${b.id}\`)\n`);
          }
          return;
        }

        // Open the visual panel (passes bundleId or undefined to auto-pick)
        stream.markdown(`## 📊 Stack Diff\n\n`);
        if (target) {
          stream.markdown(`Abrindo comparação com **${target.displayName}**…\n\n`);
        } else {
          stream.markdown('Abrindo Stack Diff — selecione o bundle no painel que será aberto.\n\n');
        }
        void vscode.commands.executeCommand('dai.stackDiff', target?.id);

        // Also show a quick Markdown summary in chat
        const [allPkgs2, installedIds2] = await Promise.all([
          registry.getAll(),
          scanner.getInstalledPackageIds(),
        ]);
        const { StackDiffBuilder: Builder } = await import('./infrastructure/services/StackDiffBuilder');
        const chosenBundle = target ?? allBundles[0];
        if (chosenBundle) {
          const diff = new Builder().build({ targetBundle: chosenBundle, allPackages: allPkgs2, installedIds: installedIds2 });
          stream.markdown(`### ${chosenBundle.displayName}\n\n`);
          stream.markdown(`**Cobertura:** ${diff.coveragePercent}% (${diff.installed.length}/${diff.installed.length + diff.missing.length} pacotes)\n\n`);

          if (diff.installed.length > 0) {
            stream.markdown('**✅ Instalados:**\n');
            for (const e of diff.installed) { stream.markdown(`- ${e.categoryEmoji || '📦'} ${e.displayName}\n`); }
            stream.markdown('\n');
          }
          if (diff.missing.length > 0) {
            stream.markdown('**🆕 Pendentes:**\n');
            for (const e of diff.missing) { stream.markdown(`- ${e.categoryEmoji || '📦'} ${e.displayName}\n`); }
            stream.markdown('\n');
          }
          if (diff.extras.length > 0) {
            stream.markdown(`**🔄 Extras (fora do bundle):** ${diff.extras.map(e => e.displayName).join(', ')}\n\n`);
          }
          stream.markdown('> 💡 Use o painel visual para mais detalhes e para instalar os pacotes pendentes.\n');
        }
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
      stream.markdown('- `/diff [bundle]` — Compara seu workspace com um bundle específico\n');
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

  // ─── URI Handler (Deep Link) ─────────────────
  // Handles: vscode://itau-engineering.descomplicai/install?packageId=<id>
  // Handles: vscode://itau-engineering.descomplicai/install?bundleId=<id>
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri: vscode.Uri): Promise<void> => {
        if (uri.path !== '/install') { return; }

        const params = new URLSearchParams(uri.query);
        const packageId = params.get('packageId');
        const bundleId = params.get('bundleId');

        if (packageId) {
          const pkg = await registry.findById(packageId);
          if (!pkg) {
            vscode.window.showErrorMessage(`Pacote "${packageId}" não encontrado no catálogo.`);
            return;
          }
          const packagesToInstall = await resolvePackagesForInstall(pkg);
          await operations.run({
            kind: packagesToInstall.length > 1 ? 'bundle-install' : 'package-install',
            label: `Instalando ${pkg.displayName} (deep link)`,
            targetId: pkg.id,
            refreshTargets: ['catalog', 'installed'],
          }, async (operation) => {
            if (packagesToInstall.length > 1) {
              await installer.installMany(packagesToInstall, {
                onProgress: (p) => operation.setProgress((p.current / p.total) * 100, p.label),
              });
              return;
            }
            operation.setProgress(10, pkg.displayName);
            await installer.install(pkg, { onProgress: () => operation.setProgress(100, pkg.displayName) });
          });
          return;
        }

        if (bundleId) {
          const bundle = await registry.findBundleById(bundleId);
          if (!bundle) {
            vscode.window.showErrorMessage(`Bundle "${bundleId}" não encontrado no catálogo.`);
            return;
          }
          const packages: Package[] = [];
          for (const pkgId of bundle.packageIds) {
            const pkg = await registry.findById(pkgId);
            if (pkg) { packages.push(pkg); }
          }
          if (packages.length > 0) {
            await operations.run({
              kind: 'bundle-install',
              label: `Instalando bundle ${bundle.displayName} (deep link)`,
              targetId: bundle.id,
              refreshTargets: ['catalog', 'installed'],
            }, async (operation) => {
              await installer.installMany(packages, {
                onProgress: (p) => operation.setProgress((p.current / p.total) * 100, p.label),
              });
            });
          }
        }
      },
    })
  );

  // ─── Health Check Scheduler ──────────────────
  const config = vscode.workspace.getConfiguration('descomplicai');
  const scheduler = new HealthCheckScheduler(
    healthChecker,
    context,
    StatusBarManager.getInstance(),
  );

  if (config.get<boolean>('autoHealthCheck', true)) {
    const intervalMs = getSchedulerIntervalMs();
    scheduler.start(intervalMs);
    context.subscriptions.push({ dispose: () => scheduler.dispose() });
  }

  // Command: force an immediate health check
  context.subscriptions.push(
    vscode.commands.registerCommand('dai.forceHealthCheck', async () => {
      await healthProvider.refresh();
      await scheduler.runNow();
    }),
  );

  const hasShownWelcome = context.globalState.get<boolean>('descomplicai.welcomeShown', false);
  if (config.get<boolean>('showWelcome', true) && !hasShownWelcome) {
    void context.globalState.update('descomplicai.welcomeShown', true);
    vscode.window.showInformationMessage('🧠 DescomplicAI ativado! Abra a barra lateral para gerenciar seus AI agents.', 'Abrir Catálogo').then((choice) => {
      if (choice === 'Abrir Catálogo') { vscode.commands.executeCommand('dai-catalog.focus'); }
    });
  }
}

export function deactivate(): void {}
