# Gimbo — Roteiro Vídeo Institucional

> Status: **rascunho aprovado** — aguardando logo para finalizar prompt de geração de vídeo.
> Duração alvo: ~60 segundos.
> Última atualização: 2026-05-28.

---

## Premissas Criativas

| Item | Decisão |
|---|---|
| **Tom** | Sóbrio, sofisticado, confiante — "digital concierge" |
| **Ritmo** | Lento nos 10s iniciais (gancho emocional) → progressivo → impactante no final |
| **Paleta** | Fundo neutro claro `#F8F9FA`, acento verde `#006E2F` / `#22C55E`, vermelho apenas pontualmente |
| **Tipografia** | Inter — grandes, arejadas, headline editorial |
| **Música** | Minimalista, piano + sintetizador ambient. Sem batida agressiva |
| **Narração** | Voz masculina ou feminina, calma, pausada — como um consultor financeiro de alto nível |
| **Idioma** | Português brasileiro |

---

## Cenas

---

### [00:00 – 00:10] O Problema

**Cena:** Tela de smartphone mostrando várias notificações de apps financeiros — Nubank, Guiabolso, Organizze. Câmera se afasta lentamente. Ambiente frio, azulado, corporativo.

**Narração:**
> "Você registra cada gasto, cada receita, cada parcela.
> Mas seus dados… ficam nos servidores de outra pessoa."

**Visual:** Ícones de nuvem corporativa surgem sobre os apps. Cadeados abertos. Dados voando para servidores distantes.

---

### [00:10 – 00:18] A Virada

**Cena:** Fade para tela preta. Uma única linha verde pulsando, como um ECG financeiro. Depois, o nome **Gimbo** surge centralizado em Inter, peso bold, letras grandes.

**Narração:**
> "E se seus dados financeiros fossem… só seus?"

**Visual:** Letras do nome surgem uma a uma com suavidade. Sem efeito flash agressivo.

---

### [00:18 – 00:35] O Produto

**Cena:** Mockup de interface do Gimbo abrindo no navegador (PWA) — dashboard limpo, fundo `#F8F9FA`, cards brancos flutuando, saldo em destaque com tipografia editorial. Câmera faz um dolly suave sobre a tela.

**Narração:**
> "Gimbo é um app de finanças pessoais que roda inteiramente no seu dispositivo.
> Sem servidor. Sem cadastro. Sem nuvem corporativa.
> Seus dados vivem em um único arquivo no seu computador — e só você decide o que fazer com ele."

**Destaques visuais** (sequência rápida de 2–3 frames, ~2s cada):
1. Tela do Dashboard com gráfico de fluxo de caixa ±3 meses
2. Tela de Cartão de Crédito com barra de utilização e fatura
3. Tela de Transações sendo lançada rapidamente (< 2 cliques)

---

### [00:35 – 00:48] O Diferencial

**Cena:** Split-screen sutil: à esquerda, um servidor de dados com ícone de cadeado aberto (apps convencionais). À direita, um arquivo JSON brilhando com cadeado fechado — controlado pelo usuário.

**Narração:**
> "Enquanto outros apps monetizam seu histórico financeiro,
> o Gimbo devolve algo raro: **controle real sobre seus dados.**
> Análises avançadas, projeções de caixa, gestão de parcelas e cartões —
> tudo isso sem abrir mão da sua privacidade."

**Visual:** A metade esquerda escurece. A direita brilha em verde. O arquivo do usuário pulsa como um coração.

---

### [00:48 – 00:58] Call to Action

**Cena:** Interface do Gimbo em tela cheia, numa janela de navegador aberta no computador de uma mesa limpa e organizada. Ambiente quente, luz natural. Pessoa ao fundo (desfocada) usando o app.

**Narração:**
> "Gimbo. Finanças pessoais. Do jeito que deveriam ser."

**Visual:** URL ou tagline na tela:
- **`gimbo.app`** *(substituir pelo domínio real)*
- Abaixo: `"Seus dados. Seu dispositivo. Sua escolha."`

---

### [00:58 – 01:00] Encerramento

**Cena:** Logo Gimbo em fundo escuro (`#191C1D`). Fade out lento.

**Música:** Resolve no acorde final com suavidade.

> ⚠️ **Pendência:** logo ainda não criado — ver seção abaixo.

---

## Próximos Passos

1. **Criar logo** usando o prompt em `LOGO_PROMPT.md` (a criar)
2. **Validar logo** nos critérios de legibilidade (16px favicon, 512px PWA icon, fundo escuro)
3. **Inserir logo** na cena de encerramento [00:58–01:00]
4. **Transformar este roteiro** em prompt detalhado para gerador de vídeo (Sora / Runway / Kling / Pika)
   - Descrição de câmera por cena (lens, movimento, ângulo)
   - Referências de estilo ("Apple product video", "linear.app aesthetic")
   - Mood board de paleta em hex
   - Instruções de timing por segmento
   - Estilo de transição entre cenas

---

## Prompt de Logo (rascunho — mover para arquivo dedicado)

> Direção escolhida: **G + Cadeado, Geométrico Minimalista**
> Referências: Linear app, Vercel, 1Password

### Versão Ideogram (recomendada — texto legível)

```
A minimalist geometric logo for a personal finance web app called "GIMBO".

The logomark consists of a stylized capital letter "G" where the open terminal
of the G naturally forms the body of a minimalist padlock. The padlock shackle
(the U-shaped arc) completes the top-left curve of the G. The design should feel
like a single unified geometric shape — not two elements glued together.

Style: precision geometry, negative space, zero ornamentation, clean vectors.
No gradients. No shadows. No rounded pill shapes. Hard right angles where possible,
with only intentional curves from the letterform.

Color: deep forest green #006E2F on pure white #FFFFFF background.
The logomark only — no taglines inside the mark itself.

Below the logomark, the wordmark "GIMBO" in a geometric sans-serif typeface
(Inter or similar), medium weight, wide tracking (letter-spacing 0.15em),
all uppercase. Same green #006E2F.

References: Linear app logo, Vercel logo, 1Password logo geometric treatment.
Tech premium fintech identity. Privacy and data ownership theme.

Output: vector-style flat logo on white background, suitable for app icon and
browser favicon. Square composition.

Negative prompt: no 3D effects, no gradients, no shadows, no clipart style,
no generic shield shape unrelated to the G letterform, no cartoon, no thin
hairlines, no serif typefaces, no colorful palette.
```

### Versão Midjourney v6

```
minimalist geometric logo design, letter "G" and padlock unified as single
letterform, padlock shackle forms the G curve arc, financial privacy app
"GIMBO", flat vector, deep forest green #006E2F on white, geometric sans-serif
wordmark below in wide tracking, negative space design, precision angles,
tech startup brand identity, references Linear app Vercel 1Password,
no gradients no shadows no 3D, professional fintech --ar 1:1 --style raw
--v 6.1 --no gradients shadows 3d-effects clipart cartoon shield-cliche
```

### Variações a Solicitar

| Variação | Instrução adicional |
|---|---|
| **A** | Shackle do cadeado em peso mais fino (contraste de espessura) |
| **B** | Shackle fechado à direita do G (composição espelhada) |
| **C** | Versão monocromática preta — para uso em fundos escuros |
| **D** | Ícone isolado sem wordmark — para favicon e ícone PWA 512×512 |

### Checklist de Validação do Logo

- [ ] G e cadeado leem como **uma forma só**, não dois elementos sobrepostos
- [ ] Legível em **16×16px** (favicon) e **512×512px** (PWA icon)
- [ ] Funciona em **fundo escuro** (modo dark do app)
- [ ] Wordmark "GIMBO" **ortograficamente correto**
- [ ] Sem gradientes ou efeitos 3D que dificultem uso em SVG
