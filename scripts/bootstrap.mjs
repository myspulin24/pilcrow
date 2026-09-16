#!/usr/bin/env node
/**
 * `npm start` -- the one documented command.
 *
 * From a fresh clone this script does everything needed to get a working app:
 *
 *   1. checks Node and Rust are new enough, with an actionable message if not
 *   2. runs `npm install` when `node_modules` is missing
 *   3. creates `.env` from `.env.example` (never overwriting an existing one)
 *   4. generates the app icons if they are not committed
 *   5. launches `tauri dev`
 *
 * It uses only Node built-ins, so it runs before any dependency is installed.
 * `npm run setup` runs steps 1-4 and stops.
 */

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SETUP_ONLY = process.argv.includes('--setup-only')

const MIN_NODE = [20, 10]
const MIN_RUST = [1, 77]

const color = process.stdout.isTTY
const paint = (code, text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text)
const bold = (text) => paint('1', text)
const dim = (text) => paint('2', text)
const green = (text) => paint('32', text)
const red = (text) => paint('31', text)
const yellow = (text) => paint('33', text)

const step = (text) => console.log(`${green('>')} ${text}`)
const warn = (text) => console.log(`${yellow('!')} ${text}`)

function fail(message, hint) {
  console.error(`\n${red('x')} ${bold(message)}`)
  if (hint) console.error(`  ${dim(hint)}`)
  process.exit(1)
}

function parseVersion(text) {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text ?? '')
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null
}

function atLeast(actual, minimum) {
  for (let i = 0; i < minimum.length; i++) {
    const a = actual[i] ?? 0
    const b = minimum[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return true
}

/** Run a command, inheriting stdio. Returns the exit code. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    // npm and cargo are batch files on Windows, which need a shell.
    shell: process.platform === 'win32',
    ...options,
  })
  return result.status ?? 1
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) return null
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

// --- 1. toolchain -----------------------------------------------------------

function checkToolchain() {
  const node = parseVersion(process.versions.node)
  if (!node || !atLeast(node, MIN_NODE)) {
    fail(
      `Potřebuješ Node ${MIN_NODE.join('.')} nebo novější (našel jsem ${process.versions.node}).`,
      'Nainstaluj ho z https://nodejs.org nebo přes správce verzí.',
    )
  }

  const rustcOutput = capture('rustc', ['--version'])
  if (!rustcOutput) {
    fail(
      'Rust není v PATH.',
      'Reader_MJ je aplikace v Tauri, takže potřebuje Rust. Nainstaluj ho z https://rustup.rs a spusť `npm start` znovu.',
    )
  }
  const rust = parseVersion(rustcOutput)
  if (rust && !atLeast(rust, MIN_RUST)) {
    fail(
      `Potřebuješ Rust ${MIN_RUST.join('.')} nebo novější (našel jsem ${rust.join('.')}).`,
      'Spusť `rustup update` a zkus to znovu.',
    )
  }

  if (process.platform === 'linux' && !capture('pkg-config', ['--version'])) {
    warn(
      'pkg-config jsem nenašel. Na Linuxu Tauri potřebuje ještě webkit2gtk a libayatana-appindicator.\n' +
        '  Seznam balíčků pro tvoji distribuci je na https://tauri.app/start/prerequisites/.',
    )
  }

  step(`Node ${process.versions.node}, ${rustcOutput.split('\n')[0]}`)
}

// --- 2. dependencies --------------------------------------------------------

function installDependencies() {
  if (existsSync(join(ROOT, 'node_modules', '.package-lock.json'))) {
    step('Závislosti už jsou nainstalované')
    return
  }
  step('Instaluji závislosti npm (jen při prvním spuštění, chvíli to trvá)')
  const code = run('npm', ['install', '--no-audit', '--no-fund'])
  if (code !== 0) fail('npm install selhal.', 'Podívej se na výpis výše a spusť `npm start` znovu.')
}

// --- 3. .env ----------------------------------------------------------------

function ensureEnvFile() {
  const target = join(ROOT, '.env')
  const example = join(ROOT, '.env.example')

  if (existsSync(target)) {
    step('.env už existuje (nechávám ho být)')
    return
  }
  if (!existsSync(example)) {
    warn('.env.example chybí, takže jsem .env nevytvořil.')
    return
  }
  copyFileSync(example, target)
  step('Vytvořil jsem .env podle .env.example')
  console.log(
    dim('  Reader_MJ nepotřebuje žádné přihlašovací údaje. Nastav tam READER_MJ_VAULT_PATH a vyber, kde mají být tvoje poznámky.'),
  )
}

// --- 4. icons ---------------------------------------------------------------

async function ensureIcons() {
  const icon = join(ROOT, 'src-tauri', 'icons', 'icon.ico')
  if (existsSync(icon)) return
  step('Generuji ikony aplikace')
  mkdirSync(join(ROOT, 'src-tauri', 'icons'), { recursive: true })
  await import('./gen-icons.mjs')
}

// --- 5. where the notes will live ------------------------------------------

function reportVaultLocation() {
  let configured = ''
  try {
    const env = readFileSync(join(ROOT, '.env'), 'utf8')
    configured = /^READER_MJ_VAULT_PATH\s*=\s*(.*)$/m.exec(env)?.[1]?.trim() ?? ''
  } catch {
    // No .env is fine; the app falls back to the platform default.
  }
  const where = configured || join('<tvoje složka Dokumenty>', 'Reader_MJ')
  console.log(`\n  ${bold('Tvoje poznámky budou v')} ${where}`)
  console.log(dim('  Jeden soubor Markdown na poznámku, k tomu přestavitelný .reader_mj/index.sqlite.\n'))
}

// --- main -------------------------------------------------------------------

async function main() {
  console.log(`\n${bold('Reader_MJ')} ${dim('- poznámky v Markdownu, všechno u tebe')}\n`)

  checkToolchain()
  installDependencies()
  ensureEnvFile()
  await ensureIcons()
  reportVaultLocation()

  if (SETUP_ONLY) {
    console.log(`${green('Hotovo.')} Aplikaci spustíš přes ${bold('npm start')}.\n`)
    return
  }

  step('Spouštím Reader_MJ (první sestavení Rustu trvá pár minut, další už jsou rychlá)')
  console.log()

  const child = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  child.on('exit', (code) => process.exit(code ?? 0))

  // Pass Ctrl-C through so the dev server and the app both stop.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal))
  }
}

main().catch((error) => fail(error?.message ?? String(error)))
