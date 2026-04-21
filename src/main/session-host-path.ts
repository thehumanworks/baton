import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

export function getSessionHostEndpoint(userDataPath: string): string {
  const hash = crypto.createHash('sha256').update(userDataPath).digest('hex').slice(0, 16)

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\baton-session-host-${hash}`
  }

  const baseDir = process.env.XDG_RUNTIME_DIR && process.env.XDG_RUNTIME_DIR.length > 0
    ? process.env.XDG_RUNTIME_DIR
    : os.tmpdir()

  return path.join(baseDir, `baton-session-host-${hash}.sock`)
}
