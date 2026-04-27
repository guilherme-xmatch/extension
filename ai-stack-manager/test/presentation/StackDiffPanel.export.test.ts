/**
 * @module test/presentation/StackDiffPanel.export.test
 * @description Unit tests for the `generateMarkdown` pure function exported
 *   by `StackDiffPanel`. Tests run without any VS Code API calls.
 */

import { describe, it, expect } from 'vitest';
import { generateMarkdown } from '../../src/presentation/panels/StackDiffPanel';
import type { StackDiff, PackageDiffEntry } from '../../src/infrastructure/services/StackDiffBuilder';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEntry(id: string, overrides?: Partial<PackageDiffEntry>): PackageDiffEntry {
  return {
    id,
    displayName: `Package ${id}`,
    description: `Description of ${id}`,
    categoryEmoji: '🤖',
    typeLabel: 'Agent',
    typeValue: 'agent',
    status: 'installed',
    ...overrides,
  };
}

function makeBundle(overrides?: Partial<StackDiff['targetBundle']>): StackDiff['targetBundle'] {
  return {
    id: 'bundle-fullstack',
    displayName: 'Full Stack Bundle',
    description: 'All tools for full-stack dev',
    packageCount: 3,
    icon: '🚀',
    color: '#EC7000',
    ...overrides,
  };
}

function makeDiff(overrides?: Partial<StackDiff>): StackDiff {
  return {
    targetBundle: makeBundle(),
    installed: [makeEntry('agent-a', { status: 'installed' })],
    missing:   [makeEntry('skill-b', { status: 'missing', typeLabel: 'Skill', typeValue: 'skill', categoryEmoji: '📐' })],
    extras:    [makeEntry('mcp-c',   { status: 'extra',   typeLabel: 'MCP',   typeValue: 'mcp',   categoryEmoji: '🔌' })],
    coveragePercent: 50,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateMarkdown', () => {
  it('includes the bundle name in the H1 title', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('# Stack Diff — Full Stack Bundle');
  });

  it('includes coverage percentage in the blockquote', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('**Cobertura: 50%**');
  });

  it('includes installed count in the coverage line', () => {
    const md = generateMarkdown(makeDiff());
    // 1 installed / 2 total (installed + missing)
    expect(md).toContain('1 de 2 pacotes instalados');
  });

  it('includes the ✅ Instalados section header', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('## ✅ Instalados (1)');
  });

  it('includes the 🆕 Pendentes section header', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('## 🆕 Pendentes (1)');
  });

  it('includes the 🔄 Extras section header', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('## 🔄 Extras — fora do bundle (1)');
  });

  it('renders a Markdown table with correct headers for non-empty sections', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('| Pacote | Tipo | Descrição |');
    expect(md).toContain('|--------|------|-----------|');
  });

  it('renders installed package in the table', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('Package agent-a');
    expect(md).toContain('Agent');
  });

  it('renders missing package in the table', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('Package skill-b');
    expect(md).toContain('Skill');
  });

  it('renders extras package in the table', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('Package mcp-c');
    expect(md).toContain('MCP');
  });

  it('includes the footer with DescomplicAI attribution', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('Gerado por DescomplicAI');
  });

  it('includes a horizontal rule before the footer', () => {
    const md = generateMarkdown(makeDiff());
    expect(md).toContain('\n---\n');
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it('shows _Nenhum._ for an empty installed section', () => {
    const md = generateMarkdown(makeDiff({ installed: [], coveragePercent: 0 }));
    // Installed section should have _Nenhum._ but others have tables
    const lines = md.split('\n');
    const installedIdx = lines.findIndex(l => l.startsWith('## ✅'));
    const missingIdx   = lines.findIndex(l => l.startsWith('## 🆕'));
    const installedSlice = lines.slice(installedIdx + 1, missingIdx).join('\n');
    expect(installedSlice).toContain('_Nenhum._');
  });

  it('shows _Nenhum._ for an empty missing section', () => {
    const md = generateMarkdown(makeDiff({ missing: [], coveragePercent: 100 }));
    const lines = md.split('\n');
    const missingIdx = lines.findIndex(l => l.startsWith('## 🆕'));
    const extrasIdx  = lines.findIndex(l => l.startsWith('## 🔄'));
    const missingSlice = lines.slice(missingIdx + 1, extrasIdx).join('\n');
    expect(missingSlice).toContain('_Nenhum._');
  });

  it('shows _Nenhum._ for an empty extras section', () => {
    const md = generateMarkdown(makeDiff({ extras: [] }));
    const lines = md.split('\n');
    const extrasIdx = lines.findIndex(l => l.startsWith('## 🔄'));
    const footerIdx = lines.findIndex(l => l === '---');
    const extrasSlice = lines.slice(extrasIdx + 1, footerIdx).join('\n');
    expect(extrasSlice).toContain('_Nenhum._');
  });

  it('shows 100% coverage correctly', () => {
    const md = generateMarkdown(makeDiff({ missing: [], coveragePercent: 100 }));
    expect(md).toContain('**Cobertura: 100%**');
  });

  it('handles all-empty diff gracefully (no throws)', () => {
    const emptyDiff = makeDiff({ installed: [], missing: [], extras: [], coveragePercent: 0 });
    expect(() => generateMarkdown(emptyDiff)).not.toThrow();
    const md = generateMarkdown(emptyDiff);
    expect(md).toContain('_Nenhum._');
  });

  it('rounds fractional coverage percentage', () => {
    const md = generateMarkdown(makeDiff({ coveragePercent: 66.6666 }));
    expect(md).toContain('**Cobertura: 67%**');
  });

  it('uses the categoryEmoji for each package row', () => {
    const md = generateMarkdown(makeDiff());
    // installed entry has 🤖, missing has 📐, extras has 🔌
    expect(md).toContain('🤖');
    expect(md).toContain('📐');
    expect(md).toContain('🔌');
  });
});
