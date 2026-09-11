import { existsSync } from 'fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupMihomoRuntimeBackup,
  cleanupMihomoRuntimeStaging,
  commitStagedMihomoRuntime,
  mihomoRuntimeInstallPaths,
  migrateLegacyMihomoRuntime,
  restoreMihomoRuntime,
  validateMihomoRuntimeBinary
} from './mihomoRuntimeInstall'
import {
  mihomoSpecificRuntimePaths,
  readMihomoSpecificRuntimeState,
  sha256Buffer,
  writeMihomoSpecificRuntimeState,
  type MihomoSpecificRuntimeState
} from './mihomoRuntime'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'clash-party-mihomo-install-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)

  if (process.platform !== 'win32') {
    await chmod(filePath, 0o755)
  }
}

function runtimeState(content: string, version = 'v1.19.30-custom.6'): MihomoSpecificRuntimeState {
  return {
    version,
    source: 'custom',
    sha256: sha256Buffer(Buffer.from(content)),
    platform: process.platform,
    arch: process.arch
  }
}

describe('Mihomo runtime transaction', () => {
  it('validates a staged runtime binary', async () => {
    const paths = mihomoRuntimeInstallPaths(tempDir)

    await writeExecutable(paths.stagingBinaryPath, 'new-runtime')

    await expect(validateMihomoRuntimeBinary(paths.stagingBinaryPath)).resolves.toBeUndefined()

    await writeFile(paths.stagingBinaryPath, '')

    await expect(validateMihomoRuntimeBinary(paths.stagingBinaryPath)).rejects.toThrow(
      'Mihomo runtime is missing or empty'
    )
  })

  it('commits the binary before the runtime state', async () => {
    const paths = mihomoRuntimeInstallPaths(tempDir)
    const state = runtimeState('new-runtime')
    let binarySeenByStateWriter: string | undefined

    await writeExecutable(paths.stagingBinaryPath, 'new-runtime')

    const observingWriter = async (
      baseDataDir: string,
      nextState: MihomoSpecificRuntimeState
    ): Promise<void> => {
      binarySeenByStateWriter = await readFile(paths.binaryPath, 'utf8')
      await writeMihomoSpecificRuntimeState(baseDataDir, nextState)
    }

    await commitStagedMihomoRuntime(tempDir, state, {
      stateWriter: observingWriter
    })

    expect(binarySeenByStateWriter).toBe('new-runtime')
    expect(await readFile(paths.binaryPath, 'utf8')).toBe('new-runtime')
    expect(await readMihomoSpecificRuntimeState(tempDir)).toEqual(state)
    expect(existsSync(paths.backupDir)).toBe(false)
  })

  it('rejects a staged binary whose checksum does not match the state', async () => {
    const paths = mihomoRuntimeInstallPaths(tempDir)

    await writeExecutable(paths.stagingBinaryPath, 'different-runtime')

    await expect(
      commitStagedMihomoRuntime(tempDir, runtimeState('expected-runtime'))
    ).rejects.toThrow('checksum does not match')

    expect(await readFile(paths.stagingBinaryPath, 'utf8')).toBe('different-runtime')
  })

  it('restores the previous binary and state when state commit fails', async () => {
    const paths = mihomoRuntimeInstallPaths(tempDir)
    const oldState = runtimeState('old-runtime', 'v1.19.30-custom.5')
    const newState = runtimeState('new-runtime', 'v1.19.30-custom.6')

    await writeExecutable(paths.binaryPath, 'old-runtime')
    await writeMihomoSpecificRuntimeState(tempDir, oldState)
    await writeExecutable(paths.stagingBinaryPath, 'new-runtime')

    const failingWriter = async (): Promise<void> => {
      throw new Error('simulated state write failure')
    }

    await expect(
      commitStagedMihomoRuntime(tempDir, newState, {
        stateWriter: failingWriter
      })
    ).rejects.toThrow('simulated state write failure')

    expect(await readFile(paths.binaryPath, 'utf8')).toBe('old-runtime')
    expect(await readMihomoSpecificRuntimeState(tempDir)).toEqual(oldState)
    expect(existsSync(paths.backupDir)).toBe(false)
  })

  it('preserves backup material when rollback itself fails', async () => {
    const paths = mihomoRuntimeInstallPaths(tempDir)
    const oldState = runtimeState('old-runtime', 'v1.19.30-custom.5')
    const newState = runtimeState('new-runtime', 'v1.19.30-custom.6')

    await writeExecutable(paths.binaryPath, 'old-runtime')
    await writeMihomoSpecificRuntimeState(tempDir, oldState)
    await writeExecutable(paths.stagingBinaryPath, 'new-runtime')

    const failingWriter = async (): Promise<void> => {
      throw new Error('simulated state write failure')
    }

    const failingRestore = async (): Promise<void> => {
      throw new Error('simulated rollback failure')
    }

    await expect(
      commitStagedMihomoRuntime(tempDir, newState, {
        stateWriter: failingWriter,
        restoreRuntime: failingRestore
      })
    ).rejects.toThrow('rollback also failed')

    expect(await readFile(paths.backupBinaryPath, 'utf8')).toBe('old-runtime')

    const backupState = JSON.parse(
      await readFile(paths.backupStatePath, 'utf8')
    ) as MihomoSpecificRuntimeState

    expect(backupState).toEqual(oldState)
    expect(existsSync(paths.backupDir)).toBe(true)
  })

  it('can restore a runtime that had no previous state marker', async () => {
    const paths = mihomoRuntimeInstallPaths(tempDir)

    await writeExecutable(paths.binaryPath, 'old-runtime')
    await mkdir(paths.backupDir, { recursive: true })
    await writeFile(paths.backupBinaryPath, 'old-runtime')

    await restoreMihomoRuntime(paths, {
      hadBinary: true,
      hadState: false
    })

    expect(await readFile(paths.binaryPath, 'utf8')).toBe('old-runtime')
    await expect(readMihomoSpecificRuntimeState(tempDir)).resolves.toBeUndefined()
  })

  it('cleans staging and backup independently', async () => {
    const paths = mihomoRuntimeInstallPaths(tempDir)

    await mkdir(paths.stagingDir, { recursive: true })
    await mkdir(paths.backupDir, { recursive: true })

    await cleanupMihomoRuntimeStaging(paths)

    expect(existsSync(paths.stagingDir)).toBe(false)
    expect(existsSync(paths.backupDir)).toBe(true)

    await cleanupMihomoRuntimeBackup(paths)

    expect(existsSync(paths.backupDir)).toBe(false)
  })
})

describe('Mihomo legacy runtime migration', () => {
  it('verifies, copies and commits a legacy runtime without deleting it', async () => {
    const legacyPath = path.join(tempDir, 'legacy', 'mihomo-specific')
    const runtime = mihomoSpecificRuntimePaths(tempDir)
    let verifiedBinaryPath: string | undefined
    let verifiedVersion: string | undefined

    await writeExecutable(legacyPath, 'legacy-runtime')

    const result = await migrateLegacyMihomoRuntime({
      baseDataDir: tempDir,
      legacyBinaryPath: legacyPath,
      version: 'v1.19.30-custom.5',
      source: 'custom',
      verifyIdentity: async (binaryPath, expected) => {
        verifiedBinaryPath = binaryPath
        verifiedVersion = expected.version
        expect(await readFile(binaryPath, 'utf8')).toBe('legacy-runtime')
        expect(expected.source).toBe('custom')
        expect(expected.platform).toBe(process.platform)
        expect(expected.arch).toBe(process.arch)
      }
    })

    expect(result).toEqual({ status: 'migrated' })
    expect(verifiedBinaryPath).toBeDefined()
    expect(verifiedVersion).toBe('v1.19.30-custom.5')
    expect(await readFile(runtime.binaryPath, 'utf8')).toBe('legacy-runtime')
    expect(await readFile(legacyPath, 'utf8')).toBe('legacy-runtime')

    const state = await readMihomoSpecificRuntimeState(tempDir)

    expect(state?.version).toBe('v1.19.30-custom.5')
    expect(state?.source).toBe('custom')
  })

  it('does not migrate when legacy identity verification fails', async () => {
    const legacyPath = path.join(tempDir, 'legacy', 'mihomo-specific')
    const runtime = mihomoSpecificRuntimePaths(tempDir)
    const installPaths = mihomoRuntimeInstallPaths(tempDir)

    await writeExecutable(legacyPath, 'wrong-runtime')

    await expect(
      migrateLegacyMihomoRuntime({
        baseDataDir: tempDir,
        legacyBinaryPath: legacyPath,
        version: 'v1.19.30-custom.5',
        source: 'custom',
        verifyIdentity: async () => {
          throw new Error('legacy runtime identity mismatch')
        }
      })
    ).rejects.toThrow('legacy runtime identity mismatch')

    expect(existsSync(runtime.binaryPath)).toBe(false)
    await expect(readMihomoSpecificRuntimeState(tempDir)).resolves.toBeUndefined()
    expect(await readFile(legacyPath, 'utf8')).toBe('wrong-runtime')
    expect(existsSync(installPaths.stagingDir)).toBe(false)
  })

  it('does nothing when the requested persistent runtime is already valid', async () => {
    const runtime = mihomoSpecificRuntimePaths(tempDir)
    const state = runtimeState('current-runtime')
    let verifierCalled = false

    await writeExecutable(runtime.binaryPath, 'current-runtime')
    await writeMihomoSpecificRuntimeState(tempDir, state)

    const result = await migrateLegacyMihomoRuntime({
      baseDataDir: tempDir,
      legacyBinaryPath: path.join(tempDir, 'legacy', 'mihomo-specific'),
      version: state.version,
      source: state.source,
      verifyIdentity: async () => {
        verifierCalled = true
      }
    })

    expect(result).toEqual({ status: 'already-valid' })
    expect(verifierCalled).toBe(false)
    expect(await readFile(runtime.binaryPath, 'utf8')).toBe('current-runtime')
  })

  it('reports a missing legacy runtime without changing persistent state', async () => {
    let verifierCalled = false

    const result = await migrateLegacyMihomoRuntime({
      baseDataDir: tempDir,
      legacyBinaryPath: path.join(tempDir, 'legacy', 'mihomo-specific'),
      version: 'v1.19.30-custom.5',
      source: 'custom',
      verifyIdentity: async () => {
        verifierCalled = true
      }
    })

    expect(result).toEqual({ status: 'legacy-missing' })
    expect(verifierCalled).toBe(false)
    await expect(readMihomoSpecificRuntimeState(tempDir)).resolves.toBeUndefined()
  })
})
