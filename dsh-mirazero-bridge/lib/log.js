/** Best-effort boot/audit log under the plugin state directory. */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { nowIso } from './util.js'

export class Logger {
  #file
  #enabled

  constructor(stateDir, enabled = true) {
    this.#enabled = enabled
    this.#file = join(stateDir, 'boot.log')
    try {
      mkdirSync(stateDir, { recursive: true })
    } catch {
      this.#enabled = false
    }
  }

  get file() {
    return this.#file
  }

  info(message) {
    this.#write('INFO', message)
  }

  warn(message) {
    this.#write('WARN', message)
  }

  error(message) {
    this.#write('ERROR', message)
  }

  #write(level, message) {
    const line = `${nowIso()} [${level}] ${String(message)}`
    try {
      console.log(`[mirazero] ${line}`)
    } catch {
      // no console
    }
    if (!this.#enabled) return
    try {
      if (existsSync(this.#file) && statSync(this.#file).size > 4 * 1024 * 1024) {
        renameSync(this.#file, `${this.#file}.1`)
      }
      appendFileSync(this.#file, `${line}\n`, 'utf8')
    } catch {
      // logging must never break the bridge
    }
  }
}
