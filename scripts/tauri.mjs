import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauriCli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

export function pickLlhttpLibrary(names) {
  return names.filter((name) => /^libllhttp\.\d+(?:\.\d+)+\.dylib$/.test(name) && !name.includes('.9.3.')).sort().at(-1)
}

export function cargoSetup() {
  const located = process.platform === 'win32'
    ? spawnSync('where', ['cargo'], { encoding: 'utf8' })
    : spawnSync('/bin/sh', ['-lc', 'command -v cargo'], { encoding: 'utf8' })
  const cargo = located.stdout.trim().split(/\r?\n/)[0]
  if (!cargo) throw new Error('Cargo is not installed.')
  const check = spawnSync(cargo, ['--version'], { encoding: 'utf8' })
  if (check.status === 0) return { env: process.env, cleanup: () => {} }
  if (process.platform !== 'darwin' || !check.stderr.includes('libllhttp.9.3.dylib')) {
    throw new Error(check.stderr.trim() || 'Cargo could not start.')
  }

  const prefix = spawnSync('brew', ['--prefix', 'llhttp'], { encoding: 'utf8' }).stdout.trim()
  if (!prefix) throw new Error('Homebrew llhttp is unavailable. Reinstall libgit2 with Homebrew.')
  const library = pickLlhttpLibrary(readdirSync(join(prefix, 'lib')))
  if (!library) throw new Error('The installed llhttp library is unavailable. Reinstall libgit2 with Homebrew.')

  const temporary = mkdtempSync(join(tmpdir(), 'figureit-cargo-'))
  const compatibility = join(temporary, 'lib')
  const bin = join(temporary, 'bin')
  mkdirSync(compatibility)
  mkdirSync(bin)
  symlinkSync(join(prefix, 'lib', library), join(compatibility, 'libllhttp.9.3.dylib'))
  const wrapper = join(bin, 'cargo')
  writeFileSync(wrapper, '#!/bin/sh\nDYLD_LIBRARY_PATH="$FIGUREIT_DYLD_PATH${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" exec "$FIGUREIT_REAL_CARGO" "$@"\n')
  chmodSync(wrapper, 0o755)
  return {
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FIGUREIT_DYLD_PATH: compatibility, FIGUREIT_REAL_CARGO: cargo },
    cleanup: () => rmSync(temporary, { recursive: true, force: true }),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const setup = cargoSetup()
  const release = process.platform === 'darwin' && process.arch === 'arm64' ? 'aarch64-apple-darwin' : process.platform === 'darwin' ? 'x86_64-apple-darwin' : process.platform === 'linux' ? 'x86_64-unknown-linux-gnu' : 'x86_64-pc-windows-msvc'
  const localTectonic = join(root, 'src-tauri', 'binaries', `tectonic-${release}${process.platform === 'win32' ? '.exe' : ''}`)
  const env = { ...setup.env, ...(process.argv.includes('dev') && existsSync(localTectonic) ? { FIGUREIT_TECTONIC: localTectonic } : {}) }
  const child = spawn(process.execPath, [tauriCli, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('exit', (code, signal) => {
    setup.cleanup()
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 1)
  })
}
