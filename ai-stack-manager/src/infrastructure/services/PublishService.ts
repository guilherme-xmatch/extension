import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import AdmZip = require('adm-zip');
import { exec } from 'child_process';
import { promisify } from 'util';
import { StatusBarManager } from './StatusBarManager';

const execAsync = promisify(exec);

export class PublishService {
  private get cacheDir(): string {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    return path.join(home, '.descomplicai', 'registry');
  }

  public async publishPackage(fileUri: vscode.Uri): Promise<void> {
    const statusBar = StatusBarManager.getInstance();
    statusBar.setWorking('Descompactando pacote...');

    try {
      const filePath = fileUri.fsPath;
      const isZip = filePath.endsWith('.zip');
      const isJson = filePath.endsWith('.json');

      if (!isZip && !isJson) {
        throw new Error('Formato não suportado. Envie um .zip ou mcp.json.');
      }

      // Garante que o registry local existe
      if (!fs.existsSync(this.cacheDir)) {
        throw new Error('Registry local não sincronizado. Clique em "Atualizar" no painel primeiro.');
      }

      if (isZip) {
        const zip = new AdmZip(filePath);
        // Descompacta na raiz do repositório registry local
        zip.extractAllTo(this.cacheDir, true);
      } else if (isJson) {
        // Copia o mcp.json
        const dest = path.join(this.cacheDir, '.vscode', path.basename(filePath));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(filePath, dest);
      }

      statusBar.setWorking('Fazendo commit no Git Central...');

      // Executa os comandos Git localmente para abrir um PR ou enviar
      await execAsync('git add .', { cwd: this.cacheDir });
      const branchName = `contrib/novo-pacote-${Date.now()}`;
      await execAsync(`git checkout -b ${branchName}`, { cwd: this.cacheDir });
      await execAsync('git commit -m "feat: Adicionando novo pacote via DescomplicAI"', { cwd: this.cacheDir });
      
      // Simula o push (num cenário real, exigiria upstream e permissão)
      // await execAsync(`git push origin ${branchName}`, { cwd: this.cacheDir });

      vscode.window.showInformationMessage(`📦 Pacote descompactado com sucesso! (Branch local ${branchName} criada no Registry).`);
      statusBar.setSuccess('Pronto para PR');
      
    } catch (error: any) {
      vscode.window.showErrorMessage(`Falha na publicação: ${error.message}`);
      statusBar.setError('Falha ao publicar');
    }
  }
}
