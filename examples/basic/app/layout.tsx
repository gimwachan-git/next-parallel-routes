import type { ReactNode } from 'react'

// The two named parallel slots (`@breadcrumbs`, `@sidebar`) arrive as props
// alongside the implicit `children` slot.
export default function RootLayout({
  children,
  breadcrumbs,
  sidebar,
}: {
  children: ReactNode
  breadcrumbs: ReactNode
  sidebar: ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <header>{breadcrumbs}</header>
        <div style={{ display: 'flex' }}>
          <aside style={{ width: 220 }}>{sidebar}</aside>
          <main style={{ flex: 1 }}>{children}</main>
        </div>
      </body>
    </html>
  )
}
