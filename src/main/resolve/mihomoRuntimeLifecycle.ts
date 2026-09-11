import {
  inferLegacyMihomoRuntimeSource,
  resolveMihomoRuntime,
  type MihomoCoreSelection,
  type MihomoRuntimeSource,
  type ResolvedMihomoRuntime
} from './mihomoRuntime'
import {
  migrateLegacyMihomoRuntime,
  type MihomoLegacyIdentityVerifier
} from './mihomoRuntimeInstall'
import { verifyMihomoLegacyRuntimeIdentity } from './mihomoRuntimeIdentity'

let legacyMigrationTail: Promise<void> = Promise.resolve()

async function runSerializedLegacyMigration(task: () => Promise<void>): Promise<void> {
  const run = legacyMigrationTail.then(task, task)
  legacyMigrationTail = run.catch(() => {})
  await run
}

export interface ResolveMihomoRuntimeLifecycleOptions {
  baseDataDir: string
  requestedCore: MihomoCoreSelection
  requestedCorePath: string
  bundledCorePath: string
  legacyBinaryPath: string
  requestedVersion?: string
  requestedSource?: MihomoRuntimeSource
  platform?: NodeJS.Platform
  arch?: string
  verifyIdentity?: MihomoLegacyIdentityVerifier
  onMigrationError?: (error: unknown) => void | Promise<void>
}

export async function resolveMihomoRuntimeLifecycle(
  options: ResolveMihomoRuntimeLifecycleOptions
): Promise<ResolvedMihomoRuntime> {
  const {
    baseDataDir,
    requestedCore,
    requestedCorePath,
    bundledCorePath,
    legacyBinaryPath,
    requestedVersion,
    requestedSource,
    platform = process.platform,
    arch = process.arch,
    verifyIdentity = verifyMihomoLegacyRuntimeIdentity,
    onMigrationError
  } = options

  if (requestedCore !== 'mihomo-specific' || !requestedVersion) {
    return await resolveMihomoRuntime({
      dataDir: baseDataDir,
      requestedCore,
      requestedCorePath,
      bundledCorePath,
      requestedVersion,
      requestedSource,
      platform,
      arch
    })
  }

  const resolvedSource = requestedSource ?? inferLegacyMihomoRuntimeSource(requestedVersion)

  const resolveRequestedRuntime = async (): Promise<ResolvedMihomoRuntime> =>
    await resolveMihomoRuntime({
      dataDir: baseDataDir,
      requestedCore,
      requestedCorePath,
      bundledCorePath,
      requestedVersion,
      requestedSource: resolvedSource,
      platform,
      arch
    })

  // Common path: an already-valid persistent runtime only needs one validation.
  const initialResolution = await resolveRequestedRuntime()

  if (!initialResolution.fallback) {
    return initialResolution
  }

  try {
    await runSerializedLegacyMigration(async () => {
      await migrateLegacyMihomoRuntime({
        baseDataDir,
        legacyBinaryPath,
        version: requestedVersion,
        source: resolvedSource,
        verifyIdentity,
        platform,
        arch
      })
    })
  } catch (error) {
    // Legacy migration is best-effort. A bad/missing/unverifiable old runtime
    // must not make application startup fail.
    try {
      await onMigrationError?.(error)
    } catch {
      // Observer/logging failures must not turn fallback into a startup failure.
    }
  }

  // Migration may have installed/repaired the persistent runtime.
  // Re-resolve to select it, otherwise preserve intent and use bundled fallback.
  return await resolveRequestedRuntime()
}
