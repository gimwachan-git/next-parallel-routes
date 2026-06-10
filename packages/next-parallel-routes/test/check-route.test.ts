import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// CommonJS plugin; reach into `__testing` namespace for direct access to the
// private check-route helpers (see `module.exports.__testing` at end of
// `index.cjs`).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const plugin = require('../index.cjs') as {
  __testing: {
    collectRealRoutes: (
      dir: string,
      segments: string[],
      trailingSlash: boolean,
      specialRoutes: Set<string>
    ) => Set<string>
    checkRouteRegistry: (
      appDir: string,
      paths: readonly string[],
      trailingSlash: boolean,
      verbose: boolean
    ) => void
    frameworkSpecialRoutes: (trailingSlash: boolean) => Set<string>
    formatRoute: (segments: string[], trailingSlash: boolean) => string
  }
}

const {
  collectRealRoutes,
  checkRouteRegistry,
  frameworkSpecialRoutes,
  formatRoute,
} = plugin.__testing

// テスト用に一時 app dir を組み立てるヘルパ。`page.tsx` のみ touch すれば良く
// (中身は plugin が読まない)、`'__EMPTY__'` で空ディレクトリも表現できる。
type AppDirSpec = {
  [path: string]: '__EMPTY__' | string
}

function makeAppDir(spec: AppDirSpec, root: string): void {
  for (const [relPath, content] of Object.entries(spec)) {
    const full = join(root, relPath)
    if (content === '__EMPTY__') {
      mkdirSync(full, { recursive: true })
      continue
    }
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
}

let tmpRoot = ''

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'nbp-check-route-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('formatRoute', () => {
  it('builds a leading-slash path from segments', () => {
    expect(formatRoute(['account', 'info'], false)).toBe('/account/info')
  })

  it('appends a trailing slash when configured', () => {
    expect(formatRoute(['account', 'info'], true)).toBe('/account/info/')
  })

  it('returns a single-segment route', () => {
    expect(formatRoute(['login'], true)).toBe('/login/')
  })

  it('handles an empty-segments root marker (trailingSlash off → "/")', () => {
    // The plugin never invokes formatRoute with empty segments at the root
    // because `collectRealRoutes` short-circuits, but the helper is still
    // pure on that input.
    expect(formatRoute([], false)).toBe('/')
    expect(formatRoute([], true)).toBe('//')
  })
})

describe('frameworkSpecialRoutes', () => {
  it('always carries `/404` (with trailing-slash variant respected)', () => {
    expect(frameworkSpecialRoutes(true)).toEqual(new Set(['/404/']))
    expect(frameworkSpecialRoutes(false)).toEqual(new Set(['/404']))
  })
})

describe('collectRealRoutes', () => {
  const specials = frameworkSpecialRoutes(true)

  it('returns an empty set for an app dir with no page.tsx', () => {
    makeAppDir({ 'layout.tsx': '' }, tmpRoot)
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(new Set())
  })

  it('skips the root page.tsx (zero-segment routes are not in the registry)', () => {
    // Root `/` is metadata-owned (root layout), not a parallel-slot route.
    // `collectRealRoutes` deliberately excludes it via `segments.length === 0`.
    makeAppDir({ 'page.tsx': '' }, tmpRoot)
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(new Set())
  })

  it('collects a single nested route', () => {
    makeAppDir({ 'account/info/page.tsx': '' }, tmpRoot)
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(
      new Set(['/account/info/'])
    )
  })

  it('honours trailingSlash=false (no trailing slash on emitted routes)', () => {
    makeAppDir({ 'account/info/page.tsx': '' }, tmpRoot)
    const noTrailingSpecials = frameworkSpecialRoutes(false)
    expect(collectRealRoutes(tmpRoot, [], false, noTrailingSpecials)).toEqual(
      new Set(['/account/info'])
    )
  })

  it('treats route groups `(group)` as transparent for URL purposes', () => {
    // `(app)/account/page.tsx` should resolve to `/account/`, not
    // `/(app)/account/`.
    makeAppDir({ '(app)/account/page.tsx': '' }, tmpRoot)
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(
      new Set(['/account/'])
    )
  })

  it('treats parallel slots `@slot` as transparent for URL purposes', () => {
    // The slot's own `page.tsx` is a slot filler, not a URL route. But the
    // route under the slot (`@metadata/account/page.tsx` → `/account/`) is.
    // (In practice `@<slot>/[...slug]/page.tsx` is filtered separately
    // because `[` segments are excluded; here we test only the transparency
    // of `@`.)
    makeAppDir({ '@metadata/account/page.tsx': '' }, tmpRoot)
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(
      new Set(['/account/'])
    )
  })

  it('descends through nested route groups and slots in any order', () => {
    makeAppDir(
      { '(app)/(sub)/@title/account/info/page.tsx': '' },
      tmpRoot
    )
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(
      new Set(['/account/info/'])
    )
  })

  it('skips dynamic segments (e.g. `[id]`, `[...slug]`)', () => {
    // `[...slug]/page.tsx` directly under the slot does NOT contribute a real
    // URL route — it's a SSG mirror generator that needs `paths` from
    // config to materialise.
    makeAppDir(
      {
        'account/[id]/page.tsx': '',
        '@metadata/[...slug]/page.tsx': '',
      },
      tmpRoot
    )
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(new Set())
  })

  it('still descends INTO a real route directory that happens to be next to a dynamic segment', () => {
    makeAppDir(
      {
        'account/[id]/page.tsx': '',
        'account/info/page.tsx': '',
      },
      tmpRoot
    )
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(
      new Set(['/account/info/'])
    )
  })

  it('filters out `specialRoutes` (e.g. `/404/`) from the result', () => {
    makeAppDir(
      {
        '404/page.tsx': '',
        'account/page.tsx': '',
      },
      tmpRoot
    )
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(
      new Set(['/account/'])
    )
  })

  it('deduplicates the same URL coming from multiple slots', () => {
    // Two slots each defining `/account/page.tsx` should collapse to a
    // single registry entry — they map to the same URL.
    makeAppDir(
      {
        '@metadata/account/page.tsx': '',
        '@header/account/page.tsx': '',
      },
      tmpRoot
    )
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(
      new Set(['/account/'])
    )
  })

  it('only emits routes for files literally named `page.tsx`', () => {
    // `layout.tsx`, `default.tsx`, `page.ts`, `page.jsx` etc. are NOT
    // routes (plugin currently only recognises `page.tsx`).
    makeAppDir(
      {
        'account/page.tsx': '',
        'account/layout.tsx': '',
        'account/default.tsx': '',
        'foo/page.ts': '',
        'foo/page.jsx': '',
      },
      tmpRoot
    )
    expect(collectRealRoutes(tmpRoot, [], true, specials)).toEqual(
      new Set(['/account/'])
    )
  })

  it('throws a descriptive error when appDir does not exist', () => {
    const missing = join(tmpRoot, 'does-not-exist')
    expect(() => collectRealRoutes(missing, [], true, specials)).toThrowError(
      /appDir を読み込めません/
    )
  })
})

describe('checkRouteRegistry', () => {
  it('returns silently when realRoutes === paths', () => {
    makeAppDir(
      {
        'account/page.tsx': '',
        'login/page.tsx': '',
      },
      tmpRoot
    )
    expect(() =>
      checkRouteRegistry(tmpRoot, ['/account/', '/login/'], true, false)
    ).not.toThrow()
  })

  it('throws listing routes present in app but missing from `paths`', () => {
    makeAppDir(
      {
        'account/page.tsx': '',
        'login/page.tsx': '',
      },
      tmpRoot
    )
    expect(() =>
      checkRouteRegistry(tmpRoot, ['/account/'], true, false)
    ).toThrowError(
      /ルート整合性エラー[\s\S]*`paths` に未登録のルート:[\s\S]*\/login\//
    )
  })

  it('throws listing `paths` entries with no matching route (orphan)', () => {
    makeAppDir({ 'account/page.tsx': '' }, tmpRoot)
    expect(() =>
      checkRouteRegistry(
        tmpRoot,
        ['/account/', '/deleted-page/'],
        true,
        false
      )
    ).toThrowError(
      /ルート整合性エラー[\s\S]*該当 page\.tsx が無いエントリ \(orphan\):[\s\S]*\/deleted-page\//
    )
  })

  it('reports both missing and orphan in a single error', () => {
    makeAppDir({ 'account/page.tsx': '' }, tmpRoot)
    expect(() =>
      checkRouteRegistry(tmpRoot, ['/login/'], true, false)
    ).toThrowError(
      /`paths` に未登録のルート:[\s\S]*\/account\/[\s\S]*該当 page\.tsx が無いエントリ \(orphan\):[\s\S]*\/login\//
    )
  })

  it('hard-errors with a clear hint when `paths` lacks trailing slash but config wants one', () => {
    makeAppDir({ 'account/page.tsx': '' }, tmpRoot)
    expect(() =>
      // trailingSlash: true, but supply `/account` (no trailing).
      checkRouteRegistry(tmpRoot, ['/account'], true, false)
    ).toThrowError(
      /paths と nextConfig\.trailingSlash の整合性エラー[\s\S]*末尾スラッシュが必要なエントリ/
    )
  })

  it('hard-errors when `paths` has trailing slash but config disabled trailing', () => {
    makeAppDir({ 'account/page.tsx': '' }, tmpRoot)
    expect(() =>
      // trailingSlash: false, but supply `/account/` (with trailing).
      checkRouteRegistry(tmpRoot, ['/account/'], false, false)
    ).toThrowError(
      /paths と nextConfig\.trailingSlash の整合性エラー[\s\S]*末尾スラッシュが不要なエントリ/
    )
  })

  it('accepts the root `/` literal even when trailingSlash is false (no trailing-slash pre-check error)', () => {
    // `/` is the only literal that legitimately ends in `/` under
    // trailingSlash=false (Next.js treats it as the home route). The
    // trailing-slash pre-check exempts it explicitly. Any subsequent error
    // must therefore come from the registry-diff stage, not the
    // pre-check stage.
    makeAppDir({ 'account/page.tsx': '' }, tmpRoot)
    expect(() =>
      checkRouteRegistry(tmpRoot, ['/', '/account'], false, false)
    ).toThrowError(/ルート整合性エラー/)
    expect(() =>
      checkRouteRegistry(tmpRoot, ['/', '/account'], false, false)
    ).not.toThrowError(/paths と nextConfig\.trailingSlash の整合性エラー/)
  })

  it('ignores `/404/` (framework-special) when computing missing routes', () => {
    makeAppDir(
      {
        '404/page.tsx': '',
        'account/page.tsx': '',
      },
      tmpRoot
    )
    // `/404/` should not appear as "missing" even though it has a real
    // page.tsx and is NOT in `paths`.
    expect(() =>
      checkRouteRegistry(tmpRoot, ['/account/'], true, false)
    ).not.toThrow()
  })

  it('does not double-count a route mirrored across multiple parallel slots', () => {
    // `@metadata/account/page.tsx` + `@header/account/page.tsx` both
    // resolve to `/account/` — registry should hold one entry.
    makeAppDir(
      {
        '@metadata/account/page.tsx': '',
        '@header/account/page.tsx': '',
      },
      tmpRoot
    )
    expect(() =>
      checkRouteRegistry(tmpRoot, ['/account/'], true, false)
    ).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // 「開発者が新しい page.tsx を追加したが path-labels (paths) を更新し忘れ」
  // という最頻出ヒューマンエラーを build 前に hard-error で捕捉する責務の
  // テスト群。エラーメッセージは IDE / CI ログから視認しやすい形式で path
  // をそのまま含めること。
  // -------------------------------------------------------------------------
  describe('extra page.tsx detection (paths registry drift)', () => {
    it('flags a newly-added deep-nested route the developer forgot to register', () => {
      // 3 階層のルートを追加したのに `paths` に入れ忘れたケース。
      // ファイル全 path がエラーメッセージにそのまま現れることを保証。
      makeAppDir(
        {
          'account/page.tsx': '',
          'parallel-route-a/child/grandchild/page.tsx': '',
        },
        tmpRoot
      )
      expect(() =>
        checkRouteRegistry(tmpRoot, ['/account/'], true, false)
      ).toThrowError(
        /`paths` に未登録のルート:[\s\S]*\/parallel-route-a\/child\/grandchild\//
      )
    })

    it('lists ALL extra routes in a single error (no first-failure bail)', () => {
      // 複数ファイルを一度に追加した PR を 1 回の build で全部報告する。
      // 1 個ずつ fix → re-run のループを避けるための仕様保証。
      makeAppDir(
        {
          'account/page.tsx': '',
          'login/page.tsx': '',
          'logout/page.tsx': '',
          'profile/page.tsx': '',
        },
        tmpRoot
      )
      let error: Error | undefined
      try {
        checkRouteRegistry(tmpRoot, ['/account/'], true, false)
      } catch (e) {
        error = e as Error
      }
      expect(error).toBeDefined()
      expect(error?.message).toMatch(/\/login\//)
      expect(error?.message).toMatch(/\/logout\//)
      expect(error?.message).toMatch(/\/profile\//)
    })

    it('strips `(route-group)` from the reported URL so devs can copy-paste into `paths`', () => {
      // `(app)/(sub)/foo/page.tsx` を追加したら error には `/foo/` と
      // 出てほしい(つまりそのまま `paths` に append すれば fix できる形)。
      // `(app)/(sub)/foo/` のような実 path 形式で出すと dev は混乱する。
      makeAppDir(
        {
          '(app)/account/page.tsx': '',
          '(app)/(sub)/foo/page.tsx': '',
        },
        tmpRoot
      )
      let error: Error | undefined
      try {
        checkRouteRegistry(tmpRoot, ['/account/'], true, false)
      } catch (e) {
        error = e as Error
      }
      expect(error?.message).toMatch(/\/foo\//)
      expect(error?.message).not.toMatch(/\(app\)/)
      expect(error?.message).not.toMatch(/\(sub\)/)
    })

    it('strips `@slot` from the reported URL when extra route lives under a parallel slot mirror', () => {
      // `@metadata/foo/page.tsx` を追加 (slot mirror に新しい URL) →
      // error には `/foo/` (URL 形式) と出てほしい。
      makeAppDir(
        {
          '@metadata/account/page.tsx': '',
          '@metadata/foo/page.tsx': '',
        },
        tmpRoot
      )
      let error: Error | undefined
      try {
        checkRouteRegistry(tmpRoot, ['/account/'], true, false)
      } catch (e) {
        error = e as Error
      }
      expect(error?.message).toMatch(/\/foo\//)
      expect(error?.message).not.toMatch(/@metadata/)
    })

    it('error message has the exact "missing from `paths`" prefix (no ambiguity with orphan section)', () => {
      // missing と orphan が同時に出る場合に section header が混ざらない
      // ことを保証 (regression guard: dev はどっちが extra page でどっちが
      // dead paths-entry か即判別できる必要がある)。
      makeAppDir(
        {
          'account/page.tsx': '',
          'extra-page/page.tsx': '', // extra file (missing from paths)
        },
        tmpRoot
      )
      let error: Error | undefined
      try {
        // /dead-path/ は paths にあるが realRoutes にない → orphan
        checkRouteRegistry(
          tmpRoot,
          ['/account/', '/dead-path/'],
          true,
          false
        )
      } catch (e) {
        error = e as Error
      }
      expect(error?.message).toMatch(
        /`paths` に未登録のルート:[\s\S]*\/extra-page\//
      )
      expect(error?.message).toMatch(
        /該当 page\.tsx が無いエントリ \(orphan\):[\s\S]*\/dead-path\//
      )
      // /extra-page/ は missing セクションだけに出る (orphan セクションには出ない)
      const orphanSection = error!.message.split('orphan')[1] ?? ''
      expect(orphanSection).not.toMatch(/\/extra-page\//)
    })

    it('all `[next-parallel-routes]` errors are prefixed with the plugin tag for grep-ability in CI logs', () => {
      makeAppDir({ 'account/page.tsx': '' }, tmpRoot)
      expect(() => checkRouteRegistry(tmpRoot, [], true, false)).toThrowError(
        /^\[next-parallel-routes\]/
      )
    })
  })
})
