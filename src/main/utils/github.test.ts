import { mkdir, mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { gzipSync } from 'zlib'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mihomoSpecificRuntimePaths } from '../resolve/mihomoRuntime'
import type {
  InstallPreparedMihomoRuntimeOptions,
  MihomoRuntimeInstallPaths
} from '../resolve/mihomoRuntimeInstall'
import { installCustomMihomoCore, installMihomoCore } from './github'

const mocks = vi.hoisted(() => ({
  platform: vi.fn(),
  hasCoreProcess: vi.fn(),
  restartCore: vi.fn(),
  stopCore: vi.fn(),
  getAppConfig: vi.fn(),
  resolveActiveMihomoRuntime: vi.fn(),
  installPreparedMihomoRuntime: vi.fn(),
  verifyIdentity: vi.fn(),
  dataDir: vi.fn(),
  chromeGet: vi.fn()
}))

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return {
    ...actual,
    platform: mocks.platform
  }
})

vi.mock('../core/manager', () => ({
  hasCoreProcess: mocks.hasCoreProcess,
  restartCore: mocks.restartCore,
  stopCore: mocks.stopCore
}))

vi.mock('../config', () => ({
  getAppConfig: mocks.getAppConfig
}))

vi.mock('../resolve/mihomoActiveRuntime', () => ({
  resolveActiveMihomoRuntime: mocks.resolveActiveMihomoRuntime
}))

vi.mock('../resolve/mihomoRuntimeInstall', () => ({
  installPreparedMihomoRuntime: mocks.installPreparedMihomoRuntime
}))

vi.mock('../resolve/mihomoRuntimeIdentity', () => ({
  verifyMihomoLegacyRuntimeIdentity: mocks.verifyIdentity
}))

vi.mock('./dirs', () => ({
  dataDir: mocks.dataDir
}))

vi.mock('./chromeRequest', () => ({
  get: mocks.chromeGet
}))

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('Mihomo GitHub persistent runtime installer wiring', () => {
  let tempDir = ''
  let stagedBinary = Buffer.alloc(0)
  let lastOptions: InstallPreparedMihomoRuntimeOptions | undefined

  function releaseName(platform: 'linux' | 'win32'): string {
    if (platform === 'linux' && process.arch === 'x64') {
      return 'mihomo-linux-amd64-compatible'
    }
    if (platform === 'linux' && process.arch === 'arm64') {
      return 'mihomo-linux-arm64'
    }
    if (platform === 'win32' && process.arch === 'x64') {
      return 'mihomo-windows-amd64-compatible'
    }
    if (platform === 'win32' && process.arch === 'ia32') {
      return 'mihomo-windows-386'
    }
    if (platform === 'win32' && process.arch === 'arm64') {
      return 'mihomo-windows-arm64'
    }

    throw new Error(`Unsupported test architecture: ${platform}-${process.arch}`)
  }

  async function prepareCandidate(options: InstallPreparedMihomoRuntimeOptions): Promise<Buffer> {
    const stagingDir = path.join(tempDir, 'test-staging')
    const stagingBinaryPath = path.join(stagingDir, 'mihomo')

    await mkdir(stagingDir, { recursive: true })

    const paths: MihomoRuntimeInstallPaths = {
      runtimeDir: path.join(tempDir, 'runtime'),
      binaryPath: path.join(tempDir, 'runtime', 'mihomo'),
      statePath: path.join(tempDir, 'runtime', 'runtime.json'),
      stagingDir,
      stagingBinaryPath,
      backupDir: path.join(tempDir, 'backup'),
      backupBinaryPath: path.join(tempDir, 'backup', 'mihomo'),
      backupStatePath: path.join(tempDir, 'backup', 'runtime.json')
    }

    await options.prepareStagedBinary(paths)

    return await readFile(stagingBinaryPath)
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'github-mihomo-test-'))
    stagedBinary = Buffer.alloc(0)
    lastOptions = undefined

    vi.clearAllMocks()

    mocks.platform.mockReturnValue('linux')
    mocks.dataDir.mockReturnValue(tempDir)
    mocks.hasCoreProcess.mockReturnValue(false)

    mocks.getAppConfig.mockResolvedValue({
      core: 'mihomo',
      specificVersion: undefined,
      specificSource: undefined
    })

    mocks.resolveActiveMihomoRuntime.mockResolvedValue({
      requestedCore: 'mihomo',
      activeCore: 'mihomo',
      activePath: path.join(tempDir, 'bundled', 'mihomo'),
      fallback: false
    })

    mocks.chromeGet.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      data: gzipSync(Buffer.from('linux-runtime'))
    })

    mocks.installPreparedMihomoRuntime.mockImplementation(
      async (options: InstallPreparedMihomoRuntimeOptions) => {
        lastOptions = options
        stagedBinary = await prepareCandidate(options)
      }
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('routes an official release through the persistent runtime transaction', async () => {
    await installMihomoCore('v1.19.30')

    expect(lastOptions).toMatchObject({
      baseDataDir: tempDir,
      version: 'v1.19.30',
      source: 'official',
      platform: 'linux',
      arch: process.arch
    })

    expect(lastOptions?.verifyIdentity).toBe(mocks.verifyIdentity)
    expect(lastOptions?.stopBeforeCommit).toBeUndefined()
    expect(lastOptions?.restartPreviousRuntime).toBeUndefined()
    expect(stagedBinary.toString()).toBe('linux-runtime')

    expect(String(mocks.chromeGet.mock.calls[0]?.[0])).toContain(
      `/MetaCubeX/mihomo/releases/download/v1.19.30/${releaseName('linux')}-v1.19.30.gz`
    )
  })

  it('routes a custom release through the same persistent runtime transaction', async () => {
    await installCustomMihomoCore('v1.19.30-custom.6')

    expect(lastOptions).toMatchObject({
      baseDataDir: tempDir,
      version: 'v1.19.30-custom.6',
      source: 'custom',
      platform: 'linux',
      arch: process.arch
    })

    expect(stagedBinary.toString()).toBe('linux-runtime')

    expect(String(mocks.chromeGet.mock.calls[0]?.[0])).toContain(
      `/ABOLUOmathh/mihomo/releases/download/v1.19.30-custom.6/${releaseName(
        'linux'
      )}-v1.19.30-custom.6.gz`
    )
  })

  it('stops a running persistent specific runtime only at the Windows commit boundary', async () => {
    mocks.platform.mockReturnValue('win32')
    mocks.hasCoreProcess.mockReturnValue(true)

    const persistentRuntime = mihomoSpecificRuntimePaths(tempDir, 'win32')

    mocks.getAppConfig.mockResolvedValue({
      core: 'mihomo-specific',
      specificVersion: 'v1.19.30',
      specificSource: 'official'
    })

    mocks.resolveActiveMihomoRuntime.mockResolvedValue({
      requestedCore: 'mihomo-specific',
      activeCore: 'mihomo-specific',
      activePath: persistentRuntime.binaryPath,
      fallback: false
    })

    const zip = new AdmZip()
    zip.addFile(`${releaseName('win32')}.exe`, Buffer.from('windows-runtime'))

    mocks.chromeGet.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      data: zip.toBuffer()
    })

    mocks.installPreparedMihomoRuntime.mockImplementation(
      async (options: InstallPreparedMihomoRuntimeOptions) => {
        lastOptions = options
        stagedBinary = await prepareCandidate(options)
        await options.stopBeforeCommit?.()
      }
    )

    await installMihomoCore('v1.19.30')

    expect(stagedBinary.toString()).toBe('windows-runtime')
    expect(mocks.stopCore).toHaveBeenCalledOnce()
    expect(mocks.stopCore).toHaveBeenCalledWith(true)
    expect(mocks.restartCore).not.toHaveBeenCalled()
    expect(lastOptions?.restartPreviousRuntime).toEqual(expect.any(Function))
  })

  it('does not stop Windows core when active runtime is bundled fallback', async () => {
    mocks.platform.mockReturnValue('win32')
    mocks.hasCoreProcess.mockReturnValue(true)

    mocks.getAppConfig.mockResolvedValue({
      core: 'mihomo-specific',
      specificVersion: 'v1.19.30',
      specificSource: 'official'
    })

    mocks.resolveActiveMihomoRuntime.mockResolvedValue({
      requestedCore: 'mihomo-specific',
      activeCore: 'mihomo',
      activePath: path.join(tempDir, 'bundled', 'mihomo.exe'),
      fallback: true
    })

    const zip = new AdmZip()
    zip.addFile(`${releaseName('win32')}.exe`, Buffer.from('windows-runtime'))

    mocks.chromeGet.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      data: zip.toBuffer()
    })

    mocks.installPreparedMihomoRuntime.mockImplementation(
      async (options: InstallPreparedMihomoRuntimeOptions) => {
        lastOptions = options
        stagedBinary = await prepareCandidate(options)
        await options.stopBeforeCommit?.()
      }
    )

    await installMihomoCore('v1.19.30')

    expect(stagedBinary.toString()).toBe('windows-runtime')
    expect(mocks.stopCore).not.toHaveBeenCalled()
    expect(mocks.restartCore).not.toHaveBeenCalled()
  })
})
