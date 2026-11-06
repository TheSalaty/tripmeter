import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { isSnapshot } from './lib/snapshot.js'
import type { Snapshot, WindowDays } from './lib/types.js'

const CACHE_DIR = 'tripmeter'

export type RunResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; error: string }

export class CollectorRunner {
  private cancellable: Gio.Cancellable | null = null

  constructor(private readonly scriptPath: string) {}

  get available(): boolean {
    return GLib.find_program_in_path('gjs') !== null
  }

  run(windowDays: WindowDays, providers: string, onDone: (result: RunResult) => void): void {
    this.cancel()
    if (!this.available) {
      onDone({ ok: false, error: 'gjs not found on PATH' })
      return
    }

    const cancellable = new Gio.Cancellable()
    this.cancellable = cancellable

    let process: Gio.Subprocess
    try {
      process = Gio.Subprocess.new(
        ['gjs', '-m', this.scriptPath, '--window', String(windowDays), '--providers', providers],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      )
    } catch (error) {
      this.cancellable = null
      onDone({ ok: false, error: `could not start collector: ${String(error)}` })
      return
    }

    process.communicate_utf8_async(null, cancellable, (source, result) => {
      if (cancellable.is_cancelled()) return
      this.cancellable = null
      try {
        const [, stdout, stderr] = (source as Gio.Subprocess).communicate_utf8_finish(result)
        const payload: unknown = stdout === null ? null : JSON.parse(stdout)
        if (!isSnapshot(payload)) {
          onDone({ ok: false, error: firstLine(stderr) ?? 'collector returned no snapshot' })
          return
        }
        onDone({ ok: true, snapshot: payload })
      } catch (error) {
        onDone({ ok: false, error: String(error) })
      }
    })
  }

  cancel(): void {
    this.cancellable?.cancel()
    this.cancellable = null
  }
}

const firstLine = (text: string | null): string | null => {
  if (text === null) return null
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0)
  return line === undefined ? null : line.trim()
}

const cachePath = (): string =>
  GLib.build_filenamev([GLib.get_user_cache_dir(), CACHE_DIR, 'snapshot.json'])

export const loadCachedSnapshot = (): Snapshot | null => {
  try {
    const [ok, contents] = GLib.file_get_contents(cachePath())
    if (!ok) return null
    const payload: unknown = JSON.parse(new TextDecoder().decode(contents))
    return isSnapshot(payload) ? payload : null
  } catch {
    return null
  }
}

export const saveCachedSnapshot = (snapshot: Snapshot): void => {
  try {
    const path = cachePath()
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755)
    GLib.file_set_contents(path, JSON.stringify(snapshot))
  } catch {}
}
