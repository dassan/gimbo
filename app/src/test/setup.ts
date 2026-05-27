import '@testing-library/jest-dom'

// jsdom does not implement window.matchMedia — polyfill for all tests.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
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
