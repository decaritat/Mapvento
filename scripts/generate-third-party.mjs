// Generates the third-party component list shown in the About dialog.
//
// npm: production closure of package-lock.json, license texts from node_modules.
// Rust: `cargo about` (same configuration as THIRD-PARTY-NOTICES.md). The slow
// cargo-about run is cached until Cargo.lock or about.toml change.
//
// Usage: node scripts/generate-third-party.mjs [--out <file>] [--require-rust]
// MAPVENTO_KEEP_NOTICES=1 keeps an already existing output file (used by the
// release build, which receives the file from the license workflow).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const out = resolve(root, outIndex >= 0 ? args[outIndex + 1] : 'src/generated/third-party.json')
const requireRust = args.includes('--require-rust')
const cacheFile = join(root, 'node_modules/.cache/mapvento/rust-components.json')
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i

if (process.env.MAPVENTO_KEEP_NOTICES && existsSync(out)) {
  console.log(`Keeping existing ${out}`)
  process.exit(0)
}

function fail(message) {
  console.error(`Third-party notices: ${message}`)
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function normalizeRepository(value) {
  const raw = typeof value === 'object' && value ? value.url : value
  if (typeof raw !== 'string' || !raw) return ''
  let url = raw.trim().replace(/^git\+/, '').replace(/\.git$/, '')
  if (/^github:/.test(url)) url = `https://github.com/${url.slice(7)}`
  else if (/^git@github\.com:/.test(url)) url = `https://github.com/${url.slice(15)}`
  else if (/^git:\/\//.test(url)) url = url.replace(/^git:/, 'https:')
  else if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`
  return /^https:\/\//.test(url) ? url : ''
}

function npmComponents() {
  const lock = readJson(join(root, 'package-lock.json'))
  const components = []
  for (const [path, info] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (!path || info.dev || info.link) continue
    const dir = join(root, path)
    const metaFile = join(dir, 'package.json')
    if (!existsSync(metaFile)) fail(`${path} is missing; run npm ci first`)
    const meta = readJson(metaFile)
    let license = info.license ?? meta.license
    if (typeof license === 'object' && license) license = license.type
    if (!license) fail(`${path} declares no license`)
    const text = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .map((name) => readFileSync(join(dir, name), 'utf8').trim())
      .join('\n\n')
    if (!text) fail(`${path} contains no license text`)
    components.push({
      ecosystem: 'npm',
      name: info.name ?? path.split('node_modules/').pop(),
      version: info.version ?? meta.version ?? '',
      license: String(license),
      repository: normalizeRepository(meta.repository),
      text,
    })
  }
  return components
}

function rustComponents() {
  const key = createHash('sha256')
    .update(readFileSync(join(root, 'src-tauri/Cargo.lock')))
    .update(readFileSync(join(root, 'src-tauri/about.toml')))
    .digest('hex')
  if (existsSync(cacheFile)) {
    const cached = readJson(cacheFile)
    if (cached.key === key) return cached.components
  }
  const result = spawnSync('cargo', ['about', 'generate', '--format', 'json', '--locked'], {
    cwd: join(root, 'src-tauri'),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.trim().split('\n').slice(-3).join(' ')
    if (requireRust) fail(`cargo about failed: ${reason}`)
    console.warn(`Third-party notices: Rust licenses skipped (${reason})`)
    return null
  }
  const components = []
  for (const license of JSON.parse(result.stdout).licenses) {
    for (const { crate } of license.used_by) {
      components.push({
        ecosystem: 'rust',
        name: crate.name,
        version: crate.version,
        license: license.id,
        repository: normalizeRepository(crate.repository),
        text: license.text.trim(),
      })
    }
  }
  mkdirSync(dirname(cacheFile), { recursive: true })
  writeFileSync(cacheFile, JSON.stringify({ key, components }))
  return components
}

const rust = rustComponents()
const texts = {}
const components = [...npmComponents(), ...(rust ?? [])]
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  .map(({ text, ...component }) => {
    const textId = createHash('sha256').update(text).digest('hex').slice(0, 12)
    texts[textId] = text
    return { ...component, textId }
  })

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ rustIncluded: rust !== null, components, texts }))
console.log(`Wrote ${components.length} components to ${out}`)
