import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const ENC_PREFIX = 'enc:v1:'

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex) throw new Error('ENCRYPTION_KEY env var not set')
  const buf = Buffer.from(hex, 'hex')
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  return buf
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Layout: iv(12 bytes) + tag(16 bytes) + ciphertext
  const payload = Buffer.concat([iv, tag, encrypted])
  return ENC_PREFIX + payload.toString('base64')
}

export function decrypt(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value // legacy plaintext during migration
  const payload = Buffer.from(value.slice(ENC_PREFIX.length), 'base64')
  const key = getKey()
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const ciphertext = payload.subarray(28)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX)
}
