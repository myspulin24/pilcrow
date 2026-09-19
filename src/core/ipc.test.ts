/**
 * Smlouva mezi webview a Rustem.
 *
 * Každé `invoke('jmeno')` ve frontendu musí mít protějšek v seznamu
 * `tauri::generate_handler![...]`. Tuhle dvojici nic negeneruje ani
 * nekontroluje: překlep se projeví až za běhu, hláškou „command not found“
 * v konzoli, kterou nikdo nevidí -- funkce prostě mlčky nefunguje.
 *
 * Jednotkové testy tohle nechytí (běží nad paměťovými implementacemi)
 * a end-to-end taky ne (ty Tauri vůbec nespouštějí). Proto se oba seznamy
 * čtou ze zdrojáků a porovnávají tady.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// `process.cwd()`, ne `import.meta.url`: Vitest servíruje moduly přes `/@fs/`,
// takže by z URL vyšla cesta, která na disku neexistuje.
const ROOT = process.cwd()

/** Všechny soubory frontendu, ve kterých se může volat `invoke`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(path)
    }
  }
  return out
}

/** Jména příkazů, která frontend volá. */
function invokedCommands(): Set<string> {
  const found = new Set<string>()
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\binvoke\s*(?:<[^>]*>)?\s*\(\s*'([^']+)'/g)) {
      if (match[1]) found.add(match[1])
    }
  }
  return found
}

/** Jména příkazů, která Rust registruje. */
function registeredCommands(): Set<string> {
  const text = readFileSync(join(ROOT, 'src-tauri/src/commands.rs'), 'utf8')
  const block = /generate_handler!\[([\s\S]*?)\n\s*\]/.exec(text)?.[1]
  if (!block) throw new Error('V commands.rs není seznam generate_handler!')
  return new Set(
    block
      .split(',')
      .map((entry) => entry.trim().split('::').pop() ?? '')
      .filter(Boolean),
  )
}

describe('smlouva mezi webview a Rustem', () => {
  it('každý volaný příkaz je zaregistrovaný', () => {
    const registered = registeredCommands()
    const missing = [...invokedCommands()].filter((name) => !registered.has(name)).sort()
    expect(missing, `příkazy volané z frontendu, které Rust nezná: ${missing.join(', ')}`).toEqual([])
  })

  it('seznamy nejsou prázdné -- jinak by test neověřoval nic', () => {
    // Pojistka proti tomu, že se změní tvar zdrojáku a oba regulární výrazy
    // přestanou nacházet cokoli. Prázdný průnik prázdných množin projde vždy.
    expect(invokedCommands().size).toBeGreaterThan(20)
    expect(registeredCommands().size).toBeGreaterThan(20)
  })

  it('příkazy pro git a repozitáře jsou mezi nimi', () => {
    // Nejnovější přírůstky, u kterých je překlep nejpravděpodobnější.
    const registered = registeredCommands()
    for (const name of [
      'git_probe',
      'git_status',
      'git_publish',
      'git_push',
      'gh_runs',
      'gh_jobs',
      'gh_status',
      'gh_repos',
      'scan_clones',
      'gh_clone',
      'open_url',
    ]) {
      expect(registered.has(name), `Rust nezná ${name}`).toBe(true)
    }
  })
})
