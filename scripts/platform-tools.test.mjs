import assert from 'node:assert/strict'
import test from 'node:test'
import { tectonicRelease } from './fetch-tectonic.mjs'
import { pickLlhttpLibrary } from './tauri.mjs'

test('selects pinned platform tools without guessing unsupported targets', () => {
  assert.equal(tectonicRelease('linux', 'x64').target, 'x86_64-unknown-linux-gnu')
  assert.equal(tectonicRelease('win32', 'x64').extension, 'zip')
  assert.throws(() => tectonicRelease('android', 'arm64'))
  assert.equal(pickLlhttpLibrary(['libllhttp.9.3.dylib', 'libllhttp.9.4.1.dylib']), 'libllhttp.9.4.1.dylib')
})
