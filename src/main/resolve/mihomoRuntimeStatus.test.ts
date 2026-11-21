import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMihomoRuntimeStatus } from './mihomoRuntimeStatus'

const mocks = vi.hoisted(() => ({
  getAppConfig: vi.fn(),
  resolveActiveMihomoRuntime: vi.fn()
}))

vi.mock('../config', () => ({
  getAppConfig: mocks.getAppConfig
}))

vi.mock('./mihomoActiveRuntime', () => ({
  resolveActiveMihomoRuntime: mocks.resolveActiveMihomoRuntime
}))

describe('getMihomoRuntimeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports desired specific selection and bundled fallback without exposing activePath', async () => {
    mocks.getAppConfig.mockResolvedValue({
      core: 'mihomo-specific',
      specificVersion: 'v1.19.30-custom.6',
      specificSource: 'custom'
    })

    mocks.resolveActiveMihomoRuntime.mockResolvedValue({
      requestedCore: 'mihomo-specific',
      requestedVersion: 'v1.19.30-custom.6',
      requestedSource: 'custom',
      activeCore: 'mihomo',
      activePath: '/private/runtime/path/mihomo',
      fallback: true,
      fallbackReason: 'runtime-missing'
    })

    const result = await getMihomoRuntimeStatus()

    expect(mocks.resolveActiveMihomoRuntime.mock.calls[0]).toEqual([
      {
        core: 'mihomo-specific',
        specificVersion: 'v1.19.30-custom.6',
        specificSource: 'custom'
      }
    ])

    expect(result).toEqual({
      requestedCore: 'mihomo-specific',
      requestedVersion: 'v1.19.30-custom.6',
      requestedSource: 'custom',
      activeCore: 'mihomo',
      activeVersion: undefined,
      activeSource: undefined,
      fallback: true,
      fallbackReason: 'runtime-missing'
    })

    expect(result).not.toHaveProperty('activePath')
  })

  it('defaults missing core selection to bundled Mihomo', async () => {
    mocks.getAppConfig.mockResolvedValue({})

    mocks.resolveActiveMihomoRuntime.mockResolvedValue({
      requestedCore: 'mihomo',
      activeCore: 'mihomo',
      activePath: '/bundled/mihomo',
      fallback: false
    })

    const result = await getMihomoRuntimeStatus()

    expect(mocks.resolveActiveMihomoRuntime.mock.calls[0]).toEqual([
      {
        core: 'mihomo',
        specificVersion: undefined,
        specificSource: undefined
      }
    ])

    expect(result).toEqual({
      requestedCore: 'mihomo',
      requestedVersion: undefined,
      requestedSource: undefined,
      activeCore: 'mihomo',
      activeVersion: undefined,
      activeSource: undefined,
      fallback: false,
      fallbackReason: undefined
    })
  })
})
