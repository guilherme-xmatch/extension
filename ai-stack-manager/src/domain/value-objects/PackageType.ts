/**
 * @module domain/value-objects/PackageType
 * @description Value object representing the type of an AI infrastructure package.
 * Encapsulates type-specific behavior: labels, icons, default paths.
 */

export class PackageType {
  // Singleton instances for each type
  static readonly Agent = new PackageType('agent', 'Agent', '$(hubot)', '.github/agents');
  static readonly Skill = new PackageType('skill', 'Skill', '$(mortar-board)', '.github/skills');
  static readonly MCP = new PackageType('mcp', 'MCP Server', '$(plug)', '.vscode');
  static readonly Instruction = new PackageType('instruction', 'Instruction', '$(book)', '.github/instructions');
  static readonly Prompt = new PackageType('prompt', 'Prompt', '$(comment-discussion)', '.github/prompts');

  private constructor(
    public readonly value: string,
    public readonly label: string,
    public readonly codicon: string,
    public readonly defaultDirectory: string,
  ) {}

  /** Parse string to PackageType */
  static fromString(value: string): PackageType {
    const map: Record<string, PackageType> = {
      'agent': PackageType.Agent,
      'skill': PackageType.Skill,
      'mcp': PackageType.MCP,
      'instruction': PackageType.Instruction,
      'prompt': PackageType.Prompt,
    };
    const result = map[value.toLowerCase()];
    if (!result) {
      throw new Error(`Unknown package type: "${value}". Valid types: ${Object.keys(map).join(', ')}`);
    }
    return result;
  }

  /** All available package types */
  static all(): PackageType[] {
    return [
      PackageType.Agent,
      PackageType.Skill,
      PackageType.MCP,
      PackageType.Instruction,
      PackageType.Prompt,
    ];
  }

  /** CSS class name for UI styling */
  get cssClass(): string {
    return `type-${this.value}`;
  }

  /** Color associated with this type (Itaú palette) */
  get color(): string {
    const colors: Record<string, string> = {
      'agent': '#EC7000',
      'skill': '#448AFF',
      'mcp': '#00C853',
      'instruction': '#AB47BC',
      'prompt': '#FFB300',
    };
    return colors[this.value] ?? '#EC7000';
  }

  equals(other: PackageType): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
