import { dataDir, mihomoCorePath } from '../utils/dirs'
import {
  resolveMihomoRuntime,
  type MihomoCoreSelection,
  type MihomoRuntimeSource,
  type ResolvedMihomoRuntime
} from './mihomoRuntime'
import {
  resolveMihomoRuntimeLifecycle,
  type ResolveMihomoRuntimeLifecycleOptions
} from './mihomoRuntimeLifecycle'

export interface MihomoRuntimeSelection {
  core: MihomoCoreSelection
  specificVersion?: string
  specificSource?: MihomoRuntimeSource
}

export interface ResolveActiveMihomoRuntimeOptions {
  migrateLegacy?: boolean
  onMigrationError?: ResolveMihomoRuntimeLifecycleOptions['onMigrationError']
}

export async function resolveActiveMihomoRuntime(
  selection: MihomoRuntimeSelection,
  options: ResolveActiveMihomoRuntimeOptions = {}
): Promise<ResolvedMihomoRuntime> {
  const { core, specificVersion, specificSource } = selection
  const baseDataDir = dataDir()
  const requestedCorePath = mihomoCorePath(core)
  const bundledCorePath = mihomoCorePath('mihomo')

  if (options.migrateLegacy) {
    return await resolveMihomoRuntimeLifecycle({
      baseDataDir,
      requestedCore: core,
      requestedCorePath,
      bundledCorePath,
      legacyBinaryPath: mihomoCorePath('mihomo-specific'),
      requestedVersion: specificVersion,
      requestedSource: specificSource,
      onMigrationError: options.onMigrationError
    })
  }

  return await resolveMihomoRuntime({
    dataDir: baseDataDir,
    requestedCore: core,
    requestedCorePath,
    bundledCorePath,
    requestedVersion: specificVersion,
    requestedSource: specificSource
  })
}
