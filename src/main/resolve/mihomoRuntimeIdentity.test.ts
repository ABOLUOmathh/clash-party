import { describe, expect, it } from 'vitest'
import {
  nodeArchToGo,
  nodePlatformToGo,
  normalizeMihomoVersion,
  parseMihomoVersionOutput,
  verifyMihomoLegacyRuntimeIdentity,
  verifyMihomoReportedIdentity,
  type MihomoVersionRunner
} from './mihomoRuntimeIdentity'
import type { MihomoLegacyRuntimeIdentity } from './mihomoRuntimeInstall'

function expectedIdentity(
  overrides: Partial<MihomoLegacyRuntimeIdentity> = {}
): MihomoLegacyRuntimeIdentity {
  return {
    version: 'v1.19.30-custom.6',
    source: 'custom',
    platform: process.platform,
    arch: process.arch,
    ...overrides
  }
}

function reportedForCurrentPlatform(version = '1.19.30-custom.6') {
  return {
    version,
    platform: nodePlatformToGo(process.platform),
    arch: nodeArchToGo(process.arch)
  }
}

describe('Mihomo runtime version identity parsing', () => {
  it('parses a custom Mihomo version line', () => {
    expect(
      parseMihomoVersionOutput(
        'Mihomo Meta 1.19.30-custom.6 linux amd64 with go1.26.0 2026-09-11T00:00:00Z\n'
      )
    ).toEqual({
      version: '1.19.30-custom.6',
      platform: 'linux',
      arch: 'amd64'
    })
  })

  it('parses an official version line with a leading v', () => {
    expect(
      parseMihomoVersionOutput(
        'Mihomo Meta v1.19.30 windows amd64 with go1.26.0 Thu Sep 11 00:00:00 UTC 2026\n'
      )
    ).toEqual({
      version: 'v1.19.30',
      platform: 'windows',
      arch: 'amd64'
    })
  })

  it('finds the identity line when other output is present', () => {
    expect(
      parseMihomoVersionOutput(
        'diagnostic line\nMihomo Meta 1.19.30-custom.6 darwin arm64 with go1.26.0 unknown\nUse tags: with_gvisor\n'
      )
    ).toEqual({
      version: '1.19.30-custom.6',
      platform: 'darwin',
      arch: 'arm64'
    })
  })

  it('rejects output without a Mihomo identity line', () => {
    expect(() => parseMihomoVersionOutput('not mihomo')).toThrow(
      'does not contain a Mihomo Meta identity line'
    )
  })

  it('normalizes only a version-number leading v', () => {
    expect(normalizeMihomoVersion('v1.19.30')).toBe('1.19.30')
    expect(normalizeMihomoVersion('1.19.30-custom.6')).toBe('1.19.30-custom.6')
    expect(normalizeMihomoVersion('version-1.19.30')).toBe('version-1.19.30')
  })
})

describe('Mihomo runtime platform identity mapping', () => {
  it('maps supported Node platforms to Go platforms', () => {
    expect(nodePlatformToGo('win32')).toBe('windows')
    expect(nodePlatformToGo('darwin')).toBe('darwin')
    expect(nodePlatformToGo('linux')).toBe('linux')
  })

  it('maps supported Node architectures to Go architectures', () => {
    expect(nodeArchToGo('x64')).toBe('amd64')
    expect(nodeArchToGo('ia32')).toBe('386')
    expect(nodeArchToGo('arm64')).toBe('arm64')
  })
})

describe('Mihomo legacy runtime identity verification', () => {
  it('accepts a matching custom runtime with normalized version syntax', () => {
    expect(() =>
      verifyMihomoReportedIdentity(
        reportedForCurrentPlatform('1.19.30-custom.6'),
        expectedIdentity()
      )
    ).not.toThrow()
  })

  it('accepts a matching official runtime with either leading-v form', () => {
    expect(() =>
      verifyMihomoReportedIdentity(
        reportedForCurrentPlatform('v1.19.30'),
        expectedIdentity({
          version: 'v1.19.30',
          source: 'official'
        })
      )
    ).not.toThrow()
  })

  it('rejects a different runtime version', () => {
    expect(() =>
      verifyMihomoReportedIdentity(
        reportedForCurrentPlatform('1.19.30-custom.5'),
        expectedIdentity()
      )
    ).toThrow('version mismatch')
  })

  it('rejects a different runtime platform', () => {
    const reported = reportedForCurrentPlatform()
    reported.platform = reported.platform === 'linux' ? 'darwin' : 'linux'

    expect(() => verifyMihomoReportedIdentity(reported, expectedIdentity())).toThrow(
      'platform mismatch'
    )
  })

  it('rejects a different runtime architecture', () => {
    const reported = reportedForCurrentPlatform()
    reported.arch = reported.arch === 'amd64' ? 'arm64' : 'amd64'

    expect(() => verifyMihomoReportedIdentity(reported, expectedIdentity())).toThrow(
      'architecture mismatch'
    )
  })

  it('rejects inconsistent legacy source metadata', () => {
    expect(() =>
      verifyMihomoReportedIdentity(
        reportedForCurrentPlatform(),
        expectedIdentity({
          source: 'official'
        })
      )
    ).toThrow('source mismatch')
  })

  it('executes only the Mihomo version command before verification', async () => {
    let invokedBinary: string | undefined
    let invokedArgs: string[] | undefined

    const runner: MihomoVersionRunner = async (binaryPath, args) => {
      invokedBinary = binaryPath
      invokedArgs = args

      return {
        stdout: `Mihomo Meta 1.19.30-custom.6 ${nodePlatformToGo(
          process.platform
        )} ${nodeArchToGo(process.arch)} with go1.26.0 test\n`,
        stderr: ''
      }
    }

    await verifyMihomoLegacyRuntimeIdentity('/staging/mihomo', expectedIdentity(), runner)

    expect(invokedBinary).toBe('/staging/mihomo')
    expect(invokedArgs).toEqual(['-v'])
  })
})
