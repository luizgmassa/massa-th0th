# Android Jetpack Compose Figma Contract

Load this reference only for Target Surface Packet rows classified as Android Jetpack Compose.

- Resolve composables, modifiers, layout primitives, Material/theme tokens, typography, shapes, painters/assets, state holders, previews/providers, navigation entry, semantics, and test tags affecting the surface.
- Distinguish Android-only Compose from Compose Multiplatform using module and source-set evidence.
- Normalize Figma pixels against density for `dp`; compare typography using `sp`, font scale, font metrics, line height, and wrapping.
- Record device/viewport, density, orientation, API, theme/UI mode, locale, font scale, `WindowInsets`, app variant, and content state.
- Verify adaptive layouts, RTL, clipping, elevation, recomposed visual states, minimum touch targets, TalkBack semantics/order, keyboard/focus behavior, and state restoration when applicable.
- Preserve established Navigation Compose or host navigation ownership, state hoisting, system back handling, Material interaction feedback, focus/IME behavior, and lifecycle restoration. Require product requirements for transitions or interactions not represented by Figma.
- Prefer existing theme tokens and shared composables when semantics, states, accessibility, and resolved values match.
- Use existing previews, Compose screenshot tests, Compose UI tests, instrumentation, emulator/device harnesses, and optional Maestro evidence.
- Do not weaken assertions, semantics, test tags, or screenshot baselines to make parity appear successful.
