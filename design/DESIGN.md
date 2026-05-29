# Gimbo Design System

> Fonte única de verdade para decisões visuais do projeto.
> Use este documento ao construir componentes, alimentar prompts de IAs geradoras de UI, ou revisar consistência visual.
> Em caso de conflito entre este documento e o código, o código é o árbitro — atualize este documento.

---

## 1. Princípios

A linguagem visual é **"The Fluid Ledger"**: editorial, minimalista, calma. O produto deve sentir como um *lookbook* premium, não como uma planilha.

- **Persona:** "O Concierge Digital" — autoridade calma. Dados complexos apresentados com clareza e espaço, nunca com ansiedade.
- **Identidade:** "Gimbo" é gíria brasileira para dinheiro. Brasileira por origem, acessível por propósito, sofisticada por execução.
- **Privacidade como valor:** os dados nunca saem do dispositivo sem ação explícita do usuário. A UI reforça isso com linguagem de posse ("seu ledger", "seu cofre").
- **Público:** usuários leigos confortáveis com tecnologia do dia a dia. A interface nunca exige conhecimento técnico.

### Princípios de produção

- **Superfície cria hierarquia, não linhas.** Separadores e bordas de seção são proibidos; profundidade vem de contraste entre superfícies e sombra.
- **Sem gradientes em fundos.** O único gradiente do sistema é no botão primário (primary → primary-container).
- **Glassmorphism delimitado.** Apenas em chrome flutuante (navbar, modais, sheets): `background 80% opacity + backdrop-blur(24px)`. Tudo mais é opaco.
- **Whitespace é textura.** Se uma tela parece "vazia", provavelmente está funcionando.
- **Sem emoji em UI funcional.** Exceções: flags de locale (🇧🇷 🇺🇸) e `→` em CTAs primários.

---

## 2. Voz e Conteúdo

### Tom
Calmo, preciso, discretamente confiante. Respeita a inteligência do usuário, nunca patroniza, nunca alarma.

- **Pessoa:** "você" (informal-respeitoso). Produto em 1ª pessoa com parcimônia: "O Gimbo opera como…"
- **Posse do usuário:** sempre enfatizada — *"Seus dados nunca deixam seu dispositivo"*, *"Seu Ledger, Sua Liberdade."*
- **Tom editorial:** headlines leem como uma revista, não um formulário.

### Casing

| Contexto | Regra | Exemplos |
| :--- | :--- | :--- |
| Botões e ações chave | Title Case | "Criar Cofre de Dados", "Salvar Despesa", "Ver Tudo" |
| Micro-labels acima de valores | UPPERCASE + letter-spacing | `FATURA`, `LIMITE DISPONÍVEL`, `R$` |
| Corpo e hints | Sentence case | "Nenhum dado encontrado" |

### Nomenclatura do domínio

O produto eleva termos comuns de finanças:

| Termo genérico | Gimbo |
| :--- | :--- |
| Transações | **Lançamentos** |
| Dashboard | **Visão Geral** |
| Relatórios | **Relatórios** (mantido) |
| Arquivo de backup | **Cofre de Dados** |
| Modelo de dados | **Ledger** |

### Números e moeda

Sempre `R$` via `Intl.NumberFormat('pt-BR', { currency: 'BRL' })` → `R$ 1.234,56`.
Receitas prefixadas com `+`, despesas com `-`. Números são os heróis: grandes, sem serifa, tabulares.

### Tom em momentos sensíveis

- **Empty state:** neutro, nunca dramático — *"Nenhum dado encontrado"* (não "Ops!").
- **Erros:** factuais + acionáveis — *"Arquivo inválido ou corrompido. Verifique se é um arquivo exportado pelo Gimbo."*
- **Privacidade:** fato, não promessa — *"Privacidade de ponta-a-ponta garantida."*
- **Demo mode:** *"Modo demonstração — alterações não são salvas."*

### Micro-copy

Presente só onde agrega valor: *"Pressione Enter para salvar rapidamente"*, *"Seus dados serão armazenados com segurança no seu dispositivo."* Curto, útil, não intrusivo.

---

## 3. Cores

### Floresta (Primária — Verde-musgo)

Cor âncora da marca. Transmite confiança, natureza e dinheiro sem ser óbvia.

| Token | Hex | Uso |
| :--- | :--- | :--- |
| Floresta 50 | `#D5F0E8` | Fundos de badges, highlights suaves |
| Floresta 100 | `#AADFD1` | `primary-container` light mode; hover em superfícies primárias claras |
| Floresta 200 | `#7FCAB8` | Barras de progresso secundárias |
| Floresta 400 | `#3D9E82` | Ícones de suporte; `primary` dark mode; paleta de gráficos |
| **Floresta 600** | **`#2D6A4F`** | **Cor primária** — botões, nav ativa, FAB, links, valores de receita |
| Floresta 700 | `#1F4D38` | Hover de botão primário; `primary-container` dark mode |
| Floresta 800 | `#143326` | Active de botão; card de saldo (fundo) |
| Floresta 900 | `#0A1F16` | Fundo dark mode; tint de sombras |

### Âmbar (Acento)

Acento quente. Máximo uma ocorrência destacada por tela.

| Token | Hex | Uso |
| :--- | :--- | :--- |
| Âmbar 50 | `#FEF3DC` | Fundos de badges de aviso |
| Âmbar 100 | `#FAE3A8` | Hover em superfícies âmbar |
| **Âmbar 400** | **`#D4A017`** | **Acento** — logo ("bo"), highlight de dados em gráficos, avisos |
| Âmbar 600 | `#A87B0C` | Texto sobre fundos âmbar claros |
| Âmbar 800 | `#6B4E07` | Texto em badges âmbar |

### Petróleo (Suporte — Azul-escuro)

Complemento ao verde em ícones, segundo tom em gráficos, links informativos.

| Token | Hex | Uso |
| :--- | :--- | :--- |
| Petróleo 50 | `#DDEAF7` | Fundos de ícones de conta bancária |
| Petróleo 200 | `#85B7EB` | Elementos de suporte em gráficos |
| **Petróleo 600** | **`#1B4F72`** | Segundo tom em gráficos, links informativos |
| Petróleo 800 | `#0C3250` | Texto sobre fundos petróleo claros |

### Bambu (Neutro Quente)

Substitui o cinza frio padrão. Dá calor sem chamar atenção.

| Token | Hex | Uso |
| :--- | :--- | :--- |
| Bambu 50 | `#F4F5F0` | **Fundo de página** (light mode) |
| Bambu 100 | `#E8EAE2` | Divisores, bordas suaves |
| Bambu 200 | `#D6D8D0` | Bordas de cards e inputs |
| Bambu 300 | `#C4C6BE` | Bordas de inputs (variante) |
| Bambu 400 | `#A8AA9F` | Placeholder, ícones disabled, paleta de gráficos |
| Bambu 600 | `#6B7280` | Texto secundário |
| Bambu 800 | `#374151` | Texto primário alternativo |
| Bambu 900 | `#1A1F2E` | Texto principal (light mode) |

### Feedback (Semântica)

| Semântica | Hex | Uso |
| :--- | :--- | :--- |
| Receita / Sucesso | `#2D6A4F` | Valores positivos, estados de sucesso (Floresta 600) |
| Despesa / Erro | `#C0392B` | Valores negativos, ações destrutivas, erros |
| Aviso | `#D4A017` | Alertas de limite, fatura próxima (Âmbar 400) |
| Info | `#1B4F72` | Tooltips informativos, links neutros (Petróleo 600) |

### Cores de emissoras de cartão de crédito

| Emissora | Cor | Hex |
| :--- | :--- | :--- |
| Nubank | Roxo | `#820AD1` |
| Itaú | Laranja | `#EC7000` |
| Inter | Laranja claro | `#FF7A00` |

### Paleta de gráficos

Para pizza/donut (despesas por categoria), nesta ordem:

1. `#2D6A4F` — Floresta 600 (primária)
2. `#1B4F72` — Petróleo 600
3. `#D4A017` — Âmbar 400
4. `#C0392B` — Vermelho (despesa)
5. `#3D9E82` — Floresta 400
6. `#A8AA9F` — Bambu 400 (outros)

Máximo 6 cores por gráfico. Excedentes agrupam em "Outros" com Bambu 400.

### Tokens CSS (variáveis em `src/index.css`)

#### Light mode

| Variável CSS | Valor |
| :--- | :--- |
| `--color-primary` | `#2D6A4F` |
| `--color-on-primary` | `#FFFFFF` |
| `--color-primary-container` | `#AADFD1` |
| `--color-on-primary-container` | `#0A1F16` |
| `--color-tertiary` | `#C0392B` |
| `--color-on-tertiary` | `#FFFFFF` |
| `--color-tertiary-container` | `#FAD0CC` |
| `--color-on-tertiary-container` | `#5A0000` |
| `--color-surface` | `#F4F5F0` |
| `--color-surface-container-lowest` | `#FFFFFF` |
| `--color-surface-container-low` | `#F4F5F0` |
| `--color-surface-container` | `#E8EAE2` |
| `--color-surface-container-high` | `#D6D8D0` |
| `--color-surface-container-highest` | `#C4C6BE` |
| `--color-on-surface` | `#1A1F2E` |
| `--color-on-surface-variant` | `#6B7280` |
| `--color-outline` | `#A8AA9F` |
| `--color-outline-variant` | `rgba(10, 31, 22, 0.15)` |
| `--color-error` | `#C0392B` |
| `--color-on-error` | `#FFFFFF` |
| `--color-error-container` | `#FAD0CC` |
| `--color-on-error-container` | `#5A0000` |

#### Dark mode (classe `.dark`)

| Variável CSS | Valor |
| :--- | :--- |
| `--color-primary` | `#3D9E82` |
| `--color-on-primary` | `#0A1F16` |
| `--color-primary-container` | `#1F4D38` |
| `--color-on-primary-container` | `#AADFD1` |
| `--color-tertiary` | `#F1948A` |
| `--color-on-tertiary` | `#5A0000` |
| `--color-tertiary-container` | `#7B241C` |
| `--color-on-tertiary-container` | `#FAD0CC` |
| `--color-surface` | `#0A1F16` |
| `--color-surface-container-lowest` | `#060F0D` |
| `--color-surface-container-low` | `#0F2C1E` |
| `--color-surface-container` | `#143326` |
| `--color-surface-container-high` | `#1A3D2E` |
| `--color-surface-container-highest` | `#214836` |
| `--color-on-surface` | `#D5F0E8` |
| `--color-on-surface-variant` | `#A8AA9F` |
| `--color-outline` | `#6B7280` |
| `--color-outline-variant` | `rgba(213, 240, 232, 0.12)` |
| `--color-error` | `#F1948A` |
| `--color-on-error` | `#5A0000` |
| `--color-error-container` | `#7B241C` |
| `--color-on-error-container` | `#FAD0CC` |

---

## 4. Tipografia

Família: **Inter** exclusivamente. Legível, geométrica, ideal para números financeiros.

Pesos: Regular (400), Medium (500), SemiBold (600). Peso 700 reservado para `display` em destaque máximo.
Números monetários sempre com **font-variant-numeric: tabular-nums** para alinhamento em colunas.

**Casing:** sempre sentence case, exceto `label-caps` (≤ 11px) e micro-labels de dados (UPPERCASE, letter-spacing elevado).

### Escala tipográfica

| Token | Tamanho | Peso | Line-height | Letter-spacing | Uso |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `display` | 32px | 600 | 1.2 | -0.02em | Títulos de seção principais |
| `headline` | 24px | 600 | 1.3 | -0.01em | Cabeçalhos de card |
| `title` | 18px | 600 | 1.4 | 0 | Subtítulos, títulos de modais |
| `body-lg` | 16px | 400 | 1.6 | 0 | Corpo de texto, labels de formulário |
| `body-md` | 14px | 400 | 1.5 | 0 | Conteúdo secundário, descrições |
| `label` | 12px | 500 | 1.0 | 0 | Metadados, datas, contagens |
| `label-caps` | 11px | 600 | 1.0 | 0.05em | Categorias em listas, headers de tabela — UPPERCASE |
| `numeric-display` | 40px | 500 | 1.0 | -0.03em | Saldos e valores principais em destaque (tabular-nums) |

---

## 5. Logo

Logotipo tipográfico em dois tons:

```
Gim  →  Floresta 600  (#2D6A4F)
bo   →  Âmbar 400     (#D4A017)
```

- Peso: SemiBold (600), tamanho mínimo 14px
- Contextos monocromáticos (favicon, ícone de app): usar "G" em Floresta 600
- Nunca sobre fundos que comprometam o contraste de qualquer um dos tons

---

## 6. Elevação e Profundidade

Hierarquia por contraste de superfície, não por linhas ou bordas de seção.

### Níveis de superfície (light mode)

| Nível | Token | Hex | Uso |
| :--- | :--- | :--- | :--- |
| L0 | `surface` | `#F4F5F0` | Fundo de página |
| L1 | `surface-container-low` | `#F4F5F0` | Seções, fundos de listas |
| L2 | `surface-container-lowest` | `#FFFFFF` | Cards — o branco "sobe" sobre o cinza |

Um card branco sobre fundo levemente cinza cria "lift" sem borda ou sombra pesada.

### Sombras

| Token | Valor CSS | Uso |
| :--- | :--- | :--- |
| `shadow-sm` | `0 1px 3px rgba(10,31,22,0.08)` | Cards em repouso |
| `shadow-md` | `0 4px 12px rgba(10,31,22,0.12)` | Cards em hover + `translateY(-1px)` |
| `shadow-xl` | `0 8px 32px rgba(10,31,22,0.16)` | Modais e drawers |
| `shadow-ambient` | `0 20px 40px rgba(10,31,22,0.06)` | Assinatura do sistema — efeito "flutuando" |
| `focus-ring` | `0 0 0 3px rgba(45,106,79,0.30)` | Obrigatório em todos os elementos interativos |

**Dark mode:** substituir tint por `rgba(0,0,0,X)` com opacidade elevada (0.3–0.4).

---

## 7. Espaçamento e Layout

Grid base de **8px**.

### Tokens de espaçamento

| Token (Tailwind) | Valor | Uso |
| :--- | :--- | :--- |
| `2` | 8px | Gaps mínimos, espaço interno pequeno |
| `3` | 12px | Padding vertical em listas densas |
| `4` | 16px | Gutters, padding compacto, FAB margins |
| `5` | 20px | Padding interno de cards padrão |
| `6` | 24px | Padding de cards grandes, modais |
| `12` | 48px | Separação entre seções maiores |

### Layout

- **Max-width de conteúdo:** `max-w-7xl` (1280px)
- **Topbar height:** 48px (glassmorphic)
- **FAB mobile:** `bottom: 16px; right: 16px`
- **Gap entre cards em grid:** 12px
- **Assimetria intencional em dashboards:** coluna principal 2/3 + atividade recente 1/3

### Chrome flutuante por breakpoint

| Contexto | Chrome |
| :--- | :--- |
| Mobile | Bottom nav glassmorphic com botão `+` central |
| Desktop | Top bar glassmorphic + FAB pill no canto |

---

## 8. Formas e Raios (Border Radius)

Nada é totalmente quadrado. Raio mínimo: `rounded-lg` (8px). Valores baseados na escala padrão do Tailwind CSS v4.

| Classe Tailwind | Valor | Uso |
| :--- | :--- | :--- |
| `rounded-sm` | 2px / 0.125rem | Checkboxes, progress bars, badges muito pequenos |
| `rounded-md` | 6px / 0.375rem | Mínimo absoluto; não usar em cards |
| `rounded-lg` | 8px / 0.5rem | Inputs, chips, segmented controls, badges |
| `rounded-xl` | 12px / 0.75rem | Cards compactos, ícones de conta |
| `rounded-2xl` | 16px / 1rem | **Cards padrão** (uso mais comum); botões |
| `rounded-3xl` | 24px / 1.5rem | Hero cards, sheets/drawers |
| `rounded-4xl` | 32px / 2rem | Modais grandes, painéis de onboarding |
| `rounded-full` | 9999px | Avatares, pills, tags, FAB, toggles |

---

## 9. Iconografia

Biblioteca: **Lucide Icons** (`lucide-react`). Linha fina, geométrica, consistente com o peso do Inter.

- **Stroke:** `strokeWidth={1.5}` para todos os ícones de UI. `2–2.5` somente para glyphs enfáticos pequenos (nav `+`, setas de CTA).
- **Tamanhos:** `16px` inline/campos, `18px` em linhas de lista e menus, `20–22px` em nav e cabeçalhos de seção, `24px` em empty states e modais.
- **Cor:** `currentColor` — herda do contexto. Ícones inativos em `opacity-40`; hover/active em `opacity-70` ou opacidade total.
- **Chip de categoria/conta:** ícone branco sobre fundo arredondado na cor da categoria.
- **Proibido:** emoji como ícones funcionais. Sem SVG ilustrativo além do `hero.png`.

### Ícones comuns no produto

`Home, Receipt, BarChart2, Settings, Bell, Plus, TrendingUp, TrendingDown, CreditCard, Landmark, PiggyBank, Bitcoin, Briefcase, ShieldCheck, Lock, FileJson, Calendar, Tag, ChevronDown, CheckCircle2, Clock, X, Trash2, ArrowRight`

---

## 10. Componentes

### Botões

| Variante | Fundo | Texto | Hover | Active |
| :--- | :--- | :--- | :--- | :--- |
| **Primário** | Gradiente Floresta 600 → Floresta 100 | Branco | `brightness(1.08)` | `brightness(0.95)` |
| **Acento (raro)** | Âmbar 400 | Floresta 900 | Âmbar 600 | Âmbar 800 |
| **Ghost / Secundário** | Transparente | Floresta 600 | Bambu 50 | Bambu 100 |
| **Destrutivo** | Transparente | `#C0392B` | `#FDECEA` | `#FAD0CC` |

- **Press:** `transform: scale(0.97)` em botões primários e FAB
- **Hover:** apenas mudança de cor/brilho, sem scale
- **Disabled:** `opacity: 0.4`
- Transições: `150ms ease-in-out`
- Border-radius: `rounded-2xl` (24px)
- Padding: `10px 16px` (padrão), `8px 12px` (compacto)

### Cards

- **Fundo:** Branco (`#FFFFFF`)
- **Borda:** `0.5px` sólida Bambu 200
- **Sombra:** `shadow-sm`; hover → `shadow-md + translateY(-1px)`
- **Border-radius:** `rounded-xl` (16px)
- **Padding:** `20px`

> **Direção:** a borda de 0.5px é o estado atual do código. O alvo do design system é hierarquia por superfície+sombra sem borda, mas a remoção das bordas é uma refatoração separada.

**Card de destaque (ex: saldo total):**
- Fundo Floresta 800 (`#143326`), texto branco, sem borda, `shadow-ambient`

### Inputs de Formulário (estilo "filled")

- **Fundo:** `surface-container-high` (`#D6D8D0`)
- **Borda:** nenhuma no repouso
- **Foco:** `focus-ring` verde (sem borda pesada)
- **Placeholder:** Bambu 400
- **Border-radius:** `rounded-lg` (12px)
- Labels sempre em sentence case

### Barras de Progresso (limite de crédito)

- **Track:** Bambu 100
- **Fill normal:** Floresta 600
- **Fill alerta (> 80%):** Âmbar 400
- **Fill crítico (> 95%):** `#C0392B`
- **Altura:** 4px, `rounded-full`

### Avatares de Transação / Categoria

- Círculo `28px`, `rounded-full`
- Fundo: tom 50 da família do ícone (Floresta 50, Âmbar 50, Petróleo 50)
- Letra/ícone em tom 600 da mesma família
- Tamanho da letra: 11px, Medium

### FAB (Floating Action Button — mobile)

- Fundo: Floresta 600, ícone branco
- `rounded-full`, padding `10px 20px`
- Sombra: `shadow-md`
- **Press:** `scale(0.97)`
- Label: "+ Nova transação"

### Chrome Glassmorphic (navbar, modais, sheets)

- `background: rgba(var(--color-surface), 0.80)`
- `backdrop-filter: blur(24px)`
- Sem borda visível — a borda de vidro é o único hairline permitido
- Sombra: `shadow-xl` (`0 8px 32px ...`)

---

## 11. Animação e Motion

**Calma, nunca saltitante.** Nada que distraia do dado financeiro.

### Curva padrão

```css
cubic-bezier(0.16, 1, 0.3, 1)   /* ease-out suave, sem overshoot */
```

### Durações

| Interação | Duração |
| :--- | :--- |
| Hover (cor, opacidade) | 150ms |
| Toggles, tabs, chips | 250ms |
| Drawers, sheets, modais | 300ms |
| Backdrop fade | 200ms |

### Padrões de entrada

- **Drawers:** slide-in pelo eixo X (desktop) ou Y (mobile)
- **Modais:** fade + scale de 0.96 → 1.0
- **Backdrops:** fade simples

---

## 12. Estados de Interação

| Estado | Tratamento |
| :--- | :--- |
| Hover (linhas de lista) | Background `surface-container-low` |
| Hover (ícones) | Opacidade `40% → 70%` |
| Hover (botão primário) | `brightness(1.08)` |
| Press (botões, FAB) | `scale(0.97)` |
| Active (nav item) | Underline primary (desktop) / ícone tintado primary (mobile) |
| Disabled | `opacity: 0.4` |
| Focus | `focus-ring` obrigatório em todos os elementos interativos |
