import { existsSync } from 'fs'
import { cp, mkdir, rename, rm, stat } from 'fs/promises'
import path from 'path'

export interface SubStoreComponentPaths {
  backendPath: string
  frontendDir: string
  stagingBackendPath: string
  stagingFrontendDir: string
  backupDir: string
}

export interface SubStoreBackupState {
  hadBackend: boolean
  hadFrontend: boolean
}

export type SubStoreBackendComponentPaths = Pick<
  SubStoreComponentPaths,
  'backendPath' | 'stagingBackendPath' | 'backupDir'
>

export interface SubStoreBackendBackupState {
  hadBackend: boolean
}

function backupBackendPath(paths: SubStoreBackendComponentPaths): string {
  return path.join(paths.backupDir, 'sub-store.bundle.cjs')
}

function backupFrontendDir(paths: SubStoreComponentPaths): string {
  return path.join(paths.backupDir, 'sub-store-frontend')
}

async function assertNonEmptyFile(filePath: string, label: string): Promise<void> {
  const info = await stat(filePath).catch(() => undefined)

  if (!info?.isFile() || info.size <= 0) {
    throw new Error(`${label} is missing or empty: ${filePath}`)
  }
}

export async function validateSubStoreStaging(
  stagingBackendPath: string,
  stagingFrontendDir: string
): Promise<void> {
  await assertNonEmptyFile(stagingBackendPath, 'Sub-Store backend')
  await assertNonEmptyFile(path.join(stagingFrontendDir, 'index.html'), 'Sub-Store frontend index')
}

export async function validateSubStoreBackendStaging(stagingBackendPath: string): Promise<void> {
  await assertNonEmptyFile(stagingBackendPath, 'Sub-Store backend')
}

export async function restoreSubStoreBackend(
  paths: SubStoreBackendComponentPaths,
  state: SubStoreBackendBackupState
): Promise<void> {
  await rm(paths.backendPath, { force: true })

  if (state.hadBackend) {
    const backupBackend = backupBackendPath(paths)

    if (!existsSync(backupBackend)) {
      throw new Error(`Sub-Store backend backup is missing: ${backupBackend}`)
    }

    await cp(backupBackend, paths.backendPath)
  }
}

export async function replaceSubStoreBackend(
  paths: SubStoreBackendComponentPaths
): Promise<SubStoreBackendBackupState> {
  const state: SubStoreBackendBackupState = {
    hadBackend: existsSync(paths.backendPath)
  }

  await rm(paths.backupDir, { recursive: true, force: true })
  await mkdir(paths.backupDir, { recursive: true })

  if (state.hadBackend) {
    await cp(paths.backendPath, backupBackendPath(paths))
  }

  try {
    await rm(paths.backendPath, { force: true })
    await rename(paths.stagingBackendPath, paths.backendPath)

    return state
  } catch (error) {
    try {
      await restoreSubStoreBackend(paths, state)
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        'Failed to replace Sub-Store backend and rollback also failed'
      )
    }

    throw error
  }
}

export async function restoreSubStoreComponents(
  paths: SubStoreComponentPaths,
  state: SubStoreBackupState
): Promise<void> {
  await rm(paths.backendPath, { force: true })
  await rm(paths.frontendDir, { recursive: true, force: true })

  if (state.hadBackend) {
    const backupBackend = backupBackendPath(paths)
    if (!existsSync(backupBackend)) {
      throw new Error(`Sub-Store backend backup is missing: ${backupBackend}`)
    }
    await cp(backupBackend, paths.backendPath)
  }

  if (state.hadFrontend) {
    const backupFrontend = backupFrontendDir(paths)
    if (!existsSync(backupFrontend)) {
      throw new Error(`Sub-Store frontend backup is missing: ${backupFrontend}`)
    }
    await cp(backupFrontend, paths.frontendDir, { recursive: true })
  }
}

export async function replaceSubStoreComponents(
  paths: SubStoreComponentPaths
): Promise<SubStoreBackupState> {
  const state: SubStoreBackupState = {
    hadBackend: existsSync(paths.backendPath),
    hadFrontend: existsSync(paths.frontendDir)
  }

  await rm(paths.backupDir, { recursive: true, force: true })
  await mkdir(paths.backupDir, { recursive: true })

  if (state.hadBackend) {
    await cp(paths.backendPath, backupBackendPath(paths))
  }

  if (state.hadFrontend) {
    await cp(paths.frontendDir, backupFrontendDir(paths), { recursive: true })
  }

  try {
    await rm(paths.backendPath, { force: true })
    await rename(paths.stagingBackendPath, paths.backendPath)

    await rm(paths.frontendDir, { recursive: true, force: true })
    await rename(paths.stagingFrontendDir, paths.frontendDir)

    return state
  } catch (error) {
    try {
      await restoreSubStoreComponents(paths, state)
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        'Failed to replace Sub-Store components and rollback also failed'
      )
    }

    throw error
  }
}

export async function cleanupSubStoreBackup(backupDir: string): Promise<void> {
  await rm(backupDir, { recursive: true, force: true })
}
