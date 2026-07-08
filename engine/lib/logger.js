import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENGINE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const LOGS_DIR = path.join(ENGINE_DIR, 'logs')

let logFilePath = null

// Gọi 1 lần đầu run: tạo logs/run-YYYYMMDD-HHmmss.log
export function initLogFile() {
  fs.mkdirSync(LOGS_DIR, { recursive: true })
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
  logFilePath = path.join(LOGS_DIR, `run-${stamp}.log`)
  return logFilePath
}

function write(level, network, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${network ? `[${network}] ` : ''}${message}`
  console.log(line)
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, line + '\n')
    } catch {
      // log file lỗi không được làm chết engine
    }
  }
}

export const log = {
  info: (msg, network = null) => write('INFO', network, msg),
  warn: (msg, network = null) => write('WARN', network, msg),
  error: (msg, network = null) => write('ERROR', network, msg),
}
