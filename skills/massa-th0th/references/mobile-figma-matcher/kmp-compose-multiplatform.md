# KMP Compose Multiplatform Figma Contract

Load this reference only for shared Compose Multiplatform Target Surface Packet rows.

- Resolve common composables, shared state, theme/design tokens, Compose resources, adaptive layout, accessibility semantics, platform adapters, and `expect`/`actual` declarations affecting presentation.
- Keep business/domain behavior in established shared boundaries. Do not move platform-only UI behavior into common code merely to reduce duplication.
- Keep navigation hosting, system back/dismissal, permissions, keyboard/focus integration, haptics, lifecycle, and other platform-native UX behind established shared interfaces or platform adapters. Do not force identical mechanics when Android and iOS conventions differ.
- Compare shared layout values using Compose density-independent units and typography scaling, but record runtime configurations separately for Android and iOS targets.
- Audit common composables and resources once. Create distinct runtime rows for each requested Android and iOS target because insets, font rendering, accessibility, resource loading, and host integration differ.
- Load Android Compose for Android-only source sets or hosts, Android Views for XML interop, UIKit for UIKit hosts/wrappers, and SwiftUI for SwiftUI hosts/wrappers.
- Verify `expect`/`actual`, resource lookup, platform painters/fonts, safe-area/inset adapters, lifecycle/host integration, and platform accessibility when they affect the surface.
- Prefer shared components and tokens only when they are already the correct ownership boundary. Apply a shared root fix before platform-local overrides when evidence shows a shared cause.
- Use existing common tests, platform compilation, previews, snapshot/screenshot tests, Android/iOS UI harnesses, and optional Maestro evidence.
- If one affected platform cannot be rendered or tested, mark its runtime rows `NOT EVALUATED`; do not infer parity from the other platform.
