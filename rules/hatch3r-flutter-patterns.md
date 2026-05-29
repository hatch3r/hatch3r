---
id: hatch3r-flutter-patterns
type: rule
description: Flutter and Dart conventions covering null safety, state management (Riverpod/Bloc), Material 3, FFI, performance, platform channels, and integration testing
scope: conditional
globs: "**/*.dart,**/pubspec.yaml,**/pubspec.lock,**/analysis_options.yaml,**/build.yaml,**/lib/**,**/test/**,**/integration_test/**,**/ios/Runner/**,**/android/app/**,**/windows/runner/**,**/macos/Runner/**,**/linux/**,**/web/index.html"
tags: [implementation]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Flutter Patterns

**Pillars:** P2 (Scientific & Practical Quality), CQ8 (Maintainability Quality)

> Applies when the project ships a Flutter app or Dart package. Detection signals: `pubspec.yaml` with `flutter:` block, `lib/main.dart` entrypoint, or `pubspec.yaml` at repo root.

## Dart Language Floor

- Use Dart 3.5+ with sound null safety. Every nullable field is explicit (`String?`), every late variable initialized before access. No `!` (bang operator) outside of test fixtures or proven-non-null hot paths.
- Records and patterns: prefer records (`(int, String)`) and pattern matching (`switch (value) { ... }`) over tuple classes and visitor patterns for simple variant returns.
- Sealed classes for closed-set hierarchies (state, events, errors): `sealed class AuthState { ... }` + `final class Authenticated extends AuthState { ... }` so the analyzer enforces exhaustive switches.
- Enable strict analyzer mode in `analysis_options.yaml` with `flutter_lints` plus `very_good_analysis`. Treat warnings as errors in CI.

## Project Structure

- Feature-first layout under `lib/`: `lib/features/<feature>/{data,domain,presentation}/` with a `lib/core/` for shared utilities. Avoid `lib/widgets/` / `lib/screens/` flat layouts beyond toy apps.
- Single entrypoint per flavor: `lib/main_dev.dart`, `lib/main_staging.dart`, `lib/main_prod.dart`. Each delegates to a shared `lib/bootstrap.dart` after environment binding.
- Public APIs documented with `///` doc comments. `dartdoc` runs in CI for the `lib/` public surface — undocumented public APIs are a warning.

## State Management

- Pick ONE state-management approach per app and document it in `docs/architecture.md`:
  - **Riverpod 2.x** (`flutter_riverpod` + `riverpod_generator`) — recommended default. Code-gen typed providers via `@riverpod` annotations.
  - **Bloc** (`flutter_bloc`) — when the team prefers event-sourcing semantics.
  - **InheritedNotifier / ChangeNotifier** — only for trivial widget-local state. Provider package is in maintenance — do not adopt for new code.
- Riverpod: prefer `@riverpod`-generated providers over manual `Provider`/`StateProvider`. Async providers return `AsyncValue<T>` — surface `loading` / `error` / `data` states in the UI.
- Bloc: separate events (input) from states (output). Avoid `setState` inside `BlocBuilder` — all mutation flows via `add(event)` to the bloc.
- Never call `notifyListeners()` inside `build()`. Never read providers in a constructor.

## UI & Material 3

- Material 3 (Material You) is the default for Android-leaning apps: `ThemeData(useMaterial3: true)`. Configure `colorSchemeSeed` rather than ad-hoc primary/accent colors so dynamic color works.
- For iOS-leaning apps, use Cupertino widgets directly or `flutter_platform_widgets` for hybrid surfaces. Do not use `Material` on a `CupertinoPageScaffold`.
- Responsive layout: use `LayoutBuilder`, `MediaQuery.sizeOf(context)`, and `Flexible`/`Expanded` for breakpoints. Avoid hard-coded pixel widths.
- Accessibility: every interactive widget has a `Semantics(label: ...)` wrapper or uses a built-in widget that emits semantics. Test with TalkBack (Android) and VoiceOver (iOS); the `flutter_test` semantics tester catches static violations.

## Performance

- Avoid expensive work in `build()`. Lift `MaterialPageRoute` factories, regex literals, and constant widgets to `const` constructors so Flutter can skip the rebuild.
- Use `const` constructors aggressively — `const SizedBox(height: 8)` is allocation-free and a major frame-budget win.
- For long scrollable lists, use `ListView.builder` with `itemExtent` set when row height is uniform. `ListView()` (default) builds every child up-front.
- Image loading: `cached_network_image` or `flutter_image_compress` for network images. The default `Image.network` does not persist a disk cache.
- Profile with DevTools: target 60fps on mid-range Android (Pixel 4a class). Frame times above 16ms are regressions; profile the Timeline view for jank.

## Platform Channels & FFI

- Native interop: prefer `dart:ffi` for synchronous C/C++ bindings (≥10x faster than channels). Use platform channels only when the API is event-driven or requires UI-thread context.
- `package:ffigen` generates Dart bindings from C headers — never hand-roll `Pointer<Native...>` signatures.
- Pigeon (`package:pigeon`) generates type-safe platform-channel code from a Dart interface declaration. Stop writing raw `MethodChannel` calls — Pigeon-generated code prevents schema drift.

## Testing

- Three test layers in `test/` (unit + widget) and `integration_test/` (full app on real device or emulator):
  - Unit tests: pure Dart logic, no Flutter binding. Run with `flutter test`.
  - Widget tests: pumped `WidgetTester` flows with mocked dependencies. Use `find.byKey` over `find.text` for resilience to copy changes.
  - Integration tests: `integration_test/` with `IntegrationTestWidgetsFlutterBinding`. Run on devices via `flutter drive` and on CI matrices.
- Coverage: `flutter test --coverage` + `lcov` reports. Floor: 80% line coverage in `lib/features/**`; critical features (auth, payments) 90%.
- Golden tests for visual regressions: `goldenFileComparator` with the `alchemist` package for multi-platform/multi-device goldens. Update goldens via PR review, never blanket-update.
- Mock HTTP: `package:http_mock_adapter` for Dio, `nock` for `package:http`. Never hit real network in tests.

## Builds & Distribution

- Flavors via `--flavor` flag + matching Android/iOS configs (`android/app/build.gradle` flavors, `ios/Runner/Configurations`). Bake the API base URL per flavor.
- App size: enable `--obfuscate --split-debug-info=<path>` for release builds. Track size regressions via `flutter build apk --analyze-size` in CI.
- Use Codemagic, Bitrise, or Fastlane for store deploys. Sign Android with Play App Signing; iOS via App Store Connect API keys (avoid Apple ID password auth — deprecated).

## References

- Dart 3 release notes: https://dart.dev/guides/whats-new (accessed 2026-05-27, official-docs)
- Flutter Material 3: https://docs.flutter.dev/ui/design/material (accessed 2026-05-27, official-docs)
- Riverpod 2.x: https://riverpod.dev/docs/introduction/getting_started (accessed 2026-05-27, official-docs)
- Pigeon: https://pub.dev/packages/pigeon (accessed 2026-05-27, official-docs)

## Cross-References

- `rules/hatch3r-component-conventions.md` — four-state surface contract maps to Flutter `AsyncValue` patterns.
- `rules/hatch3r-testing.md` — coverage thresholds and determinism rules apply to Dart tests.
- `rules/hatch3r-accessibility-standards.md` — WCAG mapping for `Semantics` widget usage.
