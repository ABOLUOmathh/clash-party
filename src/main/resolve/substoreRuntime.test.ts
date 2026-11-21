import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SUBSTORE_RUNTIME_ASSET,
  SUBSTORE_RUNTIME_REPO,
  getSubStoreBackendChecksum,
  hasSubStoreRuntimeOverride,
  parseSubStoreReleaseManifest,
  readSubStoreRuntimeState,
  removeSubStoreRuntimeState,
  sha256Buffer,
  verifySubStoreBackendChecksum,
  writeSubStoreRuntimeState
} from './substoreRuntime'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'clash-party-substore-runtime-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('Sub-Store release metadata', () => {
  it('parses and validates the custom release manifest', () => {
    const manifest = parseSubStoreReleaseManifest(
      JSON.stringify({
        releaseVersion: '2.37.0-custom.3',
        upstreamBase: '2.37.0',
        sourceCommit: 'df553ceb8cbe21cf153ff7bcc6998877b61fdedf',
        mihomoFallbackUserAgentVersion: 'v1.19.30',
        runtimeAssets: ['sub-store.min.js', 'sub-store.bundle.js']
      }),
      '2.37.0-custom.3'
    )

    expect(manifest.releaseVersion).toBe('2.37.0-custom.3')
    expect(manifest.runtimeAssets).toContain(SUBSTORE_RUNTIME_ASSET)
  })

  it('rejects a release-version mismatch', () => {
    expect(() =>
      parseSubStoreReleaseManifest(
        JSON.stringify({
          releaseVersion: '2.37.0-custom.3',
          upstreamBase: '2.37.0',
          sourceCommit: 'abc',
          mihomoFallbackUserAgentVersion: 'v1.19.30',
          runtimeAssets: ['sub-store.bundle.js']
        }),
        '2.37.0-custom.4'
      )
    ).toThrow('release version mismatch')
  })

  it('extracts the backend checksum', () => {
    const checksum = 'b61e12d76cb13b7a6e6197c98f57e3bde5c76985bae2684168eb3d472c30cd5c'

    expect(getSubStoreBackendChecksum(`${checksum}  sub-store.bundle.js\n`)).toBe(checksum)
  })
})

describe('Sub-Store runtime integrity', () => {
  it('verifies SHA256', () => {
    const data = Buffer.from('runtime-backend')
    const checksum = sha256Buffer(data)

    expect(() => verifySubStoreBackendChecksum(data, checksum)).not.toThrow()
  })

  it('rejects a SHA256 mismatch', () => {
    expect(() =>
      verifySubStoreBackendChecksum(Buffer.from('runtime-backend'), '0'.repeat(64))
    ).toThrow('SHA256 mismatch')
  })
})

describe('Sub-Store runtime state', () => {
  it('writes and reads runtime state atomically', async () => {
    const state = {
      version: '2.37.0-custom.3',
      source: SUBSTORE_RUNTIME_REPO,
      asset: SUBSTORE_RUNTIME_ASSET,
      sha256: 'b61e12d76cb13b7a6e6197c98f57e3bde5c76985bae2684168eb3d472c30cd5c',
      sourceCommit: 'df553ceb8cbe21cf153ff7bcc6998877b61fdedf'
    } as const

    await writeSubStoreRuntimeState(tempDir, state)

    await expect(readSubStoreRuntimeState(tempDir)).resolves.toEqual(state)

    const updatedState = {
      ...state,
      version: '2.37.0-custom.4',
      sha256: '2'.repeat(64)
    } as const

    await writeSubStoreRuntimeState(tempDir, updatedState)

    await expect(readSubStoreRuntimeState(tempDir)).resolves.toEqual(updatedState)
  })

  it('requires valid state, backend, and matching checksum for override', async () => {
    const backendPath = path.join(tempDir, 'sub-store.bundle.cjs')
    const backend = Buffer.from('runtime-backend')

    await writeSubStoreRuntimeState(tempDir, {
      version: '2.37.0-custom.3',
      source: SUBSTORE_RUNTIME_REPO,
      asset: SUBSTORE_RUNTIME_ASSET,
      sha256: sha256Buffer(backend)
    })

    await expect(hasSubStoreRuntimeOverride(tempDir, backendPath)).resolves.toBe(false)

    await writeFile(backendPath, backend)

    await expect(hasSubStoreRuntimeOverride(tempDir, backendPath)).resolves.toBe(true)
  })

  it('rejects a runtime override when the backend checksum does not match', async () => {
    const backendPath = path.join(tempDir, 'sub-store.bundle.cjs')
    const backend = Buffer.from('runtime-backend')

    await writeFile(backendPath, backend)

    await writeSubStoreRuntimeState(tempDir, {
      version: '2.37.0-custom.3',
      source: SUBSTORE_RUNTIME_REPO,
      asset: SUBSTORE_RUNTIME_ASSET,
      sha256: '0'.repeat(64)
    })

    await expect(hasSubStoreRuntimeOverride(tempDir, backendPath)).resolves.toBe(false)
  })

  it('removes runtime state', async () => {
    await writeSubStoreRuntimeState(tempDir, {
      version: '2.37.0-custom.3',
      source: SUBSTORE_RUNTIME_REPO,
      asset: SUBSTORE_RUNTIME_ASSET,
      sha256: '1'.repeat(64)
    })

    await removeSubStoreRuntimeState(tempDir)

    await expect(readSubStoreRuntimeState(tempDir)).resolves.toBeUndefined()

    const statePath = path.join(tempDir, 'sub-store-runtime.json')
    await expect(readFile(statePath, 'utf8')).rejects.toThrow()
  })
})
