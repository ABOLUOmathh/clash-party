import { Worker } from 'worker_threads'
import { mkdirSync } from 'fs'
import { readFile, writeFile, rm } from 'fs/promises'
import http from 'http'
import net from 'net'
import path from 'path'
import { nativeImage } from 'electron'
import express from 'express'
import AdmZip from 'adm-zip'
import * as chromeRequest from '../utils/chromeRequest'
import subStoreIcon from '../../../resources/subStoreIcon.png?asset'
import { mihomoWorkDir, subStoreDir, substoreLogPath } from '../utils/dirs'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { proxyLogger, systemLogger } from '../utils/logger'
import { createCappedLogWritableStream } from '../utils/logFile'
import { DEFAULT_MIHOMO_PORTS, DEFAULT_USE_SUB_STORE } from '../../shared/appConfig'
import {
  SUBSTORE_RUNTIME_ASSET,
  SUBSTORE_RUNTIME_REPO,
  getSubStoreBackendChecksum,
  parseSubStoreReleaseManifest,
  readSubStoreRuntimeState,
  removeSubStoreRuntimeState,
  verifySubStoreBackendChecksum,
  writeSubStoreRuntimeState
} from './substoreRuntime'
import { downloadGitHubAsset, getGitHubReleases } from '../utils/github'
import {
  cleanupSubStoreBackup,
  replaceSubStoreBackend,
  replaceSubStoreComponents,
  restoreSubStoreBackend,
  restoreSubStoreComponents,
  validateSubStoreBackendStaging,
  validateSubStoreStaging,
  type SubStoreBackendBackupState,
  type SubStoreBackendComponentPaths,
  type SubStoreBackupState,
  type SubStoreComponentPaths
} from './substoreInstall'

export let pacPort: number
export let subStorePort: number
export let subStoreFrontendPort: number
let subStoreFrontendServer: http.Server | undefined
let subStoreBackendWorker: Worker | undefined

const defaultPacScript = `
function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
`

export function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', (err) => {
      if (startPort <= 65535) {
        resolve(findAvailablePort(startPort + 1))
      } else {
        reject(err)
      }
    })
    server.on('listening', () => {
      server.close(() => {
        resolve(startPort)
      })
    })
    server.listen(startPort, '127.0.0.1')
  })
}

async function waitForTcpServer(host: string, port: number, timeoutMs = 10000): Promise<void> {
  const connectHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host

  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({
          host: connectHost,
          port
        })

        socket.once('connect', () => {
          socket.destroy()
          resolve()
        })

        socket.once('error', (error) => {
          socket.destroy()
          reject(error)
        })

        socket.setTimeout(500, () => {
          socket.destroy()
          reject(new Error('connection timed out'))
        })
      })

      return
    } catch (error) {
      lastError = error

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100)
      })
    }
  }

  const detail = lastError instanceof Error ? `: ${lastError.message}` : ''

  throw new Error(`Timed out waiting for Sub-Store server at ${connectHost}:${port}${detail}`)
}

async function waitForSubStoreBackendReady(
  worker: Worker,
  host: string,
  port: number
): Promise<void> {
  let startupErrorListener: ((error: Error) => void) | undefined
  let startupExitListener: ((code: number) => void) | undefined

  const workerFailure = new Promise<never>((_, reject) => {
    startupErrorListener = (error) => {
      reject(error)
    }

    startupExitListener = (code) => {
      reject(new Error(`Sub-Store backend worker exited before API became ready (code ${code})`))
    }

    worker.once('error', startupErrorListener)
    worker.once('exit', startupExitListener)
  })

  try {
    await Promise.race([waitForTcpServer(host, port), workerFailure])
  } finally {
    if (startupErrorListener) {
      worker.removeListener('error', startupErrorListener)
    }

    if (startupExitListener) {
      worker.removeListener('exit', startupExitListener)
    }
  }
}

let pacServer: http.Server | undefined

export async function startPacServer(): Promise<void> {
  await stopPacServer()
  const { sysProxy } = await getAppConfig()
  const { mode = 'manual', host: cHost, pacScript } = sysProxy
  if (mode !== 'auto') {
    return
  }
  const host = cHost || '127.0.0.1'
  let script = pacScript || defaultPacScript
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  script = script.replaceAll('%mixed-port%', port.toString())
  pacPort = await findAvailablePort(10000)
  const server = http.createServer(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig' })
    res.end(script)
  })
  // host 由用户自由填写，findAvailablePort 只在 127.0.0.1 上探测过端口，这里绑定可能失败
  // （EADDRNOTAVAIL / ENOTFOUND）。listen 失败是异步事件，没有 'error' 监听器会直接变成主进程
  // 未捕获异常并弹错误框，所以把失败转成 reject 交给调用方处理
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener('listening', onListening)
      reject(err)
    }
    const onListening = (): void => {
      server.removeListener('error', onError)
      // 监听成功后仍保留 error 监听，防止运行期出错（如网络接口变化）再次崩溃主进程
      server.on('error', (err) => {
        proxyLogger.error('PAC server error', err).catch(() => {})
      })
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(pacPort, host)
  })
  pacServer = server
}

export async function stopPacServer(): Promise<void> {
  if (pacServer) {
    pacServer.close()
    pacServer = undefined
  }
}

export async function startSubStoreFrontendServer(): Promise<void> {
  const { useSubStore = DEFAULT_USE_SUB_STORE, subStoreHost = '127.0.0.1' } = await getAppConfig()
  if (!useSubStore) return
  await stopSubStoreFrontendServer()
  subStoreFrontendPort = await findAvailablePort(14122)
  const app = express()
  const frontendDir = path.join(mihomoWorkDir(), 'sub-store-frontend')
  app.use(express.static(frontendDir))
  app.use((_req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'))
  })
  const server = http.createServer(app)
  subStoreFrontendServer = server

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening)
      subStoreFrontendServer = undefined
      reject(error)
    }

    const onListening = (): void => {
      server.removeListener('error', onError)

      server.on('error', (error) => {
        systemLogger.error('Sub-Store frontend server error', error).catch(() => {})
      })

      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(subStoreFrontendPort, subStoreHost)
  })
}

export async function stopSubStoreFrontendServer(): Promise<void> {
  const server = subStoreFrontendServer
  subStoreFrontendServer = undefined

  if (!server || !server.listening) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export async function startSubStoreBackendServer(): Promise<void> {
  const {
    useSubStore = DEFAULT_USE_SUB_STORE,
    useCustomSubStore = false,
    useProxyInSubStore = false,
    subStoreHost = '127.0.0.1',
    subStoreBackendSyncCron = '',
    subStoreBackendDownloadCron = '',
    subStoreBackendUploadCron = ''
  } = await getAppConfig()
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  if (!useSubStore) return
  if (!useCustomSubStore) {
    await stopSubStoreBackendServer()
    subStorePort = await findAvailablePort(38324)
    const icon = nativeImage.createFromPath(subStoreIcon)
    icon.toDataURL()
    const stdout = createCappedLogWritableStream(substoreLogPath)
    const stderr = createCappedLogWritableStream(substoreLogPath)
    const env = {
      SUB_STORE_BACKEND_API_PORT: subStorePort.toString(),
      SUB_STORE_BACKEND_API_HOST: subStoreHost,
      SUB_STORE_DATA_BASE_PATH: subStoreDir(),
      SUB_STORE_BACKEND_CUSTOM_ICON: icon.toDataURL(),
      SUB_STORE_BACKEND_CUSTOM_NAME: 'Clash Party',
      SUB_STORE_BACKEND_SYNC_CRON: subStoreBackendSyncCron,
      SUB_STORE_BACKEND_DOWNLOAD_CRON: subStoreBackendDownloadCron,
      SUB_STORE_BACKEND_UPLOAD_CRON: subStoreBackendUploadCron,
      SUB_STORE_MMDB_COUNTRY_PATH: path.join(mihomoWorkDir(), 'country.mmdb'),
      SUB_STORE_MMDB_ASN_PATH: path.join(mihomoWorkDir(), 'ASN.mmdb')
    }
    const worker = new Worker(path.join(mihomoWorkDir(), 'sub-store.bundle.cjs'), {
      env: useProxyInSubStore
        ? {
            ...env,
            HTTP_PROXY: `http://127.0.0.1:${port}`,
            HTTPS_PROXY: `http://127.0.0.1:${port}`,
            ALL_PROXY: `http://127.0.0.1:${port}`
          }
        : env
    })

    subStoreBackendWorker = worker

    worker.stdout.pipe(stdout)
    worker.stderr.pipe(stderr)

    // 始终保留 error 监听器，避免 Worker 运行期错误成为主进程未捕获异常。
    worker.on('error', (error) => {
      systemLogger.error('Sub-Store backend worker error', error).catch(() => {})
    })

    worker.on('exit', (code) => {
      if (subStoreBackendWorker === worker) {
        subStoreBackendWorker = undefined
      }

      if (code !== 0) {
        systemLogger.error(`Sub-Store backend worker exited with code ${code}`).catch(() => {})
      }
    })

    try {
      await waitForSubStoreBackendReady(worker, subStoreHost, subStorePort)
    } catch (error) {
      await stopSubStoreBackendServer().catch(() => {})
      throw error
    }
  }
}

export async function stopSubStoreBackendServer(): Promise<void> {
  const worker = subStoreBackendWorker
  subStoreBackendWorker = undefined

  if (worker) {
    await worker.terminate()
  }
}

const CUSTOM_SUBSTORE_OWNER = 'ABOLUOmathh'
const CUSTOM_SUBSTORE_REPOSITORY = 'Sub-Store'
const CUSTOM_SUBSTORE_VERSION_PATTERN = /^\d+\.\d+\.\d+-custom\.\d+$/

export async function fetchCustomSubStoreReleases(forceRefresh = false): Promise<string[]> {
  const releases = await getGitHubReleases(
    CUSTOM_SUBSTORE_OWNER,
    CUSTOM_SUBSTORE_REPOSITORY,
    forceRefresh
  )

  return releases
    .map((release) => release.name)
    .filter((version) => CUSTOM_SUBSTORE_VERSION_PATTERN.test(version))
}

export async function installCustomSubStoreRuntime(version: string): Promise<void> {
  if (!CUSTOM_SUBSTORE_VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid Custom Sub-Store version: ${version}`)
  }

  const { useSubStore = DEFAULT_USE_SUB_STORE, useCustomSubStore = false } = await getAppConfig()

  if (!useSubStore) {
    throw new Error('Sub-Store must be enabled before installing a runtime backend')
  }

  if (useCustomSubStore) {
    throw new Error(
      'Disable the external Custom Sub-Store backend before installing a local runtime backend'
    )
  }

  const workDir = mihomoWorkDir()
  const backendPath = path.join(workDir, 'sub-store.bundle.cjs')

  const stagingDir = path.join(workDir, '.substore-runtime-staging')
  const stagingBackendPath = path.join(stagingDir, 'sub-store.bundle.cjs')
  const manifestPath = path.join(stagingDir, 'release-manifest.json')
  const checksumsPath = path.join(stagingDir, 'checksums.txt')
  const backupDir = path.join(workDir, '.substore-runtime-backup')

  const componentPaths: SubStoreBackendComponentPaths = {
    backendPath,
    stagingBackendPath,
    backupDir
  }

  const previousRuntimeState = await readSubStoreRuntimeState(workDir)

  let backupState: SubStoreBackendBackupState | undefined
  let backendReplaced = false
  let servicesNeedRestart = false

  const releaseBase =
    `https://github.com/${CUSTOM_SUBSTORE_OWNER}/${CUSTOM_SUBSTORE_REPOSITORY}` +
    `/releases/download/${version}`

  try {
    // Phase 1:
    // 下载和完整性验证期间，当前 Sub-Store backend 保持运行。
    await rm(stagingDir, { recursive: true, force: true })
    mkdirSync(stagingDir, { recursive: true })

    await downloadGitHubAsset(`${releaseBase}/release-manifest.json`, manifestPath)

    await downloadGitHubAsset(`${releaseBase}/checksums.txt`, checksumsPath)

    const manifest = parseSubStoreReleaseManifest(await readFile(manifestPath, 'utf8'), version)

    const expectedBackendSha256 = getSubStoreBackendChecksum(await readFile(checksumsPath, 'utf8'))

    await downloadGitHubAsset(`${releaseBase}/${SUBSTORE_RUNTIME_ASSET}`, stagingBackendPath)

    const stagedBackend = await readFile(stagingBackendPath)

    verifySubStoreBackendChecksum(stagedBackend, expectedBackendSha256)

    await validateSubStoreBackendStaging(stagingBackendPath)

    // Phase 2:
    // 所有网络请求和校验成功后才停止旧 backend。
    servicesNeedRestart = true

    await stopSubStoreBackendServer()

    // Phase 3:
    // 只切换 backend，frontend 完全不动。
    backupState = await replaceSubStoreBackend(componentPaths)
    backendReplaced = true

    // Phase 4:
    // 新 backend 必须实际通过现有 readiness check。
    await startSubStoreBackendServer()

    // Phase 5:
    // 新 backend 成功运行后才提交 runtime marker。
    await writeSubStoreRuntimeState(workDir, {
      version,
      source: SUBSTORE_RUNTIME_REPO,
      asset: SUBSTORE_RUNTIME_ASSET,
      sha256: expectedBackendSha256,
      sourceCommit: manifest.sourceCommit
    })

    servicesNeedRestart = false

    try {
      await cleanupSubStoreBackup(backupDir)
    } catch (cleanupError) {
      await systemLogger.error('Failed to clean up Sub-Store runtime backup', cleanupError)
    }
  } catch (error) {
    const recoveryErrors: unknown[] = []

    if (servicesNeedRestart) {
      try {
        await stopSubStoreBackendServer()
      } catch (candidate) {
        recoveryErrors.push(candidate)
      }

      if (backendReplaced && backupState) {
        try {
          await restoreSubStoreBackend(componentPaths, backupState)
        } catch (candidate) {
          recoveryErrors.push(candidate)
        }
      }

      // 恢复安装前的 runtime marker。
      // 如果安装前没有有效 marker，则确保失败安装不会留下新 marker。
      try {
        if (previousRuntimeState) {
          await writeSubStoreRuntimeState(workDir, previousRuntimeState)
        } else {
          await removeSubStoreRuntimeState(workDir)
        }
      } catch (candidate) {
        recoveryErrors.push(candidate)
      }

      // 即使 marker 恢复失败，也继续尝试恢复旧 backend 服务。
      try {
        await startSubStoreBackendServer()
      } catch (candidate) {
        recoveryErrors.push(candidate)
      }
    }

    await systemLogger.error(`Failed to install Custom Sub-Store runtime ${version}`, error)

    if (recoveryErrors.length > 0) {
      throw new AggregateError(
        [error, ...recoveryErrors],
        'Custom Sub-Store runtime install failed and recovery also failed'
      )
    }

    throw error
  } finally {
    try {
      await rm(stagingDir, { recursive: true, force: true })
    } catch (cleanupError) {
      await systemLogger.error('Failed to clean up Sub-Store runtime staging', cleanupError)
    }
  }
}

export async function downloadSubStore(): Promise<void> {
  const { 'mixed-port': mixedPort = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()

  const workDir = mihomoWorkDir()

  const backendPath = path.join(workDir, 'sub-store.bundle.cjs')
  const frontendDir = path.join(workDir, 'sub-store-frontend')

  // staging / backup 都位于 work 目录。
  // Sub-Store 用户数据位于独立的 subStoreDir()，这里绝不操作该目录。
  const stagingDir = path.join(workDir, '.substore-reinstall-staging')
  const stagingBackendPath = path.join(stagingDir, 'sub-store.bundle.cjs')
  const stagingFrontendDir = path.join(stagingDir, 'dist')
  const backupDir = path.join(workDir, '.substore-reinstall-backup')

  const componentPaths: SubStoreComponentPaths = {
    backendPath,
    frontendDir,
    stagingBackendPath,
    stagingFrontendDir,
    backupDir
  }

  let backupState: SubStoreBackupState | undefined
  let servicesNeedRestart = false
  let componentsReplaced = false

  try {
    // --------------------------------------------------------
    // Phase 1: 下载和验证。
    // 此阶段现有 Sub-Store 服务继续运行。
    // --------------------------------------------------------

    await rm(stagingDir, { recursive: true, force: true })
    mkdirSync(stagingDir, { recursive: true })

    const backendRes = await chromeRequest.get(
      'https://github.com/ABOLUOmathh/Sub-Store/releases/download/2.37.0-custom.3/sub-store.bundle.js',
      {
        responseType: 'arraybuffer',
        headers: { 'Content-Type': 'application/octet-stream' },
        proxy: {
          protocol: 'http',
          host: '127.0.0.1',
          port: mixedPort
        }
      }
    )

    await writeFile(stagingBackendPath, Buffer.from(backendRes.data as Buffer))

    const frontendRes = await chromeRequest.get(
      'https://github.com/sub-store-org/Sub-Store-Front-End/releases/download/2.29.10/dist.zip',
      {
        responseType: 'arraybuffer',
        headers: { 'Content-Type': 'application/octet-stream' },
        proxy: {
          protocol: 'http',
          host: '127.0.0.1',
          port: mixedPort
        }
      }
    )

    const zip = new AdmZip(Buffer.from(frontendRes.data as Buffer))
    zip.extractAllTo(stagingDir, true)

    // backend 必须存在且非空；
    // frontend 必须至少存在有效 index.html。
    await validateSubStoreStaging(stagingBackendPath, stagingFrontendDir)

    // --------------------------------------------------------
    // Phase 2: 下载和验证全部成功后，才停止现有服务。
    // --------------------------------------------------------

    servicesNeedRestart = true

    await stopSubStoreFrontendServer()
    await stopSubStoreBackendServer()

    // --------------------------------------------------------
    // Phase 3: 备份旧组件并切换到新组件。
    // replaceSubStoreComponents 自身包含文件级 rollback。
    // --------------------------------------------------------

    backupState = await replaceSubStoreComponents(componentPaths)
    componentsReplaced = true

    // --------------------------------------------------------
    // Phase 4: 启动新组件。
    // --------------------------------------------------------

    await startSubStoreBackendServer()
    await startSubStoreFrontendServer()

    servicesNeedRestart = false

    // 新组件已经成功启动后才删除旧组件备份。
    try {
      await cleanupSubStoreBackup(backupDir)
    } catch (cleanupError) {
      await systemLogger.error('Failed to clean up Sub-Store reinstall backup', cleanupError)
    }
  } catch (error) {
    let recoveryError: unknown

    // 只有进入停服务阶段以后才需要恢复运行状态。
    if (servicesNeedRestart) {
      try {
        // 防止部分启动成功后仍占用组件文件。
        await stopSubStoreFrontendServer()
        await stopSubStoreBackendServer()

        // replaceSubStoreComponents 若自己失败，会自行 rollback。
        // 如果文件替换已经成功，但后续启动失败，则这里恢复旧组件。
        if (componentsReplaced && backupState) {
          await restoreSubStoreComponents(componentPaths, backupState)
        }

        await startSubStoreBackendServer()
        await startSubStoreFrontendServer()
      } catch (candidate) {
        recoveryError = candidate
      }
    }

    await systemLogger.error('substore.downloadFailed', error)

    if (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        'Sub-Store reinstall failed and recovery also failed'
      )
    }

    throw error
  } finally {
    // staging 无论成功失败都只是临时程序文件，可以安全清理。
    try {
      await rm(stagingDir, { recursive: true, force: true })
    } catch (cleanupError) {
      await systemLogger.error('Failed to clean up Sub-Store reinstall staging', cleanupError)
    }
  }
}
