/**
 * Feedback -- čistá část.
 *
 * Co se smí přiložit, jak se popíše místo v aplikaci a co přesně odejde.
 * Odesílá Rust (jediná síťová cesta pro text od uživatele, na pevnou adresu);
 * tady se jen rozhoduje, jak bude zpráva vypadat.
 *
 * Pravidlo, které tu platí: **co odejde, uvidí uživatel dřív, než to odejde.**
 * Kontext se proto skládá z obecných údajů (verze, systém, co je otevřené),
 * ne z obsahu -- název poznámky ani cesta k souboru do něj nepatří.
 */

export type FeedbackKind = 'bug' | 'change' | 'improvement'

export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'change', 'improvement']

/** Stejné limity jako ve Workeru (`feedback/src/feedback.ts`). */
export const FEEDBACK_LIMITS = {
  message: 10_000,
  attachment: 2 * 1024 * 1024,
} as const

/** Přípona -> typ, který Worker přijme. */
const ATTACHMENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
}

export const FEEDBACK_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((extension) => `.${extension}`)
  .join(',')

export interface FeedbackElement {
  /** Lidský popis: `tlačítko „Větve…“ · Pracovní plocha › Git`. */
  label: string
  /** Kde v rozhraní prvek je, pro vývojáře. */
  path: string
}

export interface FeedbackFile {
  name: string
  /** Typ, který Worker přijme -- odvozený z přípony, ne z toho, co tvrdí systém. */
  type: string
  size: number
  /** Obsah v base64. */
  data: string
}

export type AttachmentCheck = { ok: true; type: string } | { ok: false; reason: 'type' | 'size' }

/** Smí se tenhle soubor přiložit? Rozhoduje přípona a velikost. */
export function checkAttachment(name: string, size: number): AttachmentCheck {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  const type = name.includes('.') ? ATTACHMENT_TYPES[extension] : undefined
  if (!type) return { ok: false, reason: 'type' }
  if (size > FEEDBACK_LIMITS.attachment) return { ok: false, reason: 'size' }
  return { ok: true, type }
}

/** Velikost lidsky, pro řádek s přílohou. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

/** Co je v aplikaci otevřené, popsané bez obsahu. */
export interface LocationFacts {
  /** Je otevřená poznámka nebo soubor? */
  open: 'none' | 'note' | 'linked' | 'file'
  viewMode: 'editor' | 'split' | 'preview'
  sidebarVisible: boolean
  openFolders: number
  gitReady: boolean
  assistantOpen: boolean
}

const VIEW_LABEL: Record<LocationFacts['viewMode'], string> = {
  editor: 'Zdroj',
  split: 'Obojí',
  preview: 'Náhled',
}

/**
 * Jedna řádka kontextu: co bylo na obrazovce.
 *
 * Bez názvů a cest -- jen druh věcí. Pomůže to poznat, *kde* se chyba stala,
 * a nic se tím neprozradí o tom, *na čem* uživatel pracoval.
 */
export function feedbackLocation(facts: LocationFacts): string {
  const parts: string[] = []
  parts.push(
    facts.open === 'note'
      ? 'Poznámka v trezoru'
      : facts.open === 'linked'
        ? 'Poznámka-odkaz na soubor'
        : facts.open === 'file'
          ? 'Soubor ze složky'
          : 'Nic otevřeného',
  )
  if (facts.open !== 'none') parts.push(`zobrazení ${VIEW_LABEL[facts.viewMode]}`)
  if (!facts.sidebarVisible) parts.push('levý panel skrytý')
  if (facts.openFolders > 0) {
    parts.push(facts.openFolders === 1 ? '1 otevřená složka' : `otevřené složky: ${facts.openFolders}`)
  }
  if (facts.gitReady) parts.push('Git')
  if (facts.assistantOpen) parts.push('panel asistenta')
  return parts.join(' · ')
}

export interface FeedbackDraft {
  kind: FeedbackKind | null
  message: string
  element: FeedbackElement | null
  file: FeedbackFile | null
  anonymous: boolean
  name: string
  email: string
}

export const EMPTY_DRAFT: FeedbackDraft = {
  kind: null,
  message: '',
  element: null,
  file: null,
  anonymous: false,
  name: '',
  email: '',
}

/** Co Rust dostane. Verzi a systém doplní sám. */
export interface FeedbackRequest {
  kind: FeedbackKind
  message: string
  location: string
  element: FeedbackElement | null
  author: { name: string; email: string } | null
  attachment: { name: string; type: string; data: string } | null
}

/** Proč se ještě nedá odeslat. `null` = dá. */
export type DraftProblem = 'kind' | 'message' | 'too-long' | 'email' | null

export function draftProblem(draft: FeedbackDraft): DraftProblem {
  if (!draft.kind) return 'kind'
  const message = draft.message.trim()
  if (!message) return 'message'
  if (message.length > FEEDBACK_LIMITS.message) return 'too-long'
  const email = draft.email.trim()
  if (!draft.anonymous && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'email'
  return null
}

/**
 * Zpráva z rozepsaného konceptu.
 *
 * Anonymně znamená bez jména *a* bez e-mailu -- ne „jméno schované, e-mail
 * přiložený“. Prázdné jméno i e-mail jsou taky anonym.
 */
export function feedbackRequest(draft: FeedbackDraft, location: string): FeedbackRequest {
  const name = draft.name.trim()
  const email = draft.email.trim()
  return {
    kind: draft.kind ?? 'bug',
    message: draft.message.trim(),
    location,
    element: draft.element,
    author: draft.anonymous || (!name && !email) ? null : { name, email },
    attachment: draft.file ? { name: draft.file.name, type: draft.file.type, data: draft.file.data } : null,
  }
}
