import { existsSync } from 'fs'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installPreparedMihomoRuntime, migrateLegacyMihomoRuntime } from './mihomoRuntimeInstall'
import { mihomoSpecificRuntimePaths, readMihomoSpecificRuntimeState } from './mihomoRuntime'

describe('Mihomo prepared runtime installation', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mihomo-install-flow-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('verifies and commits a prepared runtime before returning success', async () => {
    let stopCount = 0
    let restartCount = 0
    let verifiedPath = ''

    await installPreparedMihomoRuntime({
      baseDataDir: tempDir,
      version: 'v1.19.30-custom.5',
      source: 'custom',
      prepareStagedBinary: async (paths) => {
        await writeFile(paths.stagingBinaryPath, 'new-runtime')
      },
      verifyIdentity: async (binaryPath, expected) => {
        verifiedPath = binaryPath
        expect(expected).toEqual({
          version: 'v1.19.30-custom.5',
          source: 'custom',
          platform: process.platform,
          arch: process.arch
        })
      },
      stopBeforeCommit: async () => {
        stopCount += 1
      },
      restartPreviousRuntime: async () => {
        restartCount += 1
      }
    })

    const runtime = mihomoSpecificRuntimePaths(tempDir)
    const state = await readMihomoSpecificRuntimeState(tempDir)

    expect(verifiedPath).not.toBe('')
    expect(await readFile(runtime.binaryPath, 'utf8')).toBe('new-runtime')
    expect(state?.version).toBe('v1.19.30-custom.5')
    expect(state?.source).toBe('custom')
    expect(state?.platform).toBe(process.platform)
    expect(state?.arch).toBe(process.arch)
    expect(stopCount).toBe(1)
    expect(restartCount).toBe(0)
  })

  it('does not stop the running core when preparation or identity verification fails', async () => {
    let stopCount = 0
    let restartCount = 0

    await expect(
      installPreparedMihomoRuntime({
        baseDataDir: tempDir,
        version: 'v1.19.30-custom.5',
        source: 'custom',
        prepareStagedBinary: async (paths) => {
          await writeFile(paths.stagingBinaryPath, 'wrong-runtime')
        },
        verifyIdentity: async () => {
          throw new Error('identity mismatch')
        },
        stopBeforeCommit: async () => {
          stopCount += 1
        },
        restartPreviousRuntime: async () => {
          restartCount += 1
        }
      })
    ).rejects.toThrow('identity mismatch')

    const runtime = mihomoSpecificRuntimePaths(tempDir)

    expect(stopCount).toBe(0)
    expect(restartCount).toBe(0)
    expect(existsSync(runtime.binaryPath)).toBe(false)
    expect(existsSync(runtime.statePath)).toBe(false)
  })

  it('restarts the previous runtime when commit fails after the stop boundary', async () => {
    let stopCount = 0
    let restartCount = 0

    await expect(
      installPreparedMihomoRuntime({
        baseDataDir: tempDir,
        version: 'v1.19.30-custom.5',
        source: 'custom',
        prepareStagedBinary: async (paths) => {
          await writeFile(paths.stagingBinaryPath, 'new-runtime')
        },
        verifyIdentity: async () => undefined,
        stopBeforeCommit: async () => {
          stopCount += 1
        },
        restartPreviousRuntime: async () => {
          restartCount += 1
        },
        commitRuntime: async () => {
          throw new Error('commit failed')
        }
      })
    ).rejects.toThrow('commit failed')

    expect(stopCount).toBe(1)
    expect(restartCount).toBe(1)
  })

  it('serializes legacy migration behind an in-progress prepared install', async () => {
    let releasePreparation: (() => void) | undefined
    let signalPreparationStarted: (() => void) | undefined

    const preparationStarted = new Promise<void>((resolve) => {
      signalPreparationStarted = resolve
    })

    const preparationGate = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })

    const install = installPreparedMihomoRuntime({
      baseDataDir: tempDir,
      version: 'v1.19.30-custom.5',
      source: 'custom',
      prepareStagedBinary: async (paths) => {
        await writeFile(paths.stagingBinaryPath, 'installed-runtime')
        signalPreparationStarted?.()
        await preparationGate
      },
      verifyIdentity: async () => undefined
    })

    await preparationStarted

    let migrationSettled = false

    const migration = migrateLegacyMihomoRuntime({
      baseDataDir: tempDir,
      legacyBinaryPath: path.join(tempDir, 'missing', 'mihomo-specific'),
      version: 'v1.19.30-custom.5',
      source: 'custom',
      verifyIdentity: async () => undefined
    }).then((result) => {
      migrationSettled = true
      return result
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(migrationSettled).toBe(false)

    releasePreparation?.()

    await install
    await expect(migration).resolves.toEqual({ status: 'already-valid' })
    expect(migrationSettled).toBe(true)
  })
})
