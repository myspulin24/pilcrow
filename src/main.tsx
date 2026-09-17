import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { StoreProvider } from './state/store'
// KaTeX si nese vlastní styly i písma; Vite je zabalí do aplikace, takže
// vzorce fungují bez internetu stejně jako všechno ostatní.
import 'katex/dist/katex.min.css'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
)
