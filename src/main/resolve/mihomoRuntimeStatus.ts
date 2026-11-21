import { getAppConfig } from '../config'
import { resolveActiveMihomoRuntime } from './mihomoActiveRuntime'
import type {
  MihomoCoreSelection,
  MihomoRuntimeFallbackReason,
  MihomoRuntimeSource
} from './mihomoRuntime'

export interface MihomoRuntimeStatus {
  requestedCore: MihomoCoreSelection
  requestedVersion?: string
  requestedSource?: MihomoRuntimeSource

  activeCore: MihomoCoreSelection
  activeVersion?: string
  activeSource?: MihomoRuntimeSource

  fallback: boolean
  fallbackReason?: MihomoRuntimeFallbackReason
}

export async function getMihomoRuntimeStatus(): Promise<MihomoRuntimeStatus> {
  const { core = 'mihomo', specificVersion, specificSource } = await getAppConfig()

  // UI status resolution is read-only. Legacy migration remains startup-owned.
  const runtime = await resolveActiveMihomoRuntime({
    core,
    specificVersion,
    specificSource
  })

  return {
    requestedCore: runtime.requestedCore,
    requestedVersion: runtime.requestedVersion,
    requestedSource: runtime.requestedSource,
    activeCore: runtime.activeCore,
    activeVersion: runtime.activeVersion,
    activeSource: runtime.activeSource,
    fallback: runtime.fallback,
    fallbackReason: runtime.fallbackReason
  }
}
