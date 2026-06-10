// This `default.tsx` has a top-level import, so the plugin generates a
// **re-export shim** for `@sidebar/[...slug]/page.tsx`:
//   import Default from '../default'
//   export default Default
import { SidebarNav } from '@/components/sidebar-nav'

export default function SidebarDefault() {
  return <SidebarNav />
}
