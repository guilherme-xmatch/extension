/**
 * @module infrastructure/services/McpDocumentAdapter
 * @description Normalizes MCP configuration documents from multiple client formats
 * (Copilot/VS Code, Claude Desktop, Cursor) to the canonical internal format.
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
   * Detects the format of an MCP configuration document.
   */
  static detectFormat(raw: unknown): McpClientFormat {
    if (!raw || typeof raw !== 'object') {
      return 'unknown';
    }
    const obj = raw as Record<string, unknown>;

    if (obj['servers'] && typeof obj['servers'] === 'object') {
      // Has 'servers' key — Copilot/VS Code format
      return 'copilot';
    }
    if (obj['mcpServers'] && typeof obj['mcpServers'] === 'object') {
      // Both Claude Desktop and Cursor share this root key; label generically as claude-desktop
      return 'claude-desktop';
    }
    return 'unknown';
  }

  /**
   * Normalizes any supported MCP document format to the canonical internal format.
   * Throws if the document cannot be parsed or no servers are found.
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
   * Reads and parses a JSON file, stripping single-line and block comments (JSONC).
   */
  static parseJsonFile(content: string): unknown {
    // Only strip // comments that start a line (possibly preceded by whitespace).
    // This avoids accidentally stripping // inside string values such as URLs.
    const stripped = content
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    return stripped ? JSON.parse(stripped) : {};
  }
}
