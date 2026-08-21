#!/usr/bin/env python3
"""
Sincroniza os dados do Organizze para um banco SQLite do Gimbo (gimbo.db).

Script autossuficiente, executavel por demanda: le a API do Organizze a partir de
uma data de referencia, replica contas, cartoes, categorias, tags e lancamentos na
estrutura do Gimbo e escreve um gimbo.db pronto para importar via Configuracoes ->
Dados -> Importar backup (replace total). O SCHEMA_DDL/PRAGMA user_version abaixo
precisam ser mantidos em paridade com o schema fisico do app (app/src/services/storage/
migrations/vN.sql) — ver "Armadilha recorrente" em CLAUDE.md; ja mordeu em M-51/M-64.

Dois modos de operacao:

  SNAPSHOT (default) — sem --window-months
    Reescreve o arquivo inteiro com exatamente a janela [start, end]. Nao acumula
    historico; das transacoes antigas nao sobra nada. Os campos de conta editados a mao
    (`balance`, `include_in_balance`, `archived`) sobrevivem se --base for passado — a
    preservacao vale nos dois modos, nao so no incremental. Ideal para a carga inicial e
    para reconciliacoes completas periodicas.

  INCREMENTAL — com --window-months N
    Busca somente os ultimos N meses (+ futuros, se --end for futuro) e faz MERGE por
    id sobre o --base: substitui as transacoes dentro da janela (a API e autoridade
    nesse intervalo -> cobre edicoes e exclusoes) e PRESERVA as transacoes fora dela
    vindas da base. Cadastros (contas/cartoes/categorias/tags) sao unidos base ∪ fresco
    (fresco vence) para nao quebrar referencias de transacoes antigas. Ideal para um
    run 1x/dia: ~3 chamadas de cadastro + (N + meses futuros) de transacoes por run.

    Limitacao: edicoes/exclusoes de lancamentos MAIS ANTIGOS que a janela nao sao
    capturadas (a API do Organizze filtra por data do lancamento, nao por updated_at).
    Mitigacao: rodar periodicamente um snapshot completo para reconciliar.

Decisoes de projeto (acordadas):
  - Saldo inicial das contas = 0.0 (preenchido manualmente no Gimbo depois).
  - IDs determinísticos via uuid5 -> re-execucoes com a mesma data geram o mesmo gimbo.db.
  - Modo merge (--base): preserva, por id, o `balance`, o `include_in_balance` e o `archived`
    editados manualmente, evitando que o re-sync zere os saldos ou reapareca uma conta arquivada.
  - Contas arquivadas (M-42): contas/cartoes novos (ausentes do --base) recebem `archived=1`
    quando o Organizze os retorna como `archived` -> espelha o status de arquivamento do
    Organizze na primeira migracao; em re-syncs incrementais, o `archived` de contas ja
    existentes vem do --base (o toggle do Gimbo e que vale).
  - Recorrencia: cada ocorrencia do Organizze entra como transacao avulsa (fiel ao extrato);
    as colunas recurrence_* ficam NULL (transacoes vindas da base conservam seus valores).
  - Timestamps das transacoes (B-32): `created_at` vem do Organizze (quando o lancamento foi
    criado la) e `updated_at` e o timestamp do run. Sao coisas diferentes de proposito — o
    primeiro alimenta o "Ultimos Lancamentos" do Dashboard (ordenado por createdAt, B-24), o
    segundo e a chave LWW do merge multi-dispositivo (CS-19). Transacoes preservadas do --base
    conservam o `created_at` que ja tinham, entao um cofre montado antes do B-32 so tem os
    timestamps corretos nas transacoes dentro da janela ate rodar um snapshot completo.

Uso:
  set ORGANIZZE_TOKEN=...           (PowerShell: $env:ORGANIZZE_TOKEN="...")
  set ORGANIZZE_EMAIL=voce@mail.com
  python sync_gimbo.py --start 2015-01-01                          # snapshot completo
  python sync_gimbo.py --start 2020-01-01 --end 2026-12-31         # inclui futuros/nao pagos
  python sync_gimbo.py --window-months 2 --base gimbo.db           # incremental diario
  python sync_gimbo.py --window-months 2 --end 2026-12-31 --base gimbo.db   # diario + agendados

Variaveis de ambiente:
  ORGANIZZE_TOKEN  (obrigatoria; token de app.organizze.com.br/configuracoes/api-keys)
  ORGANIZZE_EMAIL  (e-mail da conta; pode vir tambem por --email)

  $env:ORGANIZZE_TOKEN="<seu_token_aqui>"
  $env:ORGANIZZE_EMAIL="<seu_email_aqui>"
"""

import argparse
import calendar
import os
import sqlite3
import sys
import time
import uuid as uuidlib
from datetime import date, datetime

import requests
from requests.auth import HTTPBasicAuth

BASE_URL = "https://api.organizze.com.br/rest/v2"

# Namespace fixo para uuid5 — NUNCA alterar (mudaria todos os ids gerados).
GIMBO_NS = uuidlib.UUID("6f4d2e1a-0b3c-5d6e-7f80-91a2b3c4d5e6")

# ─── IDs determinísticos ─────────────────────────────────────────────────────


def gid(kind: str, key) -> str:
    """UUID estavel derivado da entidade de origem (ex.: organizze:account:564990)."""
    return str(uuidlib.uuid5(GIMBO_NS, f"organizze:{kind}:{key}"))


# ─── Mapas de tradução ───────────────────────────────────────────────────────

ACCOUNT_TYPE_MAP = {"checking": "RETAIL", "savings": "SAVINGS", "other": "OTHER"}

# Organizze institution_id -> issuerIcon reconhecido pelo Gimbo.
# Qualquer instituicao fora deste mapa vira None (== 'generic'/sem marca no Gimbo).
ISSUER_ICON_MAP = {
    "nubank": "nubank",
    "nuconta": "nubank",
    "nu-invest": "nubank",
    "itau": "itau",
    "itaupersonnalite": "itau",
    "itau-ion": "itau",
    "bradesco": "bradesco",
    "intermedium": "inter",
    "santander": "santander",
    "caixa": "caixa",
}

KIND_TYPE_MAP = {"expenses": "EXPENSE", "earnings": "INCOME", "none": "EXPENSE"}

# Inferencia de icone por nome de categoria (lucide-react). Fallback: 'circle'.
ICON_MAP = {
    "Alimentação": "utensils",
    "Supermercado": "shopping-cart",
    "Restaurante": "utensils",
    "Delivery": "package",
    "Padaria": "store",
    "Lazer": "smile",
    "Transporte": "car",
    "Combustível": "fuel",
    "Financiamento": "landmark",
    "Estacionamento": "square-parking",
    "Seguro": "shield",
    "Manutenção Carro": "wrench",
    "Manutenção": "wrench",
    "Taxas": "receipt",
    "Tarifas Bancárias": "landmark",
    "Transporte Aplicativo": "car",
    "Saúde": "heart-pulse",
    "Farmácia": "pill",
    "Médicos": "stethoscope",
    "Dentista": "smile",
    "Psicologia": "brain",
    "Nutricionista": "salad",
    "Fonoaudiologia": "mic",
    "Fisioterapia": "activity",
    "Psiquiatria": "brain",
    "Endocrinologista": "stethoscope",
    "Terapia Ocupacional": "activity",
    "Podologia": "footprints",
    "Moradia": "home",
    "Energia": "zap",
    "Condomínio": "building",
    "Triple Play": "wifi",
    "Aluguel": "home",
    "IPTU": "receipt",
    "Móveis": "sofa",
    "Água": "droplets",
    "Gás": "flame",
    "Diarista": "sparkles",
    "Jardinagem": "leaf",
    "Cachorro": "paw-print",
    "Veterinária": "paw-print",
    "Cuidados Pessoais": "sparkles",
    "Cabelereiro": "scissors",
    "Manicure": "paint-bucket",
    "Maquiagem": "sparkles",
    "Acessórios": "watch",
    "Academia": "dumbbell",
    "Presentes": "gift",
    "Saques": "banknote",
    "Família": "users",
    "Vestuário": "shirt",
    "Celular": "smartphone",
    "Viagem": "plane",
    "Empréstimo": "hand-coins",
    "Educação": "graduation-cap",
    "Fotografia": "camera",
    "Impostos": "receipt",
    "Rendimentos": "trending-up",
    "Operações Financeiras": "arrow-right-left",
    "Transferências": "arrow-right-left",
    "Pagamento de fatura": "credit-card",
    "Reembolsos": "refresh-cw",
    "Empregador A": "briefcase",
    "Salário": "briefcase",
    "Empregador B": "briefcase",
    "Pães": "store",
    "Tarot": "sparkles",
    "MEI": "building-2",
    "Consultoria Exemplo": "users",
    "Emprego A": "briefcase",
    "Emprego B": "briefcase",
    "Apartamento Exemplo": "building",
    "Investimento": "trending-up",
    "Outros": "circle",
    "Apelido A": "baby",
    "Apelido B": "baby",
}

# Paleta para colorir tags de forma deterministica.
TAG_PALETTE = [
    "#2D6A4F", "#C0392B", "#2980B9", "#8E44AD", "#D35400",
    "#16A085", "#E67E22", "#2C3E50", "#27AE60", "#7F8C8D",
]


def normalize_color(hex_color) -> str:
    h = (hex_color or "808080").strip("#").upper()
    if len(h) == 6 and all(c in "0123456789ABCDEF" for c in h):
        return f"#{h}"
    return "#808080"


def get_icon(name: str) -> str:
    if name in ICON_MAP:
        return ICON_MAP[name]
    name_lower = name.lower()
    for key, icon in ICON_MAP.items():
        if key.lower() in name_lower:
            return icon
    return "circle"


def tag_color(name: str) -> str:
    # Deterministico entre execucoes (hash() de str e randomizado por PYTHONHASHSEED).
    return TAG_PALETTE[uuidlib.uuid5(GIMBO_NS, f"tagcolor:{name}").int % len(TAG_PALETTE)]


def now_iso() -> str:
    return datetime.now().isoformat()


def parse_date_str(s: str):
    """'YYYY-MM-DD...' -> date | None (tolerante a valores inesperados da base)."""
    if not s:
        return None
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def organizze_created_at(t, fallback: str) -> str:
    """`created_at` do lancamento no Organizze -> `createdAt` do Gimbo (B-24/B-32).

    A API v2 devolve ISO 8601 com offset (ex.: '2026-08-19T20:18:32.000-03:00'), que o
    `new Date()` do app interpreta corretamente mesmo convivendo com os timestamps naive
    gravados pelo proprio Gimbo. Formato inesperado (ex.: 'DD/MM/YYYY') viraria `Invalid Date`
    e quebraria a ordenacao -> cai no fallback. O fallback (timestamp do run) tambem cobre o
    campo ausente: `transactions.created_at` e NOT NULL no schema do Gimbo.
    """
    raw = str(t.get("created_at") or "").strip()
    return raw if parse_date_str(raw) else fallback


def months_back(d: date, n: int) -> date:
    """Primeiro dia do mes `n` meses antes do mes de `d` (months_back(2026-06, 1) -> 2026-05-01)."""
    total = d.year * 12 + (d.month - 1) - n
    return date(total // 12, total % 12 + 1, 1)


def payment_reference_month(date_str: str):
    """Periodo de fatura ("YYYY-MM") que um pagamento liquida (Opcao 2).

    O Gimbo projeta o vencimento da fatura no mes seguinte ao periodo (due = periodo+1).
    Um pagamento em M quita, portanto, a fatura do periodo M-1. Heuristica boa o bastante
    para o sync (o Organizze nao diz explicitamente qual fatura o pagamento liquida).
    """
    d = parse_date_str(date_str)
    if d is None:
        return None
    total = d.year * 12 + (d.month - 1) - 1
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


# ─── Camada de API do Organizze ──────────────────────────────────────────────


def autenticar(email: str, token: str):
    """Retorna (session, nome_usuario)."""
    session = requests.Session()
    session.auth = HTTPBasicAuth(email, token)
    session.headers.update(
        {
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": f"Gimbo Sync ({email})",
        }
    )
    resp = session.get(f"{BASE_URL}/users")
    resp.raise_for_status()
    nome = resp.json()[0]["name"]
    print(f"[ok] Autenticado como {nome}")
    return session, nome


def _get(session, path: str, params=None, tentativas: int = 5) -> list:
    """GET resiliente. Re-tenta em 429 (respeita Retry-After) E em quedas de conexao/timeout
    com backoff exponencial — a API do Organizze derruba conexoes sob volume (WinError 10054),
    e um snapshot completo faz centenas de chamadas. Timeout explicito evita travar."""
    url = f"{BASE_URL}{path}"
    resp = None
    for tentativa in range(tentativas):
        try:
            resp = session.get(url, params=params, timeout=30)
        except requests.exceptions.RequestException as e:
            if tentativa < tentativas - 1:
                espera = 2 ** tentativa  # 1, 2, 4, 8...
                print(f"     [conexao] {type(e).__name__} — aguardando {espera}s "
                      f"(tentativa {tentativa + 1}/{tentativas})")
                time.sleep(espera)
                continue
            raise
        if resp.status_code == 429 and tentativa < tentativas - 1:
            espera = float(resp.headers.get("Retry-After", 5))
            print(f"     [429] rate limit — aguardando {espera}s")
            time.sleep(espera)
            continue
        resp.raise_for_status()
        return resp.json()
    resp.raise_for_status()
    return resp.json()


def month_iter(start: date, end: date):
    cur = date(start.year, start.month, 1)
    last = date(end.year, end.month, 1)
    while cur <= last:
        yield cur.year, cur.month
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)


def fetch_transactions(session, start: date, end: date, intervalo: float) -> list:
    """Busca lancamentos mes a mes (contorna o teto de 500/chamada). Dedup por id.

    `end` pode ser futuro: o Organizze retorna lancamentos agendados/recorrentes e
    parcelas a vencer, normalmente com paid=false -> chegam ao Gimbo como isPaid=false.
    """
    meses = list(month_iter(start, end))
    total = len(meses)
    print(f"[..] Buscando lancamentos de {start} ate {end} ({total} meses, intervalo {intervalo}s)")

    by_id: dict = {}
    for i, (ano, mes) in enumerate(meses, start=1):
        ultimo = calendar.monthrange(ano, mes)[1]
        params = {
            "start_date": f"{ano:04d}-{mes:02d}-01",
            "end_date": f"{ano:04d}-{mes:02d}-{ultimo:02d}",
        }
        lanc = _get(session, "/transactions", params)
        for t in lanc:
            by_id[t["id"]] = t
        if len(lanc) == 500:
            print(f"     [aviso] {params['start_date'][:7]} retornou 500 lancamentos — possivel truncamento")
        print(f"     [{i}/{total}] {params['start_date'][:7]}: {len(lanc)} lancamentos")
        if i < total:
            time.sleep(intervalo)

    print(f"[ok] {len(by_id)} lancamentos unicos coletados")
    return list(by_id.values())


def fetch_invoice_month_map(
    session, cartoes: list, start: date, end: date, intervalo: float, incremental: bool
) -> dict:
    """(card_id, invoice_id) -> "YYYY-MM" (mes do closing_date), p/ as faturas dos cartoes.

    Fonte AUTORITATIVA da associacao lancamento<->fatura (CC-31/B-18): o Organizze guarda,
    por lancamento, `credit_card_invoice_id` (charges/estornos) e `paid_credit_card_invoice_id`
    (pagamentos). O periodo da fatura no Gimbo (`reference_month`) = mes do `closing_date`
    (ex.: fatura que fecha 2026-05-30 -> "2026-05" -> vence 07/jun). Captura toda a fronteira
    difusa de fechamento que nenhuma regra de data reproduz.

    IMPORTANTE: os IDs de fatura do Organizze sao POR-CARTAO (o mesmo invoice_id aparece em
    varios cartoes). A chave PRECISA ser (card_id, invoice_id) — um inv_map so por invoice_id
    colide e desloca o reference_month em ~1 mes (bug observado no primeiro re-sync).

    O endpoint /credit_cards/:id/invoices devolve so ~12 faturas por chamada (janela recente),
    mas respeita `start_date`/`end_date`. No modo SNAPSHOT varremos o historico por janelas
    ANUAIS (com sobreposicao na fronteira) para cobrir todas as faturas — sem isso, lancamentos
    anteriores a ~6 meses ficam sem reference_month e caem na regra de data. No modo INCREMENTAL
    basta a janela recente (1 chamada/cartao): a `--base` preserva o reference_month dos antigos.
    """
    inv_map: dict = {}
    inv_due_map: dict = {}  # (card_id, invoice_id) -> due date "YYYY-MM-DD" (campo `date` da fatura, CC-33)
    if incremental:
        # Janela recente basta: a --base preserva o reference_month dos lancamentos antigos.
        windows = [(None, None)]
    else:
        # Snapshot: janelas ANUAIS sobre o horizonte (cada chamada devolve ~12 faturas = ~1 ano;
        # +1 ano no fim cobre a sobreposicao de fronteira). Sem isso, lancamentos com mais de ~6
        # meses ficam sem reference_month. O _get resiliente (retry/backoff) absorve as quedas de
        # conexao que o volume causa.
        windows = [(f"{y:04d}-01-01", f"{y:04d}-12-31") for y in range(start.year, end.year + 2)]
    total = len(cartoes)
    calls = 0
    for i, c in enumerate(cartoes, start=1):
        cid = c["id"]
        before = len(inv_map)
        for sd, ed in windows:
            params = {"start_date": sd, "end_date": ed} if sd else None
            for f in _get(session, f"/credit_cards/{cid}/invoices", params):
                iid, cl, due = f.get("id"), f.get("closing_date"), f.get("date")
                if iid is not None and cl:
                    inv_map[(cid, iid)] = str(cl)[:7]
                    if due:
                        inv_due_map[(cid, iid)] = str(due)[:10]
            calls += 1
            time.sleep(intervalo)
        print(f"     [{i}/{total}] cartao {cid}: +{len(inv_map) - before} faturas ({len(windows)} janelas)")
    print(f"[ok] {len(inv_map)} faturas mapeadas em {calls} chamadas ((card_id, invoice_id) -> periodo + vencimento)")
    return inv_map, inv_due_map


# ─── Base anterior: cadastros + transacoes lidos para merge ──────────────────


def read_base_data(base_path: str):
    """Le o gimbo.db anterior por completo (cadastros, transacoes, tags). None se ausente.

    Retorna dicts id->row (mesmo shape das colunas) prontos para merge, mais o set de
    vinculos transaction_tags.
    """
    if not base_path or not os.path.exists(base_path):
        return None
    conn = sqlite3.connect(base_path)
    conn.row_factory = sqlite3.Row
    try:
        # archived (M-42) pode nao existir numa --base gerada por versao anterior do script.
        has_archived = any(
            row[1] == "archived" for row in conn.execute("PRAGMA table_info(accounts)")
        )
        archived_col = "archived, " if has_archived else ""
        accounts = {
            r["id"]: dict(r)
            for r in conn.execute(
                "SELECT id, name, type, balance, include_in_balance, credit_limit, "
                f"credit_closing_day, credit_due_day, issuer_icon, {archived_col}created_at, updated_at "
                "FROM accounts"
            )
        }
        if not has_archived:
            for row in accounts.values():
                row["archived"] = 0
        categories = {
            r["id"]: dict(r)
            for r in conn.execute(
                "SELECT id, parent_id, name, icon, color, type, created_at, updated_at FROM categories"
            )
        }
        tags = {
            r["id"]: dict(r)
            for r in conn.execute("SELECT id, name, color, created_at, updated_at FROM tags")
        }
        # invoice_due_date (CC-33) / installment_purchase_date (M-64) podem nao existir numa
        # --base gerada por versao anterior do script.
        tx_cols = {row[1] for row in conn.execute("PRAGMA table_info(transactions)")}
        due_col = "invoice_due_date, " if "invoice_due_date" in tx_cols else ""
        purchase_col = "installment_purchase_date, " if "installment_purchase_date" in tx_cols else ""
        transactions = {
            r["id"]: dict(r)
            for r in conn.execute(
                "SELECT id, account_id, category_id, amount, type, description, date, is_paid, "
                "transfer_account_id, installment_parent_id, installment_index, installment_total, "
                f"{purchase_col}"
                "recurrence_parent_id, recurrence_frequency, recurrence_end_date, reference_month, "
                f"{due_col}created_at, updated_at "
                "FROM transactions"
            )
        }
        txtags = {(r[0], r[1]) for r in conn.execute("SELECT transaction_id, tag_id FROM transaction_tags")}
    finally:
        conn.close()
    print(
        f"[ok] Base lida: {len(accounts)} contas, {len(categories)} categorias, "
        f"{len(tags)} tags, {len(transactions)} transacoes"
    )
    return {
        "accounts": accounts,
        "categories": categories,
        "tags": tags,
        "transactions": transactions,
        "txtags": txtags,
    }


# ─── Conversão (cadastros e transacoes frescos da API) ───────────────────────


def build_accounts(contas, cartoes, base_accounts, ts):
    """Retorna (accounts_rows, account_id_map, card_id_map). Saldos preservados da base por id."""
    account_id_map = {}
    card_id_map = {}
    rows = []

    def merged(uid, default_balance, default_include, default_archived):
        b = base_accounts.get(uid)
        if b is not None:
            return b["balance"], b["include_in_balance"], b["archived"]
        return default_balance, default_include, default_archived

    for c in contas:
        uid = gid("account", c["id"])
        account_id_map[c["id"]] = uid
        gtype = ACCOUNT_TYPE_MAP.get(c.get("type") or "other", "OTHER")
        org_archived = 1 if c.get("archived") else 0
        default_include = 0 if org_archived else 1
        balance, include, archived = merged(uid, 0.0, default_include, org_archived)
        issuer = ISSUER_ICON_MAP.get(c.get("institution_id") or "", None)
        rows.append(
            {
                "id": uid, "name": c["name"], "type": gtype,
                "balance": balance, "include_in_balance": include, "archived": archived,
                "credit_limit": None, "credit_closing_day": None, "credit_due_day": None,
                "issuer_icon": issuer, "created_at": ts, "updated_at": ts,
            }
        )

    for c in cartoes:
        uid = gid("card", c["id"])
        card_id_map[c["id"]] = uid
        org_archived = 1 if c.get("archived") else 0
        default_include = 0 if org_archived else 1
        balance, include, archived = merged(uid, 0.0, default_include, org_archived)
        issuer = ISSUER_ICON_MAP.get(c.get("institution_id") or "", None)
        rows.append(
            {
                "id": uid, "name": c["name"], "type": "CREDIT",
                "balance": balance, "include_in_balance": include, "archived": archived,
                "credit_limit": (c.get("limit_cents") or 0) / 100.0,
                "credit_closing_day": c.get("closing_day") or 10,
                "credit_due_day": c.get("due_day") or 20,
                "issuer_icon": issuer, "created_at": ts, "updated_at": ts,
            }
        )

    return rows, account_id_map, card_id_map


def build_categories(categorias, ts):
    """Retorna (categories_rows, category_id_map, fb_exp, fb_inc). parent_id ja resolvido p/ uuid."""
    category_id_map = {}
    intermediarias = []
    for cat in categorias:
        uid = gid("category", cat["id"])
        category_id_map[cat["id"]] = uid
        intermediarias.append(
            {
                "id": uid,
                "parent_id_org": cat["parent_id"],
                "name": cat["name"],
                "icon": get_icon(cat["name"]),
                "color": normalize_color(cat.get("color")),
                "type": KIND_TYPE_MAP.get(cat.get("kind", "expenses"), "EXPENSE"),
            }
        )

    rows = [
        {
            "id": c["id"],
            "parent_id": category_id_map.get(c["parent_id_org"]) if c["parent_id_org"] else None,
            "name": c["name"], "icon": c["icon"], "color": c["color"], "type": c["type"],
            "created_at": ts, "updated_at": ts,
        }
        for c in intermediarias
    ]

    fb_exp = gid("category", "fallback-expense")
    fb_inc = gid("category", "fallback-income")
    rows.append({"id": fb_exp, "parent_id": None, "name": "Outros (Despesas)", "icon": "circle", "color": "#808080", "type": "EXPENSE", "created_at": ts, "updated_at": ts})
    rows.append({"id": fb_inc, "parent_id": None, "name": "Outras Receitas", "icon": "circle", "color": "#2BCA9A", "type": "INCOME", "created_at": ts, "updated_at": ts})
    return rows, category_id_map, fb_exp, fb_inc


def build_transactions(lancamentos, account_id_map, card_id_map, category_id_map, fb_exp, fb_inc, ts,
                        invoice_month_map=None, invoice_due_map=None):
    """Retorna (transactions_rows, tags_rows, txtag_rows, stats)."""
    invoice_month_map = invoice_month_map or {}
    invoice_due_map = invoice_due_map or {}
    # Lado-destino de transferencias (valor positivo + oposite) é espelho — descartar.
    destino_ids = {
        t["id"]
        for t in lancamentos
        if t.get("oposite_transaction_id") and (t.get("amount_cents") or 0) > 0
    }

    # Parcelas: chave heuristica compartilha o mesmo installment_parent_id.
    # CC-34: o Organizze nao tem campo estavel de agrupamento (recurring_id e sempre None
    # para parcelamentos — diagnostico ad-hoc, data/diag_installments.py). A chave anterior
    # (description|conta|abs(amount_cents)|total_installments) tinha dois problemas: (a) o
    # residuo de centavos pode diferir entre parcelas, quebrando o agrupamento; (b) compras
    # recorrentes com o mesmo valor/descricao/total em anos diferentes (ex.: assinatura anual
    # parcelada em 12x) cairiam na MESMA chave, fundindo series distintas. `created_at` resolve
    # os dois: e identico (ao segundo) entre todas as parcelas de uma mesma serie real, e varia
    # entre series diferentes mesmo com description/amount/total idênticos.
    def inst_key(t):
        source = t.get("credit_card_id") or t.get("account_id")
        return f"{source}|{t.get('created_at') or ''}|{t.get('total_installments') or 1}"

    tx_rows = []
    tag_names = set()
    txtag_rows = []
    skipped_no_account = 0
    skipped_dest = 0

    for t in lancamentos:
        if t["id"] in destino_ids:
            skipped_dest += 1
            continue

        amount_cents = t.get("amount_cents") or 0
        abs_amount = abs(amount_cents) / 100.0
        date_str = str(t.get("date") or "")[:10]
        is_paid = 1 if t.get("paid") else 0
        reference_month = None
        invoice_due_date = None  # CC-33: vencimento real da fatura (so charges/estornos)

        paid_cc = t.get("paid_credit_card_id")
        cc_id = t.get("credit_card_id")
        oposite_tx = t.get("oposite_transaction_id")
        oposite_acc = t.get("oposite_account_id")

        if paid_cc is not None:
            cc_uuid = card_id_map.get(paid_cc)
            bank_uuid = account_id_map.get(t.get("account_id"))
            if cc_uuid is None or bank_uuid is None:
                skipped_no_account += 1
                continue
            tx_type, account_id, transfer_account_id, category_id = "CREDIT_PAYMENT", cc_uuid, bank_uuid, None
            # CC-31: fatura quitada vem exata do Organizze (paid_credit_card_invoice_id);
            # chave (card_id, invoice_id) — IDs de fatura sao por-cartao. heuristica mes-1
            # so como fallback quando a fatura nao esta no mapa.
            reference_month = invoice_month_map.get((paid_cc, t.get("paid_credit_card_invoice_id")))
            if reference_month is None:
                reference_month = payment_reference_month(date_str)

        elif oposite_tx is not None and amount_cents <= 0:
            src = account_id_map.get(t.get("account_id"))
            dst = account_id_map.get(oposite_acc) or card_id_map.get(oposite_acc) if oposite_acc else None
            if src is None or dst is None:
                skipped_no_account += 1
                continue
            tx_type, account_id, transfer_account_id, category_id = "TRANSFER", src, dst, None

        elif cc_id is not None:
            cc_uuid = card_id_map.get(cc_id)
            if cc_uuid is None:
                skipped_no_account += 1
                continue
            org_cat = t.get("category_id")
            account_id, transfer_account_id = cc_uuid, None
            # CC-31: associa o charge/estorno a fatura real do Organizze (autoritativo;
            # captura a fronteira difusa de fechamento). Chave (card_id, invoice_id) — IDs
            # de fatura sao por-cartao. Sem invoice -> None -> default por data no app.
            inv_key = (cc_id, t.get("credit_card_invoice_id"))
            reference_month = invoice_month_map.get(inv_key)
            # CC-33: vencimento autoritativo da fatura (imuniza o passado a mudanca de fechamento).
            invoice_due_date = invoice_due_map.get(inv_key)
            # Sinal do Organizze no cartao: amount_cents > 0 = credito/estorno (abate a fatura),
            # representado no Gimbo como INCOME na propria conta CREDIT; < 0 = compra (EXPENSE).
            if amount_cents > 0:
                tx_type = "INCOME"
                category_id = category_id_map.get(org_cat, fb_inc) if org_cat else fb_inc
            else:
                tx_type = "EXPENSE"
                category_id = category_id_map.get(org_cat, fb_exp) if org_cat else fb_exp

        else:
            acc = account_id_map.get(t.get("account_id"))
            if acc is None:
                skipped_no_account += 1
                continue
            org_cat = t.get("category_id")
            account_id, transfer_account_id = acc, None
            if amount_cents > 0:
                tx_type = "INCOME"
                category_id = category_id_map.get(org_cat, fb_inc) if org_cat else fb_inc
            else:
                tx_type = "EXPENSE"
                category_id = category_id_map.get(org_cat, fb_exp) if org_cat else fb_exp

        # Parcelas
        total_inst = t.get("total_installments") or 1
        inst_parent = inst_index = inst_total = inst_purchase_date = None
        if total_inst > 1:
            inst_parent = gid("installment", inst_key(t))
            inst_index = t.get("installment") or 1
            inst_total = total_inst
            # M-64: data de compra original — `created_at` e o mesmo timestamp para toda a
            # serie (confirmado via diag_installments.py), ao contrario de `date` (vencimento
            # por parcela). Pode ser um pouco posterior a compra real se o lancamento foi
            # registrado manualmente depois (ex.: dias após a compra), mas e estavel e o
            # melhor proxy disponivel na API.
            inst_purchase_date = str(t.get("created_at") or "")[:10] or None

        tx_uuid = gid("tx", t["id"])
        tx_rows.append(
            {
                "id": tx_uuid, "account_id": account_id, "category_id": category_id,
                "amount": abs_amount, "type": tx_type, "description": t.get("description") or "",
                "date": date_str, "is_paid": is_paid, "transfer_account_id": transfer_account_id,
                "installment_parent_id": inst_parent, "installment_index": inst_index, "installment_total": inst_total,
                "installment_purchase_date": inst_purchase_date,
                "recurrence_parent_id": None, "recurrence_frequency": None, "recurrence_end_date": None,
                "reference_month": reference_month, "invoice_due_date": invoice_due_date,
                # B-32: `created_at` = quando o lancamento nasceu no Organizze (alimenta o
                # "Ultimos Lancamentos" do Dashboard, ordenado por createdAt — B-24). Ja
                # `updated_at` continua sendo o timestamp do run de proposito: e a chave LWW
                # do merge multi-dispositivo (CS-19), e o snapshot recem-sincronizado precisa
                # vencer o que estiver no cofre.
                "created_at": organizze_created_at(t, ts), "updated_at": ts,
            }
        )

        for tg in t.get("tags") or []:
            # Organizze armazena o nome da tag com um "#" embutido (ex.: "#despesaFixa"),
            # mas a UI do Gimbo ja prefixa "#" ao exibir tags -> sem isso vira "##despesaFixa".
            name = (tg.get("name") or "").strip().lstrip("#")
            if name:
                tag_names.add(name)
                txtag_rows.append((tx_uuid, gid("tag", name)))

    tag_rows = [{"id": gid("tag", n), "name": n, "color": tag_color(n), "created_at": ts, "updated_at": ts} for n in sorted(tag_names)]
    stats = {
        "transactions": len(tx_rows),
        "unpaid": sum(1 for t in tx_rows if t["is_paid"] == 0),
        "tags": len(tag_rows),
        "skipped_dest": skipped_dest,
        "skipped_no_account": skipped_no_account,
    }
    return tx_rows, tag_rows, txtag_rows, stats


# ─── Merge incremental: fresco sobre a base ──────────────────────────────────


def merge_records(base, fresh, window_start: date, window_end: date):
    """Une cadastros (base ∪ fresco, fresco vence) e funde transacoes por janela.

    Transacoes dentro de [window_start, window_end] vem do fresco (autoridade do periodo,
    cobrindo edicoes e exclusoes); fora da janela, preserva as da base. txtags acompanham.
    """
    accounts = {**base["accounts"], **fresh["accounts"]}
    categories = {**base["categories"], **fresh["categories"]}
    tags = {**base["tags"], **fresh["tags"]}

    transactions = {}
    for tid, row in base["transactions"].items():
        d = parse_date_str(row.get("date"))
        if d is None or not (window_start <= d <= window_end):
            transactions[tid] = row
    transactions.update(fresh["transactions"])

    # txtags: do fresco para tx frescas; da base para tx preservadas (nao sobrescritas).
    txtags = {tt for tt in fresh["txtags"] if tt[0] in transactions}
    txtags |= {
        tt
        for tt in base["txtags"]
        if tt[0] in transactions and tt[0] not in fresh["transactions"] and tt[1] in tags
    }

    carried = len(transactions) - len(fresh["transactions"])
    return {"accounts": accounts, "categories": categories, "tags": tags,
            "transactions": transactions, "txtags": txtags}, carried


# ─── Escrita do SQLite ────────────────────────────────────────────────────────

SCHEMA_DDL = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  file_created_at TEXT NOT NULL DEFAULT '', file_updated_at TEXT NOT NULL DEFAULT '',
  audit_log_retention_limit INTEGER,
  -- F-30/BX-07/app schema v12: toggle da receita "Quadrantes", nunca populado pelo Organizze
  -- (mesmo motivo das colunas LOAN/reserva acima).
  quadrantes_enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0, include_in_balance INTEGER NOT NULL DEFAULT 1,
  credit_limit REAL, credit_closing_day INTEGER, credit_due_day INTEGER,
  -- HE-04/app schema v8: colunas de LOAN, nunca populadas pelo Organizze (sem contas LOAN na
  -- origem) — adicionadas aqui só para acompanhar PRAGMA user_version (abaixo) e evitar que o
  -- runMigrations do app pule o ALTER TABLE correspondente ao importar este arquivo.
  loan_outstanding_balance REAL, loan_monthly_payment REAL,
  loan_remaining_installments INTEGER, loan_interest_rate REAL,
  -- HE-14/app schema v10: marcador de reserva de emergência, nunca populado pelo Organizze
  -- (mesmo motivo dos campos LOAN acima).
  is_reserve INTEGER,
  issuer_icon TEXT, archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, parent_id TEXT REFERENCES categories(id),
  name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT, amount REAL NOT NULL, type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, is_paid INTEGER NOT NULL DEFAULT 0,
  transfer_account_id TEXT, installment_parent_id TEXT, installment_index INTEGER, installment_total INTEGER,
  installment_purchase_date TEXT,
  recurrence_parent_id TEXT, recurrence_frequency TEXT, recurrence_end_date TEXT, reference_month TEXT,
  invoice_due_date TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT NOT NULL, summary TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deleted_ids (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS valuations (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL, market_value REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_periods (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- F-30/BX-03 (app schema v11): caixinhas. Nunca populadas pelo Organizze (sem conceito
-- equivalente na origem) — tabelas criadas vazias, mesmo tratamento de saved_periods acima.
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL, target REAL NOT NULL,
  period_mode TEXT NOT NULL, period_date TEXT, period_start TEXT, period_end TEXT,
  archived_at TEXT, recipe_slug TEXT, recipe_slot INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transaction_budgets (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, budget_id)
);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_recurrence ON transactions(recurrence_parent_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_transaction_tags_tx ON transaction_tags(transaction_id);
CREATE INDEX IF NOT EXISTS idx_valuations_account ON valuations(account_id);
CREATE INDEX IF NOT EXISTS idx_valuations_date ON valuations(date);
CREATE INDEX IF NOT EXISTS idx_transaction_budgets_tx ON transaction_budgets(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_budgets_budget ON transaction_budgets(budget_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_created ON transactions(date DESC, created_at DESC);
PRAGMA user_version = 13;
"""


def write_db(out_path, user_name, user_email, records):
    """Escreve os dicts finais (accounts/categories/tags/transactions + txtags) em gimbo.db."""
    ts = now_iso()
    accounts = records["accounts"]
    categories = records["categories"]
    tags = records["tags"]
    transactions = records["transactions"]
    txtags = records["txtags"]

    # Escreve em arquivo temporario e troca ao final — seguro mesmo se out == base.
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    tmp_path = out_path + ".tmp"
    if os.path.exists(tmp_path):
        os.remove(tmp_path)

    conn = sqlite3.connect(tmp_path)
    cur = conn.cursor()
    cur.executescript(SCHEMA_DDL)

    cur.execute(
        "INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('singleton', ?, ?, ?, ?)",
        [user_name, user_email, ts, ts],
    )
    cur.execute(
        "INSERT INTO settings (id, file_created_at, file_updated_at, audit_log_retention_limit) VALUES ('singleton', ?, ?, ?)",
        [ts, ts, 200],
    )

    for a in accounts.values():
        cur.execute(
            """INSERT INTO accounts
                 (id, name, type, balance, include_in_balance, credit_limit, credit_closing_day,
                  credit_due_day, loan_outstanding_balance, loan_monthly_payment,
                  loan_remaining_installments, loan_interest_rate, issuer_icon, archived,
                  created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [a["id"], a["name"], a["type"], a["balance"], a["include_in_balance"], a["credit_limit"],
             a["credit_closing_day"], a["credit_due_day"],
             a.get("loan_outstanding_balance"), a.get("loan_monthly_payment"),
             a.get("loan_remaining_installments"), a.get("loan_interest_rate"),
             a["issuer_icon"], a["archived"],
             a.get("created_at", ts), a.get("updated_at", ts)],
        )

    # Pais antes de filhos (defensivo; FK auto-referente nao e enforced sem PRAGMA).
    ordenadas = sorted(categories.values(), key=lambda c: c["parent_id"] is not None)
    for cat in ordenadas:
        cur.execute(
            "INSERT INTO categories (id, parent_id, name, icon, color, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [cat["id"], cat["parent_id"], cat["name"], cat["icon"], cat["color"], cat["type"],
             cat.get("created_at", ts), cat.get("updated_at", ts)],
        )

    for tg in tags.values():
        cur.execute(
            "INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            [tg["id"], tg["name"], tg["color"], tg.get("created_at", ts), tg.get("updated_at", ts)],
        )

    for t in transactions.values():
        cur.execute(
            """INSERT INTO transactions
                 (id, account_id, category_id, amount, type, description, date, is_paid,
                  transfer_account_id, installment_parent_id, installment_index, installment_total,
                  installment_purchase_date,
                  recurrence_parent_id, recurrence_frequency, recurrence_end_date, reference_month,
                  invoice_due_date, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [t["id"], t["account_id"], t["category_id"], t["amount"], t["type"], t["description"],
             t["date"], t["is_paid"], t["transfer_account_id"], t["installment_parent_id"],
             t["installment_index"], t["installment_total"], t.get("installment_purchase_date"),
             t.get("recurrence_parent_id"), t.get("recurrence_frequency"), t.get("recurrence_end_date"),
             t.get("reference_month"), t.get("invoice_due_date"), t.get("created_at", ts), t.get("updated_at", ts)],
        )

    for tx_id, tag_id in txtags:
        cur.execute("INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)", [tx_id, tag_id])

    conn.commit()
    conn.close()

    if os.path.exists(out_path):
        os.remove(out_path)
    os.replace(tmp_path, out_path)


# ─── Main ────────────────────────────────────────────────────────────────────


def parse_date_arg(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def main():
    p = argparse.ArgumentParser(description="Sincroniza dados do Organizze para um gimbo.db")
    p.add_argument("--start", default=None, help="Data inicial do horizonte (YYYY-MM-DD). Obrigatoria no modo snapshot")
    p.add_argument("--end", default=None, help="Data final do horizonte (YYYY-MM-DD); default: hoje. Use uma data futura para incluir lancamentos agendados/nao pagos")
    p.add_argument("--window-months", type=int, default=None, help="Ativa o modo INCREMENTAL: busca so os ultimos N meses (incluindo o atual) e funde no --base")
    # O script mora em scripts/, mas a saida default fica em data/ (irmao de scripts/,
    # ignorado no .gitignore da raiz do repo) — nunca versionar o gimbo.db gerado.
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_out = os.path.join(repo_root, "data", "gimbo.db")
    p.add_argument("--out", default=default_out, help="Caminho do gimbo.db de saida (default: data/gimbo.db)")
    p.add_argument("--base", default=None, help="gimbo.db anterior (snapshot: preserva saldos; incremental: funde transacoes). Default no incremental = --out se existir")
    p.add_argument("--email", default=os.environ.get("ORGANIZZE_EMAIL", ""), help="E-mail (ou ORGANIZZE_EMAIL)")
    p.add_argument("--interval", type=float, default=2.0, help="Intervalo (s) entre chamadas de API")
    args = p.parse_args()

    token = os.environ.get("ORGANIZZE_TOKEN", "")
    if not token:
        sys.exit("ERRO: defina a variavel de ambiente ORGANIZZE_TOKEN.")
    if not args.email:
        sys.exit("ERRO: informe --email ou defina ORGANIZZE_EMAIL.")

    incremental = args.window_months is not None
    end = parse_date_arg(args.end) if args.end else date.today()

    if incremental:
        if args.window_months < 1:
            sys.exit("ERRO: --window-months deve ser >= 1.")
        if args.start:
            print("[aviso] --start ignorado no modo incremental (janela derivada de --window-months).")
        start = months_back(date.today(), args.window_months - 1)
        # No incremental, o destino e a propria base por padrao (acumula historico).
        if not args.base and os.path.exists(args.out):
            args.base = args.out
            print(f"[ok] --base assumido como --out existente: {args.base}")
    else:
        if not args.start:
            sys.exit("ERRO: informe --start (modo snapshot) ou --window-months (modo incremental).")
        start = parse_date_arg(args.start)

    if end < start:
        sys.exit(f"ERRO: --end ({end}) e anterior ao inicio da janela ({start}).")

    modo = f"INCREMENTAL (janela {args.window_months} mes(es))" if incremental else "SNAPSHOT"
    print(f"[ok] Modo {modo} | horizonte {start} -> {end}")

    ts = now_iso()
    session, user_name = autenticar(args.email, token)
    categorias = _get(session, "/categories")
    contas = _get(session, "/accounts")
    cartoes = _get(session, "/credit_cards")
    print(f"[ok] {len(categorias)} categorias, {len(contas)} contas, {len(cartoes)} cartoes")
    invoice_month_map, invoice_due_map = fetch_invoice_month_map(
        session, cartoes, start, end, args.interval, incremental
    )
    lancamentos = fetch_transactions(session, start, end, args.interval)

    base_data = read_base_data(args.base)
    if incremental and base_data is None:
        print("[aviso] modo incremental sem base existente — historico fora da janela NAO sera preservado neste run.")
    base_accounts = base_data["accounts"] if base_data else {}

    accounts_rows, account_id_map, card_id_map = build_accounts(contas, cartoes, base_accounts, ts)
    categories_rows, category_id_map, fb_exp, fb_inc = build_categories(categorias, ts)
    tx_rows, tag_rows, txtag_rows, stats = build_transactions(
        lancamentos, account_id_map, card_id_map, category_id_map, fb_exp, fb_inc, ts,
        invoice_month_map, invoice_due_map
    )

    fresh = {
        "accounts": {a["id"]: a for a in accounts_rows},
        "categories": {c["id"]: c for c in categories_rows},
        "tags": {t["id"]: t for t in tag_rows},
        "transactions": {t["id"]: t for t in tx_rows},
        "txtags": set(txtag_rows),
    }

    carried = 0
    if incremental and base_data is not None:
        records, carried = merge_records(base_data, fresh, start, end)
    else:
        fresh["txtags"] = {tt for tt in fresh["txtags"] if tt[0] in fresh["transactions"]}
        records = fresh

    write_db(args.out, user_name, args.email, records)

    size_kb = os.path.getsize(args.out) // 1024
    print("\n=== Resumo ===")
    print(f"  Modo:        {modo}")
    print(f"  Contas:      {len(records['accounts'])} (frescas: {len(contas)} banco + {len(cartoes)} cartao)")
    print(f"  Categorias:  {len(records['categories'])} (inclui 2 fallback)")
    print(f"  Tags:        {len(records['tags'])}")
    print(f"  Transacoes:  {len(records['transactions'])} (frescas na janela: {stats['transactions']}, {stats['unpaid']} nao pagas)")
    if incremental:
        print(f"  Preservadas: {carried} transacoes fora da janela (vindas da base)")
    print(f"  Ignorados:   {stats['skipped_dest']} (espelho de transferencia) + {stats['skipped_no_account']} (conta nao encontrada)")
    print(f"  Saida:       {args.out} ({size_kb} KB)")
    print("\nImporte via Configuracoes -> Dados -> Importar backup.")


if __name__ == "__main__":
    main()
