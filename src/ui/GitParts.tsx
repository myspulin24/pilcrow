/**
 * Drobnosti, které sdílí sekce Git a její okna: výstup gitu a rozdíl
 * jednoho souboru na rozkliknutí.
 */

import { useState } from 'react'

import { patchLines, t, type FileChange } from '@/core'
import { gitMessage } from '@/git'
import { Spinner } from './Feedback'

/** Výstup gitu. Ne dekorace: tady se pozná, co selhalo. */
export function Transcript({ text }: { text: string }) {
  if (!text.trim()) return null
  return (
    <details className="git__output">
      <summary>{t.git.output}</summary>
      <pre>{text}</pre>
    </details>
  )
}

/** Třída odznaku podle druhu změny -- stejné barvy jako v seznamu změn. */
const BADGE: Record<FileChange['kind'], string> = {
  modified: 'modified',
  added: 'added',
  deleted: 'deleted',
  local: 'untracked',
}

/** Výpis `git diff` s barvou podle řádku. Hlavička se neukazuje, jméno je nad ním. */
function Patch({ text }: { text: string }) {
  const lines = patchLines(text).filter((line) => line.kind !== 'meta')
  if (lines.length === 0) return <p className="git__muted compare__patch-empty">{t.branches.diffEmpty}</p>
  return (
    <pre className="patch">
      {lines.map((line, index) => (
        <span key={index} className={`patch__line patch__line--${line.kind}`}>
          {line.text}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

/**
 * Jeden rozdílný soubor: jméno, druh změny, počet řádků, a pod ním rozdíl.
 *
 * Rozdíl se načte až po rozkliknutí -- u větve s padesáti soubory by jinak
 * okno čekalo na padesát procesů, ze kterých se uživatel podívá na dva.
 * `load` je `null` tam, kde není s čím porovnávat (soubor je jen tady).
 */
export function FileDiff({
  file,
  label,
  kindLabel,
  load,
  note,
}: {
  file: FileChange
  label: string
  kindLabel: string
  load: (() => Promise<string>) | null
  /** Co ukázat místo rozdílu, když `load` chybí. */
  note?: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && load && text === null && error === null) {
      load()
        .then(setText)
        .catch((reason) => setError(gitMessage(reason, t.branches.diffFailed)))
    }
  }

  return (
    <li className="compare__file">
      <button
        type="button"
        className="compare__file-head"
        aria-expanded={open}
        aria-label={t.branches.showDiff(label)}
        title={file.path}
        onClick={toggle}
      >
        <span className="compare__twisty" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="compare__path">{label}</span>
        <span className={`git__badge git__badge--${BADGE[file.kind]}`}>{kindLabel}</span>
        {file.additions !== null || file.deletions !== null ? (
          <span className="compare__counts" aria-hidden="true">
            {file.additions !== null ? <span className="compare__plus">+{file.additions}</span> : null}
            {file.deletions !== null ? <span className="compare__minus">−{file.deletions}</span> : null}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="compare__patch">
          {!load ? (
            <p className="git__muted compare__patch-empty">{note}</p>
          ) : error ? (
            <p className="git__muted" role="alert">
              {error}
            </p>
          ) : text === null ? (
            <Spinner label={t.branches.diffLoading} />
          ) : (
            <Patch text={text} />
          )}
        </div>
      ) : null}
    </li>
  )
}
