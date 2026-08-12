import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const version = '0.17.0'
const releases = {
  'darwin-arm64': ['aarch64-apple-darwin', 'tar.gz', 'a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667'],
  'darwin-x64': ['x86_64-apple-darwin', 'tar.gz', '7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80'],
  'linux-x64': ['x86_64-unknown-linux-gnu', 'tar.gz', '1a715688baf591e650c8aeb160ae934e181685eecbb38b317de30b269ac5d606'],
  'win32-x64': ['x86_64-pc-windows-msvc', 'zip', 'f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f'],
}

export function tectonicRelease(platform = process.platform, arch = process.arch) {
  const release = releases[`${platform}-${arch}`]
  if (!release) throw new Error(`Tectonic is not packaged for ${platform}-${arch}.`)
  return { target: release[0], extension: release[1], checksum: release[2] }
}

export async function fetchTectonic() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const release = tectonicRelease()
  const archiveName = `tectonic-${version}-${release.target}.${release.extension}`
  const url = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/${archiveName}`
  const temporary = mkdtempSync(join(tmpdir(), 'figureit-tectonic-'))
  try {
    const archive = join(temporary, archiveName)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Tectonic download failed (${response.status}).`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== release.checksum) throw new Error('Tectonic checksum mismatch.')
    writeFileSync(archive, bytes)
    const extracted = spawnSync('tar', ['-xf', archive, '-C', temporary], { stdio: 'inherit' })
    if (extracted.status !== 0) throw new Error(`Could not extract ${basename(archive)}.`)
    const executable = process.platform === 'win32' ? 'tectonic.exe' : 'tectonic'
    const destination = join(root, 'src-tauri', 'binaries', `tectonic-${release.target}${process.platform === 'win32' ? '.exe' : ''}`)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(temporary, executable), destination)
    if (process.platform !== 'win32') chmodSync(destination, 0o755)
    console.log(`Installed Tectonic ${version} for ${release.target}.`)
    return destination
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await fetchTectonic()
