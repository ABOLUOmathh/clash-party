import { chmod, mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inferLegacyMihomoRuntimeSource,
  mihomoSpecificRuntimePaths,
  readMihomoSpecificRuntimeState,
  resolveMihomoRuntime,
  sha256Buffer,
  validateMihomoSpecificRuntime,
  writeMihomoSpecificRuntimeState,
  type MihomoSpecificRuntimeState
} from './mihomoRuntime'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clash-party-mihomo-runtime-'))
  tempDirs.push(dir)
  return dir
}

async function createValidRuntime(
  baseDir: string,
  {
    version = 'v1.19.30-custom.6',
    source = 'custom',
    platform = process.platform,
    arch = process.arch
  }: {
    version?: string
    source?: 'official' | 'custom'
    platform?: NodeJS.Platform
    arch?: string
  } = {}
): Promise<MihomoSpecificRuntimeState> {
  const paths = mihomoSpecificRuntimePaths(baseDir, platform)
  const binary = Buffer.from('fake-mihomo-runtime')

  await mkdir(paths.dir, { recursive: true })
  await writeFile(paths.binaryPath, binary)

  if (platform !== 'win32') {
    await chmod(paths.binaryPath, 0o755)
  }

  const state: MihomoSpecificRuntimeState = {
    version,
    source,
    sha256: sha256Buffer(binary),
    platform,
    arch
  }

  await writeMihomoSpecificRuntimeState(baseDir, state)
  return state
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Mihomo runtime paths', () => {
  it('stores pinned runtime below the persistent data directory', () => {
    const paths = mihomoSpecificRuntimePaths('/data', 'linux')

    expect(paths.dir).toBe(path.join('/data', 'runtimes', 'mihomo', 'specific'))
    expect(paths.binaryPath).toBe(path.join('/data', 'runtimes', 'mihomo', 'specific', 'mihomo'))
    expect(paths.statePath).toBe(
      path.join('/data', 'runtimes', 'mihomo', 'specific', 'runtime.json')
    )
  })

  it('uses an exe suffix on Windows', () => {
    const paths = mihomoSpecificRuntimePaths('C:\\data', 'win32')

    expect(path.basename(paths.binaryPath)).toBe('mihomo.exe')
  })
})

describe('Mihomo runtime state', () => {
  it('writes and reads normalized runtime state', async () => {
    const dir = await makeTempDir()
    const state = await createValidRuntime(dir)

    const loaded = await readMihomoSpecificRuntimeState(dir, state.platform)

    expect(loaded).toEqual(state)
  })

  it('rejects an invalid runtime state', async () => {
    const dir = await makeTempDir()
    const paths = mihomoSpecificRuntimePaths(dir)

    await mkdir(paths.dir, { recursive: true })
    await writeFile(paths.statePath, '{"version":"broken"}')

    await expect(readMihomoSpecificRuntimeState(dir)).resolves.toBeUndefined()
  })
})

describe('Mihomo runtime validation', () => {
  it('accepts a matching pinned runtime', async () => {
    const dir = await makeTempDir()
    const state = await createValidRuntime(dir)

    const result = await validateMihomoSpecificRuntime(
      dir,
      state.version,
      state.source,
      state.platform,
      state.arch
    )

    expect(result.valid).toBe(true)
  })

  it('rejects a missing runtime binary', async () => {
    const dir = await makeTempDir()

    const result = await validateMihomoSpecificRuntime(
      dir,
      'v1.19.30-custom.6',
      'custom',
      process.platform,
      process.arch
    )

    expect(result).toEqual({
      valid: false,
      reason: 'runtime-missing'
    })
  })

  it('rejects a checksum mismatch', async () => {
    const dir = await makeTempDir()
    const state = await createValidRuntime(dir)
    const paths = mihomoSpecificRuntimePaths(dir, state.platform)

    await writeFile(paths.binaryPath, 'tampered-runtime')

    if (state.platform !== 'win32') {
      await chmod(paths.binaryPath, 0o755)
    }

    const result = await validateMihomoSpecificRuntime(
      dir,
      state.version,
      state.source,
      state.platform,
      state.arch
    )

    expect(result).toEqual({
      valid: false,
      reason: 'checksum-mismatch'
    })
  })

  it('rejects a different requested version', async () => {
    const dir = await makeTempDir()
    const state = await createValidRuntime(dir)

    const result = await validateMihomoSpecificRuntime(
      dir,
      'v1.19.30-custom.999',
      state.source,
      state.platform,
      state.arch
    )

    expect(result).toEqual({
      valid: false,
      reason: 'version-mismatch'
    })
  })
})

describe('Mihomo runtime resolver', () => {
  it('leaves bundled core selection unchanged', async () => {
    const dir = await makeTempDir()

    const result = await resolveMihomoRuntime({
      dataDir: dir,
      requestedCore: 'mihomo',
      requestedCorePath: '/app/mihomo',
      bundledCorePath: '/app/mihomo'
    })

    expect(result).toEqual({
      requestedCore: 'mihomo',
      activeCore: 'mihomo',
      activePath: '/app/mihomo',
      fallback: false
    })
  })

  it('uses a valid pinned runtime', async () => {
    const dir = await makeTempDir()
    const state = await createValidRuntime(dir)
    const paths = mihomoSpecificRuntimePaths(dir, state.platform)

    const result = await resolveMihomoRuntime({
      dataDir: dir,
      requestedCore: 'mihomo-specific',
      requestedCorePath: '/legacy/mihomo-specific',
      bundledCorePath: '/app/mihomo',
      requestedVersion: state.version,
      requestedSource: state.source,
      platform: state.platform,
      arch: state.arch
    })

    expect(result).toEqual({
      requestedCore: 'mihomo-specific',
      requestedVersion: state.version,
      requestedSource: state.source,
      activeCore: 'mihomo-specific',
      activePath: paths.binaryPath,
      activeVersion: state.version,
      activeSource: state.source,
      fallback: false
    })
  })

  it('falls back without changing the requested pinned version', async () => {
    const dir = await makeTempDir()

    const result = await resolveMihomoRuntime({
      dataDir: dir,
      requestedCore: 'mihomo-specific',
      requestedCorePath: '/legacy/mihomo-specific',
      bundledCorePath: '/app/mihomo',
      requestedVersion: 'v1.19.30-custom.5',
      requestedSource: 'custom'
    })

    expect(result).toEqual({
      requestedCore: 'mihomo-specific',
      requestedVersion: 'v1.19.30-custom.5',
      requestedSource: 'custom',
      activeCore: 'mihomo',
      activePath: '/app/mihomo',
      fallback: true,
      fallbackReason: 'runtime-missing'
    })
  })

  it('infers the source only for legacy selection compatibility', async () => {
    expect(inferLegacyMihomoRuntimeSource('v1.19.30-custom.6')).toBe('custom')
    expect(inferLegacyMihomoRuntimeSource('v1.19.30')).toBe('official')
  })
})

describe('Mihomo runtime contract edge cases', () => {
  it('falls back when a specific selection has no version', async () => {
    const dir = await makeTempDir()

    const result = await resolveMihomoRuntime({
      dataDir: dir,
      requestedCore: 'mihomo-specific',
      requestedCorePath: '/legacy/mihomo-specific',
      bundledCorePath: '/app/mihomo'
    })

    expect(result).toEqual({
      requestedCore: 'mihomo-specific',
      requestedVersion: undefined,
      requestedSource: undefined,
      activeCore: 'mihomo',
      activePath: '/app/mihomo',
      fallback: true,
      fallbackReason: 'selection-invalid'
    })
  })

  it('rejects a runtime with an invalid state file', async () => {
    const dir = await makeTempDir()
    const paths = mihomoSpecificRuntimePaths(dir)

    await mkdir(paths.dir, { recursive: true })
    await writeFile(paths.binaryPath, 'fake-runtime')
    await writeFile(paths.statePath, '{"broken":true}')

    const result = await validateMihomoSpecificRuntime(
      dir,
      'v1.19.30-custom.6',
      'custom',
      process.platform,
      process.arch
    )

    expect(result).toEqual({
      valid: false,
      reason: 'runtime-state-invalid'
    })
  })

  it('rejects a different requested source', async () => {
    const dir = await makeTempDir()
    const state = await createValidRuntime(dir)

    const result = await validateMihomoSpecificRuntime(
      dir,
      state.version,
      'official',
      state.platform,
      state.arch
    )

    expect(result).toEqual({
      valid: false,
      reason: 'source-mismatch'
    })
  })

  it('rejects a runtime whose state belongs to a different platform', async () => {
    const dir = await makeTempDir()
    const paths = mihomoSpecificRuntimePaths(dir, process.platform)
    const binary = Buffer.from('fake-mihomo-runtime')

    await mkdir(paths.dir, { recursive: true })
    await writeFile(paths.binaryPath, binary)

    if (process.platform !== 'win32') {
      await chmod(paths.binaryPath, 0o755)
    }

    const otherPlatform: NodeJS.Platform = process.platform === 'linux' ? 'darwin' : 'linux'

    await writeMihomoSpecificRuntimeState(dir, {
      version: 'v1.19.30-custom.6',
      source: 'custom',
      sha256: sha256Buffer(binary),
      platform: otherPlatform,
      arch: process.arch
    })

    const result = await validateMihomoSpecificRuntime(
      dir,
      'v1.19.30-custom.6',
      'custom',
      process.platform,
      process.arch
    )

    expect(result).toEqual({
      valid: false,
      reason: 'platform-mismatch'
    })
  })

  it('rejects a runtime for a different architecture', async () => {
    const dir = await makeTempDir()
    const state = await createValidRuntime(dir)

    const result = await validateMihomoSpecificRuntime(
      dir,
      state.version,
      state.source,
      state.platform,
      `${state.arch}-other`
    )

    expect(result).toEqual({
      valid: false,
      reason: 'arch-mismatch'
    })
  })

  it('accepts a valid official pinned runtime', async () => {
    const dir = await makeTempDir()
    const state = await createValidRuntime(dir, {
      version: 'v1.19.30',
      source: 'official'
    })

    const result = await resolveMihomoRuntime({
      dataDir: dir,
      requestedCore: 'mihomo-specific',
      requestedCorePath: '/legacy/mihomo-specific',
      bundledCorePath: '/app/mihomo',
      requestedVersion: state.version,
      requestedSource: state.source,
      platform: state.platform,
      arch: state.arch
    })

    expect(result.fallback).toBe(false)
    expect(result.activeVersion).toBe('v1.19.30')
    expect(result.activeSource).toBe('official')
  })

  it('rejects a non-executable runtime on Unix', async () => {
    if (process.platform === 'win32') return

    const dir = await makeTempDir()
    const state = await createValidRuntime(dir)
    const paths = mihomoSpecificRuntimePaths(dir, state.platform)

    await chmod(paths.binaryPath, 0o644)

    const result = await validateMihomoSpecificRuntime(
      dir,
      state.version,
      state.source,
      state.platform,
      state.arch
    )

    expect(result).toEqual({
      valid: false,
      reason: 'runtime-not-executable'
    })
  })
})
