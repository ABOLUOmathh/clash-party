import { createReadStream, createWriteStream } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { platform, tmpdir } from 'os'
import { join, resolve } from 'path'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import AdmZip from 'adm-zip'
import { hasCoreProcess, restartCore, stopCore } from '../core/manager'
import { getAppConfig } from '../config'
import { resolveActiveMihomoRuntime } from '../resolve/mihomoActiveRuntime'
import { mihomoSpecificRuntimePaths, type MihomoRuntimeSource } from '../resolve/mihomoRuntime'
import { installPreparedMihomoRuntime } from '../resolve/mihomoRuntimeInstall'
import { verifyMihomoLegacyRuntimeIdentity } from '../resolve/mihomoRuntimeIdentity'
import { dataDir } from './dirs'
import * as chromeRequest from './chromeRequest'
import { createLogger } from './logger'

const log = createLogger('GitHub')

const GITHUB_PROXIES = [
  'https://gh-proxy.org',
  'https://ghfast.top',
  'https://down.clashparty.org',
  'https://download.mihomo.party'
]

function buildDownloadUrls(githubUrl: string, proxyPref = ''): string[] {
  if (proxyPref === 'direct') return [githubUrl]
  if (proxyPref && proxyPref !== 'auto') return [`${proxyPref}/${githubUrl}`]
  return [...GITHUB_PROXIES.map((p) => `${p}/${githubUrl}`), githubUrl]
}

export interface GitHubTag {
  name: string
  zipball_url: string
  tarball_url: string
}

interface GitHubRelease {
  tag_name: string
  zipball_url: string
  tarball_url: string
}

interface VersionCache {
  data: GitHubTag[]
  timestamp: number
}

const CACHE_EXPIRY = 5 * 60 * 1000

const GITHUB_API_CONFIG = {
  BASE_URL: 'https://api.github.com',
  API_VERSION: '2022-11-28',
  TAGS_PER_PAGE: 100
}

const PLATFORM_MAP: Record<string, string> = {
  'win32-x64': 'mihomo-windows-amd64-compatible',
  'win32-ia32': 'mihomo-windows-386',
  'win32-arm64': 'mihomo-windows-arm64',
  'darwin-x64': 'mihomo-darwin-amd64-compatible',
  'darwin-arm64': 'mihomo-darwin-arm64',
  'linux-x64': 'mihomo-linux-amd64-compatible',
  'linux-arm64': 'mihomo-linux-arm64'
}

const versionCache = new Map<string, VersionCache>()

/**
 * 获取 GitHub 仓库的标签列表（带缓存）
 * @param owner 仓库所有者
 * @param repo 仓库名称
 * @param forceRefresh 是否强制刷新缓存
 * @returns 标签列表
 */
export async function getGitHubTags(
  owner: string,
  repo: string,
  forceRefresh = false
): Promise<GitHubTag[]> {
  const cacheKey = `${owner}/${repo}`

  // 检查缓存
  if (!forceRefresh && versionCache.has(cacheKey)) {
    const cache = versionCache.get(cacheKey)
    if (cache && Date.now() - cache.timestamp < CACHE_EXPIRY) {
      log.debug(`Returning cached tags for ${owner}/${repo}`)
      return cache.data
    }
  }

  try {
    log.debug(`Fetching tags for ${owner}/${repo}`)
    const response = await chromeRequest.get<GitHubTag[]>(
      `${GITHUB_API_CONFIG.BASE_URL}/repos/${owner}/${repo}/tags?per_page=${GITHUB_API_CONFIG.TAGS_PER_PAGE}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_CONFIG.API_VERSION
        },
        responseType: 'json',
        timeout: 10000
      }
    )

    // 更新缓存
    versionCache.set(cacheKey, {
      data: response.data,
      timestamp: Date.now()
    })

    log.debug(`Successfully fetched ${response.data.length} tags for ${owner}/${repo}`)
    return response.data
  } catch (error) {
    log.error(`Failed to fetch tags for ${owner}/${repo}`, error)
    if (error instanceof Error) {
      throw new Error(`GitHub API error: ${error.message}`)
    }
    throw new Error('Failed to fetch version list')
  }
}

export async function getGitHubReleases(
  owner: string,
  repo: string,
  forceRefresh = false
): Promise<GitHubTag[]> {
  const cacheKey = `${owner}/${repo}-releases`

  if (!forceRefresh && versionCache.has(cacheKey)) {
    const cache = versionCache.get(cacheKey)

    if (cache && Date.now() - cache.timestamp < CACHE_EXPIRY) {
      return cache.data
    }
  }

  const response = await chromeRequest.get<GitHubRelease[]>(
    `${GITHUB_API_CONFIG.BASE_URL}/repos/${owner}/${repo}/releases`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_CONFIG.API_VERSION
      },
      responseType: 'json',
      timeout: 10000
    }
  )

  const data = response.data.map((release) => ({
    name: release.tag_name,
    zipball_url: release.zipball_url,
    tarball_url: release.tarball_url
  }))

  versionCache.set(cacheKey, {
    data,
    timestamp: Date.now()
  })

  return data
}

/**
 * 清除版本缓存
 * @param owner 仓库所有者
 * @param repo 仓库名称
 */
export function clearVersionCache(owner: string, repo: string): void {
  const tagCacheKey = `${owner}/${repo}`
  const releaseCacheKey = `${owner}/${repo}-releases`

  const clearedTags = versionCache.delete(tagCacheKey)
  const clearedReleases = versionCache.delete(releaseCacheKey)

  log.debug(
    `Cache ${clearedTags || clearedReleases ? 'cleared' : 'not found'} for ${owner}/${repo}`
  )
}

/**
 * 下载 GitHub Release 资产
 * @param url 下载 URL
 * @param outputPath 输出路径
 */
export async function downloadGitHubAsset(url: string, outputPath: string): Promise<void> {
  const { githubProxy = '' } = await getAppConfig()
  const urls = buildDownloadUrls(url, githubProxy)
  let lastError: unknown
  for (const candidate of urls) {
    try {
      log.debug(`Downloading asset from ${candidate}`)
      const response = await chromeRequest.get(candidate, {
        responseType: 'arraybuffer',
        timeout: 30000
      })
      // chromeRequest 对任何状态码都 resolve，所以这里必须自己判断。否则镜像返回的
      // 404/502 错误页会被当成下载成功写进内核文件，而且直接 return、不再尝试后续镜像。
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }
      await writeFile(outputPath, Buffer.from(response.data as Buffer))
      log.debug(`Successfully downloaded asset to ${outputPath}`)
      return
    } catch (error) {
      log.warn(`Download failed from ${candidate}, trying next`, error)
      lastError = error
    }
  }
  log.error(`Failed to download asset from all sources`, lastError)
  throw lastError instanceof Error
    ? new Error(`Download error: ${lastError.message}`)
    : new Error('Failed to download core file')
}

async function extractMihomoReleaseBinary(
  archivePath: string,
  archiveType: 'zip' | 'gz',
  executableName: string,
  stagingBinaryPath: string
): Promise<void> {
  if (archiveType === 'zip') {
    log.debug(`Extracting Mihomo ZIP candidate ${archivePath}`)

    const zip = new AdmZip(archivePath)
    const entry = zip.getEntries().find((candidate) => {
      const normalized = candidate.entryName.replaceAll('\\', '/')
      return normalized.split('/').pop() === executableName
    })

    if (!entry) {
      throw new Error(`Executable file not found in zip: ${executableName}`)
    }

    await writeFile(stagingBinaryPath, entry.getData())
    return
  }

  log.debug(`Extracting Mihomo GZ candidate ${archivePath}`)

  await pipeline(
    createReadStream(archivePath),
    createGunzip(),
    createWriteStream(stagingBinaryPath)
  )
}

async function installMihomoRelease(version: string, source: MihomoRuntimeSource): Promise<void> {
  const plat = platform()
  const arch = process.arch
  const releaseName = PLATFORM_MAP[`${plat}-${arch}`]

  if (!releaseName) {
    throw new Error(`Unsupported platform "${plat}-${arch}"`)
  }

  const isWindows = plat === 'win32'
  const archiveType: 'zip' | 'gz' = isWindows ? 'zip' : 'gz'
  const executableName = `${releaseName}${isWindows ? '.exe' : ''}`
  const repository = source === 'custom' ? 'ABOLUOmathh/mihomo' : 'MetaCubeX/mihomo'
  const downloadURL =
    `https://github.com/${repository}/releases/download/${version}/` +
    `${releaseName}-${version}.${archiveType}`

  const baseDataDir = dataDir()
  const persistentRuntime = mihomoSpecificRuntimePaths(baseDataDir, plat)

  // 下载不占用 runtime mutation lock：
  // 网络可能很慢，而 migration/其他 runtime 操作不应该因此被阻塞。
  // 真正进入 shared staging 之后，installPreparedMihomoRuntime 会负责串行化。
  const downloadDir = await mkdtemp(join(tmpdir(), 'clash-party-mihomo-'))
  const archivePath = join(downloadDir, `mihomo.${archiveType}`)

  let stoppedRunningCore = false

  try {
    await downloadGitHubAsset(downloadURL, archivePath)

    await installPreparedMihomoRuntime({
      baseDataDir,
      version,
      source,
      platform: plat,
      arch,
      verifyIdentity: verifyMihomoLegacyRuntimeIdentity,

      prepareStagedBinary: async (paths) => {
        await extractMihomoReleaseBinary(
          archivePath,
          archiveType,
          executableName,
          paths.stagingBinaryPath
        )
      },

      // POSIX 可以安全 rename 正在执行的 binary。
      // Windows 才需要在最终 commit 前处理 exe 文件锁，而且只有当前
      // 真正运行的是 persistent specific runtime 时才应停止核心。
      stopBeforeCommit: isWindows
        ? async () => {
            if (!hasCoreProcess()) return

            const { core = 'mihomo', specificVersion, specificSource } = await getAppConfig()

            const activeRuntime = await resolveActiveMihomoRuntime({
              core,
              specificVersion,
              specificSource
            })

            if (resolve(activeRuntime.activePath) !== resolve(persistentRuntime.binaryPath)) {
              return
            }

            // 在 await 前记录。即使 stopCore 自身部分失败，
            // transaction 的 failure path 也应该尝试恢复运行状态。
            stoppedRunningCore = true
            log.debug('Stopping running persistent Mihomo runtime before Windows commit')
            await stopCore(true)
          }
        : undefined,

      restartPreviousRuntime: isWindows
        ? async () => {
            if (!stoppedRunningCore) return

            log.debug('Restarting previous Mihomo runtime after failed Windows commit')
            await restartCore()
          }
        : undefined
    })

    log.info(`Successfully installed ${source} Mihomo runtime ${version}`)
  } finally {
    // 下载文件不是 runtime state。清理失败不能把一次成功安装变成失败。
    await rm(downloadDir, { recursive: true, force: true }).catch((error) => {
      log.warn(`Failed to remove Mihomo download directory ${downloadDir}`, error)
    })
  }
}

/**
 * 安装特定版本的官方 Mihomo 核心。
 * 安装成功只更新 persistent runtime；User Intent 由上层 main-process orchestration 在成功后提交。
 */
export async function installMihomoCore(version: string): Promise<void> {
  try {
    log.info(`Installing official Mihomo core version ${version}`)
    await installMihomoRelease(version, 'official')
  } catch (error) {
    log.error('Failed to install official Mihomo core', error)

    throw new Error(
      `Failed to install core: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * 安装 Clash Party Custom 使用的自定义 Mihomo 核心。
 * 与官方版本共用完全相同的 persistent runtime transaction。
 */
export async function installCustomMihomoCore(version: string): Promise<void> {
  try {
    log.info(`Installing custom Mihomo core version ${version}`)
    await installMihomoRelease(version, 'custom')
  } catch (error) {
    log.error('Failed installing custom Mihomo', error)
    throw error
  }
}
