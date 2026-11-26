# Design System

Fonte de verdade: [`css/tokens.css`](../css/tokens.css). Pré-visualização: [`design/tokens-preview.html`](../design/tokens-preview.html).

## 1. Direção

Escuro, calmo e com o conteúdo como protagonista (capas, logótipos, vídeo). A cor de destaque é usada com parcimónia: ação primária, estado ativo, progresso, foco. A profundidade é dada por **níveis de superfície** e não por sombras fortes.

## 2. Ajuste à paleta proposta (questionado e corrigido)

A paleta original foi mantida, com **uma correção de acessibilidade** detetada na medição de contraste:

| Combinação | Contraste | WCAG AA (4.5:1) | Decisão |
|---|---|---|---|
| Texto branco sobre `#657CFF` | 3.57:1 | ❌ | Botões primários usam **`#5468F0`** (4.55:1). `#657CFF` mantém-se para ícones, texto de destaque e indicadores (5.5:1 sobre o fundo). |
| `#F5F7FA` sobre `#090B10` | 18.3:1 | ✅ | — |
| `#929BAC` sobre `#181E29` (cards) | 6.0:1 | ✅ | — |
| Branco sobre gradiente `#5468F0 → #6E56E8` | ≥ 4.55:1 | ✅ | Gradiente de marca para CTAs e hero. |
| Branco sobre verde/vermelho de estado | 3.0 / 3.9:1 | ❌ | Fills de estado usam **texto escuro** (`--color-text-on-status`). |

Foi acrescentado um **terceiro nível de texto** (`#7D8698`, 5.4:1) para metadados e um token de superfície *hover/pressed* (`#2A3546`).

## 3. Tokens — regras de uso

| Família | Prefixo | Regra |
|---|---|---|
| Primitivos | `--p-*` | Nunca usados em componentes. Só referenciados pelos tokens semânticos. |
| Cor | `--color-*` | Por função (`surface`, `text-secondary`, `danger`), nunca por aparência (`grey-2`). |
| Espaço | `--space-*` | Grelha de 4 px. |
| Tipografia | `--text-*`, `--weight-*`, `--leading-*` | Escala alinhada com os tamanhos do iOS (15/17/20/24/32). |
| Raio | `--radius-*` | Cards 14 px, sheets 20 px. |
| Movimento | `--duration-*`, `--ease-*` | Respeitam `prefers-reduced-motion` automaticamente. |
| Layout | `--safe-*`, `--touch-min`, `--tabbar-height` | Todas as áreas fixas somam a safe area correspondente. |

## 4. Tipografia

Fonte do sistema (SF Pro no iPhone). Justificação: zero bytes a descarregar, renderização ótica nativa, coerência com o iOS e funcionamento offline garantido. Os tamanhos usam `rem`, permitindo respeitar o tamanho de texto do sistema.

| Papel | Token | Peso |
|---|---|---|
| Large title (cabeçalho de ecrã) | `--text-3xl` | Bold, tracking apertado |
| Título de secção | `--text-xl` | Semibold |
| Título de card | `--text-md` | Semibold |
| Corpo | `--text-md` | Regular |
| Metadados | `--text-xs` / `--text-sm` | Regular/Medium, texto secundário |
| Badge (AO VIVO, HD) | `--text-2xs` | Bold, maiúsculas, tracking largo |

## 5. Inventário de componentes (Fase 2)

| Componente | Variantes / estados |
|---|---|
| Button | primary · secondary · ghost · danger · icon · loading · disabled |
| Tab bar | 5 itens, ativo, badge; vidro com blur; safe area inferior |
| Header | large title que colapsa ao fazer scroll; ações à direita |
| Search field | vazio · a escrever · com resultados · sem resultados; botão limpar |
| Segmented control | lista/grelha; filtros |
| Chip | categoria; selecionado; com contador |
| Channel row | logo, nome, programa atual, progresso EPG, favorito, a reproduzir |
| Channel card | variante grelha |
| Poster card | 2:3, título, ano, progresso "continuar a ver" |
| Hero / spotlight | destaque com gradiente |
| Rail (carrossel horizontal) | scroll-snap, título + "Ver tudo" |
| Sheet (bottom sheet) | ações, formulários (adicionar lista) |
| Dialog de confirmação | destrutivo (substitui `confirm()`) |
| Toast | sucesso · erro · info · com ação (ex.: "Atualizar") |
| Skeleton | linha, card, poster, hero |
| Empty state | ilustração, título, texto, CTA |
| Progress | barra fina (EPG, VOD), anel (importação) |
| Form field | text, url, password (mostrar/ocultar), select, toggle; erro inline |
| Virtual list | listas com milhares de itens |
| Player chrome | play/pause, scrub, tempo, info, legendas, áudio, AirPlay, PiP, ecrã inteiro |

## 6. Regras de interação

- Área mínima de toque: **44 × 44 px**, mesmo quando o ícone é menor.
- Feedback de toque: escala `--press-scale` + mudança de superfície, sem atraso (sem `:hover` "pegajoso" no iOS — hovers só em `@media (hover: hover)`).
- Foco visível (`:focus-visible`) com anel `--color-accent-ring` (teclado externo / acessibilidade).
- Animações apenas em `transform` e `opacity` (fluidas a 60/120 Hz).
- Nada de `alert()`/`confirm()` nativos: Dialog e Toast próprios.

## 7. Otimização para iPhone 17 Pro Max (iOS 26) — v0.3.4

Dispositivo de referência: **440 × 956 pt @3x** (1320 × 2868 px), Dynamic Island. Safe areas assumidas (a confirmar no aparelho): vertical topo 62 / base 34; horizontal laterais 62 / base 21.

| Decisão | Motivo |
|---|---|
| Barra inferior em **cápsula de vidro flutuante**, sempre acima do indicador inicial | Linguagem visual do iOS 26; toques fora da zona do gesto de sair da app |
| Barra de navegação superior de **44 pt** | Padrão iOS; recupera espaço vertical |
| **Avisos no topo** (abaixo da Dynamic Island) | Não tapam botões de painéis nem listas |
| **Horizontal compacto**: título no cabeçalho, pesquisa e ferramentas na mesma linha, barra de 52 pt com ícone e texto lado a lado | A altura (440 pt) é o recurso escasso; TV passa de 1 para 4 canais visíveis |
| `:active` ativado no iOS, sem pré-visualização de links ao pressionar, sem zoom por toque duplo | Sensação de app nativa |
| Painéis sobem acima do **teclado** (`visualViewport`) | O iOS não encolhe o layout quando o teclado abre |
| **Deslizar da margem esquerda para voltar** (só na app instalada) | A PWA instalada não tem o gesto nativo do Safari |
| Ícone, ecrãs de arranque (vertical/horizontal) e manifesto | Aspeto de app no ecrã principal |

Validação automática: `tests/e2e/iphone.mjs` (nenhum elemento interativo ou texto fixo nas safe areas, sem scroll horizontal, nº mínimo de canais visíveis) e `tests/e2e/gestures.mjs`.
