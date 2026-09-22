/**
 * End-to-end: sekce Git nad otevřenou složkou.
 *
 * Jede proti `MemoryGit`, který vrací výstup ve stejném tvaru jako skutečné
 * nástroje -- `git status -z`, JSON z `gh api` -- takže se tu procházejí
 * stejné parsery jako v aplikaci. Co se otestovat nedá, je spuštění procesů
 * a klíčenka; všechno ostatní -- kdy se sekce ukáže, co je předvybrané,
 * dialog, push, čekání na běh a jeho kroky -- ano.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { MemoryGit, type MemoryGitOptions } from '@/git'
import { StoreProvider } from '@/state/store'
import { MemoryVault } from '@/vault'

const VAULT_NOTE = [
  '---',
  'id: seed0001vault',
  'title: Poznámka z trezoru',
  'created: 2026-09-01T09:00:00.000Z',
  'updated: 2026-09-01T09:00:00.000Z',
  'pinned: false',
  'tags: []',
  '---',
  '',
  '# Poznámka z trezoru',
  '',
  'Je v trezoru.',
  '',
].join('\n')

/** Dokumentace v repu `/repo`; otevírá se podsložka `docs`. */
const EXTERNAL_FILES = {
  '/repo/docs/README.md': '# Docs\n\nTop level readme.\n',
  '/repo/docs/guide.md': '# Guide\n\nHow to.\n',
}

let vault: MemoryVault
let git: MemoryGit

type User = ReturnType<typeof userEvent.setup>

async function renderApp(options: MemoryGitOptions = {}) {
  vault = new MemoryVault({
    seed: { 'poznamka-z-trezoru.md': VAULT_NOTE },
    label: 'Testovací trezor',
    externalFiles: EXTERNAL_FILES,
    externalRoot: '/repo/docs',
  })
  git = new MemoryGit({ repoRoot: '/repo', ...options })
  render(
    <StoreProvider vault={vault} git={git}>
      <App />
    </StoreProvider>,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const workspace = () => screen.getByLabelText('Pracovní plocha')
/** Přepínač sekce Git. `null`, když sekce není. */
const gitToggle = () => within(workspace()).queryByRole('button', { name: /^Git\b/ })
const gitBody = () => document.getElementById('ws-git-body') as HTMLElement
const changesList = () => within(gitBody()).findByRole('list', { name: 'Změněné soubory' })

async function openTheFolder(user: User) {
  await user.click(within(workspace()).getByRole('button', { name: 'Otevřít složku...' }))
  await waitFor(() => {
    expect(within(workspace()).getByRole('tree')).toBeInTheDocument()
  })
}

async function waitForGit() {
  await waitFor(() => {
    expect(gitToggle()).toBeInTheDocument()
  })
}

/** Otevřít README ve stromu, něco do něj napsat a uložit. */
async function editReadme(user: User) {
  await user.click(within(workspace()).getByRole('button', { name: /README\.md/ }))
  const editor = (await screen.findByLabelText('Text poznámky')) as HTMLTextAreaElement
  await waitFor(() => expect(editor.value).toContain('Top level readme.'))
  await user.click(editor)
  await user.keyboard('{End} Změna.')
  await user.keyboard('{Control>}s{/Control}')
}

async function publish(user: User, branch = 'docs/test') {
  await user.click(within(gitBody()).getByRole('button', { name: 'Odeslat do gitu…' }))
  const dialog = await screen.findByRole('dialog', { name: 'Odeslat do gitu' })
  const branchInput = within(dialog).getByLabelText('Větev')
  await user.clear(branchInput)
  await user.type(branchInput, branch)
  await user.click(within(dialog).getByRole('button', { name: 'Odeslat' }))
  return dialog
}

afterEach(() => {
  cleanup()
})

describe('kdy se sekce ukáže', () => {
  it('bez otevřené složky není', async () => {
    await renderApp()
    expect(gitToggle()).toBeNull()
  })

  it('složka mimo repozitář ji nedostane', async () => {
    const user = userEvent.setup()
    await renderApp({ repoRoot: null })
    await openTheFolder(user)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(gitToggle()).toBeNull()
  })

  it('složka v repu ji dostane, s větví v záhlaví', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openTheFolder(user)
    await waitForGit()
    expect(gitToggle()).toHaveTextContent('main')
    expect(within(gitBody()).getByText('Žádné změny v souborech .md.')).toBeInTheDocument()
  })

  /**
   * Tlačítko „Zkontrolovat znovu“ dřív nedávalo najevo vůbec nic.
   *
   * U složky, kde se nic nezměnilo, vypadá hotové zjištění stejně jako
   * žádné: seznam změn je pořád prázdný. Uživatel na ikonu klikal a nevěděl,
   * jestli funguje. Čas nad seznamem změn je odpověď, která platí i tehdy,
   * když se nezměnilo nic.
   */
  it('sekce řekne, kdy se stav naposled zjišťoval', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openTheFolder(user)
    await waitForGit()

    await waitFor(() => expect(gitBody()).toHaveTextContent(/zjištěno v \d\d:\d\d:\d\d/))
    // V hlavičce je větev, ne čas: tam se o místo dělí s názvem sekce
    // a jménem složky a dlouhá větev by z něj stejně nic nenechala.
    expect(gitToggle()).toHaveTextContent('main')
  })

  it('kliknutí na „Zkontrolovat znovu“ se opravdu zeptá gitu', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openTheFolder(user)
    await waitForGit()
    await waitFor(() => expect(gitBody()).toHaveTextContent(/zjištěno v/))
    const before = git.probedFolders.length

    await user.click(within(workspace()).getByRole('button', { name: 'Zkontrolovat znovu' }))

    await waitFor(() => expect(git.probedFolders.length).toBe(before + 1))
    expect(git.probedFolders.at(-1)).toBe('/repo/docs')
  })

  it('bez gitu řekne, jak ho nainstalovat, a nic víc', async () => {
    const user = userEvent.setup()
    await renderApp({ gitInstalled: false })
    await openTheFolder(user)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    // Bez gitu se nedá zjistit ani to, jestli je složka v repu -- sekce se
    // tedy neukáže vůbec, místo aby ukazovala instalaci každé složce.
    expect(gitToggle()).toBeNull()
  })

  it('repo bez remote a git bez identity ukážou jeden krok', async () => {
    const user = userEvent.setup()
    await renderApp({ remoteUrl: '', changes: [{ path: 'docs/guide.md', xy: ' M' }] })
    await openTheFolder(user)
    await waitForGit()
    expect(await within(gitBody()).findByText('Repozitář nemá remote')).toBeInTheDocument()
    expect(within(gitBody()).queryByRole('list', { name: 'Změněné soubory' })).toBeNull()
    cleanup()

    await renderApp({ identity: false })
    await openTheFolder(user)
    await waitForGit()
    expect(await within(gitBody()).findByText('Git nezná tvoje jméno')).toBeInTheDocument()
    expect(within(gitBody()).getByText(/git config --global user\.email/)).toBeInTheDocument()
  })
})

describe('změny', () => {
  it('ukáže změněné .md soubory; cizí změna zůstane nezaškrtnutá', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/guide.md', xy: ' M' }, { path: 'src/main.rs', xy: ' M' }] })
    await openTheFolder(user)
    await waitForGit()

    const list = await changesList()
    const box = within(list).getByRole('checkbox', { name: /guide\.md/ })
    expect(box).not.toBeChecked()
    expect(within(list).getByText('změněno mimo Pilcrow')).toBeInTheDocument()
    // Rust mimo složku ani mimo Markdown se nenabízí.
    expect(within(list).queryByText(/main\.rs/)).toBeNull()
    expect(within(gitBody()).getByRole('button', { name: 'Odeslat do gitu…' })).toBeDisabled()

    await user.click(box)
    expect(box).toBeChecked()
    expect(within(gitBody()).getByRole('button', { name: 'Odeslat do gitu…' })).toBeEnabled()
  })

  it('soubor uložený v Pilcrow se předvybere sám', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/README.md', xy: ' M' }] })
    await openTheFolder(user)
    await waitForGit()
    expect(within(await changesList()).getByRole('checkbox', { name: /README\.md/ })).not.toBeChecked()

    await editReadme(user)

    await waitFor(() => {
      expect(within(gitBody()).getByRole('checkbox', { name: /README\.md/ })).toBeChecked()
    })
    expect(within(gitBody()).getByText('upraveno v Pilcrow')).toBeInTheDocument()
  })

  it('co uživatel odškrtl, se po uložení znovu nezaškrtne', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/README.md', xy: ' M' }] })
    await openTheFolder(user)
    await waitForGit()
    await editReadme(user)
    await waitFor(() => expect(within(gitBody()).getByRole('checkbox', { name: /README\.md/ })).toBeChecked())

    await user.click(within(gitBody()).getByRole('checkbox', { name: /README\.md/ }))
    expect(within(gitBody()).getByRole('checkbox', { name: /README\.md/ })).not.toBeChecked()

    // Další uložení obnoví seznam -- volba musí přežít.
    await user.keyboard('{Control>}s{/Control}')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(within(gitBody()).getByRole('checkbox', { name: /README\.md/ })).not.toBeChecked()
  })
})

describe('odeslání', () => {
  it('projde celou cestu: dialog, větev, push, běh se objeví a doběhne, PR', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/README.md', xy: ' M' }], runAppearsAfter: 2, runTicks: 2 })
    await openTheFolder(user)
    await waitForGit()
    await editReadme(user)
    await waitFor(() => expect(within(gitBody()).getByRole('checkbox', { name: /README\.md/ })).toBeChecked())

    await user.click(within(gitBody()).getByRole('button', { name: 'Odeslat do gitu…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Odeslat do gitu' })
    // Předvyplněné, ale k přepsání.
    expect(within(dialog).getByLabelText('Zpráva commitu')).toHaveValue('Dokumentace: README.md')
    expect((within(dialog).getByLabelText('Větev') as HTMLInputElement).value).toMatch(/^docs\/\d{4}-\d{2}-\d{2}-\d{4}$/)
    expect(within(dialog).getByText(/Do větve main se nic nemění/)).toBeInTheDocument()

    const branchInput = within(dialog).getByLabelText('Větev')
    await user.clear(branchInput)
    await user.type(branchInput, 'docs/test')
    await user.click(within(dialog).getByRole('button', { name: 'Odeslat' }))

    await waitFor(() => {
      expect(git.published).toEqual({ branch: 'docs/test', message: 'Dokumentace: README.md', files: ['docs/README.md'] })
    })
    expect(await within(gitBody()).findByText('Větev docs/test je odeslaná.')).toBeInTheDocument()
    // Seznam změn je po odeslání prázdný a záhlaví ukazuje novou větev.
    await waitFor(() => expect(within(gitBody()).getByText('Žádné změny v souborech .md.')).toBeInTheDocument())
    expect(gitToggle()).toHaveTextContent('docs/test')

    // Běh se objeví a doběhne; kroky jsou vidět jmény.
    const ci = await within(gitBody()).findByLabelText('Běh Actions')
    await waitFor(
      () => {
        expect(within(ci).getByText('Testy')).toBeInTheDocument()
        expect(within(ci).getAllByRole('img', { name: 'prošlo' }).length).toBeGreaterThan(3)
      },
      { timeout: 5000 },
    )
    expect(within(ci).getByText('ci')).toBeInTheDocument()

    // PR se zakládá rovnou tady, prohlížeč se neotevírá.
    await user.click(within(gitBody()).getByRole('button', { name: 'Otevřít PR' }))
    const prDialog = await screen.findByRole('dialog', { name: 'Založit pull request' })
    expect(within(prDialog).getByLabelText('Název')).toHaveValue('Dokumentace: README.md')
    await user.click(within(prDialog).getByRole('button', { name: 'Založit' }))

    await waitFor(() => {
      expect(git.createdPr).toEqual({
        folder: '/repo/docs',
        base: 'main',
        head: 'docs/test',
        title: 'Dokumentace: README.md',
        body: '',
      })
    })
    // Karta ukazuje živý stav PR, ne jednorázovou hlášku o založení.
    expect(await within(gitBody()).findByText(/Pull request #7 je otevřený/)).toBeInTheDocument()
    // Do prohlížeče se nic neposlalo.
    expect(git.opened).toEqual([])
  })

  it('dokud se běh neobjeví, říká, že čeká -- není to chyba', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/guide.md', xy: ' M' }], runAppearsAfter: 100_000 })
    await openTheFolder(user)
    await waitForGit()
    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide\.md/ }))
    await publish(user)

    expect(await within(gitBody()).findByText('Čekám, až se běh na GitHubu objeví…')).toBeInTheDocument()
    expect(within(gitBody()).queryByRole('alert')).toBeNull()
  })

  it('neplatné jméno větve dialog nepustí dál', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/guide.md', xy: ' M' }] })
    await openTheFolder(user)
    await waitForGit()
    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide\.md/ }))

    const dialog = await publish(user, 'má mezeru')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/větev jmenovat nemůže/)
    expect(git.published).toBeNull()
  })

  it('selhaný push to řekne, nechá commit a nabídne push znovu', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/guide.md', xy: ' M' }], failPush: 'remote: Permission denied' })
    await openTheFolder(user)
    await waitForGit()
    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide\.md/ }))
    await publish(user)

    await waitFor(() => {
      expect(within(gitBody()).getByRole('alert')).toHaveTextContent('Permission denied')
    })
    expect(within(gitBody()).getByText('Commit na větvi docs/test je, ale push selhal.')).toBeInTheDocument()
    expect(within(gitBody()).queryByRole('button', { name: 'Otevřít PR' })).toBeNull()

    git.failPush = ''
    await user.click(within(gitBody()).getByRole('button', { name: 'Zkusit push znovu' }))
    expect(await within(gitBody()).findByText('Větev docs/test je odeslaná.')).toBeInTheDocument()
    expect(within(gitBody()).queryByRole('alert')).toBeNull()
  })

  it('druhý pull request míří do výchozí větve, ne do té předchozí', async () => {
    // Tohle je ta chyba z používání: po prvním odeslání stojí uživatel na
    // `docs/…`. Když se ta větev stane základem druhého PR, GitHub ho
    // odmítne -- ta větev už je zmergovaná a smazaná.
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/guide.md', xy: ' M' }], defaultBranch: 'main' })
    await openTheFolder(user)
    await waitForGit()
    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide.md/ }))
    await publish(user, 'docs/prvni')
    await within(gitBody()).findByText('Větev docs/prvni je odeslaná.')

    // Druhé kolo: aplikace teď stojí na `docs/prvni`.
    await act(async () => {
      git.markChanged('docs/README.md')
    })
    // Tlačítko ↻ je v záhlaví sekce, ne v jejím těle.
    await user.click(within(workspace()).getByRole('button', { name: 'Zkontrolovat znovu' }))
    await waitFor(() => expect(gitToggle()).toHaveTextContent('docs/prvni'))
    await user.click(await within(gitBody()).findByRole('checkbox', { name: /README.md/ }))
    await publish(user, 'docs/druha')
    await within(gitBody()).findByText('Větev docs/druha je odeslaná.')

    await user.click(within(gitBody()).getByRole('button', { name: 'Otevřít PR' }))
    const dialog = await screen.findByRole('dialog', { name: 'Založit pull request' })
    // Cílem je výchozí větev, ne `docs/prvni`.
    expect(within(dialog).getByLabelText('Sloučit do větve')).toHaveValue('main')

    await user.click(within(dialog).getByRole('button', { name: 'Založit' }))
    await waitFor(() => {
      expect(git.createdPr?.base).toBe('main')
      expect(git.createdPr?.head).toBe('docs/druha')
    })
  })

  it('když se PR nepodaří založit, chyba je vidět v dialogu', async () => {
    // Dřív šla do panelu za dialogem, takže ji nikdo neviděl a vypadalo to,
    // že se po kliknutí neděje nic.
    const user = userEvent.setup()
    await renderApp({
      changes: [{ path: 'docs/guide.md', xy: ' M' }],
      failPr: 'pull request create failed: Base ref must be a branch',
    })
    await openTheFolder(user)
    await waitForGit()
    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide.md/ }))
    await publish(user)
    await within(gitBody()).findByText('Větev docs/test je odeslaná.')

    await user.click(within(gitBody()).getByRole('button', { name: 'Otevřít PR' }))
    const dialog = await screen.findByRole('dialog', { name: 'Založit pull request' })
    await user.click(within(dialog).getByRole('button', { name: 'Založit' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Base ref must be a branch')
    // Dialog zůstane otevřený, ať se dá cíl opravit.
    expect(screen.getByRole('dialog', { name: 'Založit pull request' })).toBeInTheDocument()
  })

  it('karta odeslání nezmizí, zatímco se PR zakládá', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/guide.md', xy: ' M' }] })
    await openTheFolder(user)
    await waitForGit()
    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide.md/ }))
    await publish(user)
    await within(gitBody()).findByText('Větev docs/test je odeslaná.')

    await user.click(within(gitBody()).getByRole('button', { name: 'Otevřít PR' }))
    const dialog = await screen.findByRole('dialog', { name: 'Založit pull request' })
    await user.click(within(dialog).getByRole('button', { name: 'Založit' }))

    // Po založení je karta pořád tam, jen s číslem PR místo tlačítka.
    // Karta ukazuje živý stav PR, ne jednorázovou hlášku o založení.
    expect(await within(gitBody()).findByText(/Pull request #7 je otevřený/)).toBeInTheDocument()
    expect(within(gitBody()).getByText('Větev docs/test je odeslaná.')).toBeInTheDocument()
  })

  /** Odeslat, založit PR a vrátit tělo sekce připravené ke sloučení. */
  async function publishAndOpenPr(user: User) {
    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide.md/ }))
    await publish(user)
    await within(gitBody()).findByText('Větev docs/test je odeslaná.')
    await user.click(within(gitBody()).getByRole('button', { name: 'Otevřít PR' }))
    const dialog = await screen.findByRole('dialog', { name: 'Založit pull request' })
    await user.click(within(dialog).getByRole('button', { name: 'Založit' }))
    await within(gitBody()).findByText(/Pull request #7 je otevřený/)
  }

  it('sloučí pull request a uklidí po něm', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/guide.md', xy: ' M' }] })
    await openTheFolder(user)
    await waitForGit()
    await publishAndOpenPr(user)

    await user.click(within(gitBody()).getByRole('button', { name: 'Sloučit…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sloučit pull request' })
    // Je vidět, co přesně se stane -- sloučení je nevratné.
    expect(within(dialog).getByText(/sloučí větev docs\/test do main/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Potom se přepne na main/)).toBeInTheDocument()
    // Squash je výchozí, když ho repozitář povoluje.
    expect(within(dialog).getByRole('radio', { name: /Squash/ })).toBeChecked()

    await user.click(within(dialog).getByRole('button', { name: 'Sloučit' }))

    await waitFor(() => {
      expect(git.merged).toEqual({
        folder: '/repo/docs',
        number: 7,
        method: 'squash',
        base: 'main',
        head: 'docs/test',
        deleteBranch: true,
      })
    })
    expect(await within(gitBody()).findByText(/Pull request #7 je sloučený/)).toBeInTheDocument()
    // Do prohlížeče se kvůli tomu nic neposílalo.
    expect(git.opened).toEqual([])
  })

  it('nabídne jen ty způsoby sloučení, které repozitář povoluje', async () => {
    const user = userEvent.setup()
    await renderApp({
      changes: [{ path: 'docs/guide.md', xy: ' M' }],
      mergeMethods: { squash: false, rebase: false },
    })
    await openTheFolder(user)
    await waitForGit()
    await publishAndOpenPr(user)

    await user.click(within(gitBody()).getByRole('button', { name: 'Sloučit…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sloučit pull request' })
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1)
    expect(within(dialog).getByRole('radio', { name: /Merge/ })).toBeChecked()
  })

  it('konflikt sloučit nenabídne a řekne proč', async () => {
    const user = userEvent.setup()
    await renderApp({
      changes: [{ path: 'docs/guide.md', xy: ' M' }],
      prState: { mergeable: 'CONFLICTING' },
    })
    await openTheFolder(user)
    await waitForGit()
    await publishAndOpenPr(user)

    expect(within(gitBody()).getByText(/má konflikty/)).toBeInTheDocument()
    expect(within(gitBody()).queryByRole('button', { name: 'Sloučit…' })).toBeNull()
  })

  it('neúspěšné sloučení to řekne v dialogu a nechá ho otevřený', async () => {
    const user = userEvent.setup()
    await renderApp({
      changes: [{ path: 'docs/guide.md', xy: ' M' }],
      failMerge: 'Pull request is not mergeable',
    })
    await openTheFolder(user)
    await waitForGit()
    await publishAndOpenPr(user)

    await user.click(within(gitBody()).getByRole('button', { name: 'Sloučit…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sloučit pull request' })
    await user.click(within(dialog).getByRole('button', { name: 'Sloučit' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('not mergeable')
    expect(screen.getByRole('alertdialog', { name: 'Sloučit pull request' })).toBeInTheDocument()
  })

  it('repozitář bez workflows to řekne hned, místo aby čekal', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/guide.md', xy: ' M' }], workflowCount: 0 })
    await openTheFolder(user)
    await waitForGit()
    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide.md/ }))
    await publish(user)

    const ci = await within(gitBody()).findByLabelText('Běh Actions')
    expect(within(ci).getByText(/nemá žádný workflow/)).toBeInTheDocument()
    // Žádné čekání: ukazatel „čekám na běh“ se vůbec neukáže.
    expect(within(ci).queryByText(/Čekám, až se běh/)).toBeNull()
  })

  it('neúspěšný běh ukáže, který krok spadl', async () => {
    const user = userEvent.setup()
    await renderApp({ changes: [{ path: 'docs/guide.md', xy: ' M' }], runTicks: 1, runConclusion: 'failure' })
    await openTheFolder(user)
    await waitForGit()
    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide\.md/ }))
    await publish(user)

    const ci = await within(gitBody()).findByLabelText('Běh Actions')
    await waitFor(
      () => {
        const failed = within(ci).getAllByRole('img', { name: 'neprošlo' })
        expect(failed.length).toBeGreaterThanOrEqual(2)
      },
      { timeout: 5000 },
    )
    const steps = within(ci).getByRole('list', { name: 'test' })
    const last = within(steps).getAllByRole('listitem').at(-1)
    expect(last).toHaveTextContent('Complete job')
    expect(within(last as HTMLElement).getByRole('img', { name: 'neprošlo' })).toBeInTheDocument()
  })
})

describe('GitHub CLI', () => {
  it('bez přihlášení nabídne přihlášení, ukáže kód, a po něm začne běhy sledovat', async () => {
    const user = userEvent.setup()
    await renderApp({ loggedIn: false })
    await openTheFolder(user)
    await waitForGit()

    expect(await within(gitBody()).findByText('GitHub CLI není přihlášené')).toBeInTheDocument()
    await user.click(within(gitBody()).getByRole('button', { name: 'Přihlásit se k GitHubu' }))
    expect(await within(gitBody()).findByLabelText('Jednorázový kód')).toHaveTextContent('D394-D2F5')

    await act(async () => {
      git.completeLogin()
    })
    await waitFor(() => {
      expect(within(gitBody()).queryByText('GitHub CLI není přihlášené')).toBeNull()
    })
  })

  it('bez gh se dá odeslat i otevřít PR, jen se nesledují běhy', async () => {
    const user = userEvent.setup()
    await renderApp({ ghInstalled: false, changes: [{ path: 'docs/guide.md', xy: ' M' }] })
    await openTheFolder(user)
    await waitForGit()

    expect(await within(gitBody()).findByText('Pro běhy Actions a PR je potřeba GitHub CLI')).toBeInTheDocument()
    expect(within(gitBody()).getByText(/winget install --id GitHub\.cli/)).toBeInTheDocument()

    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide\.md/ }))
    await publish(user)
    expect(await within(gitBody()).findByText('Větev docs/test je odeslaná.')).toBeInTheDocument()
    expect(within(gitBody()).getByRole('button', { name: 'Otevřít PR' })).toBeInTheDocument()
    expect(within(gitBody()).queryByLabelText('Běh Actions')).toBeNull()
  })

  it('mimo GitHub se PR ani běhy nenabízí', async () => {
    const user = userEvent.setup()
    await renderApp({ remoteUrl: 'git@gitlab.com:team/docs.git', changes: [{ path: 'docs/guide.md', xy: ' M' }] })
    await openTheFolder(user)
    await waitForGit()
    expect(within(gitBody()).queryByText(/GitHub CLI/)).toBeNull()

    await user.click(within(await changesList()).getByRole('checkbox', { name: /guide\.md/ }))
    await publish(user)
    expect(await within(gitBody()).findByText('Větev docs/test je odeslaná.')).toBeInTheDocument()
    expect(within(gitBody()).queryByRole('button', { name: 'Otevřít PR' })).toBeNull()
  })
})

describe('pull request z minulého spuštění', () => {
  it('sekce ho najde podle větve a nabídne sloučení, i když se v tomhle sezení nic neodesílalo', async () => {
    // Přesně situace po restartu aplikace: PR vznikl minule (nebo
    // v prohlížeči) a aplikace o něm z paměti nic neví.
    const user = userEvent.setup()
    await renderApp({
      branch: 'docs/vcerejsi',
      existingPr: { number: 42, branch: 'docs/vcerejsi', base: 'main' },
    })
    await openTheFolder(user)
    await waitForGit()

    expect(await within(gitBody()).findByText(/Pull request #42 je otevřený/)).toBeInTheDocument()
    expect(within(gitBody()).getByRole('button', { name: 'Sloučit…' })).toBeInTheDocument()
  })

  it('na hlavní větvi žádný pull request nenabízí', async () => {
    const user = userEvent.setup()
    await renderApp({ existingPr: { number: 42, branch: 'docs/vcerejsi', base: 'main' } })
    await openTheFolder(user)
    await waitForGit()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })

    expect(within(gitBody()).queryByText(/je otevřený/)).toBeNull()
    expect(within(gitBody()).queryByRole('button', { name: 'Sloučit…' })).toBeNull()
  })
})
