import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installSpecificMihomoCore } from './mihomoSpecificInstall'

const mocks = vi.hoisted(() => ({
  hasCoreProcess: vi.fn(),
  restartCore: vi.fn(),
  patchAppConfig: vi.fn(),
  clearVersionCache: vi.fn(),
  installCustomMihomoCore: vi.fn(),
  installMihomoCore: vi.fn()
}))

vi.mock('../core/manager', () => ({
  hasCoreProcess: mocks.hasCoreProcess,
  restartCore: mocks.restartCore
}))

vi.mock('../config', () => ({
  patchAppConfig: mocks.patchAppConfig
}))

vi.mock('../utils/github', () => ({
  clearVersionCache: mocks.clearVersionCache,
  installCustomMihomoCore: mocks.installCustomMihomoCore,
  installMihomoCore: mocks.installMihomoCore
}))

describe('Mihomo specific runtime install orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasCoreProcess.mockReturnValue(true)
    mocks.installMihomoCore.mockResolvedValue(undefined)
    mocks.installCustomMihomoCore.mockResolvedValue(undefined)
    mocks.patchAppConfig.mockResolvedValue(undefined)
    mocks.restartCore.mockResolvedValue(undefined)
  })

  it('installs an official runtime before committing User Intent', async () => {
    await installSpecificMihomoCore('v1.19.30', 'official')

    expect(mocks.clearVersionCache).toHaveBeenCalledWith('MetaCubeX', 'mihomo')
    expect(mocks.installMihomoCore).toHaveBeenCalledWith('v1.19.30')
    expect(mocks.installCustomMihomoCore).not.toHaveBeenCalled()

    expect(mocks.patchAppConfig).toHaveBeenCalledWith({
      core: 'mihomo-specific',
      specificVersion: 'v1.19.30',
      specificSource: 'official'
    })

    expect(mocks.installMihomoCore.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.patchAppConfig.mock.invocationCallOrder[0]
    )
  })

  it('installs a custom runtime before committing User Intent', async () => {
    await installSpecificMihomoCore('v1.19.30-custom.6', 'custom')

    expect(mocks.clearVersionCache).toHaveBeenCalledWith('ABOLUOmathh', 'mihomo')
    expect(mocks.installCustomMihomoCore).toHaveBeenCalledWith('v1.19.30-custom.6')

    expect(mocks.patchAppConfig).toHaveBeenCalledWith({
      core: 'mihomo-specific',
      specificVersion: 'v1.19.30-custom.6',
      specificSource: 'custom'
    })
  })

  it('does not patch intent or add IPC recovery when runtime installation fails', async () => {
    const installError = new Error('runtime install failed')
    mocks.installMihomoCore.mockRejectedValueOnce(installError)

    await expect(installSpecificMihomoCore('v1.19.30', 'official')).rejects.toBe(installError)

    expect(mocks.patchAppConfig).not.toHaveBeenCalled()
    expect(mocks.restartCore).not.toHaveBeenCalled()

    // Only the initial running-state snapshot is needed.
    expect(mocks.hasCoreProcess).toHaveBeenCalledTimes(1)
  })

  it('restarts the previous intent path when intent persistence fails after the core was stopped', async () => {
    const patchError = new Error('config write failed')

    mocks.hasCoreProcess.mockReturnValueOnce(true).mockReturnValueOnce(false)

    mocks.patchAppConfig.mockRejectedValueOnce(patchError)

    await expect(installSpecificMihomoCore('v1.19.30', 'official')).rejects.toBe(patchError)

    expect(mocks.restartCore).toHaveBeenCalledOnce()
  })

  it('does not restart when intent persistence fails but the old core is still running', async () => {
    const patchError = new Error('config write failed')

    mocks.hasCoreProcess.mockReturnValueOnce(true).mockReturnValueOnce(true)

    mocks.patchAppConfig.mockRejectedValueOnce(patchError)

    await expect(installSpecificMihomoCore('v1.19.30', 'official')).rejects.toBe(patchError)

    expect(mocks.restartCore).not.toHaveBeenCalled()
  })

  it('does not restart when intent persistence fails if the core was not running before installation', async () => {
    const patchError = new Error('config write failed')

    mocks.hasCoreProcess.mockReturnValueOnce(false)
    mocks.patchAppConfig.mockRejectedValueOnce(patchError)

    await expect(installSpecificMihomoCore('v1.19.30', 'official')).rejects.toBe(patchError)

    expect(mocks.restartCore).not.toHaveBeenCalled()
    expect(mocks.hasCoreProcess).toHaveBeenCalledTimes(1)
  })

  it('preserves both persistence and recovery errors when recovery also fails', async () => {
    const patchError = new Error('config write failed')
    const restartError = new Error('restart failed')

    mocks.hasCoreProcess.mockReturnValueOnce(true).mockReturnValueOnce(false)

    mocks.patchAppConfig.mockRejectedValueOnce(patchError)
    mocks.restartCore.mockRejectedValueOnce(restartError)

    let thrown: unknown

    try {
      await installSpecificMihomoCore('v1.19.30', 'official')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AggregateError)

    const aggregate = thrown as AggregateError
    expect(aggregate.errors).toEqual([patchError, restartError])
  })
})
