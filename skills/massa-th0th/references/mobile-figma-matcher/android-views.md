# Android Views Figma Contract

Load this reference only for Target Surface Packet rows classified as Android Views XML.

- Resolve `res/layout`, qualifiers, includes/merges, styles/themes, dimensions, colors/selectors, text appearances, drawables, fonts, strings, binding/adapters, and Material components affecting the surface.
- Follow aliases to final values. Record the symbolic resource chain and resolved value.
- Normalize Figma pixels against Android density before comparing `dp`; compare text using `sp`, font scale, font metrics, line height, and actual wrapping.
- Record device/viewport, density, orientation, API, theme/UI mode, locale, font scale, system bars/insets, app variant, and content state.
- Verify constraints, weights, intrinsic sizing, RTL, clipping, elevation, state drawables, minimum touch targets, TalkBack labels/order, and keyboard/focus behavior when represented or required.
- Preserve the repository's Activity/Fragment/navigation ownership, system back behavior, Material interaction feedback, focus traversal, IME handling, and lifecycle-safe state restoration. Figma may represent appearance and selected states but does not define these behaviors by itself.
- Prefer established styles, resources, and shared Views components over duplicated local values when their resolved behavior matches.
- Use existing layout previews/renderers, screenshot tests, instrumentation, Espresso/UIAutomator, emulator/device harnesses, and optional Maestro evidence.
- Never approve or regenerate a screenshot baseline solely to hide a mismatch.
