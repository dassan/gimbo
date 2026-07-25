import '@testing-library/jest-dom'

// jsdom defaults navigator.language/languages to 'en-US', but every component test in this
// suite assumes the app's real default target locale (pt-BR) — same mismatch that broke the
// Playwright E2E suite when browser-language detection (9ef2e59) started reading the real
// browser locale instead of a hardcoded 'pt-BR' (see playwright.config.ts `locale: 'pt-BR'`).
// Without this, detectBrowserLocale()/defaultCurrencyForLocale() would silently default every
// test to en-US/USD instead of pt-BR/BRL (B-25).
Object.defineProperty(window.navigator, 'language', { value: 'pt-BR', configurable: true })
Object.defineProperty(window.navigator, 'languages', { value: ['pt-BR'], configurable: true })

// jsdom does not implement window.matchMedia — polyfill for all tests.
// Simulates a desktop viewport (1280px wide): min-width queries up to 1280px match,
// max-width queries below 1280px do not match.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  const SIMULATED_WIDTH = 1280
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => {
      const minMatch = query.match(/\(min-width:\s*(\d+)px\)/)
      const maxMatch = query.match(/\(max-width:\s*(\d+)px\)/)
      let matches = false
      if (minMatch) matches = SIMULATED_WIDTH >= parseInt(minMatch[1], 10)
      else if (maxMatch) matches = SIMULATED_WIDTH <= parseInt(maxMatch[1], 10)
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }
    },
  })
}

// Blob.prototype.text() is not implemented in jsdom — polyfill via FileReader.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Object.defineProperty(Blob.prototype, 'text', {
    value(this: Blob): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
        reader.readAsText(this)
      })
    },
  })
}
