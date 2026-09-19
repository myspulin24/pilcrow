/**
 * Skutečný git: `git` a `gh` běžící na tomhle počítači.
 *
 * Soubor je schválně tenký -- předá argumenty, otevře kanál, pustí kousky dál.
 * Co znamenají, ví `@/core/git`; jak je ukázat, ví sekce Git.
 */

import { Channel, invoke } from '@tauri-apps/api/core'

import type { GitProbe } from '@/core'
import type { GitApi, GitChunk, GitSink, PublishInput } from './api'

/** True, když v tomhle okně běží Tauri. */
export function isGitAvailable(): boolean {
  if (typeof window === 'undefined') return false
  const candidate = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in candidate || '__TAURI__' in candidate
}

function sinkChannel(sink: GitSink): Channel<GitChunk> {
  const channel = new Channel<GitChunk>()
  channel.onmessage = (chunk) => {
    sink(chunk)
  }
  return channel
}

export class TauriGit implements GitApi {
  readonly available = true
  readonly pollMs = 4000

  probe(folder: string): Promise<GitProbe> {
    return invoke<GitProbe>('git_probe', { folder })
  }

  status(folder: string): Promise<string> {
    return invoke<string>('git_status', { folder })
  }

  publish(input: PublishInput, sink: GitSink): Promise<void> {
    return invoke<void>('git_publish', { request: input, channel: sinkChannel(sink) })
  }

  push(folder: string, branch: string, sink: GitSink): Promise<void> {
    return invoke<void>('git_push', { folder, branch, channel: sinkChannel(sink) })
  }

  cancel(): Promise<void> {
    return invoke<void>('git_cancel')
  }

  runs(folder: string, headSha: string): Promise<string> {
    return invoke<string>('gh_runs', { folder, headSha })
  }

  jobs(folder: string, runId: number): Promise<string> {
    return invoke<string>('gh_jobs', { folder, runId })
  }

  recentRuns(folder: string): Promise<string> {
    return invoke<string>('gh_recent_runs', { folder })
  }

  login(sink: GitSink): Promise<void> {
    return invoke<void>('gh_login', { channel: sinkChannel(sink) })
  }

  loginCancel(): Promise<void> {
    return invoke<void>('gh_login_cancel')
  }

  openUrl(url: string): Promise<void> {
    return invoke<void>('open_url', { url })
  }
}
