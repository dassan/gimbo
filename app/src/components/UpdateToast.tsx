import { useRegisterSW } from 'virtual:pwa-register/react'
import { useTranslation } from 'react-i18next'
import Toast from '@/components/Toast'

// M-76: checagem periódica além da checagem nativa do browser em cada navegação — sem isso,
// uma aba/PWA deixada aberta por muito tempo nunca saberia de uma versão nova até ser fechada
// e reaberta.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

export default function UpdateToast() {
  const { t } = useTranslation()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS)
    },
  })

  if (!needRefresh) return null

  return (
    <Toast
      message={t('update.available')}
      actionLabel={t('update.reload')}
      onAction={() => void updateServiceWorker(true)}
      onDismiss={() => setNeedRefresh(false)}
    />
  )
}
