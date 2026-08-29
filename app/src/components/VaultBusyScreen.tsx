import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MonitorSmartphone } from 'lucide-react'
import { requestTakeover } from '@/lib/vaultOwnership'

export interface VaultBusyScreenProps {
  /** `revoked` = esta aba **era** a dona e cedeu; `blocked` = nunca conseguiu abrir. */
  reason: 'blocked' | 'revoked'
}

/**
 * HY-21 — a tela que uma aba vê quando o cofre está aberto em outra.
 *
 * Existe porque o `locking_mode=EXCLUSIVE` do `HY-20` torna o cofre de aba única. Sem ela, a
 * segunda aba não daria erro: ficaria pendurada num lock para sempre. Trocar isso por uma escolha
 * explícita — o padrão do WhatsApp Web — é o que torna o ganho de desempenho aceitável.
 *
 * "Usar aqui" pede a posse à outra aba e **recarrega**. Recarregar em vez de reinicializar em
 * memória é deliberado: o worker de storage, o wasm e o ponteiro do banco foram desmontados de
 * propósito do outro lado, e reconstruir tudo isso a quente teria mais estados intermediários do
 * que vale a pena para uma ação que o usuário faz uma vez.
 */
export default function VaultBusyScreen({ reason }: VaultBusyScreenProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'taking' | 'dismissed' | 'failed'>('idle')

  async function handleUseHere() {
    setState('taking')
    try {
      await requestTakeover()
      window.location.reload()
    } catch {
      // A outra aba não respondeu a tempo: pode estar travada ou ter sido fechada sem liberar o
      // lock. Dizer isso é melhor que girar para sempre.
      setState('failed')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md rounded-2xl border border-outline-variant/50 bg-surface-container-low p-8 text-center shadow-card">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <MonitorSmartphone className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>

        <h1 className="mb-2 text-xl font-semibold text-on-surface">{t('vaultBusy.title')}</h1>
        <p className="mb-6 text-sm leading-relaxed text-on-surface/60">
          {reason === 'revoked' ? t('vaultBusy.revokedBody') : t('vaultBusy.blockedBody')}
        </p>

        {state === 'failed' && (
          <p className="mb-4 text-sm text-error" role="alert">
            {t('vaultBusy.failed')}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void handleUseHere()}
            disabled={state === 'taking'}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {state === 'taking' ? t('vaultBusy.takingOver') : t('vaultBusy.useHere')}
          </button>

          {state !== 'dismissed' && (
            <button
              type="button"
              onClick={() => setState('dismissed')}
              className="w-full rounded-xl px-4 py-3 text-sm font-medium text-on-surface/60 transition-colors hover:bg-surface-container"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>

        {state === 'dismissed' && (
          <p className="mt-4 text-xs text-on-surface/40">{t('vaultBusy.dismissedHint')}</p>
        )}
      </div>
    </div>
  )
}
