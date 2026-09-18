/**
 * Údaje pro sekci „O aplikaci“.
 *
 * Skládají se ze dvou zdrojů, protože jinak to nejde: verze knihoven rozhraní
 * zná jen sestavovací nástroj (vkládá je Vite, viz `vite.config.ts`), verze
 * běhového prostředí a překladače zná jen Rust. Tady se z obojího stane jeden
 * seznam.
 */

import { invoke } from '@tauri-apps/api/core'

/** Co do binárky vložil Vite. Klíče jsou názvy balíčků. */
declare const __FRONTEND_VERSIONS__: Record<string, string>

export interface AppInfo {
  version: string
  identifier: string
  profile: string
  tauriVersion: string
  webviewVersion: string
  rustcVersion: string
  target: string
  sqliteVersion: string
  os: string
  arch: string
}

/** Jedna řádka v tabulce. Prázdná hodnota se ukáže jako pomlčka. */
export interface AboutRow {
  label: string
  value: string
}

export interface About {
  frontend: AboutRow[]
  backend: AboutRow[]
  runtime: AboutRow[]
}

const OS_NAMES: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
}

/**
 * Verze běhového prostředí a překladače.
 *
 * V prohlížeči (`npm run dev:web`) žádný Rust neběží, takže se vrátí `null`
 * a sekce ukáže jen to, co o sobě ví rozhraní. Předstírat čísla, která nemáme,
 * by v sekci, jejímž smyslem je přesnost, bylo obzvlášť hloupé.
 */
export async function loadAppInfo(): Promise<AppInfo | null> {
  if (typeof window === 'undefined') return null
  const candidate = window as unknown as Record<string, unknown>
  if (!('__TAURI_INTERNALS__' in candidate) && !('__TAURI__' in candidate)) return null
  try {
    return await invoke<AppInfo>('app_info')
  } catch {
    return null
  }
}

/** Verze balíčků rozhraní, jak byly nainstalované při sestavení. */
export function frontendVersions(): Record<string, string> {
  return typeof __FRONTEND_VERSIONS__ === 'undefined' ? {} : __FRONTEND_VERSIONS__
}

/** Hezčí název operačního systému než `windows`. */
export function osName(os: string): string {
  return OS_NAMES[os] ?? os
}

/**
 * Jak se jmenuje to, co kreslí rozhraní.
 *
 * Každý systém má jiné, a jen tohle číslo rozhoduje o tom, co v okně opravdu
 * funguje -- proto se v seznamu jmenuje pravým jménem, ne obecně „webview“.
 */
export function webviewName(os: string): string {
  if (os === 'windows') return 'WebView2'
  if (os === 'macos') return 'WebKit'
  return 'WebKitGTK'
}
