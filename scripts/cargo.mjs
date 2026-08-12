import { spawn } from 'node:child_process'
import { cargoSetup } from './tauri.mjs'

const setup = cargoSetup()
const child = spawn('cargo', process.argv.slice(2), { env: setup.env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => {
  setup.cleanup()
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
