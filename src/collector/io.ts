import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Soup from 'gi://Soup?version=3.0'

const decoder = new TextDecoder('utf-8')

export const readTextFile = (path: string): string | null => {
  try {
    const [ok, contents] = GLib.file_get_contents(path)
    if (!ok) return null
    return decoder.decode(contents)
  } catch {
    return null
  }
}

export const readJsonFile = (path: string): unknown => {
  const text = readTextFile(path)
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export const writeJsonFile = (path: string, value: unknown): void => {
  try {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700)
    GLib.file_set_contents(path, JSON.stringify(value))
  } catch {
    // A cache that cannot be written is not worth reporting.
  }
}

export const exists = (path: string): boolean => GLib.file_test(path, GLib.FileTest.EXISTS)

export const onPath = (program: string): boolean => GLib.find_program_in_path(program) !== null

export const runShell = (script: string, env: Record<string, string>): string => {
  const environment = [
    ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
    `PATH=${GLib.getenv('PATH') ?? '/usr/bin:/bin'}`,
  ]
  try {
    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
    })
    for (const entry of environment) {
      const separator = entry.indexOf('=')
      launcher.setenv(entry.slice(0, separator), entry.slice(separator + 1), true)
    }
    const process = launcher.spawnv(['sh', '-c', script])
    const [, stdout] = process.communicate_utf8(null, null)
    return stdout ?? ''
  } catch {
    return ''
  }
}

export type HttpResult = {
  status: number
  body: string
}

export const httpGet = (url: string, headers: Record<string, string>): HttpResult => {
  const session = new Soup.Session()
  session.timeout = 15
  const message = Soup.Message.new('GET', url)
  if (message === null) return { status: 0, body: '' }
  for (const [name, value] of Object.entries(headers)) {
    message.get_request_headers().append(name, value)
  }
  try {
    const bytes = session.send_and_read(message, null)
    const data = bytes.get_data()
    return {
      status: message.get_status(),
      body: data === null ? '' : decoder.decode(data),
    }
  } catch {
    return { status: 0, body: '' }
  }
}

export const isoSeconds = (epochMs: number): string =>
  new Date(epochMs).toISOString().replace(/\.\d+Z$/, 'Z')
