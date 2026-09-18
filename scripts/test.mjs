#!/usr/bin/env node
/**
 * `npm test` -- run every suite and summarise.
 *
 *   1. TypeScript type check
 *   2. Rust tests for the vault layer  (files, paths, SQLite index)
 *   3. TypeScript unit tests for the core transformation
 *   4. The end-to-end happy path
 *
 * Each stage runs even if an earlier one failed, so one command tells you
 * everything that is broken rather than only the first thing.
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const color = process.stdout.isTTY
const paint = (code, text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text)
const bold = (text) => paint('1', text)
const dim = (text) => paint('2', text)

const STAGES = [
  {
    name: 'typecheck',
    label: 'Typy TypeScriptu',
    command: 'npx',
    args: ['tsc', '--noEmit'],
  },
  {
    name: 'rust',
    label: 'Vrstva trezoru v Rustu (soubory, cesty, rejstřík, procházení složek)',
    command: 'cargo',
    args: ['test', '--manifest-path', 'src-tauri/Cargo.toml', '-p', 'pilcrow-core'],
  },
  {
    name: 'unit',
    label: 'Jádro (Markdown, štítky, odkazy, hledání)',
    command: 'npx',
    args: ['vitest', 'run'],
  },
  {
    name: 'e2e',
    label: 'End-to-end (průchod poznámkami + průzkumník souborů)',
    command: 'npx',
    args: ['vitest', 'run', '--config', 'vitest.e2e.config.ts'],
  },
]

const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
const stages = only.length > 0 ? STAGES.filter((stage) => only.includes(stage.name)) : STAGES

if (stages.length === 0) {
  console.error(`Unknown stage. Available: ${STAGES.map((stage) => stage.name).join(', ')}`)
  process.exit(1)
}

const results = []

for (const stage of stages) {
  console.log(`\n${bold(`- ${stage.label}`)}`)
  console.log(dim(`  ${stage.command} ${stage.args.join(' ')}\n`))

  const started = Date.now()
  const result = spawnSync(stage.command, stage.args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  results.push({
    ...stage,
    ok: result.status === 0,
    seconds: ((Date.now() - started) / 1000).toFixed(1),
  })
}

console.log(`\n${bold('Summary')}`)
for (const result of results) {
  const mark = result.ok ? paint('32', 'PASS') : paint('31', 'FAIL')
  console.log(`  ${mark}  ${result.label} ${dim(`(${result.seconds}s)`)}`)
}
console.log()

process.exit(results.every((result) => result.ok) ? 0 : 1)
