import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupSubStoreBackup,
  replaceSubStoreBackend,
  replaceSubStoreComponents,
  restoreSubStoreBackend,
  restoreSubStoreComponents,
  validateSubStoreBackendStaging,
  validateSubStoreStaging,
  type SubStoreComponentPaths
} from './substoreInstall'

let tempDir: string

function componentPaths(): SubStoreComponentPaths {
  return {
    backendPath: path.join(tempDir, 'work', 'sub-store.bundle.cjs'),
    frontendDir: path.join(tempDir, 'work', 'sub-store-frontend'),
    stagingBackendPath: path.join(tempDir, 'work', '.substore-staging', 'sub-store.bundle.cjs'),
    stagingFrontendDir: path.join(tempDir, 'work', '.substore-staging', 'dist'),
    backupDir: path.join(tempDir, 'work', '.substore-backup')
  }
}

async function createCurrentComponents(paths: SubStoreComponentPaths): Promise<void> {
  await mkdir(paths.frontendDir, { recursive: true })
  await writeFile(paths.backendPath, 'old-backend')
  await writeFile(path.join(paths.frontendDir, 'index.html'), 'old-frontend')
}

async function createStagedComponents(paths: SubStoreComponentPaths): Promise<void> {
  await mkdir(paths.stagingFrontendDir, { recursive: true })
  await writeFile(paths.stagingBackendPath, 'new-backend')
  await writeFile(path.join(paths.stagingFrontendDir, 'index.html'), 'new-frontend')
}

async function readText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'clash-party-substore-install-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('Sub-Store backend runtime install', () => {
  it('validates a staged backend', async () => {
    const paths = componentPaths()

    await mkdir(path.dirname(paths.stagingBackendPath), { recursive: true })
    await writeFile(paths.stagingBackendPath, 'new-backend')

    await expect(validateSubStoreBackendStaging(paths.stagingBackendPath)).resolves.toBeUndefined()

    await writeFile(paths.stagingBackendPath, '')

    await expect(validateSubStoreBackendStaging(paths.stagingBackendPath)).rejects.toThrow(
      'Sub-Store backend is missing or empty'
    )
  })

  it('replaces only the backend and can restore it', async () => {
    const paths = componentPaths()

    await mkdir(path.dirname(paths.backendPath), { recursive: true })
    await createCurrentComponents(paths)

    await mkdir(path.dirname(paths.stagingBackendPath), { recursive: true })
    await writeFile(paths.stagingBackendPath, 'new-backend')

    const state = await replaceSubStoreBackend(paths)

    expect(await readText(paths.backendPath)).toBe('new-backend')
    expect(await readText(path.join(paths.frontendDir, 'index.html'))).toBe('old-frontend')

    await restoreSubStoreBackend(paths, state)

    expect(await readText(paths.backendPath)).toBe('old-backend')
    expect(await readText(path.join(paths.frontendDir, 'index.html'))).toBe('old-frontend')
  })

  it('automatically restores the old backend when replacement fails', async () => {
    const paths = componentPaths()

    await mkdir(path.dirname(paths.backendPath), { recursive: true })
    await createCurrentComponents(paths)

    await expect(replaceSubStoreBackend(paths)).rejects.toThrow()

    expect(await readText(paths.backendPath)).toBe('old-backend')
    expect(await readText(path.join(paths.frontendDir, 'index.html'))).toBe('old-frontend')
  })
})

describe('Sub-Store component reinstall', () => {
  it('validates a complete staging area', async () => {
    const paths = componentPaths()
    await createStagedComponents(paths)

    await expect(
      validateSubStoreStaging(paths.stagingBackendPath, paths.stagingFrontendDir)
    ).resolves.toBeUndefined()

    await writeFile(paths.stagingBackendPath, '')

    await expect(
      validateSubStoreStaging(paths.stagingBackendPath, paths.stagingFrontendDir)
    ).rejects.toThrow('Sub-Store backend is missing or empty')
  })

  it('replaces components and can restore the previous installation', async () => {
    const paths = componentPaths()
    await mkdir(path.dirname(paths.backendPath), { recursive: true })
    await createCurrentComponents(paths)
    await createStagedComponents(paths)

    const state = await replaceSubStoreComponents(paths)

    expect(await readText(paths.backendPath)).toBe('new-backend')
    expect(await readText(path.join(paths.frontendDir, 'index.html'))).toBe('new-frontend')

    await restoreSubStoreComponents(paths, state)

    expect(await readText(paths.backendPath)).toBe('old-backend')
    expect(await readText(path.join(paths.frontendDir, 'index.html'))).toBe('old-frontend')

    await cleanupSubStoreBackup(paths.backupDir)
  })

  it('automatically restores old components when replacement fails', async () => {
    const paths = componentPaths()
    await mkdir(path.dirname(paths.backendPath), { recursive: true })
    await createCurrentComponents(paths)

    await mkdir(path.dirname(paths.stagingBackendPath), { recursive: true })
    await writeFile(paths.stagingBackendPath, 'new-backend')

    await expect(replaceSubStoreComponents(paths)).rejects.toThrow()

    expect(await readText(paths.backendPath)).toBe('old-backend')
    expect(await readText(path.join(paths.frontendDir, 'index.html'))).toBe('old-frontend')
  })
})
