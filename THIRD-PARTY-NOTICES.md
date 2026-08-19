# Avisos de Terceiros

O Gimbo é distribuído sob a licença MIT (ver `LICENSE`). O aplicativo publicado embute código de
terceiros, e as licenças abaixo exigem que o aviso de copyright acompanhe a redistribuição — é o
que este arquivo cumpre (`SEC-14`).

O escopo é **o que vai para o bundle de produção**: as dependências de runtime declaradas em
`app/package.json` → `dependencies`, mais a fonte self-hospedada. Ferramentas de build e teste
(`devDependencies`) não são redistribuídas e por isso não aparecem aqui.

Nenhuma dependência é GPL, AGPL ou SSPL. Todas são permissivas e compatíveis com a distribuição
sob MIT.

---

## Fonte

### Inter — SIL Open Font License 1.1

Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)

Self-hospedada em `app/public/fonts/` desde o `SEC-15`. O texto completo da licença acompanha o
arquivo em `app/public/fonts/OFL.txt`, e a procedência do `.woff2` está documentada em
`app/public/fonts/README.md`.

> A OFL exige que a licença acompanhe o arquivo de fonte, então o `OFL.txt` permanece ao lado do
> `.woff2` mesmo estando referenciado aqui. Não mover.

---

## Motor de banco de dados

### wa-sqlite — MIT

Copyright (c) 2023 Roy T. Hashimoto

Build WebAssembly do SQLite usado como camada de persistência (`app/src/services/storage/`).

> **Atenção ao auditar licenças automaticamente:** o `package.json` do `wa-sqlite` **não declara o
> campo `license`**, então ferramentas de varredura o reportam como "UNKNOWN". A licença MIT está
> no arquivo `LICENSE` do pacote. Foi esse falso positivo que originou o `SEC-14`.

O `wa-sqlite` embute o **SQLite**, que é de **domínio público** (dedicação explícita dos autores,
sem exigência de atribuição). A menção aqui é informativa, não uma obrigação de licença.

---

## Bibliotecas de runtime

| Pacote | Licença | Copyright |
|---|---|---|
| `react` | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `react-dom` | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `react-is` | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `react-router-dom` | MIT | Copyright (c) React Training LLC 2015-2019 |
| `zustand` | MIT | Copyright (c) 2019 Paul Henschel |
| `zod` | MIT | Copyright (c) 2025 Colin McDonnell |
| `recharts` | MIT | Copyright (c) 2015-present recharts |
| `i18next` | MIT | Copyright (c) 2011-present i18next |
| `react-i18next` | MIT | Copyright (c) 2015-present i18next |
| `tailwindcss` | MIT | Copyright (c) Tailwind Labs, Inc. |
| `@tailwindcss/vite` | MIT | Copyright (c) Tailwind Labs, Inc. |
| `tailwind-merge` | MIT | Copyright (c) 2021 Dany Castillo |
| `clsx` | MIT | Copyright (c) Luke Edwards (lukeed.com) |
| `idb` | ISC | Copyright (c) 2016, Jake Archibald |
| `lucide-react` | ISC | Copyright (c) 2026 Lucide Icons and Contributors |

O texto integral de cada licença acompanha o respectivo pacote em `app/node_modules/<pacote>/LICENSE`.

---

## Como manter este arquivo

Ao adicionar ou remover uma dependência de **runtime** (`dependencies`, não `devDependencies`),
atualizar a tabela acima. Para levantar o estado real em vez de confiar na memória:

```bash
cd app && python3 - <<'EOF'
import json, os
for name in sorted(json.load(open('package.json'))['dependencies']):
    j = json.load(open(f'node_modules/{name}/package.json'))
    print(f"{name:24} {j.get('version','?'):12} {j.get('license') or 'NÃO DECLARADA'}")
EOF
```

Licença reportada como "NÃO DECLARADA" não significa ausência de licença — significa que o
`package.json` omite o campo, e o arquivo `LICENSE` do pacote precisa ser lido à mão (foi o caso do
`wa-sqlite`).
