import { existsSync } from 'fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  mihomoSpecificRuntimePaths,
  sha256Buffer,
  writeMihomoSpecificRuntimeState
} from './mihomoRuntime'
import { resolveMihomoRuntimeLifecycle } from './mihomoRuntimeLifecycle'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clash-party-mihomo-lifecycle-'))
  tempDirs.push(dir)
  return dir
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)

  if (process.platform !== 'win32') {
    await chmod(filePath, 0o755)
  }
}

function legacyBinaryPath(dir: string): string {
  return path.join(dir, 'legacy', `mihomo-specific${process.platform === 'win32' ? '.exe' : ''}`)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Mihomo runtime lifecycle', () => {
  it('keeps bundled core selection unchanged', async () => {
    const dir = await makeTempDir()
    let verifierCalled = false

    const result = await resolveMihomoRuntimeLifecycle({
      baseDataDir: dir,
      requestedCore: 'mihomo',
      requestedCorePath: '/app/mihomo',
      bundledCorePath: '/app/mihomo',
      legacyBinaryPath: legacyBinaryPath(dir),
      verifyIdentity: async () => {
        verifierCalled = true
      }
    })

    expect(result).toEqual({
      requestedCore: 'mihomo',
      activeCore: 'mihomo',
      activePath: '/app/mihomo',
      fallback: false
    })
    expect(verifierCalled).toBe(false)
  })

  it('migrates a matching legacy specific runtime before resolving it', async () => {
    const dir = await makeTempDir()
    const legacyPath = legacyBinaryPath(dir)
    const runtime = mihomoSpecificRuntimePaths(dir)

    await writeExecutable(legacyPath, 'legacy-specific-runtime')

    let verifiedPath: string | undefined

    const result = await resolveMihomoRuntimeLifecycle({
      baseDataDir: dir,
      requestedCore: 'mihomo-specific',
      requestedCorePath: legacyPath,
      bundledCorePath: '/app/mihomo',
      legacyBinaryPath: legacyPath,
      requestedVersion: 'v1.19.30-custom.5',
      verifyIdentity: async (binaryPath, expected) => {
        verifiedPath = binaryPath
        expect(expected.version).toBe('v1.19.30-custom.5')
        expect(expected.source).toBe('custom')
      }
    })

    expect(result.fallback).toBe(false)
    expect(result.activeCore).toBe('mihomo-specific')
    expect(result.activePath).toBe(runtime.binaryPath)
    expect(result.activeVersion).toBe('v1.19.30-custom.5')
    expect(result.activeSource).toBe('custom')

    expect(verifiedPath).toBeDefined()
    expect(existsSync(legacyPath)).toBe(true)
    expect(await readFile(legacyPath, 'utf8')).toBe('legacy-specific-runtime')
    expect(await readFile(runtime.binaryPath, 'utf8')).toBe('legacy-specific-runtime')
  })

  it('falls back to bundled core when legacy identity verification fails', async () => {
    const dir = await makeTempDir()
    const legacyPath = legacyBinaryPath(dir)
    const runtime = mihomoSpecificRuntimePaths(dir)

    await writeExecutable(legacyPath, 'wrong-legacy-runtime')

    let migrationError: unknown

    const result = await resolveMihomoRuntimeLifecycle({
      baseDataDir: dir,
      requestedCore: 'mihomo-specific',
      requestedCorePath: legacyPath,
      bundledCorePath: '/app/mihomo',
      legacyBinaryPath: legacyPath,
      requestedVersion: 'v1.19.30-custom.5',
      requestedSource: 'custom',
      verifyIdentity: async () => {
        throw new Error('identity mismatch')
      },
      onMigrationError: (error) => {
        migrationError = error
      }
    })

    expect(migrationError).toBeInstanceOf(Error)
    expect(result).toEqual({
      requestedCore: 'mihomo-specific',
      requestedVersion: 'v1.19.30-custom.5',
      requestedSource: 'custom',
      activeCore: 'mihomo',
      activePath: '/app/mihomo',
      fallback: true,
      fallbackReason: 'runtime-missing'
    })

    expect(existsSync(legacyPath)).toBe(true)
    expect(existsSync(runtime.binaryPath)).toBe(false)
    expect(existsSync(runtime.statePath)).toBe(false)
  })

  it('falls back while preserving desired selection when legacy runtime is missing', async () => {
    const dir = await makeTempDir()

    const result = await resolveMihomoRuntimeLifecycle({
      baseDataDir: dir,
      requestedCore: 'mihomo-specific',
      requestedCorePath: legacyBinaryPath(dir),
      bundledCorePath: '/app/mihomo',
      legacyBinaryPath: legacyBinaryPath(dir),
      requestedVersion: 'v1.19.30-custom.5'
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

  it('uses an already-valid persistent runtime without invoking legacy verifier', async () => {
    const dir = await makeTempDir()
    const runtime = mihomoSpecificRuntimePaths(dir)
    const binary = Buffer.from('current-specific-runtime')

    await writeExecutable(runtime.binaryPath, binary.toString())

    await writeMihomoSpecificRuntimeState(dir, {
      version: 'v1.19.30',
      source: 'official',
      sha256: sha256Buffer(binary),
      platform: process.platform,
      arch: process.arch
    })

    let verifierCalled = false

    const result = await resolveMihomoRuntimeLifecycle({
      baseDataDir: dir,
      requestedCore: 'mihomo-specific',
      requestedCorePath: legacyBinaryPath(dir),
      bundledCorePath: '/app/mihomo',
      legacyBinaryPath: legacyBinaryPath(dir),
      requestedVersion: 'v1.19.30',
      requestedSource: 'official',
      verifyIdentity: async () => {
        verifierCalled = true
      }
    })

    expect(verifierCalled).toBe(false)
    expect(result.fallback).toBe(false)
    expect(result.activePath).toBe(runtime.binaryPath)
    expect(result.activeVersion).toBe('v1.19.30')
    expect(result.activeSource).toBe('official')
  })

  it('serializes concurrent legacy migration attempts for the shared runtime slot', async () => {
    const dir = await makeTempDir()
    const legacyPath = legacyBinaryPath(dir)
    const runtime = mihomoSpecificRuntimePaths(dir)

    await writeExecutable(legacyPath, 'legacy-specific-runtime')

    let verifierCalls = 0

    const resolveRuntime = async () =>
      await resolveMihomoRuntimeLifecycle({
        baseDataDir: dir,
        requestedCore: 'mihomo-specific',
        requestedCorePath: legacyPath,
        bundledCorePath: '/app/mihomo',
        legacyBinaryPath: legacyPath,
        requestedVersion: 'v1.19.30-custom.5',
        requestedSource: 'custom',
        verifyIdentity: async () => {
          verifierCalls += 1
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
      })

    const [first, second] = await Promise.all([resolveRuntime(), resolveRuntime()])

    expect(verifierCalls).toBe(1)
    expect(first.fallback).toBe(false)
    expect(second.fallback).toBe(false)
    expect(first.activePath).toBe(runtime.binaryPath)
    expect(second.activePath).toBe(runtime.binaryPath)
    expect(await readFile(runtime.binaryPath, 'utf8')).toBe('legacy-specific-runtime')
  })

  it('does not let a migration error observer failure prevent bundled fallback', async () => {
    const dir = await makeTempDir()
    const legacyPath = legacyBinaryPath(dir)

    await writeExecutable(legacyPath, 'wrong-legacy-runtime')

    let observerCalled = false

    const result = await resolveMihomoRuntimeLifecycle({
      baseDataDir: dir,
      requestedCore: 'mihomo-specific',
      requestedCorePath: legacyPath,
      bundledCorePath: '/app/mihomo',
      legacyBinaryPath: legacyPath,
      requestedVersion: 'v1.19.30-custom.5',
      requestedSource: 'custom',
      verifyIdentity: async () => {
        throw new Error('identity mismatch')
      },
      onMigrationError: async () => {
        observerCalled = true
        throw new Error('observer failed')
      }
    })

    expect(observerCalled).toBe(true)
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
})
