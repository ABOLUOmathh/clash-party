import { execFile } from 'child_process'
import { inferLegacyMihomoRuntimeSource, type MihomoRuntimeSource } from './mihomoRuntime'
import type { MihomoLegacyRuntimeIdentity } from './mihomoRuntimeInstall'

export interface MihomoReportedIdentity {
  version: string
  platform: string
  arch: string
}

export interface MihomoVersionCommandResult {
  stdout: string
  stderr: string
}

export type MihomoVersionRunner = (
  binaryPath: string,
  args: string[]
) => Promise<MihomoVersionCommandResult>

export function normalizeMihomoVersion(version: string): string {
  return version.trim().replace(/^v(?=\d)/, '')
}

export function nodePlatformToGo(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'darwin'
    case 'linux':
      return 'linux'
    default:
      throw new Error(`Unsupported Mihomo runtime platform: ${platform}`)
  }
}

export function nodeArchToGo(arch: string): string {
  switch (arch) {
    case 'x64':
      return 'amd64'
    case 'ia32':
      return '386'
    case 'arm64':
      return 'arm64'
    default:
      throw new Error(`Unsupported Mihomo runtime architecture: ${arch}`)
  }
}

export function parseMihomoVersionOutput(output: string): MihomoReportedIdentity {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.startsWith('Mihomo Meta '))

  if (!line) {
    throw new Error('Mihomo version output does not contain a Mihomo Meta identity line')
  }

  const match = /^Mihomo Meta\s+(\S+)\s+(\S+)\s+(\S+)\s+with(?:\s|$)/.exec(line)

  if (!match) {
    throw new Error(`Unrecognized Mihomo version output: ${line}`)
  }

  return {
    version: match[1],
    platform: match[2],
    arch: match[3]
  }
}

export function verifyMihomoReportedIdentity(
  reported: MihomoReportedIdentity,
  expected: MihomoLegacyRuntimeIdentity
): void {
  const expectedSource: MihomoRuntimeSource = inferLegacyMihomoRuntimeSource(expected.version)

  if (expectedSource !== expected.source) {
    throw new Error(
      `Mihomo legacy source mismatch: version ${expected.version} implies ${expectedSource}, expected ${expected.source}`
    )
  }

  const normalizedReportedVersion = normalizeMihomoVersion(reported.version)
  const normalizedExpectedVersion = normalizeMihomoVersion(expected.version)

  if (normalizedReportedVersion !== normalizedExpectedVersion) {
    throw new Error(
      `Mihomo legacy version mismatch: reported ${reported.version}, expected ${expected.version}`
    )
  }

  const expectedPlatform = nodePlatformToGo(expected.platform)

  if (reported.platform !== expectedPlatform) {
    throw new Error(
      `Mihomo legacy platform mismatch: reported ${reported.platform}, expected ${expectedPlatform}`
    )
  }

  const expectedArch = nodeArchToGo(expected.arch)

  if (reported.arch !== expectedArch) {
    throw new Error(
      `Mihomo legacy architecture mismatch: reported ${reported.arch}, expected ${expectedArch}`
    )
  }
}

export const runMihomoVersion: MihomoVersionRunner = async (
  binaryPath,
  args
): Promise<MihomoVersionCommandResult> => {
  return await new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      args,
      {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 64 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `Failed to inspect Mihomo runtime identity: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          )
          return
        }

        resolve({
          stdout: String(stdout),
          stderr: String(stderr)
        })
      }
    )
  })
}

export async function verifyMihomoLegacyRuntimeIdentity(
  binaryPath: string,
  expected: MihomoLegacyRuntimeIdentity,
  runner: MihomoVersionRunner = runMihomoVersion
): Promise<void> {
  const result = await runner(binaryPath, ['-v'])

  const output = [result.stdout, result.stderr].filter((value) => value.length > 0).join('\n')

  const reported = parseMihomoVersionOutput(output)

  verifyMihomoReportedIdentity(reported, expected)
}
