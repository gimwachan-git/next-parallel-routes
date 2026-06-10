'use strict'

const fs = require('fs')
const path = require('path')
const chalk = require('chalk')

const PRELOAD_PATH = path.join(__dirname, 'preload.cjs')

const ENV_VERBOSE = 'NEXT_PARALLEL_GSP_DEDUPE_VERBOSE'
const ENV_PATHS = 'NEXT_PARALLEL_ROUTES_PATHS_JSON'

// Re-export the macro helper for convenience. The canonical user-facing entry
// is `next-parallel-routes/macro` (avoids dragging this file's
// build-time deps — fs, path, Module — into a user app bundle).
const { staticParamsFromConfig } = require('./macro.cjs')

// ---------------------------------------------------------------------------
// 日本語エラーメッセージ + chalk 着色
// ---------------------------------------------------------------------------
// プラグインが投げる Error はすべて Next.js / pnpm を通して dev / CI ログに
// 流れるため、IDE / terminal で視認しやすい形式で出力する。chalk は TTY 自動
// 検出があるので CI (非 TTY) では ANSI コードが空文字に落ち plain text 出力。
//
// 構造化スキーマ:
//   { title, sections: [{ header, items[], hint? }] }
// 各 section の items は path (cyan), hint は補足説明 (dim italic)。

const TAG = '[next-parallel-routes]'

function buildJpError(title, sections) {
  const lines = [chalk.red.bold(TAG + ' ' + title)]
  for (const sec of sections) {
    if (sec.header) lines.push('  ' + chalk.yellow(sec.header))
    for (const it of sec.items || []) {
      lines.push('    - ' + chalk.cyan(it))
    }
    if (sec.hint) lines.push('    ' + chalk.dim.italic('→ ' + sec.hint))
  }
  return new Error(lines.join('\n'))
}

function formatRoute(segments, trailingSlash) {
  return '/' + segments.join('/') + (trailingSlash ? '/' : '')
}

// `/404` (or `/404/`) is handled by Next's `_not-found` flow, not by
// `@metadata/[...slug]`. Mirroring the old `scripts/check-route-labels.mjs`.
function frameworkSpecialRoutes(trailingSlash) {
  return new Set([formatRoute(['404'], trailingSlash)])
}

function collectRealRoutes(dir, segments, trailingSlash, specialRoutes) {
  const routes = new Set()
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch (err) {
    throw buildJpError('appDir を読み込めません', [
      { items: [dir + '   (' + err.message + ')'] },
      {
        hint:
          'next.config.ts の cwd 配下に `app/` ディレクトリが存在することを' +
          '確認してください (または options.appDir で明示指定)',
      },
    ])
  }
  for (const entry of entries) {
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) {
      const transparent =
        (entry.startsWith('(') && entry.endsWith(')')) || entry.startsWith('@')
      if (transparent) {
        for (const r of collectRealRoutes(full, segments, trailingSlash, specialRoutes)) {
          routes.add(r)
        }
        continue
      }
      if (entry.startsWith('[')) continue
      for (const r of collectRealRoutes(full, segments.concat([entry]), trailingSlash, specialRoutes)) {
        routes.add(r)
      }
      continue
    }
    if (entry !== 'page.tsx') continue
    if (segments.length === 0) continue
    const route = formatRoute(segments, trailingSlash)
    if (specialRoutes.has(route)) continue
    routes.add(route)
  }
  return routes
}

function checkRouteRegistry(appDir, paths, trailingSlash, verbose) {
  // Pre-check: user's paths must agree with nextConfig.trailingSlash.
  // (Comparing against realRoutes after the fact would also catch this, but
  //  the error would be confusing — every path would show up as both missing
  //  and orphan. Reporting the underlying cause directly is much clearer.)
  const inconsistentMissing = []
  const inconsistentExtra = []
  for (const p of paths) {
    const ends = p.endsWith('/')
    if (trailingSlash && !ends) {
      inconsistentMissing.push(p)
    } else if (!trailingSlash && ends && p !== '/') {
      inconsistentExtra.push(p)
    }
  }
  if (inconsistentMissing.length > 0 || inconsistentExtra.length > 0) {
    const sections = []
    if (inconsistentMissing.length > 0) {
      sections.push({
        header:
          'nextConfig.trailingSlash: true ですが末尾スラッシュが必要なエントリ:',
        items: inconsistentMissing,
        hint:
          'paths の各 entry 末尾に `/` を付けてください (例: `/account` → `/account/`)',
      })
    }
    if (inconsistentExtra.length > 0) {
      sections.push({
        header:
          'nextConfig.trailingSlash: false ですが末尾スラッシュが不要なエントリ:',
        items: inconsistentExtra,
        hint:
          'paths の各 entry 末尾の `/` を外してください (例: `/account/` → `/account`)',
      })
    }
    throw buildJpError(
      'paths と nextConfig.trailingSlash の整合性エラー',
      sections
    )
  }

  const specialRoutes = frameworkSpecialRoutes(trailingSlash)
  const realRoutes = collectRealRoutes(appDir, [], trailingSlash, specialRoutes)
  const pathSet = new Set(paths)

  const missing = []
  for (const r of realRoutes) {
    if (!pathSet.has(r)) missing.push(r)
  }
  const orphans = []
  for (const p of paths) {
    if (!realRoutes.has(p)) orphans.push(p)
  }

  if (missing.length === 0 && orphans.length === 0) {
    if (verbose) {
      console.log(
        '[next-parallel-routes] route registry OK (' +
          realRoutes.size +
          ' routes, ' +
          pathSet.size +
          ' registry entries)',
      )
    }
    return
  }

  const sections = []
  if (missing.length > 0) {
    sections.push({
      header: 'app に page.tsx は存在するが `paths` に未登録のルート:',
      items: missing,
      hint:
        '上記ルートを path-labels SSOT に追加するか、不要なら page.tsx を削除してください',
    })
  }
  if (orphans.length > 0) {
    sections.push({
      header: '`paths` に登録されているが app に該当 page.tsx が無いエントリ (orphan):',
      items: orphans,
      hint:
        '上記エントリを path-labels SSOT から削除するか、対応する page.tsx を作成してください',
    })
  }
  throw buildJpError('ルート整合性エラー', sections)
}

// ---------------------------------------------------------------------------
// Auto-generate strict route types (`Route` / `LinkProps` / router methods)
// ---------------------------------------------------------------------------
// Writes `<appDir>/../.next/types/parallel-routes.d.ts` augmenting `next`,
// `next/link`, and `next/navigation` so that `Route<T>` is a literal union
// of `paths` only (no `[...slug]` catch-all leak that next.js's built-in
// `typedRoutes: true` suffers from when the app has a root catch-all).
//
// Why not just use next 16's `typedRoutes: true`?
//   - When the app has parallel-slot catch-alls (`@<slot>/[...slug]/page.tsx`),
//     next folds them into a `DynamicRoutes<T>` branch in `RouteImpl<T>` that
//     matches any `/something` literal. Typo routes like `/aboot` then sneak
//     through `<Link href="/aboot" />` without an error.
//   - Plugin owns the SSG `paths` SSOT in next.config, so it can emit a
//     strict union with no catch-all branch.
//
// Conflicts with `nextConfig.typedRoutes`: do not enable both. Plugin's
// generated file would clash with next.js's own `.next/types/{routes,link}.d.ts`
// module augmentations.

function pathsToTypeLiteralUnion(paths) {
  // User code in the wild uses both `/foo` and `/foo/` (both navigate to the
  // same SSG html when `trailingSlash: true`). Emit both forms in the union
  // so both type-check.
  const forms = new Set()
  for (const p of paths) {
    if (p === '/') {
      forms.add('/')
      continue
    }
    const noSlash = p.endsWith('/') ? p.slice(0, -1) : p
    const withSlash = noSlash + '/'
    forms.add(noSlash)
    forms.add(withSlash)
  }
  const sorted = Array.from(forms).sort()
  return sorted.map(function (p) { return '  | `' + p + '`' }).join('\n')
}

function hasRootPage(appDir) {
  // Detect a root `/` page by walking `app/` and matching the first
  // `page.tsx` that resolves to zero URL segments (route groups `(x)` and
  // parallel slots `@x` are transparent for URL purposes).
  function walk(dir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
    for (const e of entries) {
      if (e.isFile() && e.name === 'page.tsx') return true
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const name = e.name
      // Only descend into transparent segments (route groups + parallel slots).
      if (!(name.startsWith('(') && name.endsWith(')')) && !name.startsWith('@')) continue
      if (walk(path.join(dir, name))) return true
    }
    return false
  }
  return walk(appDir)
}

function renderRouteTypesDts(paths, externalRoutes, includeRoot) {
  const ssgPaths = includeRoot ? Array.from(new Set(['/', ...paths])) : paths
  const ssgUnion = pathsToTypeLiteralUnion(ssgPaths)
  const hasExternal = externalRoutes && externalRoutes.length > 0
  const externalUnion = hasExternal ? pathsToTypeLiteralUnion(externalRoutes) : ''
  return (
    '// AUTO-GENERATED by next-parallel-routes — do not edit\n' +
    '// Source: next.config.ts `paths` (' + ssgPaths.length + ' SSG routes' +
    (hasExternal ? ', ' + externalRoutes.length + ' external routes' : '') + ')\n' +
    '//\n' +
    '// Strict route-type augmentation. Unlike next.js`s built-in typedRoutes,\n' +
    '// this union does NOT include a catch-all branch, so typo routes like\n' +
    '// `<Link href="/aboot" />` are rejected at compile time.\n' +
    '\n' +
    'declare namespace __nbp_route_types__ {\n' +
    '  type SearchOrHash = `?${string}` | `#${string}`\n' +
    '  type WithProtocol = `${string}:${string}`\n' +
    '\n' +
    '  type SsgRoute =\n' +
    ssgUnion + '\n' +
    '\n' +
    (hasExternal
      ? '  type ExternalRoute =\n' + externalUnion + '\n\n'
      : '  type ExternalRoute = never\n\n') +
    '  type AppRoute = SsgRoute | ExternalRoute\n' +
    '\n' +
    '  type RouteImpl<_T = string> =\n' +
    '    | AppRoute\n' +
    '    | SearchOrHash\n' +
    '    | WithProtocol\n' +
    '    | `${AppRoute}${SearchOrHash}`\n' +
    '}\n' +
    '\n' +
    "declare module 'next' {\n" +
    "  export { default } from 'next/types.js'\n" +
    "  export * from 'next/types.js'\n" +
    '  export type Route<T extends string = string> = __nbp_route_types__.RouteImpl<T>\n' +
    '}\n' +
    '\n' +
    "declare module 'next/link' {\n" +
    "  export { useLinkStatus } from 'next/dist/client/link.js'\n" +
    "  import type { LinkProps as OriginalLinkProps } from 'next/dist/client/link.js'\n" +
    "  import type { AnchorHTMLAttributes, DetailedHTMLProps } from 'react'\n" +
    "  import type { UrlObject } from 'url'\n" +
    '\n' +
    '  type LinkRestProps = Omit<\n' +
    '    Omit<\n' +
    '      DetailedHTMLProps<\n' +
    '        AnchorHTMLAttributes<HTMLAnchorElement>,\n' +
    '        HTMLAnchorElement\n' +
    '      >,\n' +
    '      keyof OriginalLinkProps\n' +
    '    > &\n' +
    '      OriginalLinkProps,\n' +
    "    'href'\n" +
    '  >\n' +
    '\n' +
    '  export type LinkProps<RouteInferType = string> = LinkRestProps & {\n' +
    '    href: __nbp_route_types__.RouteImpl<RouteInferType> | UrlObject\n' +
    '  }\n' +
    '\n' +
    '  export default function Link<RouteType = string>(props: LinkProps<RouteType>): JSX.Element\n' +
    '}\n' +
    '\n' +
    "declare module 'next/navigation' {\n" +
    "  export * from 'next/dist/client/components/navigation.js'\n" +
    "  import type { NavigateOptions, AppRouterInstance as OriginalAppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime.js'\n" +
    '\n' +
    '  interface AppRouterInstance extends OriginalAppRouterInstance {\n' +
    '    push<RouteType = string>(href: __nbp_route_types__.RouteImpl<RouteType>, options?: NavigateOptions): void\n' +
    '    replace<RouteType = string>(href: __nbp_route_types__.RouteImpl<RouteType>, options?: NavigateOptions): void\n' +
    '    prefetch<RouteType = string>(href: __nbp_route_types__.RouteImpl<RouteType>): void\n' +
    '  }\n' +
    '\n' +
    '  export function useRouter(): AppRouterInstance\n' +
    '}\n'
  )
}

function generateRouteTypes(appDir, paths, externalRoutes, verbose) {
  // Sibling to `app/` so user `tsconfig.json` `.next/types/**/*.ts` include
  // picks it up automatically (same pattern as next 16's own typedRoutes).
  const outDir = path.join(appDir, '..', '.next', 'types')
  const outFile = path.join(outDir, 'parallel-routes.d.ts')
  const includeRoot = hasRootPage(appDir)
  const ext = externalRoutes || []
  const expected = renderRouteTypesDts(paths, ext, includeRoot)
  let current = ''
  try { current = fs.readFileSync(outFile, 'utf8') } catch {}
  if (current === expected) {
    if (verbose) {
      console.log('[next-parallel-routes] route types: unchanged (' + paths.length + ' SSG' +
        (ext.length ? ', ' + ext.length + ' external' : '') + ')')
    }
    return
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outFile, expected)
  if (verbose) {
    console.log('[next-parallel-routes] route types: generated ' + paths.length + ' SSG' +
      (ext.length ? ', ' + ext.length + ' external' : '') +
      ' → .next/types/parallel-routes.d.ts')
  }
}

// ---------------------------------------------------------------------------
// Auto-generate Group 2 shim marker files
// ---------------------------------------------------------------------------
// For each `<appDir>/.../@<slot>/default.tsx` in `slots`, generate a sibling
// `[...slug]/page.tsx` that mirrors the slot for every registered path.
//
// Templates branch on whether `default.tsx` has any top-level `import`:
//   - No imports (e.g. `export default function Default() { return null }`):
//     inline a `return null` body; do NOT `import '../default'` because a
//     Linux + node 24 + isolatedModules tsc edge case reports TS2307 when the
//     sibling has zero external imports.
//   - Has imports: re-export via `import Default from '../default'`.
//
// Files are idempotent (content compared before write) and carry an
// AUTO-GENERATED header so accidental hand edits surface obviously in diffs.

function shimHeader(slotName) {
  return (
    '// AUTO-GENERATED by next-parallel-routes — do not edit\n' +
    '// Source: ' + slotName + '/default.tsx\n' +
    '// To customise, edit default.tsx (and/or add a slot-specific page.tsx)\n'
  )
}

function shimComponentName(slotName) {
  const clean = slotName.replace(/^@/, '')
  return clean.charAt(0).toUpperCase() + clean.slice(1) + 'CatchAll'
}

function renderInlineShim(slotName) {
  return (
    shimHeader(slotName) +
    "import { staticParamsFromConfig } from 'next-parallel-routes/macro'\n" +
    '\n' +
    'export const dynamicParams = false\n' +
    'export const generateStaticParams = staticParamsFromConfig()\n' +
    '\n' +
    'export default function ' + shimComponentName(slotName) + '() {\n' +
    '  return null\n' +
    '}\n'
  )
}

function renderRedirectShim(slotName) {
  return (
    shimHeader(slotName) +
    "import { staticParamsFromConfig } from 'next-parallel-routes/macro'\n" +
    "import Default from '../default'\n" +
    '\n' +
    'export const dynamicParams = false\n' +
    'export const generateStaticParams = staticParamsFromConfig()\n' +
    'export default Default\n'
  )
}

function collectSlotDirs(dir, slots, acc) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const full = path.join(dir, e.name)
    if (e.name.startsWith('@') && slots.indexOf(e.name) !== -1) {
      const defaultFile = path.join(full, 'default.tsx')
      if (fs.existsSync(defaultFile)) acc.push({ slotDir: full, slotName: e.name })
    }
    collectSlotDirs(full, slots, acc)
  }
  return acc
}

// User-written `[...slug]/page.tsx` files (Group 1 dictionary-driven mirrors,
// Group 3 nested catch-alls) are detected by the absence of the plugin's
// AUTO-GENERATED header. Plugin **never** overwrites them — `autoShimSlots`
// is a one-way auto-fill for sibling-slot-name matches that don't already
// have hand-written page.tsx, so the same slot name (e.g. `@title`) can be
// Group 1 in one part of the app and Group 2 promotion null elsewhere.
const SHIM_HEADER_NEEDLE = 'AUTO-GENERATED by next-parallel-routes'

function isPluginManagedShim(content) {
  return typeof content === 'string' && content.indexOf(SHIM_HEADER_NEEDLE) !== -1
}

function autoGenShimSlots(appDir, slots, verbose) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return { generatedFiles: [], generatedDirs: [] }
  }
  const matches = collectSlotDirs(appDir, slots, [])
  let generated = 0
  let unchanged = 0
  let skippedUserWritten = 0
  const generatedFiles = []
  const generatedDirs = []
  for (const m of matches) {
    const defaultSource = fs.readFileSync(path.join(m.slotDir, 'default.tsx'), 'utf8')
    const hasImports = /^\s*import\s/m.test(defaultSource)
    const expected = hasImports ? renderRedirectShim(m.slotName) : renderInlineShim(m.slotName)
    const pageDir = path.join(m.slotDir, '[...slug]')
    const pageFile = path.join(pageDir, 'page.tsx')
    let current = ''
    try { current = fs.readFileSync(pageFile, 'utf8') } catch {}
    if (current && !isPluginManagedShim(current)) {
      // User-written page.tsx — leave it alone, do not register for cleanup.
      skippedUserWritten++
      continue
    }
    generatedFiles.push(pageFile)
    generatedDirs.push(pageDir)
    if (current === expected) {
      unchanged++
      continue
    }
    fs.mkdirSync(pageDir, { recursive: true })
    fs.writeFileSync(pageFile, expected)
    generated++
  }
  if (verbose && (generated > 0 || matches.length > 0)) {
    console.log(
      '[next-parallel-routes] auto-shim: ' + generated + ' generated, ' +
        unchanged + ' unchanged, ' + skippedUserWritten + ' user-written skipped ' +
        '(slots: ' + slots.join(', ') + ')',
    )
  }
  return { generatedFiles: generatedFiles, generatedDirs: generatedDirs }
}

// ---------------------------------------------------------------------------
// Transient shim mode: cleanup on process exit
// ---------------------------------------------------------------------------
// When `transientShim: true`, plugin removes the AUTO-GENERATED `[...slug]/page.tsx`
// files (and now-empty `[...slug]/` dirs) at process exit time. This keeps the
// source tree visually clean between builds.
//
// Cleanup is registered on:
//   - `exit` event (covers `next build` normal completion, `process.exit()` calls)
//   - `SIGINT` (ctrl-C in `next dev` / `next build`)
//   - `SIGTERM` (sent by orchestrators like docker, k8s, turbo)
//
// Cleanup runs ONCE (guarded by `cleaned` flag). Worker child processes spawned
// by `next build` (jest-worker) inherit env vars but they do not re-evaluate
// `next.config.ts`, so they never re-register cleanup — only the main process
// does the actual unlink.

let _cleanupRegistered = false

function registerTransientCleanup(filePaths, dirPaths, verbose) {
  if (_cleanupRegistered) return
  _cleanupRegistered = true

  let cleaned = false
  const cleanup = function () {
    if (cleaned) return
    cleaned = true
    let removedFiles = 0
    let removedDirs = 0
    for (const f of filePaths) {
      // Double-check: only unlink files that still carry the AUTO-GENERATED
      // header. If a user manually replaced the file with hand-written code
      // mid-build, leave it alone.
      try {
        const content = fs.readFileSync(f, 'utf8')
        if (!isPluginManagedShim(content)) continue
        fs.unlinkSync(f); removedFiles++
      } catch (_err) {}
    }
    // Only remove `[...slug]/` dirs that are now empty (defence against user
    // adding sibling files inside the dir).
    for (const d of dirPaths) {
      try {
        const entries = fs.readdirSync(d)
        if (entries.length === 0) { fs.rmdirSync(d); removedDirs++ }
      } catch (_err) {}
    }
    if (verbose) {
      console.log(
        '[next-parallel-routes] transient shim cleanup: ' +
          removedFiles + ' file(s), ' + removedDirs + ' dir(s) removed'
      )
    }
  }

  process.on('exit', cleanup)
  process.once('SIGINT', function () {
    cleanup()
    process.exit(130)
  })
  process.once('SIGTERM', function () {
    cleanup()
    process.exit(143)
  })
}

// ---------------------------------------------------------------------------
// .gitignore management for AUTO-GENERATED shim files
// ---------------------------------------------------------------------------
// Writes an `app/.gitignore` (sibling of slot dirs) with explicit per-file
// entries for every generated `[...slug]/page.tsx`. This is the second line
// of defence: if process is `kill -9`'d or crashes before cleanup fires,
// residual files won't appear in `git status` / pollute diffs.
//
// Entries are bracketed by a sentinel block so manual user entries in the
// same file are preserved across plugin re-runs.

const GITIGNORE_BEGIN = '# >>> next-parallel-routes BEGIN'
const GITIGNORE_END = '# <<< next-parallel-routes END'

function updateGitignore(appDir, filePaths, verbose) {
  const gitignoreFile = path.join(appDir, '.gitignore')
  // Use forward slashes (git on Windows also expects forward slashes here)
  // and make paths relative to `app/.gitignore` directory.
  //
  // CRITICAL: git fnmatch treats `[...]` as a character class, so a raw
  // `[...slug]` pattern matches a single char from `.`/`s`/`l`/`u`/`g`,
  // NOT the literal directory name `[...slug]`. We must backslash-escape
  // `[` and `]` to make git treat them as literal characters. `(` / `)` /
  // `@` are not fnmatch metachars so they pass through unchanged.
  const sorted = filePaths
    .map(function (f) {
      const rel = path.relative(appDir, f).split(path.sep).join('/')
      return rel.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
    })
    .sort()
  const block = [
    GITIGNORE_BEGIN,
    '# AUTO-MANAGED — paths below correspond to plugin-generated `[...slug]/page.tsx`.',
    '# To stop ignoring, drop `transientShim` / `autoShimSlots` from `next.config`.',
    ...sorted,
    GITIGNORE_END,
  ].join('\n') + '\n'

  let current = ''
  try { current = fs.readFileSync(gitignoreFile, 'utf8') } catch (_err) {}

  let next
  const beginIdx = current.indexOf(GITIGNORE_BEGIN)
  const endIdx = current.indexOf(GITIGNORE_END)
  if (beginIdx !== -1 && endIdx !== -1) {
    // Replace existing block (preserve surrounding user content).
    const before = current.slice(0, beginIdx)
    const after = current.slice(endIdx + GITIGNORE_END.length)
    // Strip the trailing newline that follows the END marker (so we don't
    // accumulate blank lines on every regen).
    const afterTrim = after.replace(/^\n/, '')
    next = before + block + afterTrim
  } else if (current.length === 0) {
    next = block
  } else {
    next = current.replace(/\n*$/, '\n') + block
  }

  if (current === next) return
  fs.writeFileSync(gitignoreFile, next)
  if (verbose) {
    console.log(
      '[next-parallel-routes] gitignore: updated ' +
        sorted.length + ' entries in ' + path.relative(process.cwd(), gitignoreFile)
    )
  }
}

function installDedupePatch(opts, paths, trailingSlash) {
  if (opts.verbose === false) process.env[ENV_VERBOSE] = '0'
  // Pass paths to preload (which runs in every worker via NODE_OPTIONS). It
  // converts `'/foo/bar/'` → `{ slug: ['foo', 'bar'] }` for marker GSPs.
  process.env[ENV_PATHS] = JSON.stringify({
    paths: paths,
    trailingSlash: !!trailingSlash,
  })
  require(PRELOAD_PATH)
  const requireFlag = '--require=' + PRELOAD_PATH
  const existing = process.env.NODE_OPTIONS || ''
  if (!existing.includes(PRELOAD_PATH)) {
    process.env.NODE_OPTIONS = existing
      ? existing + ' ' + requireFlag
      : requireFlag
  }
}

/**
 * Wraps a NextConfig with build-time guarantees for parallel-route catch-all
 * SSG under `output: 'export'`:
 *
 *  1. **Route registry health check** — fails the build (hard error) if the
 *     filesystem app routes and `options.paths` disagree (missing entries or
 *     orphans). Replaces a standalone `check-route-labels`-style script.
 *
 *  2. **`staticParamsFromConfig()` marker resolution** — every parallel-slot
 *     `[...slug]/page.tsx` that uses the macro helper gets its placeholder
 *     `generateStaticParams` replaced at runtime with one returning
 *     `paths.map(p => ({ slug: p.split('/').filter(Boolean) }))`.
 *
 *  3. **Route-aware filter for nested catch-alls** — for slots whose
 *     catch-all sits under a sub-path (e.g. `@sidebar/docs/[...slug]`),
 *     the resolver auto-filters `paths` to entries matching that prefix, so
 *     the build does not produce fake URLs like `/docs/login/`.
 *
 *  4. **Parallel-slot GSP dedupe by mirror key** — patches next.js's
 *     `generateRouteStaticParams` to collapse same-mirror-key siblings into
 *     one GSP call, preventing the K^N cartesian-product OOM.
 *
 *  5. **Auto-generated shim files (Group 2)** — for slots listed in
 *     `autoShimSlots`, plugin scans `<appDir>/.../@<slot>/default.tsx` and
 *     auto-generates a sibling `[...slug]/page.tsx` mirroring `default.tsx`.
 *     User edits `default.tsx`; plugin keeps `page.tsx` in sync.
 *
 * @param {import('next').NextConfig} nextConfig
 * @param {{
 *   paths: string[],
 *   appDir?: string,
 *   autoShimSlots?: string[],
 *   verbose?: boolean,
 * }} options
 * @returns {import('next').NextConfig}
 */
function withParallelRoutes(nextConfig, options) {
  const config = nextConfig || {}
  const opts = options || {}

  if (!Array.isArray(opts.paths)) {
    throw buildJpError('options.paths は必須です', [
      {
        hint:
          'trailing-slash 付きルート文字列の配列を渡してください ' +
          '(例: `Object.keys(YOUR_PATH_LABELS_SSOT)`)',
      },
    ])
  }

  const appDir = opts.appDir || path.join(process.cwd(), 'app')
  const verbose = opts.verbose !== false
  // next.js default: `trailingSlash: false`. Any truthy → true.
  const trailingSlash = config.trailingSlash === true

  // Auto-gen Group 2 shim files BEFORE registry check so freshly generated
  // page.tsx files are included in the route walk.
  const shimResult = autoGenShimSlots(appDir, opts.autoShimSlots, verbose)

  if (opts.transientShim && shimResult.generatedFiles.length > 0) {
    // Always update .gitignore (covers crash residue), then register cleanup
    // so files vanish on normal/graceful exit.
    updateGitignore(appDir, shimResult.generatedFiles, verbose)
    registerTransientCleanup(shimResult.generatedFiles, shimResult.generatedDirs, verbose)
  }

  checkRouteRegistry(appDir, opts.paths, trailingSlash, verbose)

  if (opts.generateRouteTypes === true) {
    if (config.typedRoutes === true) {
      throw buildJpError(
        'options.generateRouteTypes と nextConfig.typedRoutes は同時に有効化できません',
        [
          {
            hint:
              'plugin が emit する strict Route union が next.js 内蔵の typedRoutes ' +
              '型注入と衝突します。どちらか片方を無効化してください ' +
              '(推奨: plugin を残し `typedRoutes: true` を next.config から外す)',
          },
        ]
      )
    }
    generateRouteTypes(appDir, opts.paths, opts.externalRoutes, verbose)
  }

  installDedupePatch(opts, opts.paths, trailingSlash)

  return config
}

function getPreloadPath() {
  return PRELOAD_PATH
}

module.exports = withParallelRoutes
module.exports.withParallelRoutes = withParallelRoutes
module.exports.staticParamsFromConfig = staticParamsFromConfig
module.exports.getPreloadPath = getPreloadPath
module.exports.default = withParallelRoutes

// Internal helpers exposed solely for unit testing. NOT part of the public
// API — do not import these from app code; their signatures may change.
module.exports.__testing = {
  collectRealRoutes: collectRealRoutes,
  checkRouteRegistry: checkRouteRegistry,
  frameworkSpecialRoutes: frameworkSpecialRoutes,
  formatRoute: formatRoute,
}
