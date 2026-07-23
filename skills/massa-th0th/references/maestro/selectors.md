# Maestro Selectors Reference

Use this when choosing or auditing selectors. Official selector index: https://docs.maestro.dev/reference/selectors.md.

## Source Basis

Maestro targets UI through the accessibility tree for mobile and through rendered browser UI for web. Stable selectors are a reliability contract, not a cosmetic choice.

## Core Selectors

| Selector | Use | Notes |
|---|---|---|
| `text` | Visible text or accessibility label | Regex by default; brittle under localization/copy churn. |
| `id` | Android resource ID or iOS accessibility identifier | Preferred for dynamic content, icons, and localized apps. |
| `index` | Specific occurrence among duplicates | 0-based; pair with stable selector to avoid list drift. |
| `point` | Relative or absolute coordinates | Last resort when no accessibility target exists. |
| `css` | Web-only DOM selector | Does not use the same regex behavior as text/id. |

```yaml
- tapOn:
    id: login_button
- assertVisible:
    text: ".*Welcome.*"
- tapOn:
    id: buy_button
    index: 2
- tapOn:
    point: "50%,50%"
- assertVisible:
    css: "#main-header"
```

## Relational Selectors

Relational selectors identify elements by screen position or accessibility hierarchy:

- `above`, `below`, `leftOf`, `rightOf`
- `containsChild`, `childOf`, `containsDescendants`

```yaml
- tapOn:
    text: Delete
    childOf:
      id: basket_container

- assertVisible:
    id: list_item
    containsDescendants:
      - text: Wireless Headphones
      - text: "$99.99"
```

Position selectors use screen bounds; combine them with `id`, `text`, or state filters when possible.

## Trait, State, And Dimension Filters

Use trait, state, and dimension selectors only when they make an already stable selector more precise:

- Traits: physical characteristics such as shape or long text when official docs support them for the command.
- State: `enabled`, `checked`, `focused`, `selected`.
- Dimensions: width/height matchers with tolerance when official docs support them.

```yaml
- tapOn:
    id: terms_checkbox
    checked: false

- assertVisible:
    id: submit_button
    enabled: true
```

## Platform Caveats

- Android Views: `id` maps to resource ID; text may include visible text or content descriptions.
- Android Compose: configure semantics so test tags become resource IDs when ID selectors are required.
- iOS UIKit/SwiftUI: `text` maps to accessibility label; `id` maps to accessibility identifier.
- Flutter: prefer visible text, Semantics labels, or Semantics identifiers; internal Flutter keys are not enough.
- Web: `css` is web-only; official docs mark web automation as beta and Chromium-based.

## Selector Policy

Prefer this order for new or fixed flows:

1. Existing repo convention and stable test IDs/accessibility identifiers.
2. Accessible visible labels that are low churn and localized deliberately.
3. Relational selectors anchored to stable IDs/text.
4. State/dimension filters to reduce ambiguity.
5. Coordinates, images, screenshots, or index-only selectors only when no stronger target exists.

If a needed stable selector is missing from production app code, stop and route app changes through `feature`, `debug`, or a parent implementation workflow. Do not modify production code inside `maestro-fix`.
