import { hasCoreProcess, restartCore } from '../core/manager'
import { patchAppConfig } from '../config'
import { clearVersionCache, installCustomMihomoCore, installMihomoCore } from '../utils/github'

export type MihomoSpecificRuntimeSource = 'official' | 'custom'

export async function installSpecificMihomoCore(
  version: string,
  source: MihomoSpecificRuntimeSource = 'official'
): Promise<void> {
  const wasRunning = hasCoreProcess()

  if (source === 'custom') {
    clearVersionCache('ABOLUOmathh', 'mihomo')
    await installCustomMihomoCore(version)
  } else {
    clearVersionCache('MetaCubeX', 'mihomo')
    await installMihomoCore(version)
  }

  try {
    // Runtime commit succeeded. User Intent is committed only afterwards.
    // patchAppConfig propagates write failures and updates in-memory config
    // only after the atomic write succeeds.
    await patchAppConfig({
      core: 'mihomo-specific',
      specificVersion: version,
      specificSource: source
    })
  } catch (error) {
    // Runtime installation already succeeded. On Windows it may have stopped
    // the previously running persistent specific core before replacing its
    // executable. If persisting the new intent fails, keep the old intent and
    // restore service availability through the normal resolver/fallback path.
    if (wasRunning && !hasCoreProcess()) {
      try {
        await restartCore()
      } catch (restartError) {
        throw new AggregateError(
          [error, restartError],
          'Failed to persist Mihomo specific selection and restore the previous core state'
        )
      }
    }

    throw error
  }
}
