import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile, rm } from 'fs/promises'
import path from 'path'
import { atomicWriteFile } from '../utils/safeFile'

export const SUBSTORE_RUNTIME_REPO = 'ABOLUOmathh/Sub-Store'
export const SUBSTORE_RUNTIME_ASSET = 'sub-store.bundle.js'
export const SUBSTORE_RUNTIME_STATE_FILE = 'sub-store-runtime.json'

export interface SubStoreReleaseManifest {
  releaseVersion: string
  upstreamBase: string
  sourceCommit: string
  mihomoFallbackUserAgentVersion: string
  runtimeAssets: string[]
}

export interface SubStoreRuntimeState {
  version: string
  source: typeof SUBSTORE_RUNTIME_REPO
  asset: typeof SUBSTORE_RUNTIME_ASSET
  sha256: string
  sourceCommit?: string
}

export function parseSubStoreReleaseManifest(
  text: string,
  expectedVersion?: string
): SubStoreReleaseManifest {
  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Invalid Sub-Store release manifest JSON')
  }

  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Sub-Store release manifest')
  }

  const manifest = value as Partial<SubStoreReleaseManifest>

  if (
    typeof manifest.releaseVersion !== 'string' ||
    typeof manifest.upstreamBase !== 'string' ||
    typeof manifest.sourceCommit !== 'string' ||
    typeof manifest.mihomoFallbackUserAgentVersion !== 'string' ||
    !Array.isArray(manifest.runtimeAssets) ||
    !manifest.runtimeAssets.every((asset) => typeof asset === 'string')
  ) {
    throw new Error('Invalid Sub-Store release manifest fields')
  }

  if (expectedVersion && manifest.releaseVersion !== expectedVersion) {
    throw new Error(
      `Sub-Store release version mismatch: expected ${expectedVersion}, got ${manifest.releaseVersion}`
    )
  }

  if (!manifest.runtimeAssets.includes(SUBSTORE_RUNTIME_ASSET)) {
    throw new Error(`Sub-Store release manifest does not contain ${SUBSTORE_RUNTIME_ASSET}`)
  }

  return manifest as SubStoreReleaseManifest
}

export function parseSubStoreChecksums(text: string): Map<string, string> {
  const checksums = new Map<string, string>()

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line) continue

    const match = line.match(/^([a-fA-F0-9]{64})\s+(.+)$/)

    if (!match) {
      throw new Error(`Invalid Sub-Store checksum line: ${rawLine}`)
    }

    const sha256 = match[1].toLowerCase()
    const filename = match[2].trim()

    const existing = checksums.get(filename)

    if (existing && existing !== sha256) {
      throw new Error(`Conflicting checksum entries for ${filename}`)
    }

    checksums.set(filename, sha256)
  }

  return checksums
}

export function getSubStoreBackendChecksum(checksumsText: string): string {
  const checksums = parseSubStoreChecksums(checksumsText)
  const checksum = checksums.get(SUBSTORE_RUNTIME_ASSET)

  if (!checksum) {
    throw new Error(`Sub-Store checksums do not contain ${SUBSTORE_RUNTIME_ASSET}`)
  }

  return checksum
}

export function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function verifySubStoreBackendChecksum(data: Buffer, expectedSha256: string): void {
  if (!/^[a-fA-F0-9]{64}$/.test(expectedSha256)) {
    throw new Error('Invalid expected Sub-Store SHA256')
  }

  const actual = sha256Buffer(data)
  const expected = expectedSha256.toLowerCase()

  if (actual !== expected) {
    throw new Error(`Sub-Store backend SHA256 mismatch: expected ${expected}, got ${actual}`)
  }
}

export function subStoreRuntimeStatePath(workDir: string): string {
  return path.join(workDir, SUBSTORE_RUNTIME_STATE_FILE)
}

export async function readSubStoreRuntimeState(
  workDir: string
): Promise<SubStoreRuntimeState | undefined> {
  const statePath = subStoreRuntimeStatePath(workDir)

  if (!existsSync(statePath)) return undefined

  try {
    const value = JSON.parse(await readFile(statePath, 'utf8')) as Partial<SubStoreRuntimeState>

    if (
      typeof value.version !== 'string' ||
      value.source !== SUBSTORE_RUNTIME_REPO ||
      value.asset !== SUBSTORE_RUNTIME_ASSET ||
      typeof value.sha256 !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(value.sha256)
    ) {
      return undefined
    }

    return {
      version: value.version,
      source: SUBSTORE_RUNTIME_REPO,
      asset: SUBSTORE_RUNTIME_ASSET,
      sha256: value.sha256.toLowerCase(),
      ...(typeof value.sourceCommit === 'string' ? { sourceCommit: value.sourceCommit } : {})
    }
  } catch {
    return undefined
  }
}

export async function writeSubStoreRuntimeState(
  workDir: string,
  state: SubStoreRuntimeState
): Promise<void> {
  const statePath = subStoreRuntimeStatePath(workDir)

  const serialized = `${JSON.stringify(
    {
      ...state,
      sha256: state.sha256.toLowerCase()
    },
    null,
    2
  )}\n`

  await atomicWriteFile(statePath, serialized)
}

export async function removeSubStoreRuntimeState(workDir: string): Promise<void> {
  await rm(subStoreRuntimeStatePath(workDir), { force: true })
}

export async function hasSubStoreRuntimeOverride(
  workDir: string,
  backendPath: string
): Promise<boolean> {
  if (!existsSync(backendPath)) return false

  const state = await readSubStoreRuntimeState(workDir)

  if (!state) return false

  try {
    const backend = await readFile(backendPath)

    return sha256Buffer(backend) === state.sha256
  } catch {
    return false
  }
}
