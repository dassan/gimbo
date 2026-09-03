#!/usr/bin/env python3
"""Gera o cofre sintético de demonstração do Gimbo (F-25) — a "Família Ribeiro".

Uma família de 4 pessoas, classe média-alta brasileira, com 5 anos de histórico
(2024-01 a 2028-12): dois anos de passado realizado, o mês corrente e dois anos de
lançamentos futuros ainda não pagos.

Saída: o `DataFile` (schema v19) em JSON, gravado nos dois caminhos que o app sabe ler —
`app/src/assets/demo-data.json` (VITE_DEMO_MODE=true) e `app/public/dev/seed.json`
(`?devSeed` em dev). Rodar sem argumentos regenera os dois; `--out` grava num caminho só.

Determinístico: `random.Random(SEED)` e ids `uuid5` — rodar duas vezes dá byte a byte o
mesmo arquivo, então o diff no git é sempre legível.

Invariantes que o app impõe e este gerador respeita (ver CLAUDE.md):
  * `Account.balance` é o saldo *inicial*; o exibido é derivado das transações. As sementes
    das contas de caixa são resolvidas no fim (`solve_seed`) para que o saldo derivado hoje
    caia num número escolhido.
  * TRANSFER e CREDIT_PAYMENT contam no saldo *independentemente da data* e de `isPaid`
    (`isCashRealized`), e o Dashboard não filtra por data. Por isso **nenhum dos dois é
    emitido com data futura** — só INCOME/EXPENSE atravessam o presente, sempre com
    `isPaid=False` no futuro.
  * `categoryId` vazio em TRANSFER/CREDIT_PAYMENT, como o app grava.
  * `Transaction.referenceMonth` só nos pagamentos de fatura (a associação autoritativa da
    fatura, B-18); as compras deixam o motor derivar o período pelo `closingDay`.
  * Ícone de categoria: só os 12 nomes que `CATEGORY_ICONS` (Settings) conhece — qualquer
    outro cai num ícone genérico na tela.
"""

from __future__ import annotations

import argparse
import json
import random
import uuid
from calendar import monthrange
from datetime import date, timedelta
from pathlib import Path

# ─── Âncoras ──────────────────────────────────────────────────────────────────

TODAY = date(2026, 9, 2)
START = date(2024, 1, 1)
END = date(2028, 12, 31)
SEED = 555  # escolhido entre alguns candidatos: o mês corrente do cofre fecha levemente
           # positivo e a semente do Itaú cai num valor plausível para janeiro de 2024

TZ = "-03:00"
NS = uuid.UUID("7f3d9c2a-4e1b-4a6f-9b8d-2c5e10a4f7b3")
RNG = random.Random(SEED)

# Índice de inflação por ano, base 2026 = 1.0 (~5,3% a.a.) — aplicado às despesas
# discricionárias; as fixas têm tabela própria por ano.
INFL = {2024: 0.902, 2025: 0.950, 2026: 1.000, 2027: 1.053, 2028: 1.109}

# Fator global de calibração das despesas discricionárias. Existe para fechar a história
# pedida — "na maioria dos meses o saldo fecha positivo, por pouco" — sem ter que
# re-equilibrar cada linha à mão. Ajustado pelo relatório que o script imprime no fim.
DISCRETIONARY_SCALE = 1.0  # sobrescrito por --scale


def uid(*parts: str) -> str:
    return str(uuid.uuid5(NS, "|".join(parts)))


def ts(d: date, hour: int = 9, minute: int = 0) -> str:
    """Timestamp ISO com offset de Brasília — o formato que o app grava."""
    return f"{d.isoformat()}T{hour:02d}:{minute:02d}:00{TZ}"


def clamp_day(y: int, m: int, day: int) -> date:
    return date(y, m, min(day, monthrange(y, m)[1]))


def months(a: date, b: date):
    """Itera (ano, mês) de `a` até `b`, inclusive."""
    y, m = a.year, a.month
    while (y, m) <= (b.year, b.month):
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


def jitter(base: float, pct: float = 0.18) -> float:
    return round(base * (1 + RNG.uniform(-pct, pct)), 2)


def money(v: float) -> float:
    return round(v + 0.0, 2)


# ─── Contas ───────────────────────────────────────────────────────────────────

A_ITAU = uid("account", "itau-corrente")
A_INTER = uid("account", "inter-pj")
A_RESERVA = uid("account", "reserva")
A_TESOURO = uid("account", "tesouro")
A_CARD_ITAU = uid("account", "cartao-itau")
A_CARD_NU = uid("account", "cartao-nubank")
A_FINANC = uid("account", "financiamento")
A_APTO = uid("account", "apartamento")
A_CARRO = uid("account", "carro")
A_ALELO = uid("account", "alelo")

# Saldo derivado que cada conta de caixa deve exibir em TODAY. As sementes
# (`Account.balance`) são resolvidas no fim para bater exatamente com estes números.
CASH_TARGETS = {
    A_ITAU: 12_400.00,
    A_INTER: 4_400.00,
    A_ALELO: 310.00,
}

# A reserva e os investimentos não são alvo fixo: rendem por dentro (INCOME de
# "Rendimentos" na reserva, cotação no Tesouro), então a semente é escolhida e o valor
# de hoje é o que o replay der — o relatório final imprime onde caiu.
RESERVA_SEED = 5_800.00
TESOURO_V0 = 11_400.00  # valor de mercado em 2024-01-01
TESOURO_MONTHLY_YIELD = 0.0088

ACCOUNTS = [
    {
        "id": A_ITAU,
        "name": "Itaú — Conta Conjunta",
        "type": "RETAIL",
        "balance": 0.0,
        "includeInBalance": True,
        "issuerIcon": "itau",
    },
    {
        "id": A_INTER,
        "name": "Inter — Conta PJ",
        "type": "RETAIL",
        "balance": 0.0,
        "includeInBalance": True,
        "issuerIcon": "inter",
    },
    {
        # O VA é benefício da CLT, não salário — entra numa conta própria e é consumido no
        # mercado. Sem ele a renda declarada não cobre escola + financiamento + reserva.
        "id": A_ALELO,
        "name": "Alelo — Vale Alimentação",
        "type": "RETAIL",
        "balance": 0.0,
        "includeInBalance": True,
        "issuerIcon": "generic",
    },
    {
        "id": A_RESERVA,
        "name": "Reserva de Emergência",
        "type": "SAVINGS",
        "balance": RESERVA_SEED,
        "includeInBalance": True,
        "issuerIcon": "nubank",
        "reserveMetadata": {},
    },
    {
        "id": A_TESOURO,
        "name": "Tesouro Direto",
        "type": "STOCKS",
        "balance": 0.0,
        "includeInBalance": True,
        "issuerIcon": "generic",
    },
    {
        "id": A_CARD_ITAU,
        "name": "Itaú Platinum",
        "type": "CREDIT",
        "balance": 0.0,
        "includeInBalance": False,
        "issuerIcon": "itau",
        "creditMetadata": {"limit": 15_000, "closingDay": 3, "dueDay": 10},
    },
    {
        "id": A_CARD_NU,
        "name": "Nubank — Rodrigo",
        "type": "CREDIT",
        "balance": 0.0,
        "includeInBalance": False,
        "issuerIcon": "nubank",
        "creditMetadata": {"limit": 9_000, "closingDay": 20, "dueDay": 27},
    },
    {
        # HE-04: o financiamento não tem série de parcelas lançada (360x seria ruído puro);
        # o passivo vive em loanMetadata e o débito mensal é uma despesa comum, sem
        # `installment` — é justamente a separação que o M-85 fixou para não contar a mesma
        # dívida duas vezes.
        "id": A_FINANC,
        "name": "Financiamento do Apartamento",
        "type": "LOAN",
        "balance": 0.0,
        "includeInBalance": False,
        "issuerIcon": "caixa",
        "loanMetadata": {
            "outstandingBalance": 398_400.00,
            "monthlyPayment": 2_200.00,
            "remainingInstallments": 268,
            "interestRate": 0.72,
        },
    },
    {
        "id": A_APTO,
        "name": "Apartamento",
        "type": "ASSET",
        "balance": 640_000.00,
        "includeInBalance": False,
    },
    {
        "id": A_CARRO,
        "name": "Jeep Compass 2021",
        "type": "ASSET",
        "balance": 118_000.00,
        "includeInBalance": False,
    },
]

# ─── Tags ─────────────────────────────────────────────────────────────────────

TAGS_DEF = [
    ("camila", "Camila", "#3b82f6"),
    ("rodrigo", "Rodrigo", "#a855f7"),
    ("helena", "Helena", "#f97316"),
    ("laura", "Laura", "#06b6d4"),
    ("essencial", "Essencial", "#22c55e"),
    ("lazer", "Lazer", "#ef4444"),
    ("imprevisto", "Imprevisto", "#6b7280"),
]
TAGS = [{"id": uid("tag", k), "name": n, "color": c} for k, n, c in TAGS_DEF]
T = {k: uid("tag", k) for k, _, _ in TAGS_DEF}


# ─── Categorias ───────────────────────────────────────────────────────────────
#
# Dois níveis: as raízes agregam em Relatórios → Categorias (que faz o roll-up e o
# drill-down), e as folhas é que recebem lançamento — o Dashboard mostra as folhas no
# "top 5". Os nomes de ícone vêm de CATEGORY_ICONS (pages/Settings/index.tsx); só existem
# doze, e qualquer outro nome cai num ícone genérico na tela.

CATEGORY_TREE = [
    ("trabalho", "Renda do Trabalho", "briefcase", "#16a34a", "INCOME", [
        ("salario", "Salário CLT", "briefcase", "#22c55e"),
        ("vale", "Vale-Alimentação", "utensils", "#86efac"),
        ("prolabore", "Pró-labore e Faturamento", "briefcase", "#4ade80"),
        ("bonus", "Bônus e PLR", "gift", "#facc15"),
        ("decimo", "13º Salário", "gift", "#fbbf24"),
        ("ferias", "Férias", "plane", "#fb923c"),
    ]),
    ("outras_receitas", "Outras Receitas", "tag", "#0891b2", "INCOME", [
        ("rendimentos", "Rendimentos", "tag", "#22d3ee"),
        ("restituicao", "Restituição de IR", "tag", "#38bdf8"),
        ("reembolsos", "Reembolsos", "tag", "#7dd3fc"),
        ("presentes_recebidos", "Presentes Recebidos", "gift", "#f472b6"),
    ]),
    ("moradia", "Moradia", "home", "#dc2626", "EXPENSE", [
        ("financiamento", "Financiamento Imobiliário", "home", "#ef4444"),
        ("condominio", "Condomínio", "home", "#f87171"),
        ("energia", "Energia Elétrica", "home", "#fbbf24"),
        ("agua", "Água e Esgoto", "home", "#38bdf8"),
        ("gas", "Gás", "home", "#fb923c"),
        ("iptu", "IPTU", "home", "#e11d48"),
        ("manutencao_casa", "Manutenção da Casa", "wrench", "#94a3b8"),
        ("diarista", "Diarista", "home", "#67e8f9"),
    ]),
    ("alimentacao", "Alimentação", "utensils", "#059669", "EXPENSE", [
        ("supermercado", "Supermercado", "shopping-cart", "#34d399"),
        ("feira", "Feira e Hortifruti", "shopping-cart", "#4ade80"),
        ("padaria", "Padaria", "utensils", "#d97706"),
        ("restaurantes", "Restaurantes", "utensils", "#fb7185"),
        ("delivery", "Delivery", "utensils", "#e879f9"),
    ]),
    ("educacao", "Educação", "graduation-cap", "#4f46e5", "EXPENSE", [
        ("mensalidade", "Mensalidade Escolar", "graduation-cap", "#818cf8"),
        ("material", "Material Escolar", "graduation-cap", "#a5b4fc"),
        ("extracurricular", "Atividades Extracurriculares", "graduation-cap", "#c7d2fe"),
    ]),
    ("transporte", "Transporte", "car", "#475569", "EXPENSE", [
        ("combustivel", "Combustível", "car", "#94a3b8"),
        ("manutencao_carro", "Manutenção do Carro", "wrench", "#64748b"),
        ("ipva", "IPVA e Licenciamento", "car", "#cbd5e1"),
        ("seguro_auto", "Seguro do Carro", "car", "#a1a1aa"),
        ("estacionamento", "Estacionamento e Pedágio", "car", "#d4d4d8"),
        ("apps_transporte", "Aplicativos de Transporte", "car", "#a78bfa"),
    ]),
    ("saude", "Saúde", "heart", "#be123c", "EXPENSE", [
        ("plano_saude", "Plano de Saúde", "heart", "#fb7185"),
        ("farmacia", "Farmácia", "heart", "#f43f5e"),
        ("dentista", "Dentista", "heart", "#fda4af"),
        ("consultas", "Consultas e Exames", "heart", "#f9a8d4"),
        ("terapia", "Terapia", "heart", "#ec4899"),
    ]),
    ("pessoal", "Pessoal e Lazer", "tv", "#7c3aed", "EXPENSE", [
        ("assinaturas", "Assinaturas e Streaming", "tv", "#8b5cf6"),
        ("vestuario", "Vestuário", "tag", "#c084fc"),
        ("beleza", "Beleza e Cuidados", "tag", "#f0abfc"),
        ("presentes", "Presentes", "gift", "#f472b6"),
        ("passeios", "Passeios e Cultura", "tv", "#a78bfa"),
        ("eletronicos", "Eletrônicos e Eletrodomésticos", "tv", "#64748b"),
        ("viagens", "Viagens", "plane", "#0ea5e9"),
    ]),
    ("filhas", "Filhas", "heart", "#db2777", "EXPENSE", [
        ("roupas_filhas", "Roupas e Calçados", "tag", "#f9a8d4"),
        ("brinquedos", "Brinquedos e Livros", "gift", "#fbcfe8"),
        ("festas", "Festas e Aniversários", "gift", "#f472b6"),
    ]),
    ("pet", "Pet", "heart", "#65a30d", "EXPENSE", [
        ("racao", "Ração e Petshop", "heart", "#a3e635"),
        ("veterinario", "Veterinário", "heart", "#84cc16"),
    ]),
    ("servicos", "Serviços e Taxas", "tag", "#0f766e", "EXPENSE", [
        ("internet", "Internet", "tv", "#818cf8"),
        ("telefonia", "Telefonia", "tv", "#94a3b8"),
        ("tarifas", "Tarifas Bancárias", "tag", "#cbd5e1"),
        ("impostos_pj", "Impostos PJ", "briefcase", "#64748b"),
        ("contador", "Contador", "briefcase", "#78716c"),
    ]),
    ("encargos", "Encargos Financeiros", "tag", "#9a3412", "EXPENSE", [
        ("juros", "Juros e Encargos", "tag", "#c2410c"),
    ]),
]

CATEGORIES: list[dict] = []
C: dict[str, str] = {}
for root_key, root_name, root_icon, root_color, kind, children in CATEGORY_TREE:
    root_id = uid("category", root_key)
    C[root_key] = root_id
    CATEGORIES.append({
        "id": root_id, "parentId": None, "name": root_name,
        "icon": root_icon, "color": root_color, "type": kind,
    })
    for child_key, child_name, child_icon, child_color in children:
        child_id = uid("category", child_key)
        C[child_key] = child_id
        CATEGORIES.append({
            "id": child_id, "parentId": root_id, "name": child_name,
            "icon": child_icon, "color": child_color, "type": kind,
        })


# ─── Fábrica de lançamentos ───────────────────────────────────────────────────

TXS: list[dict] = []
_seq = {"n": 0}


def tx(
    account: str,
    category: str,
    amount: float,
    kind: str,
    when: date,
    description: str,
    tags: list[str] | None = None,
    installment: dict | None = None,
    transfer_to: str | None = None,
    reference_month: str | None = None,
) -> dict:
    """Cria e registra um lançamento. `isPaid` deriva da data: o futuro nunca é pago.

    TRANSFER e CREDIT_PAYMENT com data futura são recusados — eles entram no saldo
    independentemente de data ou de `isPaid` (`isCashRealized` + o Dashboard não filtra
    por data), então um só deles no futuro já envenena o saldo de hoje.
    """
    if kind in ("TRANSFER", "CREDIT_PAYMENT") and when > TODAY:
        raise ValueError(f"{kind} no futuro ({when}) corromperia o saldo de hoje: {description}")

    _seq["n"] += 1
    stamp_day = when if when <= TODAY else TODAY - timedelta(days=150)
    stamp = ts(stamp_day, hour=8 + (_seq["n"] % 12), minute=(_seq["n"] * 7) % 60)
    entry = {
        "id": uid("tx", description, when.isoformat(), str(_seq["n"])),
        "accountId": account,
        "categoryId": category,
        "amount": money(amount),
        "type": kind,
        "date": when.isoformat(),
        "description": description,
        "isPaid": when <= TODAY,
        "tags": tags or [],
        "createdAt": stamp,
        "updatedAt": stamp,
    }
    if installment:
        entry["installment"] = installment
    if transfer_to:
        entry["transferAccountId"] = transfer_to
    if reference_month:
        entry["referenceMonth"] = reference_month
    TXS.append(entry)
    return entry


def series(
    account: str,
    category: str,
    parcel: float,
    total: int,
    first: date,
    label: str,
    tags: list[str] | None = None,
) -> None:
    """Compra parcelada: uma Transaction por parcela, como o app materializa (CC-24/CC-25).

    É o que alimenta o motor de dívida (`getDebtBreakdown`): parcelas com data de hoje em
    diante contam como comprometido; as passadas são tratadas como quitadas.
    """
    parent = uid("inst", label, first.isoformat())
    for i in range(total):
        y, m = first.year, first.month + i
        y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
        when = clamp_day(y, m, first.day)
        if when > END:
            break
        tx(
            account, category, parcel, "EXPENSE", when,
            f"{label} ({i + 1}/{total})", tags,
            installment={
                "parentId": parent,
                "currentIndex": i + 1,
                "total": total,
                "purchaseDate": first.isoformat(),
            },
        )


def maybe(prob: float) -> bool:
    return RNG.random() < prob


# ─── Tabelas por ano ──────────────────────────────────────────────────────────

# Salário líquido da Camila (CLT). O reajuste entra em maio; 2027 acumula dissídio e
# promoção. Setembro/2026 — o "hoje" do cofre — cai nos R$ 8.000 do enunciado.
SALARY = {
    2024: (7_100, 7_100),
    2025: (7_100, 7_500),
    2026: (7_500, 8_000),
    2027: (8_000, 9_200),
    2028: (9_200, 9_700),
}

FINANCIAMENTO = {2024: 2_060, 2025: 2_130, 2026: 2_200, 2027: 2_275, 2028: 2_350}
CONDOMINIO = {2024: 660, 2025: 700, 2026: 750, 2027: 795, 2028: 840}
MENSALIDADE = {2024: 1_270, 2025: 1_380, 2026: 1_500, 2027: 1_620, 2028: 1_745}
PLANO_SAUDE = {2024: 316, 2025: 344, 2026: 380, 2027: 412, 2028: 442}
IPTU = {2024: 2_180, 2025: 2_390, 2026: 2_640, 2027: 2_810, 2028: 2_980}
IPVA = {2024: 2_460, 2025: 2_310, 2026: 2_180, 2027: 2_060, 2028: 1_950}
SEGURO_AUTO = {2024: 276, 2025: 288, 2026: 304, 2027: 318, 2028: 332}  # 10x, mar–dez

# A caçula entra na escola em fevereiro de 2025 (antes disso, só a Helena).
LAURA_SCHOOL_START = date(2025, 2, 1)


def salary(y: int, m: int) -> float:
    low, high = SALARY[y]
    return float(low if m < 5 else high)


def infl(y: int, base: float) -> float:
    return base * INFL[y] * DISCRETIONARY_SCALE


# ─── Vocabulário de descrições ────────────────────────────────────────────────

MERCHANTS = {
    "supermercado": ["Pão de Açúcar", "Carrefour", "Assaí Atacadista", "Extra Hiper", "Zona Sul"],
    "feira": ["Feira do Bairro", "Hortifruti Natural", "Quitanda da Esquina"],
    "padaria": ["Padaria Bella Massa", "Casa do Pão", "Padaria Santa Clara"],
    "restaurantes": ["Outback", "Coco Bambu", "Madero", "Cantina Napoli", "Sushi Yama"],
    "delivery": ["iFood", "Rappi", "iFood — jantar"],
    "combustivel": ["Posto Ipiranga", "Posto Shell", "Posto BR", "Posto Petrobras"],
    "farmacia": ["Drogasil", "Droga Raia", "Farmácia Pague Menos"],
    "racao": ["Petz", "Cobasi"],
    "passeios": ["Cinemark", "Parque Aquático", "Museu de Ciências", "Zoológico", "Teatro Municipal"],
    "beleza": ["Studio Hair", "Barbearia do Zé", "Manicure Ana"],
    "estacionamento": ["Estacionamento Shopping", "Pedágio CCR", "Zona Azul"],
    "apps_transporte": ["Uber", "99 Pop"],
    "vestuario": ["Renner", "C&A", "Zara", "Riachuelo"],
    "roupas_filhas": ["PUC Kids", "Lojas Pompéia", "Marisa Kids"],
    "brinquedos": ["Ri Happy", "Livraria Cultura", "Americanas"],
    "manutencao_casa": ["Leroy Merlin", "Telhanorte", "Chaveiro 24h"],
}


def pick(key: str) -> str:
    return RNG.choice(MERCHANTS[key])


ENERGY_SEASON = {1: 1.35, 2: 1.35, 3: 1.30, 4: 1.10, 5: 0.90, 6: 0.85,
                 7: 0.85, 8: 0.88, 9: 1.00, 10: 1.10, 11: 1.20, 12: 1.30}

FAMILY = [T["essencial"]]


# ─── Geração mês a mês ────────────────────────────────────────────────────────

def emit_income(y: int, m: int) -> None:
    sal = salary(y, m)
    tx(A_ITAU, C["salario"], sal, "INCOME", clamp_day(y, m, 5),
       "Salário — Vertex Engenharia", [T["camila"], T["essencial"]])

    tx(A_ALELO, C["vale"], round(945 * INFL[y], 2), "INCOME", clamp_day(y, m, 5),
       "Vale-alimentação — Vertex Engenharia", [T["camila"], T["essencial"]])

    if m == 1:
        tx(A_ITAU, C["ferias"], round(sal / 3, 2), "INCOME", clamp_day(y, m, 20),
           "Férias — 1/3 constitucional", [T["camila"]])
    if m == 6:
        tx(A_ITAU, C["bonus"], sal * 2, "INCOME", clamp_day(y, m, 15),
           "PLR — Vertex Engenharia", [T["camila"]])
        tx(A_ITAU, C["restituicao"], jitter(2_400 * INFL[y], 0.30), "INCOME",
           clamp_day(y, m, 25), "Restituição de IR", [T["camila"]])
    if m == 11:
        tx(A_ITAU, C["decimo"], round(sal / 2, 2), "INCOME", clamp_day(y, m, 20),
           "13º salário — 1ª parcela", [T["camila"]])
    if m == 12:
        tx(A_ITAU, C["decimo"], round(sal / 2, 2), "INCOME", clamp_day(y, m, 15),
           "13º salário — 2ª parcela", [T["camila"]])

    # Rodrigo: faturamento irregular da consultoria, em dois recebimentos por mês.
    base = {2024: 2_950, 2025: 3_200, 2026: 3_450, 2027: 3_700, 2028: 3_950}[y]
    if maybe(0.10):
        base *= 1.75  # projeto grande fechado
    elif maybe(0.14):
        base *= 0.55  # mês fraco
    split = RNG.uniform(0.40, 0.60)
    tx(A_INTER, C["prolabore"], jitter(base * split, 0.12), "INCOME", clamp_day(y, m, 10),
       "Nota fiscal — consultoria", [T["rodrigo"]])
    tx(A_INTER, C["prolabore"], jitter(base * (1 - split), 0.12), "INCOME", clamp_day(y, m, 25),
       "Nota fiscal — consultoria", [T["rodrigo"]])


def emit_housing(y: int, m: int) -> None:
    tx(A_ITAU, C["financiamento"], FINANCIAMENTO[y], "EXPENSE", clamp_day(y, m, 10),
       "Parcela do financiamento — Caixa", FAMILY)
    tx(A_ITAU, C["condominio"], CONDOMINIO[y], "EXPENSE", clamp_day(y, m, 8),
       "Condomínio Edifício Aurora", FAMILY)
    tx(A_ITAU, C["energia"], jitter(infl(y, 232) * ENERGY_SEASON[m], 0.12), "EXPENSE",
       clamp_day(y, m, 15), "Enel — energia elétrica", FAMILY)
    tx(A_ITAU, C["agua"], jitter(infl(y, 104), 0.16), "EXPENSE", clamp_day(y, m, 18),
       "Sabesp — água e esgoto", FAMILY)
    tx(A_ITAU, C["gas"], jitter(infl(y, 82), 0.14), "EXPENSE", clamp_day(y, m, 20),
       "Comgás", FAMILY)
    for day in (6, 26):
        tx(A_ITAU, C["diarista"], jitter(infl(y, 148), 0.06), "EXPENSE", clamp_day(y, m, day),
           "Diarista — Dona Marlene", FAMILY)


def emit_school(y: int, m: int) -> None:
    kids = [("Helena", T["helena"])]
    if date(y, m, 1) >= LAURA_SCHOOL_START:
        kids.append(("Laura", T["laura"]))
    value = MENSALIDADE[y]
    for name, tag in kids:
        if m == 1:
            tx(A_ITAU, C["mensalidade"], value, "EXPENSE", clamp_day(y, m, 15),
               f"Matrícula {y} — Colégio Santa Inês ({name})", [tag, T["essencial"]])
            tx(A_ITAU, C["material"], jitter(infl(y, 415), 0.20), "EXPENSE",
               clamp_day(y, m, 18), f"Material escolar {y} ({name})", [tag])
        else:
            tx(A_ITAU, C["mensalidade"], value, "EXPENSE", clamp_day(y, m, 7),
               f"Mensalidade — Colégio Santa Inês ({name})", [tag, T["essencial"]])
    # Natação da Helena o ano todo; balé da Laura a partir de 2026.
    tx(A_CARD_ITAU, C["extracurricular"], jitter(infl(y, 172), 0.05), "EXPENSE",
       clamp_day(y, m, 9), "Natação — Academia Aquática", [T["helena"]])
    if y >= 2027:
        tx(A_CARD_ITAU, C["extracurricular"], jitter(infl(y, 148), 0.05), "EXPENSE",
           clamp_day(y, m, 9), "Balé — Espaço Movimento", [T["laura"]])


def emit_health(y: int, m: int) -> None:
    tx(A_ITAU, C["plano_saude"], PLANO_SAUDE[y], "EXPENSE", clamp_day(y, m, 5),
       "Plano de saúde — coparticipação", FAMILY)
    tx(A_CARD_ITAU, C["farmacia"], jitter(infl(y, 104), 0.35), "EXPENSE", clamp_day(y, m, 11),
       pick("farmacia"), FAMILY)
    if maybe(0.28):
        tx(A_CARD_ITAU, C["consultas"], jitter(infl(y, 188), 0.30), "EXPENSE",
           clamp_day(y, m, RNG.randint(12, 26)), "Consulta — coparticipação", FAMILY)
    if y >= 2025:
        tx(A_CARD_ITAU, C["terapia"], jitter(infl(y, 164), 0.02) * 2, "EXPENSE",
           clamp_day(y, m, 17), "Terapia — Camila (2 sessões)", [T["camila"]])


def emit_groceries(y: int, m: int) -> None:
    for day in (3, 11, 19, 26):
        tx(A_ALELO, C["supermercado"], jitter(infl(y, 166), 0.28), "EXPENSE",
           clamp_day(y, m, day), pick("supermercado"), FAMILY)
    for day in (7, 22):
        tx(A_ALELO, C["feira"], jitter(infl(y, 82), 0.25), "EXPENSE",
           clamp_day(y, m, day), pick("feira"), FAMILY)
    for day in (2, 13, 27):
        tx(A_ALELO, C["padaria"], jitter(infl(y, 38), 0.30), "EXPENSE",
           clamp_day(y, m, day), pick("padaria"), FAMILY)
    for day in (9, 25):
        tx(A_CARD_ITAU, C["restaurantes"], jitter(infl(y, 74), 0.35), "EXPENSE",
           clamp_day(y, m, day), pick("restaurantes"), [T["lazer"]])
    for day in (5, 27):
        if maybe(0.80):
            tx(A_CARD_ITAU, C["delivery"], jitter(infl(y, 56), 0.30), "EXPENSE",
               clamp_day(y, m, day), pick("delivery"), [T["lazer"]])


def emit_transport(y: int, m: int) -> None:
    for day in (4, 25):
        tx(A_CARD_ITAU, C["combustivel"], jitter(infl(y, 96), 0.20), "EXPENSE",
           clamp_day(y, m, day), pick("combustivel"), FAMILY)
    tx(A_CARD_ITAU, C["estacionamento"], jitter(infl(y, 46), 0.35), "EXPENSE",
       clamp_day(y, m, 13), pick("estacionamento"), [])
    if maybe(0.65):
        tx(A_CARD_ITAU, C["apps_transporte"], jitter(infl(y, 41), 0.40), "EXPENSE",
           clamp_day(y, m, 18), pick("apps_transporte"), [])
    if m == 1:
        tx(A_ITAU, C["ipva"], IPVA[y], "EXPENSE", clamp_day(y, m, 25),
           f"IPVA {y} + licenciamento", FAMILY)
    if m >= 3:
        tx(A_ITAU, C["seguro_auto"], SEGURO_AUTO[y], "EXPENSE", clamp_day(y, m, 12),
           f"Seguro do carro — Porto Seguro ({m - 2}/10)", FAMILY)


def emit_subscriptions_and_utils(y: int, m: int) -> None:
    tx(A_CARD_ITAU, C["assinaturas"], jitter(infl(y, 55), 0.02), "EXPENSE",
       clamp_day(y, m, 5), "Netflix", [T["lazer"]])
    tx(A_CARD_ITAU, C["assinaturas"], jitter(infl(y, 35), 0.02), "EXPENSE",
       clamp_day(y, m, 8), "Spotify Família", [T["lazer"]])
    tx(A_CARD_ITAU, C["internet"], jitter(infl(y, 119), 0.01), "EXPENSE",
       clamp_day(y, m, 12), "Vivo Fibra 500MB", FAMILY)
    tx(A_CARD_ITAU, C["telefonia"], jitter(infl(y, 134), 0.03), "EXPENSE",
       clamp_day(y, m, 14), "Claro — 4 linhas", FAMILY)
    tx(A_CARD_ITAU, C["racao"], jitter(infl(y, 104), 0.25), "EXPENSE",
       clamp_day(y, m, 29), pick("racao"), [])
    tx(A_CARD_ITAU, C["beleza"], jitter(infl(y, 96), 0.30), "EXPENSE",
       clamp_day(y, m, 19), pick("beleza"), [])
    if maybe(0.55):
        tx(A_CARD_ITAU, C["passeios"], jitter(infl(y, 132), 0.40), "EXPENSE",
           clamp_day(y, m, 21), pick("passeios"), [T["lazer"]])
    if maybe(0.45):
        tx(A_CARD_ITAU, C["vestuario"], jitter(infl(y, 178), 0.45), "EXPENSE",
           clamp_day(y, m, RNG.randint(6, 27)), pick("vestuario"), [])
    if maybe(0.40):
        tx(A_CARD_ITAU, C["roupas_filhas"], jitter(infl(y, 138), 0.40), "EXPENSE",
           clamp_day(y, m, RNG.randint(6, 27)), pick("roupas_filhas"),
           [RNG.choice([T["helena"], T["laura"]])])
    if maybe(0.30):
        tx(A_CARD_ITAU, C["brinquedos"], jitter(infl(y, 96), 0.45), "EXPENSE",
           clamp_day(y, m, RNG.randint(6, 27)), pick("brinquedos"),
           [RNG.choice([T["helena"], T["laura"]])])
    if maybe(0.22):
        tx(A_CARD_ITAU, C["manutencao_casa"], jitter(infl(y, 195), 0.55), "EXPENSE",
           clamp_day(y, m, RNG.randint(6, 27)), pick("manutencao_casa"), [])


def emit_rodrigo_card(y: int, m: int) -> None:
    for day in (7, 26):
        tx(A_CARD_NU, C["restaurantes"], jitter(infl(y, 68), 0.35), "EXPENSE",
           clamp_day(y, m, day), pick("restaurantes"), [T["rodrigo"]])
    tx(A_CARD_NU, C["combustivel"], jitter(infl(y, 88), 0.22), "EXPENSE",
       clamp_day(y, m, 11), pick("combustivel"), [T["rodrigo"]])
    tx(A_CARD_NU, C["padaria"], jitter(infl(y, 34), 0.30), "EXPENSE",
       clamp_day(y, m, 16), pick("padaria"), [T["rodrigo"]])
    if maybe(0.60):
        tx(A_CARD_NU, C["apps_transporte"], jitter(infl(y, 52), 0.40), "EXPENSE",
           clamp_day(y, m, 24), pick("apps_transporte"), [T["rodrigo"]])
    if maybe(0.35):
        tx(A_CARD_NU, C["delivery"], jitter(infl(y, 54), 0.30), "EXPENSE",
           clamp_day(y, m, 28), pick("delivery"), [T["rodrigo"]])


def emit_pj(y: int, m: int) -> None:
    tx(A_INTER, C["contador"], jitter(infl(y, 245), 0.02), "EXPENSE", clamp_day(y, m, 15),
       "Escritório contábil — honorários", [T["rodrigo"]])
    tx(A_INTER, C["impostos_pj"], jitter(infl(y, 262), 0.15), "EXPENSE", clamp_day(y, m, 20),
       "DAS — Simples Nacional", [T["rodrigo"]])
    tx(A_INTER, C["tarifas"], jitter(infl(y, 42), 0.05), "EXPENSE", clamp_day(y, m, 5),
       "Tarifa de conta PJ", [T["rodrigo"]])


def emit_seasonal(y: int, m: int) -> None:
    """Os picos que dão forma ao ano: janeiro pesado, meio de ano com bônus, dezembro caro."""
    if m == 2:
        tx(A_CARD_ITAU, C["passeios"], jitter(infl(y, 330), 0.30), "EXPENSE",
           clamp_day(y, m, 12), "Carnaval — hospedagem no litoral", [T["lazer"]])
    if m == 4:
        tx(A_CARD_ITAU, C["festas"], jitter(infl(y, 860), 0.18), "EXPENSE",
           clamp_day(y, m, 14), "Aniversário da Laura — buffet", [T["laura"], T["lazer"]])
    if m == 6:
        tx(A_CARD_ITAU, C["festas"], jitter(infl(y, 185), 0.25), "EXPENSE",
           clamp_day(y, m, 22), "Festa junina do colégio", [T["helena"], T["laura"]])
    if m == 10:
        tx(A_CARD_ITAU, C["festas"], jitter(infl(y, 960), 0.18), "EXPENSE",
           clamp_day(y, m, 22), "Aniversário da Helena — buffet", [T["helena"], T["lazer"]])
        tx(A_CARD_ITAU, C["presentes"], jitter(infl(y, 335), 0.25), "EXPENSE",
           clamp_day(y, m, 11), "Dia das Crianças", [T["helena"], T["laura"]])
    if m == 11:
        tx(A_CARD_ITAU, C["vestuario"], jitter(infl(y, 545), 0.35), "EXPENSE",
           clamp_day(y, m, 28), "Black Friday — roupas e eletrônicos", [])
    if m == 12:
        tx(A_CARD_ITAU, C["presentes"], jitter(infl(y, 1_380), 0.20), "EXPENSE",
           clamp_day(y, m, 18), "Presentes de Natal", [T["lazer"]])
        tx(A_CARD_ITAU, C["supermercado"], jitter(infl(y, 505), 0.20), "EXPENSE",
           clamp_day(y, m, 23), "Ceia de Natal — compras", FAMILY)
    if m == 1:
        tx(A_ITAU, C["iptu"], IPTU[y], "EXPENSE", clamp_day(y, m, 20),
           f"IPTU {y} — cota única", FAMILY)


# Eventos únicos: os imprevistos e as compras grandes que dão textura ao histórico.
# Data, conta, categoria, valor, descrição, tags — parcelados vão em ONE_OFF_SERIES.
ONE_OFF = [
    (date(2024, 3, 19), A_CARD_ITAU, "manutencao_carro", 940, "Revisão dos 40 mil km", ["imprevisto"]),
    (date(2024, 5, 8), A_CARD_ITAU, "veterinario", 430, "Veterinário — Mel (vacinas)", ["imprevisto"]),
    (date(2024, 8, 27), A_CARD_ITAU, "manutencao_casa", 1_150, "Conserto do vazamento — banheiro", ["imprevisto"]),
    (date(2024, 11, 6), A_CARD_NU, "manutencao_carro", 720, "Troca de bateria + alinhamento", ["imprevisto"]),
    (date(2025, 2, 21), A_CARD_ITAU, "veterinario", 980, "Veterinário — Mel (cirurgia)", ["imprevisto"]),
    (date(2025, 6, 13), A_CARD_ITAU, "manutencao_carro", 1_180, "Suspensão dianteira", ["imprevisto"]),
    (date(2025, 9, 4), A_ITAU, "manutencao_casa", 1_780, "Pintura da sala e dos quartos", ["imprevisto"]),
    (date(2025, 12, 9), A_CARD_ITAU, "consultas", 610, "Exames de rotina — Rodrigo", ["rodrigo"]),
    (date(2026, 2, 17), A_CARD_ITAU, "veterinario", 520, "Veterinário — Mel (check-up)", []),
    (date(2026, 4, 23), A_CARD_NU, "manutencao_carro", 610, "Troca de óleo e filtros", []),
    (date(2026, 6, 24), A_CARD_ITAU, "manutencao_casa", 940, "Troca da resistência do chuveiro + elétrica", ["imprevisto"]),
    (date(2027, 3, 11), A_CARD_ITAU, "manutencao_carro", 1_340, "Revisão dos 90 mil km", ["imprevisto"]),
    (date(2027, 7, 29), A_CARD_ITAU, "consultas", 760, "Exames de rotina — família", []),
    (date(2028, 5, 16), A_CARD_ITAU, "manutencao_casa", 1_980, "Troca do piso da cozinha", ["imprevisto"]),
    (date(2025, 7, 12), A_CARD_ITAU, "viagens", 4_200, "Férias em Porto de Galinhas", ["lazer"]),
    (date(2027, 4, 20), A_CARD_ITAU, "eletronicos", 2_600, "Notebook novo — Camila", ["camila"]),
    (date(2027, 7, 14), A_CARD_ITAU, "viagens", 5_400, "Férias na Serra Gaúcha", ["lazer"]),
    (date(2028, 1, 15), A_ITAU, "eletronicos", 3_900, "Troca do fogão e da TV da sala", []),
    (date(2028, 7, 10), A_CARD_ITAU, "viagens", 6_200, "Férias no Nordeste", ["lazer"]),
    (date(2028, 9, 5), A_CARD_ITAU, "manutencao_casa", 2_800, "Reforma do banheiro da suíte", []),
]

# Parcelamentos: data da 1ª parcela, conta, categoria, valor da parcela, nº de parcelas,
# descrição, tags. Alimentam o motor de dívida de /health e a view de Faturas.
ONE_OFF_SERIES = [
    (date(2024, 4, 12), A_CARD_ITAU, "eletronicos", 385, 10, "Máquina de lavar Brastemp", []),
    (date(2024, 10, 5), A_CARD_ITAU, "viagens", 640, 8, "Pacote Gramado — fim de ano", ["lazer"]),
    (date(2025, 3, 8), A_CARD_ITAU, "vestuario", 195, 6, "Óculos de grau — Rodrigo", ["rodrigo"]),
    (date(2025, 5, 15), A_CARD_ITAU, "eletronicos", 420, 10, "Geladeira Electrolux Frost Free", []),
    (date(2025, 9, 20), A_CARD_ITAU, "eletronicos", 355, 12, "Notebook — trabalho do Rodrigo", ["rodrigo"]),
    (date(2026, 3, 6), A_CARD_ITAU, "dentista", 320, 18, "Aparelho ortodôntico — Helena", ["helena"]),
    (date(2026, 5, 17), A_CARD_ITAU, "manutencao_carro", 790, 3, "Troca da embreagem", ["imprevisto"]),
    (date(2026, 8, 18), A_CARD_ITAU, "viagens", 860, 6, "Viagem de férias — Nordeste", ["lazer"]),
]


def emit_one_offs() -> None:
    for when, account, cat, value, label, tag_keys in ONE_OFF:
        tx(account, C[cat], jitter(value, 0.06), "EXPENSE", when, label,
           [T[k] for k in tag_keys])
    for first, account, cat, parcel, total, label, tag_keys in ONE_OFF_SERIES:
        series(account, C[cat], parcel, total, first, label, [T[k] for k in tag_keys])


# ─── Transferências (só passado) ──────────────────────────────────────────────
#
# TRANSFER conta no saldo independentemente de data e de `isPaid`, e o Dashboard soma sem
# filtrar por data — uma transferência datada em 2028 apareceria no saldo de hoje. Por isso
# a poupança e os aportes param em TODAY; do presente em diante o cofre só tem receita e
# despesa previstas.

RESERVE_SKIP = {(2024, 1), (2025, 1), (2026, 1), (2024, 12), (2025, 12)}
RESERVE_WITHDRAWALS = {
    (2024, 8): (1_400.0, "Resgate da reserva — conserto do vazamento"),
    (2025, 9): (2_100.0, "Resgate da reserva — pintura do apartamento"),
}
RESERVE_MONTHLY_YIELD = 0.0079

VALUATIONS: list[dict] = []
_tesouro_flows: list[tuple[date, float]] = []


def emit_transfers() -> None:
    running = RESERVA_SEED
    for y, m in months(START, TODAY):
        rendimento = clamp_day(y, m, 1)
        if rendimento <= TODAY:
            gain = round(running * RESERVE_MONTHLY_YIELD, 2)
            tx(A_RESERVA, C["rendimentos"], gain, "INCOME", rendimento,
               "Rendimento — CDB liquidez diária", [T["essencial"]])
            running += gain

        deposit_day = clamp_day(y, m, 6)
        if deposit_day <= TODAY and (y, m) not in RESERVE_SKIP:
            tx(A_ITAU, "", 1_000.0, "TRANSFER", deposit_day,
               "Aporte mensal na reserva", [T["essencial"]], transfer_to=A_RESERVA)
            running += 1_000.0

        if (y, m) in RESERVE_WITHDRAWALS:
            amount, label = RESERVE_WITHDRAWALS[(y, m)]
            when = clamp_day(y, m, 3)
            if when <= TODAY:
                tx(A_RESERVA, "", amount, "TRANSFER", when, label,
                   [T["imprevisto"]], transfer_to=A_ITAU)
                running -= amount

        # Aportes no Tesouro saem do PLR (junho) e do 13º (dezembro), não do mês a mês.
        for month, base, label in ((6, 8_000, "Aporte no Tesouro — PLR"),
                                   (12, 4_000, "Aporte no Tesouro — 13º")):
            if m != month:
                continue
            when = clamp_day(y, m, 26)
            if when > TODAY:
                continue
            value = round(base * INFL[y], 2)
            tx(A_ITAU, "", value, "TRANSFER", when, label, [T["camila"]],
               transfer_to=A_TESOURO)
            _tesouro_flows.append((when, value))

        # Rodrigo repassa o que sobra da PJ para a conta conjunta.
        sweep_day = clamp_day(y, m, 28)
        if sweep_day <= TODAY:
            inter_month = sum(
                t["amount"] if t["type"] == "INCOME" else -t["amount"]
                for t in TXS
                if t["accountId"] == A_INTER
                and t["type"] in ("INCOME", "EXPENSE")
                and t["date"][:7] == f"{y}-{m:02d}"
            )
            sweep = round(max(inter_month * 0.97, 0), 2)
            if sweep > 0:
                tx(A_INTER, "", sweep, "TRANSFER", sweep_day,
                   "Repasse da PJ para a conta conjunta", [T["rodrigo"]],
                   transfer_to=A_ITAU)


# ─── Faturas dos cartões ──────────────────────────────────────────────────────

# Uma fatura paga parcialmente (aperto de janeiro), com os encargos do rotativo caindo na
# fatura seguinte — o selo "parcial" da view de Faturas precisa de um caso real.
PARTIAL = {(A_CARD_ITAU, "2025-01"): 0.62}


def invoice_period(when: date, closing_day: int) -> tuple[int, int]:
    """Espelha getInvoicePeriod: compra no dia do fechamento ou depois cai na fatura seguinte."""
    if when.day >= closing_day:
        return (when.year + 1, 1) if when.month == 12 else (when.year, when.month + 1)
    return when.year, when.month


def invoice_due(period: tuple[int, int], due_day: int, closing_day: int) -> date:
    y, m = period
    if due_day <= closing_day:
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return clamp_day(y, m, due_day)


def emit_invoice_payments() -> None:
    for account in ACCOUNTS:
        if account["type"] != "CREDIT":
            continue
        meta = account["creditMetadata"]
        closing, due_day = meta["closingDay"], meta["dueDay"]

        totals: dict[tuple[int, int], float] = {}
        for t in TXS:
            if t["accountId"] != account["id"] or t["type"] not in ("EXPENSE", "INCOME"):
                continue
            when = date.fromisoformat(t["date"])
            p = invoice_period(when, closing)
            signed = t["amount"] if t["type"] == "EXPENSE" else -t["amount"]
            totals[p] = totals.get(p, 0.0) + signed

        for period in sorted(totals):
            total = round(totals[period], 2)
            if total <= 0:
                continue
            when = invoice_due(period, due_day, closing)
            if when > TODAY:
                continue  # fatura ainda em aberto — é o que o app deve mostrar
            key = f"{period[0]}-{period[1]:02d}"
            ratio = PARTIAL.get((account["id"], key), 1.0)
            tx(account["id"], "", round(total * ratio, 2), "CREDIT_PAYMENT", when,
               f"Pagamento da fatura — {account['name']}", [],
               transfer_to=A_ITAU, reference_month=key)
            if ratio < 1.0:
                # O que não foi pago rola para a fatura seguinte, com encargos — sem isso a
                # fatura parcial nunca fecharia e o cartão ficaria devendo para sempre.
                rest = total * (1 - ratio)
                rollover = when + timedelta(days=3)
                tx(account["id"], C["juros"], round(rest, 2), "EXPENSE", rollover,
                   "Saldo da fatura anterior", [T["imprevisto"]])
                tx(account["id"], C["juros"], round(rest * 0.14, 2), "EXPENSE", rollover,
                   "Encargos de rotativo", [T["imprevisto"]])


# ─── Cotações (NW-08) ─────────────────────────────────────────────────────────
#
# ASSET/STOCKS são avaliados por cotação em /net-worth: o motor retoma da última cotação
# até hoje e reaplica só o que veio depois dela. O imóvel e o carro não têm lançamento
# nenhum — só cotação. O Tesouro tem aportes, então a semente é calculada no fim para que
# o saldo do Dashboard (replay puro) caia no mesmo valor da última cotação.

QUARTER_ENDS = [
    d for y, m in months(START, END)
    if m in (3, 6, 9, 12)
    for d in [clamp_day(y, m, monthrange(y, m)[1])]
]


def valuation(account: str, when: date, value: float) -> None:
    VALUATIONS.append({
        "id": uid("valuation", account, when.isoformat()),
        "accountId": account,
        "date": when.isoformat(),
        "marketValue": money(value),
    })


def emit_valuations() -> float:
    # Imóvel: valorização de ~1,25% ao trimestre. Carro: depreciação de ~2,2%.
    apto, carro = 640_000.0, 118_000.0
    for i, when in enumerate(QUARTER_ENDS):
        apto *= 1.0125
        carro *= 0.9785
        valuation(A_APTO, when, round(apto, -2))
        valuation(A_CARRO, when, round(carro, -2))

    # Tesouro: valor de mercado composto mês a mês sobre os aportes efetivamente feitos.
    value = TESOURO_V0
    flows = dict(_tesouro_flows)
    last_valuation = TODAY - timedelta(days=1)
    for y, m in months(START, TODAY):
        value *= 1 + TESOURO_MONTHLY_YIELD
        for when, amount in flows.items():
            if (when.year, when.month) == (y, m):
                value += amount
        marker = clamp_day(y, m, monthrange(y, m)[1])
        if m in (3, 6, 9, 12) and marker < last_valuation:
            valuation(A_TESOURO, marker, round(value, 2))
    valuation(A_TESOURO, last_valuation, round(value, 2))
    return round(value, 2)


# ─── Sementes de saldo ────────────────────────────────────────────────────────


def replay_delta(account_id: str) -> float:
    """Efeito líquido dos lançamentos sobre uma conta — espelha computeAccountBalances.

    Sem recorte de data de propósito: é assim que o Dashboard soma. Como nenhum TRANSFER
    ou CREDIT_PAYMENT é emitido no futuro e todo INCOME/EXPENSE futuro está `isPaid=False`,
    esta soma é exatamente o saldo de hoje.
    """
    total = 0.0
    for t in TXS:
        if t["type"] == "CREDIT_PAYMENT":
            if t.get("transferAccountId") == account_id:
                total -= t["amount"]
            continue
        if t["type"] != "TRANSFER" and not t["isPaid"]:
            continue
        if t["type"] == "INCOME" and t["accountId"] == account_id:
            total += t["amount"]
        elif t["type"] == "EXPENSE" and t["accountId"] == account_id:
            total -= t["amount"]
        elif t["type"] == "TRANSFER":
            if t["accountId"] == account_id:
                total -= t["amount"]
            if t.get("transferAccountId") == account_id:
                total += t["amount"]
    return round(total, 2)


# ─── Caixinhas (F-30) ─────────────────────────────────────────────────────────

BUDGETS: list[dict] = []


def budget(
    key: str, name: str, emoji: str, color: str, kind: str, target: float,
    period: dict, created: date, **extra,
) -> str:
    bid = uid("budget", key)
    BUDGETS.append({
        "id": bid, "name": name, "emoji": emoji, "color": color, "kind": kind,
        "target": money(target), "period": period,
        "createdAt": ts(created), "updatedAt": ts(created), **extra,
    })
    return bid


def link(bid: str, predicate) -> int:
    n = 0
    for t in TXS:
        if predicate(t):
            t.setdefault("budgetIds", []).append(bid)
            n += 1
    return n


def day_slot(day: int) -> int:
    return 1 if day <= 8 else 2 if day <= 16 else 3 if day <= 24 else 4


def median(values: list[float]) -> float:
    s = sorted(values)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def quadrante_target(slot: int, reference: tuple[int, int]) -> float:
    """Mesma regra de suggestQuadranteTarget: mediana das despesas realizadas do slot nos
    6 meses fechados anteriores. Pré-calcular aqui deixa o lote já nascido calibrado — na
    tela, uma meta 0 é o que a receita gera quando não há histórico."""
    sums: dict[str, float] = {}
    for t in TXS:
        if t["type"] != "EXPENSE" or not t["isPaid"]:
            continue
        if day_slot(int(t["date"][8:10])) != slot:
            continue
        key = t["date"][:7]
        if key >= f"{reference[0]}-{reference[1]:02d}":
            continue
        sums[key] = sums.get(key, 0.0) + t["amount"]
    window = []
    y, m = reference
    for _ in range(6):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        key = f"{y}-{m:02d}"
        if key in sums:
            window.append(sums[key])
    return round(median(window), 2) if window else 0.0


QUADRANTE_EMOJI = {1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣"}
QUADRANTE_COLOR = "#6B7280"


def emit_quadrantes(y: int, m: int, archived: date | None) -> None:
    """Lote mensal da receita "Quadrantes" (BX-07), já com os lançamentos do mês vinculados.

    O app gera o lote do mês corrente sozinho no boot, mas só associa transação na criação
    ou edição — dado semeado nunca passa por lá. Pré-vincular é o que faz /budgets abrir
    com progresso real em vez de quatro caixinhas zeradas.
    """
    last = monthrange(y, m)[1]
    ranges = {1: (1, 8), 2: (9, 16), 3: (17, 24), 4: (25, last)}
    for slot in (1, 2, 3, 4):
        lo, hi = ranges[slot]
        extra = {
            "recipeSlug": "quadrantes",
            "recipeSlot": slot,
            "targetSource": "auto",
        }
        if archived:
            extra["archivedAt"] = ts(archived)
        bid = budget(
            f"quadrante-{y}-{m}-{slot}", f"Quadrante {slot}", QUADRANTE_EMOJI[slot],
            QUADRANTE_COLOR, "expense", quadrante_target(slot, (y, m)),
            {"mode": "range",
             "start": f"{y}-{m:02d}-{lo:02d}", "end": f"{y}-{m:02d}-{hi:02d}"},
            date(y, m, 1),
            **extra,
        )
        link(bid, lambda t, lo=lo, hi=hi: (
            t["type"] == "EXPENSE"
            and t["date"][:7] == f"{y}-{m:02d}"
            and lo <= int(t["date"][8:10]) <= hi
        ))


def emit_budgets() -> None:
    ago = budget("mercado-ago-2026", "Mercado de Agosto", "🛒", "#2D6A4F", "expense",
                 1_400, {"mode": "range", "start": "2026-08-01", "end": "2026-08-31"},
                 date(2026, 8, 1))
    link(ago, lambda t: (
        t["accountId"] in (A_ALELO, A_CARD_ITAU, A_CARD_NU)
        and t["categoryId"] in (C["supermercado"], C["feira"], C["padaria"])
        and t["date"][:7] == "2026-08"
    ))

    setembro = budget("mercado-set-2026", "Mercado de Setembro", "🛒", "#2D6A4F", "expense",
                      1_450, {"mode": "range", "start": "2026-09-01", "end": "2026-09-30"},
                      date(2026, 9, 1))
    link(setembro, lambda t: (
        t["accountId"] in (A_ALELO, A_CARD_ITAU, A_CARD_NU)
        and t["categoryId"] in (C["supermercado"], C["feira"], C["padaria"])
        and t["date"][:7] == "2026-09"
    ))

    aparelho = budget("aparelho-helena", "Aparelho da Helena", "🦷", "#1B4F72", "expense",
                      18 * 320, {"mode": "date", "date": "2027-08-06"}, date(2026, 3, 6))
    link(aparelho, lambda t: t["description"].startswith("Aparelho ortodôntico"))

    viagem = budget("viagem-2027", "Viagem de férias 2027", "✈️", "#0E7490", "expense",
                    6 * 860, {"mode": "date", "date": "2027-01-18"}, date(2026, 8, 18))
    link(viagem, lambda t: t["description"].startswith("Viagem de férias — Nordeste"))

    reserva = budget("reserva-2026", "Reserva de emergência 2026", "🛟", "#B45309", "income",
                     12_000, {"mode": "range", "start": "2026-01-01", "end": "2026-12-31"},
                     date(2026, 1, 6))
    link(reserva, lambda t: (
        t["type"] == "TRANSFER"
        and t.get("transferAccountId") == A_RESERVA
        and t["date"][:4] == "2026"
    ))

    emit_quadrantes(2026, 8, archived=date(2026, 9, 1))
    emit_quadrantes(2026, 9, archived=None)


# ─── Períodos salvos e histórico ──────────────────────────────────────────────

SAVED_PERIODS = [
    {"id": uid("period", "ano-letivo"), "name": "Ano letivo 2026",
     "start": "2026-02-01", "end": "2026-12-20"},
    {"id": uid("period", "1sem-2026"), "name": "1º semestre 2026",
     "start": "2026-01-01", "end": "2026-06-30"},
]


def build_audit() -> list[dict]:
    """Últimas modificações, no formato que buildSummary() grava (useDataStore.ts)."""
    cat_name = {c["id"]: c["name"] for c in CATEGORIES}
    acc_name = {a["id"]: a["name"] for a in ACCOUNTS}
    recent = sorted(
        (t for t in TXS if t["isPaid"]),
        key=lambda t: (t["date"], t["id"]),
    )[-40:]
    entries = []
    for t in recent:
        amount = f"R$ {t['amount']:.2f}".replace(".", ",")
        if t["type"] == "CREDIT_PAYMENT":
            summary = (f"Pagamento de fatura: {acc_name[t['accountId']]} ← "
                       f"{acc_name.get(t.get('transferAccountId', ''), '')} {amount}")
        else:
            name = t["description"] or cat_name.get(t["categoryId"], "")
            cat = cat_name.get(t["categoryId"], "")
            extra = f"{amount}{f' — {cat}' if cat else ''}"
            summary = f"Transação criada: {name} — {extra}"
        entries.append({
            "id": uid("audit", t["id"]),
            "timestamp": t["createdAt"],
            "action": "CREATE",
            "entity": "transaction",
            "entityId": t["id"],
            "summary": summary,
        })
    entries.append({
        "id": uid("audit", "budget-setembro"),
        "timestamp": ts(date(2026, 9, 1), 20, 14),
        "action": "CREATE", "entity": "budget",
        "entityId": uid("budget", "mercado-set-2026"),
        "summary": "Caixinha criada: Mercado de Setembro — R$ 1450,00",
    })
    entries.sort(key=lambda e: e["timestamp"])
    return entries


# ─── Montagem ─────────────────────────────────────────────────────────────────

DEFAULT_OUTPUTS = [
    Path("app/src/assets/demo-data.json"),
    Path("app/public/dev/seed.json"),
]


def generate() -> dict:
    for y, m in months(START, END):
        emit_income(y, m)
        emit_housing(y, m)
        emit_school(y, m)
        emit_health(y, m)
        emit_groceries(y, m)
        emit_transport(y, m)
        emit_subscriptions_and_utils(y, m)
        emit_rodrigo_card(y, m)
        emit_pj(y, m)
        emit_seasonal(y, m)

    emit_one_offs()
    emit_transfers()
    emit_invoice_payments()
    tesouro_today = emit_valuations()
    emit_budgets()

    TXS.sort(key=lambda t: (t["date"], t["id"]))

    # Sementes: `Account.balance` é o saldo *inicial*, então vale o alvo de hoje menos o que
    # os lançamentos já moveram. É o que faz o Dashboard abrir num número escolhido em vez
    # de num resíduo do gerador.
    by_id = {a["id"]: a for a in ACCOUNTS}
    for account_id, target in CASH_TARGETS.items():
        by_id[account_id]["balance"] = money(target - replay_delta(account_id))
    by_id[A_TESOURO]["balance"] = money(tesouro_today - replay_delta(A_TESOURO))

    # Imóvel e carro não têm lançamento nenhum, então a semente nunca é reaplicada: fixá-la
    # na cotação de hoje mantém Configurações (que lê `balance` direto, sem consultar
    # cotação) coerente com /net-worth (que lê a cotação). Ver a nota sobre o rodapé de
    # Lançamentos no cabeçalho deste arquivo.
    for account_id in (A_APTO, A_CARRO):
        latest = max(
            (v for v in VALUATIONS
             if v["accountId"] == account_id and date.fromisoformat(v["date"]) <= TODAY),
            key=lambda v: v["date"],
        )
        by_id[account_id]["balance"] = latest["marketValue"]

    created = ts(date(2024, 1, 1), 10, 0)
    updated = ts(TODAY, 19, 42)
    return {
        "schemaVersion": 19,
        "user": {"name": "Família Ribeiro", "createdAt": created, "updatedAt": updated},
        "settings": {
            "fileCreatedAt": created,
            "fileUpdatedAt": updated,
            "auditLogRetentionLimit": 200,
            "quadrantesEnabled": True,
            "quadrantesInferFromHistory": True,
        },
        "accounts": ACCOUNTS,
        "categories": CATEGORIES,
        "tags": TAGS,
        "transactions": TXS,
        "valuations": sorted(VALUATIONS, key=lambda v: (v["date"], v["accountId"])),
        "auditLog": build_audit(),
        "deletedIds": [],
        "savedPeriods": SAVED_PERIODS,
        "budgets": BUDGETS,
    }


# ─── Relatório ────────────────────────────────────────────────────────────────


def report(data: dict) -> None:
    by_id = {a["id"]: a for a in data["accounts"]}
    cash = (A_ITAU, A_INTER, A_ALELO, A_RESERVA)

    print(f"\n{len(data['transactions'])} lançamentos · {len(data['categories'])} categorias "
          f"· {len(data['budgets'])} caixinhas · {len(data['valuations'])} cotações\n")

    print(f"{'ano':>5} {'receita':>12} {'despesa':>12} {'resultado':>12} {'média/mês':>11}")
    for y in range(START.year, END.year + 1):
        inc = sum(t["amount"] for t in data["transactions"]
                  if t["type"] == "INCOME" and t["date"][:4] == str(y)
                  and by_id[t["accountId"]]["type"] != "CREDIT")
        exp = sum(t["amount"] for t in data["transactions"]
                  if t["type"] == "EXPENSE" and t["date"][:4] == str(y))
        print(f"{y:>5} {inc:>12,.0f} {exp:>12,.0f} {inc - exp:>12,.0f} {(inc - exp) / 12:>11,.0f}")

    print("\nsaldo em", TODAY.isoformat())
    for account_id in cash:
        acc = by_id[account_id]
        print(f"  {acc['name']:<28} {acc['balance'] + replay_delta(account_id):>12,.2f}"
              f"   (semente {acc['balance']:>10,.2f})")

    # Fatura em aberto = período corrente, a mesma janela de getOpenCreditBalance.
    for account_id in (A_CARD_ITAU, A_CARD_NU):
        acc = by_id[account_id]
        meta = acc["creditMetadata"]
        period = invoice_period(TODAY, meta["closingDay"])
        key = f"{period[0]}-{period[1]:02d}"
        total = sum(
            (t["amount"] if t["type"] == "EXPENSE" else -t["amount"])
            for t in data["transactions"]
            if t["accountId"] == account_id and t["type"] in ("EXPENSE", "INCOME")
            and invoice_period(date.fromisoformat(t["date"]), meta["closingDay"]) == period
        )
        paid = sum(t["amount"] for t in data["transactions"]
                   if t["type"] == "CREDIT_PAYMENT" and t["accountId"] == account_id
                   and t.get("referenceMonth") == key)
        print(f"  {acc['name']:<28} fatura {key}: {total - paid:>10,.2f}"
              f"   limite livre {meta['limit'] - (total - paid):>10,.2f}")

    # Dívida comprometida: parcelas de hoje em diante + saldo devedor dos LOAN (HE-08).
    open_inst = sum(t["amount"] for t in data["transactions"]
                    if t.get("installment") and t["type"] == "EXPENSE"
                    and date.fromisoformat(t["date"]) >= TODAY)
    loan = by_id[A_FINANC]["loanMetadata"]["outstandingBalance"]
    latest = {}
    for v in data["valuations"]:
        if date.fromisoformat(v["date"]) <= TODAY:
            latest[v["accountId"]] = v["marketValue"]
    assets = sum(by_id[a]["balance"] + replay_delta(a) for a in cash) + sum(latest.values())
    print(f"\n  ativos                       {assets:>12,.2f}")
    print(f"  parcelamentos em aberto      {open_inst:>12,.2f}")
    print(f"  financiamento                {loan:>12,.2f}")
    print(f"  patrimônio líquido           {assets - open_inst - loan:>12,.2f}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", action="append", type=Path,
                        help="caminho de saída (repetível); padrão: os dois do app")
    parser.add_argument("--scale", type=float, default=None,
                        help="fator das despesas discricionárias (calibração)")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent,
                        help="raiz do repositório, base dos caminhos padrão")
    args = parser.parse_args()

    if args.scale is not None:
        globals()["DISCRETIONARY_SCALE"] = args.scale

    data = generate()
    report(data)

    targets = args.out or [args.root / p for p in DEFAULT_OUTPUTS]
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    for path in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload, encoding="utf-8")
        print(f"escrito: {path}  ({len(payload) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
