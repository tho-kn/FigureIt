import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { releaseVersion } from './bundle.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

export function releaseAssetNames(target, version) {
  releaseVersion(version)
  const names = {
    'macos-arm64': [`FigureIt-${version}-macos-arm64.tar.gz`],
    'macos-x64': [`FigureIt-${version}-macos-x64.tar.gz`],
    'windows-x64': [`FigureIt-${version}-windows-x64-setup.exe`],
    'linux-x64': [`FigureIt-${version}-linux-x64.deb`, `FigureIt-${version}-linux-x64.AppImage`],
    'android-arm64': [`FigureIt-${version}-android-arm64-preview.apk`],
  }[target]
  if (!names) throw new Error('Unsupported release target.')
  return names
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

function one(directory, suffix, version) {
  const matches = files(directory).filter((path) => basename(path).includes(version) && path.endsWith(suffix))
  if (matches.length !== 1) throw new Error(`Expected one ${suffix} bundle for this version.`)
  return matches[0]
}

export function collectRelease(target, version) {
  const names = releaseAssetNames(target, version)
  const output = resolve(root, 'src-tauri', 'target', 'release-assets')
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })

  if (target.startsWith('macos-')) {
    const result = spawnSync('tar', ['-czf', join(output, names[0]), '-C', resolve(root, 'src-tauri', 'target', 'release', 'bundle', 'macos'), 'FigureIt.app'], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error('Could not archive the macOS application.')
  } else if (target === 'windows-x64') {
    copyFileSync(one(resolve(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis'), '-setup.exe', version), join(output, names[0]))
  } else if (target === 'linux-x64') {
    const bundle = resolve(root, 'src-tauri', 'target', 'release', 'bundle')
    copyFileSync(one(resolve(bundle, 'deb'), '.deb', version), join(output, names[0]))
    copyFileSync(one(resolve(bundle, 'appimage'), '.AppImage', version), join(output, names[1]))
  } else {
    copyFileSync(resolve(root, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk', 'universal', 'debug', 'app-universal-debug.apk'), join(output, names[0]))
  }
  console.log(`Collected ${names.join(', ')}.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) collectRelease(process.argv[2] ?? '', process.argv[3] ?? '')
