// HY-21 — posse do cofre entre abas.
//
// Desde o `HY-20` o banco é aberto com `locking_mode=EXCLUSIVE`, que é o que mantém o
// `SyncAccessHandle` do OPFS aberto (leitura 2,6x mais rápida) e o que torna o WAL possível nesta
// VFS (escrita 60x mais rápida). O preço é que **uma segunda aba não consegue abrir o mesmo
// cofre** — e sem tratamento ela não falha com erro, ela simplesmente trava esperando um lock que
// nunca é liberado, que é o pior desfecho possível.
//
// Este módulo troca a trava silenciosa por uma escolha explícita, no mesmo padrão que o WhatsApp
// Web usa: a aba nova avisa que o Gimbo já está aberto e oferece assumir o controle.
//
// Duas primitivas, cada uma resolvendo o que a outra não resolve:
// - **Web Locks** é a fonte da verdade sobre quem é o dono. Ser um lock de verdade elimina a
//   corrida entre duas abas abertas ao mesmo tempo, que uma troca de mensagens não elimina.
// - **BroadcastChannel** é como se pede a posse. O dono libera o lock só **depois** de fechar o
//   banco, então conseguir o lock é prova de que o cofre está livre — não uma promessa de que
//   estará.

const LOCK_NAME = 'gimbo-vault-owner'
const CHANNEL_NAME = 'gimbo-vault-ownership'
const TAKEOVER_TIMEOUT_MS = 5000

// Uma recarga ou navegação interna destrói o documento anterior, mas o lock dele não é liberado no
// mesmo instante em que o novo já está pedindo. Sem estas tentativas, um simples F5 mostraria "o
// Gimbo já está aberto" — a aba se veria bloqueada por si mesma, que é pior que o problema que
// este módulo resolve. Duas abas de verdade continuam sendo detectadas: a antiga não solta o lock
// em 300ms nem em tempo nenhum.
const CLAIM_ATTEMPTS = 3
const CLAIM_RETRY_MS = 150

export type VaultClaim = 'owner' | 'busy'

type OwnershipMessage = { type: 'takeover' }

let releaseLock: (() => void) | null = null
let channel: BroadcastChannel | null = null
// A posse é do **processo**, não de um componente. Guardar a promessa aqui torna `claimVault`
// idempotente, e isso não é refinamento: amarrada ao ciclo de vida de um efeito, a aquisição
// quebra sob `<StrictMode>`, que monta, limpa e monta de novo. A limpeza chegava antes de a
// aquisição resolver, o lock vazava sem ninguém para liberá-lo, e a segunda montagem se via
// bloqueada por si mesma — a aba inteira caía na tela de "aberto em outra aba" sem nenhuma outra
// aba existir.
let claim: Promise<VaultClaim> | null = null

function supported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'locks' in navigator &&
    typeof BroadcastChannel !== 'undefined'
  )
}

/**
 * Tenta assumir a posse do cofre sem esperar indefinidamente por ela.
 *
 * `onRevoked` é chamado quando outra aba pede a posse. Deve desmontar tudo que segura o banco — o
 * lock só é liberado depois que essa promessa resolve, e é isso que torna seguro para a outra aba
 * prosseguir assim que ela conseguir o lock.
 */
export function claimVault(onRevoked: () => Promise<void> | void): Promise<VaultClaim> {
  claim ??= acquire(onRevoked)
  return claim
}

async function acquire(onRevoked: () => Promise<void> | void): Promise<VaultClaim> {
  // Sem Web Locks ou BroadcastChannel não há como coordenar: seguir como dono preserva o
  // comportamento de antes desta feature em vez de bloquear o app por falta de uma API.
  if (!supported()) return 'owner'

  let acquired = false
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS && !acquired; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, CLAIM_RETRY_MS))
    acquired = await tryAcquire()
  }

  if (!acquired) return 'busy'

  // `pagehide` é o gancho que cobre recarga, navegação e fechamento da aba — inclusive quando a
  // página vai para o cache de retrocesso, onde `unload` não dispara. Liberar aqui encurta a
  // janela em que o lock fica órfão; as tentativas acima cobrem o resto dela.
  window.addEventListener('pagehide', releaseVault)

  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent<OwnershipMessage>) => {
    if (event.data?.type !== 'takeover') return
    void (async () => {
      try {
        await onRevoked()
      } catch {
        // Engolido de propósito: a outra aba já está esperando a posse, e propagar daqui só
        // produziria uma rejeição não tratada. O `finally` abaixo é o que importa.
      } finally {
        // Sempre libera, mesmo se o desmonte falhar: segurar o lock após ter cedido a posse
        // deixaria as duas abas inutilizáveis, que é pior que uma delas em estado ruim.
        releaseVault()
      }
    })()
  }
  return 'owner'
}

/**
 * Uma tentativa de aquisição sem espera. `ifAvailable` é o detalhe que importa: sem ele a chamada
 * **enfileira** e a aba nova fica pendurada exatamente como ficaria sem este módulo.
 */
function tryAcquire(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    void navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false)
        return
      }
      resolve(true)
      // O lock dura enquanto esta promessa estiver pendente — é assim que a Web Locks API
      // expressa "segurar indefinidamente".
      return new Promise<void>((release) => {
        releaseLock = release
      })
    })
  })
}

/** Libera a posse. Idempotente — chamado tanto pelo desmonte quanto pela saída da página. */
export function releaseVault(): void {
  window.removeEventListener('pagehide', releaseVault)
  channel?.close()
  channel = null
  releaseLock?.()
  releaseLock = null
  claim = null
}

/**
 * Pede a posse à aba que a detém e espera até tê-la de fato.
 *
 * Resolve quando o lock é adquirido — o que só acontece depois de o dono anterior ter fechado o
 * banco. Rejeita no timeout: se a aba dona estiver travada ou tiver sido fechada de um jeito que
 * não liberou o lock, é melhor dizer isso do que esperar para sempre.
 */
export async function requestTakeover(): Promise<void> {
  if (!supported()) return

  const request = new BroadcastChannel(CHANNEL_NAME)
  request.postMessage({ type: 'takeover' } satisfies OwnershipMessage)
  request.close()

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error('takeover-timeout'))
    }, TAKEOVER_TIMEOUT_MS)
    const controller = new AbortController()

    void navigator.locks
      .request(LOCK_NAME, { signal: controller.signal }, () => {
        clearTimeout(timer)
        resolve()
        // Não segura o lock aqui: quem assume recarrega a página, e a instância nova o reivindica
        // pelo caminho normal do boot. Segurar aqui deixaria o lock preso a um contexto que está
        // prestes a morrer.
      })
      .catch(() => {
        // AbortError do timeout acima — a rejeição já foi reportada.
      })
  })
}
