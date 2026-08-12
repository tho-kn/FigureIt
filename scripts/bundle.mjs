import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tectonicRelease } from './fetch-tectonic.mjs'

const root = resolve(import.meta.dirname, '..')
const release = tectonicRelease()
const executable = `tectonic-${release.target}${process.platform === 'win32' ? '.exe' : ''}`
const source = join(root, 'src-tauri', 'binaries', executable)
if (!existsSync(source)) throw new Error('Run pnpm fetch:tectonic before pnpm bundle.')
const temporary = mkdtempSync(join(tmpdir(), 'figureit-bundle-'))
try {
  const config = join(temporary, 'platform.json')
  const targets = process.platform === 'darwin' ? ['app'] : process.platform === 'win32' ? ['nsis'] : ['deb', 'appimage']
  writeFileSync(config, JSON.stringify({ bundle: { targets, resources: { [source]: process.platform === 'win32' ? 'tectonic.exe' : 'tectonic' } } }))
  const env = { ...process.env }
  if (process.platform !== 'win32') env.RUSTFLAGS = `${env.RUSTFLAGS ? `${env.RUSTFLAGS} ` : ''}--remap-path-prefix=${root}=/figureit --remap-path-prefix=${process.env.HOME ?? root}=/build`
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'tauri.mjs'), 'build', '--config', config], { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`FigureIt bundle failed (${result.status ?? 'signal'}).`)
  console.log(`Bundled FigureIt with ${basename(source)}.`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
