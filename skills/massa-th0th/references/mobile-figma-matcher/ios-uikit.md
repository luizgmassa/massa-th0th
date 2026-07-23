# iOS UIKit Figma Contract

Load this reference only for Target Surface Packet rows classified as iOS UIKit.

- Resolve storyboards, XIBs, programmatic views, view controllers, reusable views/cells, Auto Layout constraints, appearance APIs, trait-dependent resources, asset catalogs, fonts, strings, and state configuration.
- Compare Figma coordinates with UIKit points, then account for device display scale only when validating rendered pixels.
- Record device/viewport, display scale, orientation, OS version, size classes, appearance, locale, content-size category, safe-area assumptions, app scheme/build, and content state.
- Verify intrinsic content size, content hugging/compression resistance, safe-area guides, readable-content guides, RTL, clipping, shadows, SF Symbols configuration, Dynamic Type through `UIFontMetrics`, minimum targets, and UIAccessibility labels/traits/order.
- Preserve established `UINavigationController`, tab, sheet, presentation, dismissal, gesture, keyboard, focus, haptic, and state-restoration behavior. Apply Apple platform conventions when Figma omits native interaction details.
- Prefer established UIKit components, appearance tokens, and asset-catalog resources when their semantics and resolved behavior match.
- Use existing previews/render harnesses, snapshot tests, XCTest/XCUITest, simulator/device workflows, accessibility inspection, and optional Maestro evidence.
- Do not rewrite snapshot references or accessibility identifiers merely to hide a mismatch.
