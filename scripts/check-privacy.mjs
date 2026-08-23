import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RULES = [
  {
    name: 'absolute-home-path',
    pattern: /(?:\/(?:Users|home)\/[^\s"'`<>]+|[A-Za-z]:\\Users\\[^\s"'`<>]+|file:\/\/[^\s"'`<>]+)/g,
    // Emscripten's built-in fake $HOME inside bundled wasm runtimes (pdf.js
    // worker); a fixed placeholder, never host identity.
    allow: (match) => match === '/home/web_user',
  },
  {
    name: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: 'credential',
    pattern: /(?:sk-(?:ant|proj)-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/g,
  },
]

const WALK_EXCLUDES = new Set([
  '.git',
  '.claude',
  '.codex',
  'node_modules',
  'coverage',
  'playwright-report',
  'target',
  'test-results',
])

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length
}

export function scanText(file, text) {
  const findings = []

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.allow?.(match[0])) continue
      findings.push({
        file: file.replaceAll('\\', '/'),
        line: lineNumber(text, match.index ?? 0),
        rule: rule.name,
      })
    }
  }

  return findings
}

function walkFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (WALK_EXCLUDES.has(entry.name) || entry.name === 'AGENTS.md') return []
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walkFiles(root, path) : [relative(root, path)]
  })
}

function gitFiles(root) {
  try {
    return execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .split('\n')
      .filter(Boolean)
  } catch {
    return walkFiles(root)
  }
}

function candidateFiles(root) {
  const sourceFiles = gitFiles(root)
  const bundleFiles = existsSync(resolve(root, 'dist'))
    ? walkFiles(resolve(root, 'dist')).map((file) => `dist/${file}`)
    : []

  return [...new Set([...sourceFiles, ...bundleFiles])].sort()
}

export function scanRepository(root) {
  return candidateFiles(root).flatMap((file) => {
    const path = resolve(root, file)
    if (!existsSync(path) || !statSync(path).isFile()) return []
    const bytes = readFileSync(path)
    if (bytes.includes(0)) return []
    return scanText(file, bytes.toString('utf8'))
  })
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const findings = scanRepository(root)

  if (findings.length === 0) {
    console.log('Privacy check passed.')
    return
  }

  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.rule}`)
  }
  process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
