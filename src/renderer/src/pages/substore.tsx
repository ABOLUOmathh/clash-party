import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner,
  useDisclosure
} from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  downloadSubStore,
  ensureSubStoreServices,
  fetchCustomSubStoreReleases,
  getSubStoreRuntimeState,
  installCustomSubStoreRuntime,
  subStoreFrontendPort,
  subStorePort
} from '@renderer/utils/ipc'
import React, { useEffect, useState } from 'react'
import { HiExternalLink } from 'react-icons/hi'
import { IoMdCloudDownload, IoMdRefresh } from 'react-icons/io'
import { useTranslation } from 'react-i18next'

type SubStoreRelease = Awaited<ReturnType<typeof fetchCustomSubStoreReleases>>[number]

type SubStoreRuntimeState = Awaited<ReturnType<typeof getSubStoreRuntimeState>>

const SubStore: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { useCustomSubStore, customSubStoreUrl } = appConfig || {}

  const {
    isOpen: isRuntimeModalOpen,
    onOpen: onRuntimeModalOpen,
    onClose: onRuntimeModalClose
  } = useDisclosure()

  const [backendPort, setBackendPort] = useState<number | undefined>()
  const [frontendPort, setFrontendPort] = useState<number | undefined>()

  const [isUpdating, setIsUpdating] = useState(false)
  const [isRuntimeInstalling, setIsRuntimeInstalling] = useState(false)
  const [isLoadingReleases, setIsLoadingReleases] = useState(false)

  const [runtimeState, setRuntimeState] = useState<SubStoreRuntimeState>()

  const [releases, setReleases] = useState<SubStoreRelease[]>([])
  const [selectedVersion, setSelectedVersion] = useState('')

  const getPort = async (ensureStarted = true): Promise<void> => {
    if (ensureStarted) {
      const ports = await ensureSubStoreServices()

      setBackendPort(ports.backendPort)
      setFrontendPort(ports.frontendPort)

      return
    }

    setBackendPort(await subStorePort())
    setFrontendPort(await subStoreFrontendPort())
  }

  const refreshRuntimeState = async (): Promise<void> => {
    const state = await getSubStoreRuntimeState()
    setRuntimeState(state)
  }

  const loadRuntimeReleases = async (forceRefresh = false): Promise<void> => {
    setIsLoadingReleases(true)

    try {
      const data = await fetchCustomSubStoreReleases(forceRefresh)

      setReleases(data)

      setSelectedVersion((current) => {
        if (current && data.some((release) => release.name === current)) {
          return current
        }

        if (
          runtimeState?.version &&
          data.some((release) => release.name === runtimeState.version)
        ) {
          return runtimeState.version
        }

        return data[0]?.name ?? ''
      })
    } catch (error) {
      new Notification(`${t('substore.updateFailed')}: ${String(error)}`)
    } finally {
      setIsLoadingReleases(false)
    }
  }

  const openRuntimeManager = async (): Promise<void> => {
    onRuntimeModalOpen()

    try {
      const state = await getSubStoreRuntimeState()

      setRuntimeState(state)

      setIsLoadingReleases(true)

      const data = await fetchCustomSubStoreReleases(false)

      setReleases(data)

      if (state?.version && data.some((release) => release.name === state.version)) {
        setSelectedVersion(state.version)
      } else {
        setSelectedVersion(data[0]?.name ?? '')
      }
    } catch (error) {
      new Notification(`${t('substore.updateFailed')}: ${String(error)}`)
    } finally {
      setIsLoadingReleases(false)
    }
  }

  const installSelectedRuntime = async (): Promise<void> => {
    if (!selectedVersion) return

    setIsRuntimeInstalling(true)

    try {
      new Notification(t('substore.updating'))

      await installCustomSubStoreRuntime(selectedVersion)

      await getPort(false)
      await refreshRuntimeState()

      new Notification(t('substore.updateCompleted'))

      onRuntimeModalClose()
    } catch (error) {
      new Notification(`${t('substore.updateFailed')}: ${String(error)}`)
    } finally {
      setIsRuntimeInstalling(false)
    }
  }

  useEffect(() => {
    void getPort().catch((error) => {
      new Notification(`${t('substore.updateFailed')}: ${error}`)
    })
  }, [t, useCustomSubStore])

  if (!useCustomSubStore && !backendPort) return null
  if (!frontendPort) return null

  return (
    <>
      <BasePage
        title={t('substore.title')}
        header={
          <div className="flex gap-2">
            {!useCustomSubStore && (
              <Button
                title={t('substore.checkUpdate')}
                isIconOnly
                size="sm"
                className="app-nodrag"
                variant="light"
                onPress={() => {
                  void openRuntimeManager()
                }}
              >
                <IoMdRefresh className="text-lg" />
              </Button>
            )}

            <Button
              title={t('substore.reinstall')}
              isIconOnly
              size="sm"
              className="app-nodrag"
              variant="light"
              isLoading={isUpdating}
              onPress={async () => {
                try {
                  new Notification(t('substore.reinstalling'))

                  setIsUpdating(true)

                  await downloadSubStore()

                  await new Promise((resolve) => setTimeout(resolve, 1000))

                  setFrontendPort(0)

                  await getPort(false)
                  await refreshRuntimeState()

                  new Notification(t('substore.reinstallCompleted'))
                } catch (error) {
                  new Notification(`${t('substore.reinstallFailed')}: ${error}`)
                } finally {
                  setIsUpdating(false)
                }
              }}
            >
              <IoMdCloudDownload className="text-lg" />
            </Button>

            <Button
              title={t('substore.openInBrowser')}
              isIconOnly
              size="sm"
              className="app-nodrag"
              variant="light"
              onPress={() => {
                open(
                  `http://127.0.0.1:${frontendPort}?api=${
                    useCustomSubStore ? customSubStoreUrl : `http://127.0.0.1:${backendPort}`
                  }`
                )
              }}
            >
              <HiExternalLink className="text-lg" />
            </Button>
          </div>
        }
      >
        <iframe
          className="w-full h-full"
          allow="clipboard-write; clipboard-read"
          src={`http://127.0.0.1:${frontendPort}?api=${
            useCustomSubStore ? customSubStoreUrl : `http://127.0.0.1:${backendPort}`
          }`}
        />
      </BasePage>

      <Modal
        isOpen={isRuntimeModalOpen}
        onClose={onRuntimeModalClose}
        size="lg"
        backdrop="blur"
        classNames={{ backdrop: 'top-[48px]' }}
      >
        <ModalContent>
          <ModalHeader className="flex app-drag">Sub-Store Runtime</ModalHeader>

          <ModalBody>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-default-500">Runtime</span>

                <Chip size="sm" variant="flat" color={runtimeState ? 'primary' : 'default'}>
                  {runtimeState?.version ?? 'Bundled'}
                </Chip>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  label={t('substore.checkUpdate')}
                  selectedKeys={selectedVersion ? new Set([selectedVersion]) : new Set<string>()}
                  onSelectionChange={(selection) => {
                    setSelectedVersion(selection.currentKey ?? '')
                  }}
                  isDisabled={isLoadingReleases || isRuntimeInstalling}
                >
                  {releases.map((release) => (
                    <SelectItem key={release.name}>{release.name}</SelectItem>
                  ))}
                </Select>

                <Button
                  isIconOnly
                  variant="light"
                  title={t('common.refresh')}
                  isLoading={isLoadingReleases}
                  isDisabled={isRuntimeInstalling}
                  onPress={() => {
                    void loadRuntimeReleases(true)
                  }}
                >
                  <IoMdRefresh className="text-lg" />
                </Button>
              </div>

              {isLoadingReleases && releases.length === 0 && (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            <Button variant="light" onPress={onRuntimeModalClose} isDisabled={isRuntimeInstalling}>
              {t('common.cancel')}
            </Button>

            <Button
              color="primary"
              isLoading={isRuntimeInstalling}
              isDisabled={!selectedVersion || isRuntimeInstalling || isLoadingReleases}
              onPress={() => {
                void installSelectedRuntime()
              }}
            >
              {t('mihomo.installVersion')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

export default SubStore
