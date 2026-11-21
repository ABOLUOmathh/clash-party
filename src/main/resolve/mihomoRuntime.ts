import { createHash } from 'crypto'
import { constants, existsSync } from 'fs'
import { access, mkdir, readFile, rm } from 'fs/promises'
import path from 'path'
import { atomicWriteFile } from '../utils/safeFile'

export type MihomoRuntimeSource = 'official' | 'custom'

export type MihomoRuntimeValidationFailureReason =
  | 'runtime-missing'
  | 'runtime-state-invalid'
  | 'platform-mismatch'
  | 'arch-mismatch'
  | 'version-mismatch'
  | 'source-mismatch'
  | 'checksum-mismatch'
  | 'runtime-unreadable'
  | 'runtime-not-executable'

export type MihomoRuntimeFallbackReason = 'selection-invalid' | MihomoRuntimeValidationFailureReason

export interface MihomoSpecificRuntimeState {
  version: string
  source: MihomoRuntimeSource
  sha256: string
  platform: NodeJS.Platform
  arch: string
}

export interface MihomoSpecificRuntimePaths {
  dir: string
  binaryPath: string
  statePath: string
}

export interface MihomoRuntimeValidationSuccess {
  valid: true
  state: MihomoSpecificRuntimeState
  binaryPath: string
}

export interface MihomoRuntimeValidationFailure {
  valid: false
  reason: MihomoRuntimeValidationFailureReason
}

export type MihomoRuntimeValidation =
  MihomoRuntimeValidationSuccess | MihomoRuntimeValidationFailure

export type MihomoCoreSelection = 'mihomo' | 'mihomo-alpha' | 'mihomo-smart' | 'mihomo-specific'

export interface ResolveMihomoRuntimeOptions {
  dataDir: string
  requestedCore: MihomoCoreSelection
  requestedCorePath: string
  bundledCorePath: string
  requestedVersion?: string
  requestedSource?: MihomoRuntimeSource
  platform?: NodeJS.Platform
  arch?: string
}

export interface ResolvedMihomoRuntime {
  requestedCore: MihomoCoreSelection
  requestedVersion?: string
  requestedSource?: MihomoRuntimeSource

  activeCore: MihomoCoreSelection
  activePath: string
  activeVersion?: string
  activeSource?: MihomoRuntimeSource

  fallback: boolean
  fallbackReason?: MihomoRuntimeFallbackReason
}

export function inferLegacyMihomoRuntimeSource(version: string): MihomoRuntimeSource {
  return version.includes('-custom.') ? 'custom' : 'official'
}

export function mihomoSpecificRuntimePaths(
  baseDataDir: string,
  platform: NodeJS.Platform = process.platform
): MihomoSpecificRuntimePaths {
  const dir = path.join(baseDataDir, 'runtimes', 'mihomo', 'specific')
  const binaryName = `mihomo${platform === 'win32' ? '.exe' : ''}`

  return {
    dir,
    binaryPath: path.join(dir, binaryName),
    statePath: path.join(dir, 'runtime.json')
  }
}

export function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function readMihomoSpecificRuntimeState(
  baseDataDir: string,
  platform: NodeJS.Platform = process.platform
): Promise<MihomoSpecificRuntimeState | undefined> {
  const { statePath } = mihomoSpecificRuntimePaths(baseDataDir, platform)

  if (!existsSync(statePath)) return undefined

  try {
    const value = JSON.parse(
      await readFile(statePath, 'utf8')
    ) as Partial<MihomoSpecificRuntimeState>

    if (
      typeof value.version !== 'string' ||
      value.version.length === 0 ||
      (value.source !== 'official' && value.source !== 'custom') ||
      typeof value.sha256 !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(value.sha256) ||
      typeof value.platform !== 'string' ||
      value.platform.length === 0 ||
      typeof value.arch !== 'string' ||
      value.arch.length === 0
    ) {
      return undefined
    }

    return {
      version: value.version,
      source: value.source,
      sha256: value.sha256.toLowerCase(),
      platform: value.platform as NodeJS.Platform,
      arch: value.arch
    }
  } catch {
    return undefined
  }
}

export async function writeMihomoSpecificRuntimeState(
  baseDataDir: string,
  state: MihomoSpecificRuntimeState
): Promise<void> {
  const { dir, statePath } = mihomoSpecificRuntimePaths(baseDataDir, state.platform)

  await mkdir(dir, { recursive: true })

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

export async function removeMihomoSpecificRuntimeState(
  baseDataDir: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const { statePath } = mihomoSpecificRuntimePaths(baseDataDir, platform)
  await rm(statePath, { force: true })
}

export async function validateMihomoSpecificRuntime(
  baseDataDir: string,
  expectedVersion: string,
  expectedSource: MihomoRuntimeSource,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): Promise<MihomoRuntimeValidation> {
  const { binaryPath } = mihomoSpecificRuntimePaths(baseDataDir, platform)

  if (!existsSync(binaryPath)) {
    return { valid: false, reason: 'runtime-missing' }
  }

  const state = await readMihomoSpecificRuntimeState(baseDataDir, platform)

  if (!state) {
    return { valid: false, reason: 'runtime-state-invalid' }
  }

  if (state.platform !== platform) {
    return { valid: false, reason: 'platform-mismatch' }
  }

  if (state.arch !== arch) {
    return { valid: false, reason: 'arch-mismatch' }
  }

  if (state.version !== expectedVersion) {
    return { valid: false, reason: 'version-mismatch' }
  }

  if (state.source !== expectedSource) {
    return { valid: false, reason: 'source-mismatch' }
  }

  let binary: Buffer

  try {
    binary = await readFile(binaryPath)
  } catch {
    return { valid: false, reason: 'runtime-unreadable' }
  }

  if (sha256Buffer(binary) !== state.sha256) {
    return { valid: false, reason: 'checksum-mismatch' }
  }

  if (platform !== 'win32') {
    try {
      await access(binaryPath, constants.X_OK)
    } catch {
      return { valid: false, reason: 'runtime-not-executable' }
    }
  }

  return {
    valid: true,
    state,
    binaryPath
  }
}

export async function resolveMihomoRuntime(
  options: ResolveMihomoRuntimeOptions
): Promise<ResolvedMihomoRuntime> {
  const {
    dataDir,
    requestedCore,
    requestedCorePath,
    bundledCorePath,
    requestedVersion,
    requestedSource,
    platform = process.platform,
    arch = process.arch
  } = options

  if (requestedCore !== 'mihomo-specific') {
    return {
      requestedCore,
      activeCore: requestedCore,
      activePath: requestedCorePath,
      fallback: false
    }
  }

  if (!requestedVersion) {
    return {
      requestedCore,
      requestedVersion,
      requestedSource,
      activeCore: 'mihomo',
      activePath: bundledCorePath,
      fallback: true,
      fallbackReason: 'selection-invalid'
    }
  }

  const resolvedSource = requestedSource ?? inferLegacyMihomoRuntimeSource(requestedVersion)

  const validation = await validateMihomoSpecificRuntime(
    dataDir,
    requestedVersion,
    resolvedSource,
    platform,
    arch
  )

  if (!validation.valid) {
    return {
      requestedCore,
      requestedVersion,
      requestedSource: resolvedSource,
      activeCore: 'mihomo',
      activePath: bundledCorePath,
      fallback: true,
      fallbackReason: validation.reason
    }
  }

  return {
    requestedCore,
    requestedVersion,
    requestedSource: resolvedSource,
    activeCore: 'mihomo-specific',
    activePath: validation.binaryPath,
    activeVersion: validation.state.version,
    activeSource: validation.state.source,
    fallback: false
  }
}
