import { afterEach, describe, expect, it } from 'vitest'

import { describeElement } from './element-target'

function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('describeElement', () => {
  it('tlačítko popíše jménem a oblastí, ve které je', () => {
    const root = mount(`
      <div class="workspace" aria-label="Pracovní plocha">
        <section id="ws-git" class="ws-section">
          <div class="ws-section__header">
            <button aria-label="Větve…" title="main — Procházet větve" class="git__branch-button"><span>main</span></button>
          </div>
          <div class="ws-section__body"><button class="button">Porovnat s main…</button></div>
        </section>
      </div>`)
    const branch = describeElement(root.querySelector('.git__branch-button span')!)
    expect(branch.label).toBe('tlačítko „Větve…“ · Pracovní plocha › Git')
    expect(branch.path).toContain('button.git__branch-button')

    const compare = describeElement(root.querySelector('.ws-section__body .button')!)
    expect(compare.label).toBe('tlačítko „Porovnat s main…“ · Pracovní plocha › Git')
  })

  it('z editoru a náhledu nevezme ani slovo z poznámky', () => {
    const root = mount(`
      <section aria-label="Poznámka">
        <textarea aria-label="Text poznámky">Tajné heslo k bance</textarea>
        <div class="markdown-body"><p>Plat šéfa je 200 000</p></div>
      </section>`)
    const editor = describeElement(root.querySelector('textarea')!)
    expect(editor.label).toBe('textové pole „Text poznámky“ · Poznámka')
    const preview = describeElement(root.querySelector('.markdown-body p')!)
    expect(JSON.stringify(preview)).not.toContain('200 000')
    expect(JSON.stringify(editor)).not.toContain('heslo')
  })

  it('ze stromu souborů a hlavičky složky nevezme cestu ani jméno složky', () => {
    const root = mount(`
      <div class="workspace" aria-label="Pracovní plocha">
        <section id="ws-files-c-tajny-projekt" class="ws-section">
          <div class="ws-section__header">
            <button class="ws-section__toggle" title="C:\\Users\\micha\\tajny-projekt"><span class="ws-section__label">tajny-projekt</span></button>
          </div>
          <ul class="tree"><li><button title="C:\\Users\\micha\\tajny-projekt\\plan.md">plan.md</button></li></ul>
        </section>
      </div>`)
    const header = describeElement(root.querySelector('.ws-section__toggle')!)
    const file = describeElement(root.querySelector('.tree button')!)
    for (const described of [header, file]) {
      expect(described.label).not.toContain('tajny')
      expect(described.label).not.toContain('plan')
      expect(described.label).toContain('Pracovní plocha › složka')
    }
  })

  it('lišta s otevřeným souborem se pozná jménem, ne jako celá pracovní plocha', () => {
    // Přesně první feedback: klik do lišty „Čtu“ skončil jako „Pracovní
    // plocha“ s cestou `div.workspace`, a nešlo poznat, o co jde.
    const root = mount(`
      <div class="workspace" aria-label="Pracovní plocha">
        <div class="workspace__current" role="group" aria-label="Otevřený soubor" title="C:\\Users\\micha\\docs\\plan.md">
          <span class="workspace__current-label">Čtu</span>
          <span class="workspace__current-path">docs/plan.md</span>
        </div>
      </div>`)
    const described = describeElement(root.querySelector('.workspace__current-path')!)
    expect(described.label).toBe('část „Otevřený soubor“ · Pracovní plocha')
    // Cesta vede od místa kliknutí, ne od zobecněného předka.
    expect(described.path).toMatch(/div\.workspace__current > span\.workspace__current-path$/)
    // A jméno souboru ani cesta na disku v popisu nejsou.
    expect(JSON.stringify(described)).not.toContain('plan')
  })

  it('id, která generuje React, do cesty nedá', () => {
    const root = mount(`<div role="dialog" aria-labelledby=":r5:"><h2 id=":r5:">Poslat feedback</h2><button>Odeslat</button></div>`)
    const described = describeElement(root.querySelector('button')!)
    expect(described.label).toBe('tlačítko „Odeslat“ · Poslat feedback')
    expect(described.path).not.toContain(':r5:')
  })
})
