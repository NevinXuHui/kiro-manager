import { openUrl } from '@tauri-apps/plugin-opener'

export const REPOSITORY_URL = 'https://github.com/NeuraLabHQ/kiro-manager'

export interface UpdateAsset {
  name: string
  downloadUrl: string
  size: number
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseName: string
  releaseNotes: string
  releaseUrl: string
  publishedAt?: string
  assets: UpdateAsset[]
}

const INSTALLER_EXTENSIONS = ['.msi', '.exe', '.dmg', '.appimage', '.deb', '.rpm']

class UpdateService {
  async openRepository(): Promise<void> {
    await openUrl(REPOSITORY_URL)
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    return (window as any).__TAURI__.core.invoke('check_for_updates')
  }

  async downloadUpdateAsset(asset: UpdateAsset): Promise<string> {
    return (window as any).__TAURI__.core.invoke('download_update_asset', {
      downloadUrl: asset.downloadUrl,
      fileName: asset.name
    })
  }

  pickInstallAsset(assets: UpdateAsset[]): UpdateAsset | null {
    const installable = assets.filter(asset => {
      const name = asset.name.toLowerCase()
      return INSTALLER_EXTENSIONS.some(ext => name.endsWith(ext))
    })

    if (installable.length === 0) return assets[0] || null

    const isWindows = navigator.userAgent.toLowerCase().includes('windows')
    if (isWindows) {
      return installable.find(asset => asset.name.toLowerCase().endsWith('.msi'))
        || installable.find(asset => asset.name.toLowerCase().endsWith('.exe'))
        || installable[0]
    }

    return installable[0]
  }

  formatAssetSize(size: number): string {
    if (!Number.isFinite(size) || size <= 0) return '未知大小'
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }
}

export const updateService = new UpdateService()
