import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface, type Interface } from 'node:readline'

export const OPENOCR_ENGINE = 'openocr'
export const OPENOCR_PIPELINE = 'RepViT DB + RepSVTR Mobile / ONNX CPU'

export interface OpenOcrLine {
  text: string
  score: number
  box?: unknown
}

export interface OpenOcrResult {
  ok: boolean
  engine: string
  engineVersion: string | null
  lines: OpenOcrLine[]
  error?: string
}

type Pending = {
  id: string
  resolve: (value: OpenOcrResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function workerPath(): string | null {
  const candidates = [
    process.env.OPENOCR_WORKER,
    process.env.NUXT_OCR_WORKER,
    join(process.cwd(), 'server/ocr/openocr_worker.py'),
    '/app/ocr/openocr_worker.py',
  ]
  return candidates.find((path): path is string => Boolean(path && existsSync(path))) ?? null
}

function pythonBin(): string {
  return process.env.OPENOCR_PYTHON || process.env.NUXT_OCR_PYTHON || 'python3'
}

function imageExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg'
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'png'
  if (buffer.length >= 12 && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  return 'jpg'
}

class OpenOcrWorker {
  private child: ChildProcessWithoutNullStreams | null = null
  private reader: Interface | null = null
  private ready = false
  private starting: Promise<void> | null = null
  private seq = 0
  private inflight = new Map<string, Pending>()
  private chain: Promise<unknown> = Promise.resolve()

  available(): { python: string, worker: string | null } {
    return { python: pythonBin(), worker: workerPath() }
  }

  async health(): Promise<{ healthy: boolean, version: string | null, message: string }> {
    const worker = workerPath()
    if (!worker) {
      return {
        healthy: false,
        version: null,
        message: 'OpenOCR worker script is missing.',
      }
    }

    if (this.ready && this.child) {
      try {
        const ping = await this.request({ cmd: 'ping' }, 8_000)
        return {
          healthy: ping.ok,
          version: ping.engineVersion,
          message: ping.ok
            ? `OpenOCR ${ping.engineVersion ?? ''} ready (${OPENOCR_PIPELINE}).`.replace(/\s+/g, ' ').trim()
            : (ping.error || 'OpenOCR did not respond.'),
        }
      }
      catch (error) {
        return {
          healthy: false,
          version: null,
          message: error instanceof Error ? error.message : 'OpenOCR is not available.',
        }
      }
    }

    try {
      const probe = await new Promise<{ code: number | null, stdout: string, stderr: string }>((resolve, reject) => {
        const child = spawn(pythonBin(), ['-c', 'from openocr import OpenOCR; import onnxruntime; print("ok")'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error('OpenOCR import check timed out.'))
        }, 20_000)
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
        })
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8')
        })
        child.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          resolve({ code, stdout, stderr })
        })
      })
      if (probe.code !== 0 || !probe.stdout.includes('ok')) {
        return {
          healthy: false,
          version: null,
          message: (probe.stderr || probe.stdout || 'OpenOCR Python package is not installed.').trim().slice(0, 280),
        }
      }
      return {
        healthy: true,
        version: null,
        message: `OpenOCR Python package installed (${OPENOCR_PIPELINE}). Models load on the first scan.`,
      }
    }
    catch (error) {
      return {
        healthy: false,
        version: null,
        message: error instanceof Error ? error.message : 'python3 / OpenOCR is not available.',
      }
    }
  }

  async recognize(image: Buffer, timeoutMs = 90_000): Promise<OpenOcrResult> {
    const dir = await mkdtemp(join(tmpdir(), 'openocr-'))
    const file = join(dir, `frame.${imageExtension(image)}`)
    try {
      await writeFile(file, image)
      return await this.request({ cmd: 'ocr', image_path: file }, timeoutMs)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  private request(payload: Record<string, unknown>, timeoutMs: number): Promise<OpenOcrResult> {
    const run = async () => {
      await this.ensure()
      const id = String(++this.seq)
      const child = this.child
      if (!child) throw new Error('OpenOCR worker is not running.')

      return await new Promise<OpenOcrResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.inflight.delete(id)
          reject(new Error(`OpenOCR timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        this.inflight.set(id, { id, resolve, reject, timer })
        child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, (error) => {
          if (!error) return
          clearTimeout(timer)
          this.inflight.delete(id)
          reject(error)
        })
      })
    }

    const next = this.chain.then(run, run)
    this.chain = next.then(() => undefined, () => undefined)
    return next
  }

  private async ensure(): Promise<void> {
    if (this.ready && this.child && !this.child.killed) return
    if (this.starting) return this.starting
    this.starting = this.spawnWorker().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async spawnWorker(): Promise<void> {
    const script = workerPath()
    if (!script) {
      throw new Error('OpenOCR worker script was not found. Install the app with server/ocr/openocr_worker.py.')
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(pythonBin(), ['-u', script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          HOME: process.env.HOME || tmpdir(),
          HF_HOME: process.env.HF_HOME || join(tmpdir(), 'huggingface'),
          ...this.modelEnv(),
        },
      })

      this.child = child
      this.ready = false
      this.reader = createInterface({ input: child.stdout })

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim()
        if (text) console.warn('[openocr]', text)
      })

      const bootTimer = setTimeout(() => {
        reject(new Error('OpenOCR worker did not become ready (ONNX models may still be downloading).'))
        this.kill()
      }, 180_000)

      let settled = false
      this.reader.on('line', (line) => {
        if (!settled) {
          try {
            const msg = JSON.parse(line) as { ok?: boolean, event?: string, error?: string }
            if (msg.event === 'ready' && msg.ok) {
              settled = true
              clearTimeout(bootTimer)
              this.ready = true
              resolve()
              return
            }
            if (msg.ok === false) {
              settled = true
              clearTimeout(bootTimer)
              reject(new Error(msg.error || 'OpenOCR failed to start.'))
              this.kill()
              return
            }
          }
          catch {
            // Non-JSON boot noise is ignored; the ready event is JSON.
          }
        }
        if (this.ready) this.onLine(line)
      })

      child.on('error', (error) => {
        clearTimeout(bootTimer)
        this.ready = false
        reject(error)
      })

      child.on('close', (code) => {
        this.ready = false
        this.child = null
        const err = new Error(`OpenOCR worker exited (${code ?? 'null'}).`)
        for (const pending of this.inflight.values()) {
          clearTimeout(pending.timer)
          pending.reject(err)
        }
        this.inflight.clear()
      })
    })
  }

  private onLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: OpenOcrResult & { id?: string, event?: string }
    try {
      msg = JSON.parse(trimmed) as OpenOcrResult & { id?: string, event?: string }
    }
    catch {
      return
    }

    if (msg.event === 'ready') {
      this.ready = Boolean(msg.ok)
      return
    }

    const pending = msg.id ? this.inflight.get(String(msg.id)) : undefined
    if (!pending) return
    this.inflight.delete(pending.id)
    clearTimeout(pending.timer)
    pending.resolve({
      ok: Boolean(msg.ok),
      engine: msg.engine || OPENOCR_ENGINE,
      engineVersion: msg.engineVersion ?? null,
      lines: Array.isArray(msg.lines) ? msg.lines : [],
      error: msg.error,
    })
  }

  private modelEnv(): Record<string, string> {
    let det = process.env.OPENOCR_DET_MODEL || ''
    let rec = process.env.OPENOCR_REC_MODEL || ''
    try {
      const config = useRuntimeConfig()
      det = det || String(config.ocrDetModel || '')
      rec = rec || String(config.ocrRecModel || '')
    }
    catch {
      // runtimeConfig is only available inside a Nitro request
    }
    return {
      ...(det ? { OPENOCR_DET_MODEL: det } : {}),
      ...(rec ? { OPENOCR_REC_MODEL: rec } : {}),
    }
  }

  private kill() {
    this.ready = false
    this.reader?.close()
    this.reader = null
    this.child?.kill('SIGKILL')
    this.child = null
  }
}

let instance: OpenOcrWorker | undefined

export function useOpenOcrWorker(): OpenOcrWorker {
  if (!instance) instance = new OpenOcrWorker()
  return instance
}
