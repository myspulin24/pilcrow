/**
 * The document pane: header, Markdown editor, rendered preview and backlinks.
 *
 * It shows two kinds of document, and the difference matters:
 *
 * - A **vault note** is owned by Reader_MJ. The textarea edits the body while
 *   frontmatter is managed for you, which is why the file on disk always has
 *   `id`, `created`, `updated`, `pinned` and `tags` without you typing them.
 * - An **external file**, opened through the explorer, is not owned by
 *   Reader_MJ. The textarea shows the file exactly as it is, and saving writes
 *   it back byte for byte. Someone else's Markdown never acquires frontmatter,
 *   an id, or an index entry just because it was opened here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  baseName,
  buildLinkIndex,
  collectFilePaths,
  insertLink,
  parentPath,
  stemOf,
  parseNote,
  renderMarkdown,
  resolveLink,
  serializeNoteFile,
  applyBodyEdit,
  showsEditor,
  t,
  showsPreview,
  titleFromPath,
} from '@/core'
import { useActions, useAppState, useStore } from '@/state/store'
import { EmptyState } from './Feedback'
import { ViewSwitch } from './ViewSwitch'
import { Backlinks } from './Backlinks'

function NoteHeader({ path, external }: { path: string; external: boolean }) {
  const state = useAppState()
  const actions = useActions()
  const parsed = state.parsed

  // A vault note is titled by its frontmatter; an external file is titled by
  // its file name, because Reader_MJ does not own its metadata.
  const title = external ? baseName(path) : (parsed?.frontmatter.title ?? titleFromPath(path))
  const folder = external
    ? parentPath(path)
    : path.includes('/')
      ? path.slice(0, path.lastIndexOf('/'))
      : ''

  const status = state.editor?.saving
    ? t.note.saving
    : state.editor?.dirty
      ? t.note.unsaved
      : state.editor?.savedAt
        ? t.note.saved
        : t.note.upToDate

  return (
    // Labelled because the preview renders the note's own `# Heading` as an
    // <h1> too; this is what distinguishes the chrome from the content.
    <header className="note-header" aria-label={t.note.header}>
      <div className="note-header__main">
        <h1 className="note-header__title" title={path}>
          {!external && parsed?.frontmatter.pinned ? <span className="note-header__pin">★</span> : null}
          {title}
        </h1>
        <div className="note-header__meta">
          {external ? <span className="note-header__badge">{t.note.externalBadge}</span> : null}
          {folder ? (
            <span className="note-header__folder">{external ? folder : `${folder}/`}</span>
          ) : null}
          <span>{t.note.words(parsed?.wordCount ?? 0)}</span>
          {parsed && parsed.tasks.total > 0 ? (
            <span>{t.note.tasks(parsed.tasks.done, parsed.tasks.total)}</span>
          ) : null}
          <span className={`note-header__status note-header__status--${state.editor?.dirty ? 'dirty' : 'clean'}`}>
            {status}
          </span>
        </div>
      </div>
      <div className="note-header__actions">
        {external ? null : (
          <button type="button" className="button button--ghost" onClick={() => void actions.togglePin(path)}>
            {parsed?.frontmatter.pinned ? t.note.unpin : t.note.pin}
          </button>
        )}
        <ViewSwitch mode={state.viewMode} onChange={actions.setViewMode} />
      </div>
    </header>
  )
}

export function NotePane() {
  const { state } = useStore()
  const actions = useActions()
  const { vault } = useStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [dropActive, setDropActive] = useState(false)

  const editor = state.editor

  useEffect(() => {
    actions.bindEditorElement(textareaRef.current)
    return () => actions.bindEditorElement(null)
  }, [actions, editor?.path])

  // Live parse of the buffer so the preview, word count and tags update as you
  // type without waiting for a save.
  const live = useMemo(
    () => (editor ? parseNote(editor.text, { path: editor.path }) : null),
    [editor],
  )

  const isExternal = editor?.external ?? false

  /**
   * What `[[links]]` resolve against.
   *
   * A vault note resolves against the vault. An external file resolves against
   * the folder it was opened from, so a link between two files in someone
   * else's folder still works.
   */
  const linkIndex = useMemo(() => {
    if (isExternal && state.explorer.tree) {
      return buildLinkIndex(
        collectFilePaths(state.explorer.tree).map((path) => ({
          path,
          title: stemOf(baseName(path)),
        })),
      )
    }
    return buildLinkIndex(state.notes.map((note) => ({ path: note.path, title: note.title })))
  }, [isExternal, state.explorer.tree, state.notes])

  const html = useMemo(() => {
    if (!live) return ''
    return renderMarkdown(live.body, {
      interactiveTasks: true,
      resolveWikiLink: (target) => {
        const resolved = resolveLink(linkIndex, target)
        return { href: `#note/${encodeURIComponent(resolved ?? target)}`, exists: resolved !== null }
      },
      resolveImage: (src) => vault.attachmentUrl(src) || src,
    })
  }, [live, linkIndex, vault])

  /**
   * What the textarea holds.
   *
   * For a vault note it is the body, with frontmatter hidden and managed for
   * you. For an external file it is the file, byte for byte -- nothing is
   * hidden and nothing is added on save.
   */
  const editorText = isExternal ? (editor?.text ?? '') : (live?.body ?? '')

  const onEditorChange = useCallback(
    (next: string) => {
      if (isExternal) {
        actions.edit(next)
        return
      }
      if (!live) return
      actions.edit(serializeNoteFile(applyBodyEdit(live, next)))
    },
    [actions, isExternal, live],
  )

  const onPreviewClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      const wikilink = target.closest('[data-wikilink]')
      if (wikilink instanceof HTMLElement) {
        event.preventDefault()
        void actions.openOrCreateByTitle(wikilink.dataset.wikilink ?? '')
        return
      }
      const tag = target.closest('[data-tag]')
      if (tag instanceof HTMLElement) {
        event.preventDefault()
        actions.setActiveTag(tag.dataset.tag ?? null)
      }
    },
    [actions],
  )

  const onPreviewChange = useCallback(
    (event: React.ChangeEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      if (target instanceof HTMLInputElement && target.dataset.taskIndex !== undefined) {
        void actions.toggleTaskAt(Number(target.dataset.taskIndex))
      }
    },
    [actions],
  )

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      event.preventDefault()
      setDropActive(false)
      const file = event.dataTransfer.files?.[0]
      if (file) void actions.attachImage(file)
    },
    [actions],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const element = event.currentTarget
      // `[[` opens the link picker, the way Bear and Obsidian both behave.
      if (event.key === '[' && element.value.slice(element.selectionStart - 1, element.selectionStart) === '[') {
        event.preventDefault()
        actions.setPalette(true, 'link')
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const start = element.selectionStart
        const end = element.selectionEnd
        onEditorChange(`${element.value.slice(0, start)}  ${element.value.slice(end)}`)
        requestAnimationFrame(() => element.setSelectionRange(start + 2, start + 2))
      }
    },
    [actions, onEditorChange],
  )

  if (!editor || !live) {
    return (
      <section className="note-pane note-pane--empty">
        <EmptyState
          icon="✎"
          title={t.note.nothingOpen}
          description={t.note.nothingOpenHint}
          action={{
            label: t.workspace.newNote,
            onClick: () => void actions.create({ title: 'Bez názvu' }),
          }}
        />
      </section>
    )
  }

  return (
    <section className="note-pane" aria-label={t.note.region}>
      <NoteHeader path={editor.path} external={isExternal} />
      <div className={`note-pane__body note-pane__body--${state.viewMode}`}>
        {showsEditor(state.viewMode) ? (
        <div className={`editor ${dropActive ? 'is-drop-target' : ''}`}>
          <textarea
            ref={textareaRef}
            data-editor-textarea
            className="editor__textarea"
            aria-label={t.note.body}
            spellCheck
            value={editorText}
            style={{ fontSize: `${state.settings.editorFontSize}px` }}
            onChange={(event) => onEditorChange(event.target.value)}
            onKeyDown={onKeyDown}
            onDragOver={(event) => {
              event.preventDefault()
              setDropActive(true)
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={onDrop}
            onPaste={(event) => {
              const file = Array.from(event.clipboardData.files)[0]
              if (file && file.type.startsWith('image/')) {
                event.preventDefault()
                void actions.attachImage(file)
              }
            }}
          />
          {dropActive ? <div className="editor__drop-hint">{t.note.dropImage}</div> : null}
        </div>
        ) : null}

        {showsPreview(state.viewMode) ? (
          <div
            className="preview markdown-body"
            aria-label={t.note.preview}
            onClick={onPreviewClick}
            onChange={onPreviewChange}
            // `renderMarkdown` escapes all text and scheme-checks every URL.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : null}
      </div>
      {isExternal ? null : <Backlinks />}
    </section>
  )
}

/** Exposed for the link palette: insert `[[target]]` at the caret. */
export function useInsertWikiLink() {
  const { state } = useStore()
  const actions = useActions()
  return useCallback(
    (target: string) => {
      const editor = state.editor
      if (!editor) return
      const element = document.querySelector<HTMLTextAreaElement>('[data-editor-textarea]')

      // The caret is an offset into whatever the textarea shows: the raw file
      // for an external document, the body for a vault note.
      const source = editor.external ? editor.text : parseNote(editor.text, { path: editor.path }).body
      const start = element?.selectionStart ?? source.length
      const end = element?.selectionEnd ?? source.length
      const { body, caret } = insertLink(source, start, end, target)

      if (editor.external) {
        actions.edit(body)
        requestAnimationFrame(() => {
          element?.focus()
          element?.setSelectionRange(caret, caret)
        })
        return
      }
      actions.edit(serializeNoteFile(applyBodyEdit(parseNote(editor.text, { path: editor.path }), body)))
      requestAnimationFrame(() => {
        element?.focus()
        element?.setSelectionRange(caret, caret)
      })
    },
    [actions, state.editor],
  )
}
