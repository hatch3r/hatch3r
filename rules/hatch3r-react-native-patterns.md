---
id: hatch3r-react-native-patterns
type: rule
description: React Native conventions covering New Architecture (Fabric + TurboModules), Hermes, Expo Router/SDK, native module bridging, performance, and platform-specific UI
scope: conditional
globs: "**/App.tsx,**/App.jsx,**/index.js,**/metro.config.js,**/metro.config.ts,**/babel.config.js,**/app.json,**/app.config.ts,**/app.config.js,**/ios/**,**/android/**,**/expo-env.d.ts,**/.expo/**,**/*.native.tsx,**/*.native.jsx,**/*.native.ts"
tags: [implementation, lang:typescript]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# React Native Patterns

> Applies when the project ships a React Native or Expo app. Detection signals: `react-native` in `package.json` dependencies, `app.json` / `app.config.{ts,js}`, `metro.config.js`, `ios/` + `android/` workspace folders, or `.expo/` directory.

## New Architecture (Fabric + TurboModules)

- Target React Native 0.76+ with the New Architecture enabled (`newArchEnabled: true` in `app.json` for Expo, or `RCT_NEW_ARCH_ENABLED=1` for bare workflow). The New Architecture is on by default in 0.76 and is the only supported path for Expo SDK 52+.
- Use Fabric renderer (synchronous, type-safe) for new native components. Legacy Paper renderer is for backward compatibility only — do not write new components against it.
- Author native modules as TurboModules via `codegen` schemas. Stop adding `RCTBridgeModule`-style legacy modules — they bypass type-safety and force a full bridge serialization.
- Run `react-native codegen` in CI to regenerate JSI specs from the schema files. Spec drift between TS and native side is a merge blocker.
- Hermes is the default JS engine — keep it on. Avoid JSC unless a specific dependency requires it; document the reason in `README.md`.

## Expo (Managed + Bare Workflow)

- Prefer the Expo Managed workflow for new apps under SDK 52+. Expo Router 4 (file-system routing in `app/`) is the routing default; do not introduce React Navigation directly when Expo Router already covers the route surface.
- Use EAS Build for production binaries (Apple App Store, Google Play). Local `expo run:ios` / `expo run:android` is for development only.
- Pin the Expo SDK in `app.json` (`expo.sdkVersion`) and lock the matching `expo` package version. SDK upgrades go through `npx expo install --fix` — never edit `package.json` versions manually for Expo packages.
- For OTA updates, use EAS Update (CodePush is sunset for RN). Channel and runtime version policy: pin `runtimeVersion` per binary release; never push a runtime-incompatible JS bundle.

## Bridging & Native Modules

- New native modules: author TurboModule specs in TypeScript first (`*.spec.ts`), run codegen, then implement Swift/Kotlin handlers. Spec-first prevents type drift.
- Fabric native components: declare the spec via `codegenNativeComponent<Props>('ComponentName')`; never call the legacy `requireNativeComponent` for new code.
- Use the `react-native-nitro-modules` or `expo-modules-core` API when authoring shared native code — both target the New Architecture and avoid the legacy bridge.
- Cross-platform native APIs: prefer existing Expo modules (`expo-camera`, `expo-file-system`, `expo-secure-store`) over hand-rolled bridges. Do not duplicate community-maintained bindings.

## Navigation

- File-system routing via Expo Router 4 (`app/_layout.tsx`, `app/(tabs)/index.tsx`, `app/[id].tsx`). Use typed routes (`expo-router/typed-routes`) for compile-time link safety.
- Deep links: define the URL scheme in `app.json` (`scheme`) and register the universal/app-link domain pair for both platforms. Test universal links on a real device — simulators do not honor associated-domains entitlements reliably.
- For non-Expo apps, use React Navigation 7 with `@react-navigation/native-stack` (native UIKit/Fragment stack). JS-based stack (`@react-navigation/stack`) is for prototypes only.

## Performance

- Replace `FlatList` / `SectionList` with `@shopify/flash-list` for lists over 50 rows. FlashList recycles cells natively and outperforms FlatList by 5-10x on mid-range Android.
- Memoize render functions in lists: every `renderItem` is wrapped in `React.memo` with stable equality. Inline arrow functions in `renderItem` re-render the whole list.
- Use `InteractionManager.runAfterInteractions` to defer non-critical work until animations and gestures complete; never schedule heavy work on the JS thread during a transition.
- Image loading: use `expo-image` (managed) or `react-native-fast-image` (bare). The default `<Image>` lacks caching and progressive decode.
- Lazy-load screens with `React.lazy` + `Suspense` inside Expo Router layouts. Code-split heavy native screens behind navigation events.

## Platform-Specific UI

- Branch on `Platform.OS === 'ios' | 'android' | 'web'` only when the platform mandates a different UX (haptic patterns, header back gesture, status bar contrast). Avoid platform branching for layout — use flex + responsive units.
- iOS: use `react-native-screens` with `enableScreens()` so the navigator renders native `UIViewController` stacks. Without this, all screens are JS Views.
- Android: target SDK 35 (Android 15) per Google Play 2025 requirement. Configure edge-to-edge content (`android:windowOptOutEdgeToEdgeEnforcement="false"`) and respect insets via `react-native-safe-area-context`.
- Accessibility: every touchable surface has `accessibilityRole`, `accessibilityLabel`, and `accessibilityHint`. Test with VoiceOver (iOS) and TalkBack (Android) before merge — simulator a11y is not equivalent.

## State & Data

- Use TanStack Query (`@tanstack/react-query`) for server state. Avoid Redux unless the app has cross-screen optimistic UI requirements not served by Query mutations.
- Local persistent state: `@react-native-async-storage/async-storage` for non-secret values, `expo-secure-store` for tokens. Never store auth tokens in AsyncStorage on iOS (Keychain via SecureStore is the floor).
- Background sync: use Expo's `expo-task-manager` + `expo-background-fetch` (managed) or `react-native-background-fetch` (bare). Document the platform-specific minimum interval (iOS ~15 min minimum, Android ~15 min minimum on Doze).

## Testing

- Unit + component tests with `jest-expo` (Expo) or `@testing-library/react-native` (bare). Run on the host Node runtime — no simulator boot for unit tests.
- Integration tests with Detox (gray-box) or Maestro (black-box). Detox is preferred for apps with native modules; Maestro for pure-JS flows.
- Snapshot tests for every screen at multiple viewport sizes (iPhone SE, iPhone 16 Pro Max, Pixel 8a) — guard against layout regressions on small devices.
- E2E on EAS: configure `eas-cli` matrix builds against real devices via BrowserStack App Live or Sauce Labs Real Device Cloud.

## References

- React Native New Architecture overview: https://reactnative.dev/docs/the-new-architecture/landing-page (accessed 2026-05-27, official-docs)
- Expo SDK 52 release notes: https://expo.dev/changelog/2024-11-12-sdk-52 (accessed 2026-05-27, official-docs)
- Expo Router 4: https://docs.expo.dev/router/introduction/ (accessed 2026-05-27, official-docs)

## Cross-References

- `rules/hatch3r-component-conventions.md` — shared four-state surface contract applies to RN screens.
- `rules/hatch3r-accessibility-standards.md` — WCAG mapping carries to React Native via `accessibilityRole` props.
- `rules/hatch3r-testing.md` — coverage thresholds and determinism rules apply to RN tests.
