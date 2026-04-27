/**
 * @module infrastructure/services/McpDocumentAdapter
 * @description Normaliza documentos de configuração MCP de múltiplos formatos de clientes
 * (Copilot/VS Code, Claude Desktop, Cursor) para o formato interno canônico.
 */

export type McpClientFormat = 'copilot' | 'claude-desktop' | 'cursor' | 'unknown';

export interface NormalizedMcpDocument {
  /** Detected source format */
  readonly format: McpClientFormat;
  /** Normalized servers map (Copilot format) */
  readonly servers: Record<string, unknown>;
  /** Input variable definitions (only present in Copilot format) */
  readonly inputs: Array<{ id: string; [key: string]: unknown }>;
}

export class McpDocumentAdapter {
  /**
   * Detecta o formato de um documento de configuração MCP.
   */
  static detectFormat(raw: unknown): McpClientFormat {
    if (!raw || typeof raw !== 'object') {
      return 'unknown';
    }
    const obj = raw as Record<string, unknown>;

    if (obj['servers'] && typeof obj['servers'] === 'object') {
      // Possui chave 'servers' — formato Copilot/VS Code
      return 'copilot';
    }
    if (obj['mcpServers'] && typeof obj['mcpServers'] === 'object') {
      // Claude Desktop e Cursor compartilham esta chave raiz; identificado genericamente como claude-desktop
      return 'claude-desktop';
    }
    return 'unknown';
  }

  /**
   * Normaliza qualquer formato suportado de documento MCP para o formato interno canônico.
   * Lança exceção se o documento não puder ser analisado ou nenhum servidor for encontrado.
   */
  static normalize(raw: unknown): NormalizedMcpDocument {
    const format = McpDocumentAdapter.detectFormat(raw);
    const obj = raw as Record<string, unknown>;

    switch (format) {
      case 'copilot': {
        const servers = (obj['servers'] as Record<string, unknown>) ?? {};
        const inputs = Array.isArray(obj['inputs'])
          ? (obj['inputs'] as Array<{ id: string; [key: string]: unknown }>).filter(
              i => i && typeof i.id === 'string'
            )
          : [];
        if (Object.keys(servers).length === 0) {
          throw new Error('Nenhum servidor MCP encontrado no documento (formato Copilot).');
        }
        return { format, servers, inputs };
      }

      case 'claude-desktop': {
        const mcpServers = (obj['mcpServers'] as Record<string, unknown>) ?? {};
        if (Object.keys(mcpServers).length === 0) {
          throw new Error(
            'Nenhum servidor MCP encontrado no documento (formato Claude Desktop/Cursor).'
          );
        }
        // Claude Desktop and Cursor share the same server schema; normalize to 'servers'
        return { format, servers: mcpServers, inputs: [] };
      }

      default:
        throw new Error(
          'Formato de documento MCP não reconhecido. ' +
            'Formatos suportados: VS Code/Copilot (.vscode/mcp.json), ' +
            'Claude Desktop (claude_desktop_config.json), Cursor (.cursor/mcp.json).'
        );
    }
  }

  /**
   * Lê e analisa um arquivo JSON, removendo comentários de linha única e em bloco (JSONC).
   */
  static parseJsonFile(content: string): unknown {
    // Remove apenas comentários // que iniciam uma linha (possivelmente precedidos por espaços).
    // Isso evita remover // dentro de valores de string, como URLs.
    const stripped = content
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    return stripped ? JSON.parse(stripped) : {};
  }
}
