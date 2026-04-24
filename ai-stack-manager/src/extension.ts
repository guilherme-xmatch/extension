/**
 * @module extension
 * @description Entry point for DescomplicAI VS Code extension.
 */

import * as vscode from 'vscode';
import * as path from 'path';

// Domain
import { InstallStatus } from './domain/entities/Package';

// Infrastructure
import { LocalRegistry } from './infrastructure/repositories/LocalRegistry';
import { WorkspaceScanner } from './infrastructure/services/WorkspaceScanner';
import { FileInstaller } from './infrastructure/services/FileInstaller';
import { HealthCheckerService } from './infrastructure/services/HealthChecker';

// Presentation
import { CatalogViewProvider } from './presentation/providers/CatalogViewProvider';
import { InstalledViewProvider } from './presentation/providers/InstalledViewProvider';
import { HealthViewProvider } from './presentation/providers/HealthViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const registry = new LocalRegistry();
  const scanner = new WorkspaceScanner();
  const installer = new FileInstaller();
  const healthChecker = new HealthCheckerService();

  // ─── Sidebar Providers ───────────────────────
  const catalogProvider = new CatalogViewProvider(context.extensionUri, registry, scanner, installer);
  const installedProvider = new InstalledViewProvider(context.extensionUri, registry, scanner, installer);
  const healthProvider = new HealthViewProvider(context.extensionUri, healthChecker);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CatalogViewProvider.viewType, catalogProvider),
    vscode.window.registerWebviewViewProvider(InstalledViewProvider.viewType, installedProvider),
    vscode.window.registerWebviewViewProvider(HealthViewProvider.viewType, healthProvider),
  );

  // ─── Commands ────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('dai.install', async () => {
      const packages = await registry.getAll();
      const items = packages.map(p => ({
        label: `${p.categoryEmoji || p.typeIcon} ${p.displayName}`,
        description: p.agentMeta?.category.label ?? p.type.label,
        detail: p.description,
        id: p.id,
      }));
      const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a package to install...', matchOnDescription: true, matchOnDetail: true });
      if (selected) {
        const pkg = await registry.findById(selected.id);
        if (pkg) { await installer.install(pkg); catalogProvider.refresh(); installedProvider.refresh(); }
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
      if (installed.length === 0) { vscode.window.showInformationMessage('No packages installed.'); return; }
      const selected = await vscode.window.showQuickPick(installed, { placeHolder: 'Select a package to uninstall...' });
      if (selected) {
        const pkg = await registry.findById(selected.id);
        if (pkg) { await installer.uninstall(pkg); catalogProvider.refresh(); installedProvider.refresh(); }
      }
    }),

    vscode.commands.registerCommand('dai.healthCheck', async () => { await healthProvider.refresh(); }),
    vscode.commands.registerCommand('dai.refresh', async () => { await catalogProvider.refresh(); await installedProvider.refresh(); }),

    vscode.commands.registerCommand('dai.installBundle', async () => {
      const bundles = await registry.getAllBundles();
      const items = bundles.map(b => ({ label: `$(package) ${b.displayName}`, description: `${b.packageCount} packages`, detail: b.description, id: b.id }));
      const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a bundle to install...', matchOnDetail: true });
      if (selected) {
        const bundle = await registry.findBundleById(selected.id);
        if (bundle) {
          const packages: import('./domain/entities/Package').Package[] = [];
          for (const pkgId of bundle.packageIds) { const pkg = await registry.findById(pkgId); if (pkg) { packages.push(pkg); } }
          if (packages.length > 0) { await installer.installMany(packages); catalogProvider.refresh(); installedProvider.refresh(); }
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
        { placeHolder: 'What type of package do you want to create?' },
      );
      if (!typeChoice) { return; }
      const name = await vscode.window.showInputBox({ prompt: `Name for the new ${typeChoice.value}`, placeHolder: 'e.g. my-custom-agent', validateInput: (v) => { if (!v) { return 'Required'; } if (!/^[a-z0-9-]+$/.test(v)) { return 'lowercase + hyphens only'; } return null; } });
      if (!name) { return; }
      const description = await vscode.window.showInputBox({ prompt: `Description for "${name}"`, placeHolder: 'Brief description...' });
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) { vscode.window.showErrorMessage('No workspace open.'); return; }

      const templates: Record<string, { path: string; content: string }> = {
        agent: { path: `.github/agents/${name}.agent.md`, content: `---\nname: ${name}\ndescription: >\n  ${description ?? 'Custom agent.'}\ntools:\n  - read\n  - editFiles\n  - search\nagents: []\nuser-invocable: false\n---\n\n# ${name}\n\n${description ?? 'Custom agent.'}\n` },
        skill: { path: `.github/skills/${name}/SKILL.md`, content: `---\nname: ${name}\ndescription: "${description ?? 'Custom skill.'}"\n---\n\n# ${name}\n\n> ${description ?? 'Custom skill.'}\n` },
        instruction: { path: `.github/instructions/${name}.instructions.md`, content: `---\napplyTo: "*"\n---\n# ${name}\n\n${description ?? 'Custom instruction.'}\n` },
        prompt: { path: `.github/prompts/${name}.prompt.md`, content: `---\nmode: agent\ndescription: "${description ?? 'Custom prompt.'}"\n---\n\n# ${name}\n\n${description ?? 'Custom prompt.'}\n` },
      };
      const template = templates[typeChoice.value];
      if (!template) { return; }

      const fullPath = vscode.Uri.file(`${root}/${template.path}`);
      const dirPath = vscode.Uri.file(path.dirname(fullPath.fsPath));
      await vscode.workspace.fs.createDirectory(dirPath);
      await vscode.workspace.fs.writeFile(fullPath, Buffer.from(template.content, 'utf-8'));
      const doc = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`✨ Created ${typeChoice.value}: ${name}`);
      catalogProvider.refresh(); installedProvider.refresh();
    }),

    vscode.commands.registerCommand('dai.openWorkflow', async () => {
      vscode.window.showInformationMessage('Workflow Visualizer coming soon!');
    }),
  );

  // ─── Chat Participant @stack ─────────────────
  try {
    const handler: vscode.ChatRequestHandler = async (request, chatContext, stream, token) => {
      const cmd = request.command;
      const prompt = request.prompt.trim();

      if (cmd === 'recommend' || (!cmd && prompt.toLowerCase().includes('recommend'))) {
        stream.markdown('## 📊 Workspace Analysis\n\n');
        stream.markdown('Based on your project, here are **recommended packages**:\n\n');
        const allPkgs = await registry.getAll();
        const bundles = await registry.getAllBundles();
        stream.markdown('### 🚀 Quick Start\n');
        for (const b of bundles) { stream.markdown(`- **${b.displayName}** — ${b.description} (${b.packageCount} packages)\n`); }
        stream.markdown('\n### ⚡ Individual Agents\n');
        for (const p of allPkgs.filter(p => p.isAgent)) { stream.markdown(`- ${p.categoryEmoji} **${p.displayName}** — ${p.description}\n`); }
        stream.markdown('\n> 💡 Use `/install <name>` to install any package.\n');
        return;
      }

      if (cmd === 'explain') {
        const pkg = (await registry.getAll()).find(p => p.name.includes(prompt.toLowerCase()) || p.displayName.toLowerCase().includes(prompt.toLowerCase()));
        if (!pkg) { stream.markdown(`❌ Package "${prompt}" not found. Try \`/recommend\` to see all packages.`); return; }
        stream.markdown(`## ${pkg.categoryEmoji || '📦'} ${pkg.displayName}\n\n`);
        stream.markdown(`**Type:** ${pkg.agentMeta?.category.label ?? pkg.type.label}\n\n`);
        stream.markdown(`**Description:** ${pkg.description}\n\n`);
        if (pkg.agentMeta) {
          stream.markdown(`**Tools:** ${pkg.agentMeta.tools.join(', ')}\n\n`);
          stream.markdown(`**Workflow Phase:** ${pkg.agentMeta.workflowPhase}\n\n`);
          stream.markdown(`**Complexity:** ${pkg.complexityScore}/100\n\n`);
          if (pkg.agentMeta.delegatesTo.length > 0) {
            stream.markdown(`**Agent Network (${pkg.agentMeta.delegatesTo.length}):**\n`);
            for (const d of pkg.agentMeta.delegatesTo) { stream.markdown(`- ${d}\n`); }
          }
          if (pkg.agentMeta.relatedSkills.length > 0) {
            stream.markdown(`\n**Related Skills:**\n`);
            for (const s of pkg.agentMeta.relatedSkills) { stream.markdown(`- ${s}\n`); }
          }
        }
        return;
      }

      if (cmd === 'workflow') {
        stream.markdown('## 🔄 Agent Workflow Pipeline\n\n');
        stream.markdown('```\n');
        stream.markdown('TRIAGE (🧠 orchestrator)\n');
        stream.markdown('  ↓\n');
        stream.markdown('PLAN (📐 planner) — optional for simple tasks\n');
        stream.markdown('  ↓\n');
        stream.markdown('DESIGN (🏛️ code-architect) — optional\n');
        stream.markdown('  ↓\n');
        stream.markdown('EXECUTION (⚡ backend/frontend/database/devops)\n');
        stream.markdown('  ↓\n');
        stream.markdown('VALIDATION (🧪 test-engineer) — optional for docs\n');
        stream.markdown('  ↓\n');
        stream.markdown('CRITIC (🛡️ code-reviewer) — for non-trivial changes\n');
        stream.markdown('  ↓\n');
        stream.markdown('DELIVER (🧠 orchestrator)\n');
        stream.markdown('  ↓\n');
        stream.markdown('REMEMBER (💾 mempalace) — best-effort\n');
        stream.markdown('```\n\n');
        stream.markdown('> Each gate can be skipped based on task complexity.\n');
        return;
      }

      if (cmd === 'health') {
        const report = await healthChecker.check();
        stream.markdown(`## 🩺 Health Check: ${report.statusEmoji} ${report.statusLabel}\n\n`);
        stream.markdown(`**Score:** ${report.score}/100 | **Scan time:** ${report.scanDurationMs}ms\n\n`);
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
        stream.markdown(`To install "${prompt}", use the **DescomplicAI sidebar** or run:\n\n`);
        stream.markdown('```\nDescomplicAI: Install Package\n```\n\n');
        stream.markdown('from the Command Palette (`Ctrl+Shift+P`).\n');
        return;
      }

      // Default: help
      stream.markdown('## 🧠 DescomplicAI\n\n');
      stream.markdown('I can help you manage your AI agent infrastructure:\n\n');
      stream.markdown('- `/recommend` — Suggest packages for your project\n');
      stream.markdown('- `/explain <name>` — Explain an agent or package\n');
      stream.markdown('- `/workflow` — Show the agent workflow pipeline\n');
      stream.markdown('- `/health` — Run infrastructure health check\n');
      stream.markdown('- `/install <name>` — Install a package\n');
    };

    const participant = vscode.chat.createChatParticipant('dai.stack', handler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', 'sidebar-icon.svg');
    context.subscriptions.push(participant);
  } catch {
    // Chat API may not be available in all VS Code versions
  }

  // ─── Auto Health Check ───────────────────────
  const config = vscode.workspace.getConfiguration('descomplicai');
  if (config.get<boolean>('autoHealthCheck', true)) {
    setTimeout(() => healthProvider.refresh(), 3000);
  }

  if (config.get<boolean>('showWelcome', true)) {
    vscode.window.showInformationMessage('🧠 DescomplicAI activated! Open the sidebar to manage your AI agents.', 'Open Catalog').then((choice) => {
      if (choice === 'Open Catalog') { vscode.commands.executeCommand('dai-catalog.focus'); }
    });
  }
}

export function deactivate(): void {}
