import { constants, existsSync } from 'fs'
import { access, chmod, cp, mkdir, readFile, rename, rm, stat } from 'fs/promises'
import path from 'path'
import {
  mihomoSpecificRuntimePaths,
  sha256Buffer,
  validateMihomoSpecificRuntime,
  writeMihomoSpecificRuntimeState,
  type MihomoRuntimeSource,
  type MihomoSpecificRuntimeState
} from './mihomoRuntime'

export interface MihomoRuntimeInstallPaths {
  runtimeDir: string
  binaryPath: string
  statePath: string
  stagingDir: string
  stagingBinaryPath: string
  backupDir: string
  backupBinaryPath: string
  backupStatePath: string
}

export interface MihomoRuntimeBackupState {
  hadBinary: boolean
  hadState: boolean
}

export type MihomoLegacyMigrationStatus = 'already-valid' | 'legacy-missing' | 'migrated'

export interface MihomoLegacyMigrationResult {
  status: MihomoLegacyMigrationStatus
}

export interface MihomoLegacyRuntimeIdentity {
  version: string
  source: MihomoRuntimeSource
  platform: NodeJS.Platform
  arch: string
}

export type MihomoLegacyIdentityVerifier = (
  binaryPath: string,
  expected: MihomoLegacyRuntimeIdentity
) => Promise<void>

type RuntimeStateWriter = (baseDataDir: string, state: MihomoSpecificRuntimeState) => Promise<void>

type RuntimeRestorer = (
  paths: MihomoRuntimeInstallPaths,
  backup: MihomoRuntimeBackupState
) => Promise<void>

export interface CommitStagedMihomoRuntimeDependencies {
  stateWriter?: RuntimeStateWriter
  restoreRuntime?: RuntimeRestorer
}

let mihomoRuntimeMutationTail: Promise<void> = Promise.resolve()

async function runSerializedMihomoRuntimeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mihomoRuntimeMutationTail.then(operation)

  mihomoRuntimeMutationTail = result.then(
    () => undefined,
    () => undefined
  )

  return await result
}

export function mihomoRuntimeInstallPaths(
  baseDataDir: string,
  platform: NodeJS.Platform = process.platform
): MihomoRuntimeInstallPaths {
  const runtime = mihomoSpecificRuntimePaths(baseDataDir, platform)
  const parentDir = path.dirname(runtime.dir)
  const binaryName = path.basename(runtime.binaryPath)
  const stagingDir = path.join(parentDir, '.specific-staging')
  const backupDir = path.join(parentDir, '.specific-backup')

  return {
    runtimeDir: runtime.dir,
    binaryPath: runtime.binaryPath,
    statePath: runtime.statePath,
    stagingDir,
    stagingBinaryPath: path.join(stagingDir, binaryName),
    backupDir,
    backupBinaryPath: path.join(backupDir, binaryName),
    backupStatePath: path.join(backupDir, 'runtime.json')
  }
}

export async function validateMihomoRuntimeBinary(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const info = await stat(binaryPath).catch(() => undefined)

  if (!info?.isFile() || info.size <= 0) {
    throw new Error(`Mihomo runtime is missing or empty: ${binaryPath}`)
  }

  await access(binaryPath, constants.R_OK)

  if (platform !== 'win32') {
    await access(binaryPath, constants.X_OK)
  }
}

export async function cleanupMihomoRuntimeStaging(paths: MihomoRuntimeInstallPaths): Promise<void> {
  await rm(paths.stagingDir, { recursive: true, force: true })
}

export async function cleanupMihomoRuntimeBackup(paths: MihomoRuntimeInstallPaths): Promise<void> {
  await rm(paths.backupDir, { recursive: true, force: true })
}

export async function restoreMihomoRuntime(
  paths: MihomoRuntimeInstallPaths,
  backup: MihomoRuntimeBackupState
): Promise<void> {
  await rm(paths.binaryPath, { force: true })
  await rm(paths.statePath, { force: true })

  if (backup.hadBinary) {
    if (!existsSync(paths.backupBinaryPath)) {
      throw new Error(`Mihomo runtime backup is missing: ${paths.backupBinaryPath}`)
    }

    await mkdir(paths.runtimeDir, { recursive: true })
    await cp(paths.backupBinaryPath, paths.binaryPath)
  }

  if (backup.hadState) {
    if (!existsSync(paths.backupStatePath)) {
      throw new Error(`Mihomo runtime state backup is missing: ${paths.backupStatePath}`)
    }

    await mkdir(paths.runtimeDir, { recursive: true })
    await cp(paths.backupStatePath, paths.statePath)
  }
}

export async function commitStagedMihomoRuntime(
  baseDataDir: string,
  state: MihomoSpecificRuntimeState,
  dependencies: CommitStagedMihomoRuntimeDependencies = {}
): Promise<void> {
  const paths = mihomoRuntimeInstallPaths(baseDataDir, state.platform)
  const stateWriter = dependencies.stateWriter ?? writeMihomoSpecificRuntimeState
  const restoreRuntime = dependencies.restoreRuntime ?? restoreMihomoRuntime

  await validateMihomoRuntimeBinary(paths.stagingBinaryPath, state.platform)

  const stagedBinary = await readFile(paths.stagingBinaryPath)
  const stagedSha256 = sha256Buffer(stagedBinary)

  if (stagedSha256 !== state.sha256.toLowerCase()) {
    throw new Error('Mihomo staged runtime checksum does not match runtime state')
  }

  const backup: MihomoRuntimeBackupState = {
    hadBinary: existsSync(paths.binaryPath),
    hadState: existsSync(paths.statePath)
  }

  await rm(paths.backupDir, { recursive: true, force: true })
  await mkdir(paths.backupDir, { recursive: true })

  if (backup.hadBinary) {
    await cp(paths.binaryPath, paths.backupBinaryPath)
  }

  if (backup.hadState) {
    await cp(paths.statePath, paths.backupStatePath)
  }

  try {
    await mkdir(paths.runtimeDir, { recursive: true })

    await rm(paths.binaryPath, { force: true })
    await rename(paths.stagingBinaryPath, paths.binaryPath)

    // runtime.json 是事务提交点。只有 binary 已经成功落盘后才更新 state。
    await stateWriter(baseDataDir, state)
  } catch (error) {
    try {
      await restoreRuntime(paths, backup)
    } catch (restoreError) {
      // rollback 自身失败时，backup 是最后的恢复材料，必须保留。
      throw new AggregateError(
        [error, restoreError],
        'Failed to install Mihomo runtime and rollback also failed'
      )
    }

    // rollback 已经成功，backup 不再承担恢复职责。
    await cleanupMihomoRuntimeBackup(paths).catch(() => {})
    throw error
  }

  // commit 已完成。清理失败不应让一次成功安装变成失败；
  // 最多留下一个可安全覆盖的旧 backup。
  await cleanupMihomoRuntimeBackup(paths).catch(() => {})
}

export interface InstallPreparedMihomoRuntimeOptions {
  baseDataDir: string
  version: string
  source: MihomoRuntimeSource
  prepareStagedBinary: (paths: MihomoRuntimeInstallPaths) => Promise<void>
  verifyIdentity: MihomoLegacyIdentityVerifier
  stopBeforeCommit?: () => Promise<void>
  restartPreviousRuntime?: () => Promise<void>
  commitRuntime?: (baseDataDir: string, state: MihomoSpecificRuntimeState) => Promise<void>
  platform?: NodeJS.Platform
  arch?: string
}

export async function installPreparedMihomoRuntime(
  options: InstallPreparedMihomoRuntimeOptions
): Promise<void> {
  if (options.stopBeforeCommit && !options.restartPreviousRuntime) {
    throw new Error('restartPreviousRuntime is required when stopBeforeCommit is configured')
  }

  return await runSerializedMihomoRuntimeMutation(async () => {
    const {
      baseDataDir,
      version,
      source,
      prepareStagedBinary,
      verifyIdentity,
      stopBeforeCommit,
      restartPreviousRuntime,
      commitRuntime = commitStagedMihomoRuntime,
      platform = process.platform,
      arch = process.arch
    } = options

    const paths = mihomoRuntimeInstallPaths(baseDataDir, platform)

    await cleanupMihomoRuntimeStaging(paths)
    await mkdir(paths.stagingDir, { recursive: true })

    let stopAttempted = false

    try {
      await prepareStagedBinary(paths)

      if (platform !== 'win32') {
        await chmod(paths.stagingBinaryPath, 0o755)
      }

      await validateMihomoRuntimeBinary(paths.stagingBinaryPath, platform)

      await verifyIdentity(paths.stagingBinaryPath, {
        version,
        source,
        platform,
        arch
      })

      const binary = await readFile(paths.stagingBinaryPath)

      const state: MihomoSpecificRuntimeState = {
        version,
        source,
        sha256: sha256Buffer(binary),
        platform,
        arch
      }

      if (stopBeforeCommit) {
        // 从这里开始失败时必须恢复之前正在使用的 runtime。
        // 在 await 之前标记，覆盖 stop 自身发生部分失败的情况。
        stopAttempted = true
        await stopBeforeCommit()
      }

      await commitRuntime(baseDataDir, state)
    } catch (error) {
      if (stopAttempted && restartPreviousRuntime) {
        try {
          await restartPreviousRuntime()
        } catch (restartError) {
          throw new AggregateError(
            [error, restartError],
            'Failed to install Mihomo runtime and restore the previous running runtime'
          )
        }
      }

      throw error
    } finally {
      // staging 永远只承载未提交材料。清理失败不能覆盖安装结果。
      await cleanupMihomoRuntimeStaging(paths).catch(() => {})
    }
  })
}

async function migrateLegacyMihomoRuntimeUnlocked(options: {
  baseDataDir: string
  legacyBinaryPath: string
  version: string
  source: MihomoRuntimeSource
  verifyIdentity: MihomoLegacyIdentityVerifier
  platform?: NodeJS.Platform
  arch?: string
}): Promise<MihomoLegacyMigrationResult> {
  const {
    baseDataDir,
    legacyBinaryPath,
    version,
    source,
    verifyIdentity,
    platform = process.platform,
    arch = process.arch
  } = options

  const current = await validateMihomoSpecificRuntime(baseDataDir, version, source, platform, arch)

  if (current.valid) {
    return { status: 'already-valid' }
  }

  if (!existsSync(legacyBinaryPath)) {
    return { status: 'legacy-missing' }
  }

  const paths = mihomoRuntimeInstallPaths(baseDataDir, platform)

  await rm(paths.stagingDir, { recursive: true, force: true })
  await mkdir(paths.stagingDir, { recursive: true })

  try {
    // 只复制，不移动、不删除 legacy runtime。
    await cp(legacyBinaryPath, paths.stagingBinaryPath)

    if (platform !== 'win32') {
      await chmod(paths.stagingBinaryPath, 0o755)
    }

    await validateMihomoRuntimeBinary(paths.stagingBinaryPath, platform)

    // 旧架构没有可信 runtime metadata。
    // 迁移前必须由调用方确认 binary 的真实身份与 requested metadata 一致。
    await verifyIdentity(paths.stagingBinaryPath, {
      version,
      source,
      platform,
      arch
    })

    const binary = await readFile(paths.stagingBinaryPath)

    const state: MihomoSpecificRuntimeState = {
      version,
      source,
      sha256: sha256Buffer(binary),
      platform,
      arch
    }

    await commitStagedMihomoRuntime(baseDataDir, state)

    return { status: 'migrated' }
  } finally {
    // 这里只清 staging。
    // cleanup 是 best effort，不能覆盖 identity/commit/rollback 的原始错误；
    // 如果 commit 的 rollback 自身失败，backup 必须留下供人工恢复。
    await cleanupMihomoRuntimeStaging(paths).catch(() => {})
  }
}

export async function migrateLegacyMihomoRuntime(
  options: Parameters<typeof migrateLegacyMihomoRuntimeUnlocked>[0]
): Promise<MihomoLegacyMigrationResult> {
  return await runSerializedMihomoRuntimeMutation(async () => {
    return await migrateLegacyMihomoRuntimeUnlocked(options)
  })
}
