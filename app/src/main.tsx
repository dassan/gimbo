import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './lib/i18n'
import './index.css'
import App from './App.tsx'
import { startBootTracking } from './lib/bootMetrics'

// M-87: antes de montar o React — a partir daqui todo o tempo até a interface aparecer é medido.
startBootTracking()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
