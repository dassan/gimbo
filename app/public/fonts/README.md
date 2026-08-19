# Fontes self-hospedadas — procedência (SEC-15)

## `inter-latin-var.woff2`

Fonte **Inter**, subset `latin`, arquivo variável (eixo `wght`), 48.256 bytes.

| | |
|---|---|
| SHA-256 | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| Origem | `https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2` |
| Baixado em | 2026-08-19 |
| Licença | SIL Open Font License 1.1 — ver `OFL.txt` |

### Por que este arquivo, e não o release upstream

São exatamente os bytes que o Google já servia aos usuários do Gimbo antes do `SEC-15` — o
`@import` do `index.css` apontava para o CSS que referencia esta URL. Vendorizar o mesmo arquivo
torna a mudança **byte-idêntica do ponto de vista visual**: zero risco de a tipografia mudar de
aparência ao remover o terceiro. O `InterVariable.woff2` oficial (`rsms/inter`) tem o charset
completo (~340 KB) e precisaria ser subsetado para chegar no mesmo resultado.

### Por que só o subset `latin`

O `unicode-range` do subset `latin` é `U+0000-00FF` + pontuação e símbolos — cobre **todos** os
acentos do português (`á à â ã ç é ê í ó ô õ ú`) e do inglês, os dois únicos locales do app
(`pt-BR`, `en-US`). Os subsets `latin-ext`, `cyrillic`, `cyrillic-ext`, `greek`, `greek-ext` e
`vietnamese` que o Google também declara nunca eram baixados por esses usuários — o browser só
busca o subset que o `unicode-range` exige. Manter só o `latin` é o mesmo custo de banda de antes.

### Por que um arquivo só para 4 pesos

É uma fonte **variável** com eixo `wght` contínuo, então um arquivo cobre 400/500/600/700 (e o
`@font-face` em `src/index.css` declara `font-weight: 400 700`). Verificado empiricamente antes de
adotar — medindo a largura do mesmo texto nos 4 pesos com `font-synthesis: none` (que desliga o
negrito sintético do browser): larguras distintas em todos, confirmando que o eixo é real e que os
222 usos de `font-semibold` do código não iam renderizar como 400 nem como falso-negrito.

### Como regenerar / atualizar

```bash
# 1. Descobrir a URL atual do subset latin (a versão muda: v20 → v21…)
curl -s -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" \
  | grep -B2 "unicode-range: U+0000" | grep -oE "https://[^)]*woff2" | head -1

# 2. Baixar e substituir
curl -sL "<URL>" -o app/public/fonts/inter-latin-var.woff2

# 3. Conferir que o unicode-range no @font-face de src/index.css ainda bate com o do CSS do Google
```

Ao atualizar, revisar também o `unicode-range` declarado em `src/index.css`: ele precisa continuar
espelhando o do subset, senão o browser pede a fonte para caracteres que o arquivo não tem (ou
deixa de pedir para caracteres que tem).

## Obrigação de licença

A OFL 1.1 permite redistribuição, inclusive de versões subsetadas, **desde que o aviso de copyright
e a licença acompanhem o arquivo** — é o papel do `OFL.txt` aqui. Não renomear a família para algo
que contenha "Inter" caso a fonte venha a ser modificada (a OFL reserva o nome original para o
projeto upstream); subsetar não conta como modificação para esse fim.
