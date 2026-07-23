# iOS SwiftUI Figma Contract

Load this reference only for Target Surface Packet rows classified as iOS SwiftUI.

- Resolve `View` composition, modifiers, layout containers, environment values, state selection, navigation entry, styles, asset catalogs, symbols, fonts, previews, accessibility modifiers, and UIKit hosting/interoperability affecting the surface.
- Compare Figma coordinates with SwiftUI points, then account for display scale only for rendered-pixel evidence.
- Record device/viewport, display scale, orientation, OS version, size classes, color scheme, locale, Dynamic Type category, safe-area assumptions, app scheme/build, and content state.
- Verify proposed/ideal sizing, layout priorities, safe areas, adaptive stacks/grids, RTL, clipping, shadows, SF Symbols, Dynamic Type, minimum targets, VoiceOver labels/traits/order, focus, and represented state transitions.
- Preserve established `NavigationStack`, tab, sheet/full-screen-cover, dismissal, gesture, focus/keyboard, sensory feedback, scene state, and restoration ownership. Require product requirements for interactions or transitions not represented by Figma.
- Prefer established styles, environment tokens, and reusable views when semantics, states, accessibility, and resolved values match.
- Use existing previews, snapshot tests, XCTest/XCUITest, simulator/device workflows, accessibility inspection, and optional Maestro evidence.
- Do not add fixed frames or disable Dynamic Type solely to force one screenshot to match.
