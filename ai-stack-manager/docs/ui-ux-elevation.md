# DescomplicAI UI/UX Elevation

## Scope of this pass

This pass focuses on the user-facing surfaces with the highest visibility and frequency of use:

- shared webview design system in `media/webview/main.css`
- shared motion system in `media/webview/animations.css`
- sidebar views in `src/presentation/providers/CatalogViewProvider.ts`, `InstalledViewProvider.ts`, and `HealthViewProvider.ts`
- quick accessibility wins in `src/presentation/panels/ScaffoldWizardPanel.ts` and `src/presentation/panels/WorkflowPanel.ts`

The goal is to increase perceived quality, reduce ambiguity in critical flows, and create a consistent enterprise-grade interaction model across discovery, installation, monitoring, and management.

## Logo motion system

### Variants by context

| Context | Class | Size | Primary intent |
| --- | --- | --- | --- |
| Sidebar header | `.dai-stack-icon--sidebar` | `24x24` | compact brand presence with low visual noise |
| Status / hero block | `.dai-stack-icon--status` | `28x28` | reinforce state in health and operational summaries |
| Splash / loading screen | `.dai-stack-icon--splash` | `48x48` | strong branded focus during initialization |

### States and usage

| State | Class | Trigger | Timing | Easing | Transform sequence | UX intent |
| --- | --- | --- | --- | --- | --- | --- |
| Intro | layer default + copy reveal | first render only | `880ms` intro, `110ms` stagger | `cubic-bezier(0.16, 1, 0.3, 1)` | 3 layers descend in perspective, overshoot softly, settle; copy reveals from left with blur fade | communicate intelligence, depth, and polish |
| Idle | `.dai-logo-idle` | resting state | `4.8s` loop | `cubic-bezier(0.37, 0, 0.22, 1)` | subtle breathe on container + low halo pulse | confidence and readiness without distraction |
| Active / Loading | `.dai-logo-loading`, `.dai-logo-working`, `.dai-logo-active` | install, uninstall, sync, health run | `1.3s` loop | linear for rotation, ease-in-out for halo | center layer rotates in 3D; halo pulses | dynamism and ongoing processing |
| Success | `.dai-logo-success` | operation finished successfully | `560ms` | `cubic-bezier(0.22, 1, 0.36, 1)` | short scale burst + green halo | closure, confidence, completion |
| Error | `.dai-logo-error` | operation failed | `460ms` | damped ease | short horizontal shake + red halo | alert without panic |
| Inactive | `.dai-logo-inactive` | disabled / paused states | none | none | reduced saturation, static posture | stability and non-availability |

### Performance and accessibility rules

- Only `transform`, `opacity`, and composited shadows are animated.
- The first-render intro is allowed once, then suppressed after hydration to avoid replay on incremental rerenders.
- `prefers-reduced-motion: reduce` disables continuous motion and keeps the logo in a stable final state.
- The same state model can be reused in future splash or status indicators without new keyframes.

## User journey and perceptible improvements

| Journey stage | Touchpoint | Previous friction | Improvement applied now | Impact | Effort |
| --- | --- | --- | --- | --- | --- |
| Discovery | Catalog header | logo felt decorative, not operational; hierarchy weak | brand header now exposes state, metadata, and enterprise positioning | High | Medium |
| Discovery | Search and filters | controls had low contrast and limited affordance | larger hit areas, better focus states, clearer placeholder text, `aria-pressed` on chips | High | Low |
| Discovery | Catalog cards | state reading depended on subtle badges and opacity-heavy text | explicit status pills, stronger card surfaces, clearer action labels | High | Medium |
| Installation | Operation feedback | banner was generic and text-only | shared progress banner now shows state, copy, and visual progress bar | High | Low |
| Installation | Bundle recommendation | CTA competed with body copy | recommendation banner now isolates note, context, and action | Medium | Low |
| Monitoring | Health hero and report | emoji-heavy hero felt less enterprise; stats were flat | branded mark, clearer score framing, stronger stat cards, better findings contrast | High | Medium |
| Monitoring | Installed list | truncated paths had no recovery path | `title` tooltips added on truncated paths and actions renamed semantically | High | Low |
| Management | Wizard focus states | keyboard focus was understated | visible focus ring added for inputs, textarea, and select | High | Low |
| Management | Workflow diagram | svg layer had no accessible description | `role`, `aria-label`, and `title` added to workflow map | Medium | Low |

## Visual system decisions

### Color and contrast

- `#EC7000` remains the primary accent and is now used as a stronger operational signal, not only as decoration.
- Muted copy was lifted away from `opacity: 0.35`-style treatment and moved closer to readable contrast on dark and light themes.
- Status colors were normalized into three reusable pills: ready, active, and warning.
- Shared surfaces now use glass-like panels with stronger border separation to improve scanning in dense sidebars.

### Interaction model

- Primary CTAs now read as verbs (`Instalar`, `Atualizar`, `Remover`, `Abrir`, `Configurar`) instead of isolated symbols.
- Detail toggles expose `aria-expanded` and switch between `Detalhes` and `Ocultar`.
- Progress banners use the same information architecture in Catalog, Installed, and Health to reduce cognitive switching.

### Responsive behavior

- Critical layout groups now collapse on narrow sidebar widths.
- Summary pills, action rows, and hero metadata wrap instead of clipping.
- Health metrics collapse to one column when vertical density matters more than compactness.

## Advanced backlog

The first backlog slice from this document has now been implemented in code:

| Delivered item | Where it landed | User-facing outcome |
| --- | --- | --- |
| Inline validation and form feedback | `ConfigPanel.ts`, `ScaffoldWizardPanel.ts`, `package.json` settings schema | fields validate in real time, save/next actions block invalid states, and token/security settings are now persisted |
| Inline notifications inside webviews | `WebviewHelper.ts`, `main.css`, `ConfigPanel.ts`, `InsightsPanel.ts`, `StackDiffPanel.ts`, `ScaffoldWizardPanel.ts`, `CatalogViewProvider.ts`, `InstalledViewProvider.ts`, `HealthViewProvider.ts` | toast-style feedback now spans both custom panels and primary sidebars, keeping the user inside the task flow instead of relying only on editor-level notifications |
| Skeleton states for slow loads | `InsightsPanel.ts`, `StackDiffPanel.ts`, `WorkflowPanel.ts`, `CatalogViewProvider.ts`, `InstalledViewProvider.ts` | heavy panels and the highest-traffic sidebars now communicate loading immediately with perceptible progress instead of blank surfaces |
| Keyboard flow in visual panels | `WorkflowPanel.ts`, `StackDiffPanel.ts`, `InsightsPanel.ts` | arrow-key navigation, focusable cards, selection summaries, and improved landmarks reduce mouse dependency |
| Sidebar semantic consistency | `CatalogViewProvider.ts`, `InstalledViewProvider.ts`, `HealthViewProvider.ts` | list semantics, retry/error states, and inline action feedback improve screen-reader clarity across discovery, monitoring, and management |
| Critical modal flow cleanup | `CatalogViewProvider.ts`, `extension.ts`, `FileInstaller.ts`, `InstallationStrategy.ts` | dependency and destructive-action prompts now use clearer copy and explicit cancel paths instead of silently falling back to install-only behavior |
| Editor-native accessibility and copy audit | `extension.ts`, `PublishService.ts`, `HealthCheckScheduler.ts`, `GitRegistry.ts`, `InstalledViewProvider.ts` | command palette flows now have clearer titles, empty states, action-oriented next steps, and notification copy aligned with the upgraded webviews |
| Local-only UX diagnostics | `UxDiagnosticsService.ts`, `InsightsGenerator.ts`, `InsightsPanel.ts`, `ConfigPanel.ts`, `ScaffoldWizardPanel.ts`, `StackDiffPanel.ts`, `extension.ts` | abandonment, cancellation, repeated exports, and failure signals are now aggregated locally and surfaced in Insights without storing user content |

The remaining backlog is now narrower and more strategic:

| Item | Why it matters | Suggested priority |
| --- | --- | --- |
| Formal WCAG verification with assistive tech on chat, status bar, and notification surfaces | validates the upgraded semantics with real screen-reader and keyboard passes beyond static code inspection | High |
| Operational recovery guidance for failed actions | complements the new diagnostics with clearer remediation paths in error states and status bar feedback | Medium |
| Consistency guardrails for future panels and command flows | ensures new surfaces adopt the same notification, skeleton, and diagnostics primitives by default | Medium |

## Recommended next implementation slice

1. Executar uma verificação assistida por leitor de tela e teclado real nas superfícies que ainda dependem do shell nativo do VS Code.
2. Adicionar orientação de recuperação para falhas operacionais frequentes, usando os novos sinais locais como priorização.
3. Transformar os padrões de copy, skeleton e diagnósticos em checklist obrigatório para qualquer novo painel ou comando da extensão.
