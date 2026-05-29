---
id: hatch3r-ruby-rails-patterns
type: rule
description: Ruby 3.3+ and Rails 8.x conventions covering Hotwire (Turbo + Stimulus), ActiveRecord patterns, Sidekiq jobs, RSpec testing, RuboCop / Standard, and YJIT performance
scope: conditional
globs: "**/*.rb,**/*.rake,**/Gemfile,**/Gemfile.lock,**/Rakefile,**/config.ru,**/.rubocop.yml,**/.rubocop.yaml,**/.standard.yml,**/app/**,**/config/**,**/db/migrate/**,**/lib/**,**/spec/**,**/test/**"
tags: [implementation, lang:ruby]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Ruby / Rails Patterns

**Pillars:** P2 (Scientific & Practical Quality), CQ8 (Maintainability Quality)

> Applies when the project ships a Ruby application. Detection signals: `Gemfile` at repo root, `config/application.rb` (Rails), `.ruby-version`, or any `*.rb` file. Sinatra and Hanami projects share most of the Ruby-level guidance here.

## Ruby Language Floor

- Target Ruby 3.3+ (3.4 recommended for new projects). Use pattern matching (`case/in`), rightward assignment (`x => y`), endless methods (`def square(x) = x * x`) when they improve readability — not as defaults.
- Enable YJIT in production (`--yjit` flag or `RUBY_YJIT_ENABLE=1`). YJIT delivers 15–25% throughput improvements on Rails workloads with no code changes.
- Sorbet (`sorbet-runtime`) or RBS (`steep`) for gradual typing. Type-check business logic and public API surfaces; skip view code and trivial helpers.
- Format with Standard Ruby (`standardrb`) or RuboCop with `rubocop-rails` + `rubocop-rspec`. Pin in CI; reformat-on-save in editors.

## Project Layout (Rails)

- Default Rails structure:
  - `app/models/` — ActiveRecord models and POROs.
  - `app/controllers/` — controllers (HTTP only).
  - `app/views/` — templates (ERB / Slim / HAML).
  - `app/components/` — ViewComponent (`view_component` gem) for reusable UI components.
  - `app/services/<Domain>/` — service objects (single public `call` method).
  - `app/jobs/` — Active Job / Sidekiq workers.
  - `app/policies/` — Pundit policies (or equivalent authorization).
- Service objects (`app/services/`) for multi-step business operations. Thin controllers → service object → return result struct. Never put complex logic in controllers or models.
- Keep models focused: validations, associations, scopes. Move complex queries to query objects (`app/queries/`) and complex callbacks to dedicated observers / commands.

## Rails 8.x

- Rails 8.0 is the floor (Nov 2024 release). It bundles SolidQueue, SolidCache, and SolidCable — drop Redis-only deployments for new apps unless throughput requires it.
- Hotwire (Turbo + Stimulus) is the default for interactive UI — no separate SPA. Use `turbo_frame_tag` and `turbo_stream` responses for in-page updates without writing custom JavaScript.
- Authentication: built-in `bin/rails generate authentication` scaffold (Rails 8 default). Use `Devise` only if the project needs OAuth / SAML out of the box.
- Skip Webpacker — use the bundled `propshaft` asset pipeline + `importmap-rails` for ESM imports without a Node build step. Use `jsbundling-rails` (esbuild/rollup/vite) only when the project needs heavy JS tooling.

## ActiveRecord

- Define explicit `strong_parameters` in controllers (`params.expect(user: [:name, :email])`). Mass-assignment vulnerabilities are real.
- N+1 query prevention: eager-load with `.includes(:association)` or `.preload(:association)`. Use the `bullet` gem in development + CI to detect N+1 patterns.
- Avoid `Model.all.each` over large tables — use `find_each(batch_size: 100)` for batched iteration with constant memory.
- Migrations are forward-only in production. Mark destructive migrations with `safety_assured` (`strong_migrations` gem) only after review. Run migrations in a separate deploy step from code rollout to maintain rollback ability.
- Use `optimize_for_inference_of_query` for complex scopes; avoid hand-written SQL strings (use Arel or query objects for parameterized custom SQL).

## Hotwire & ViewComponent

- Turbo Frames (`turbo_frame_tag`) for in-page partial updates. Turbo Streams (`turbo_stream.replace`, `.append`, `.update`) for server-pushed UI updates over WebSocket / Server-Sent Events.
- Stimulus controllers for client-side interactivity (`app/javascript/controllers/`). Keep controllers small (≤100 lines). Use Stimulus values + classes for state; never reach into other controllers' DOM.
- ViewComponent (`view_component` gem) for testable, reusable UI components. Each component has a `*.rb` class and `*.html.erb` template with co-located preview (`spec/components/<name>_preview.rb`).
- Avoid jQuery and ad-hoc JavaScript files — Stimulus and Turbo cover 90% of interactivity needs in Rails apps.

## Background Jobs

- Active Job with SolidQueue (Rails 8 default), Sidekiq (Redis-backed), or GoodJob (Postgres-backed). Pick one and document in `docs/architecture.md`.
- Configure retry policy explicitly: `retry_on StandardError, attempts: 3, wait: :exponentially_longer`. Default retry-forever is a footgun.
- Idempotency keys for jobs touching external APIs — pass the key as a job argument, persist on first execution, no-op on retry with same key.
- Set queue priorities: `queue_as :critical | :default | :low`. Critical for user-facing latency-sensitive work, low for background reporting.

## Testing

- RSpec (`rspec-rails`) for new projects — `Capybara` for system tests. Minitest is acceptable for legacy / official-Rails-pattern projects.
- Test types under `spec/`:
  - `spec/models/`, `spec/services/`, `spec/jobs/` — unit tests.
  - `spec/requests/` — request specs (full middleware stack, faster than feature specs).
  - `spec/system/` — system tests (Capybara + headless Chrome).
- Database cleanup: `database_cleaner-active_record` with `:truncation` for system tests, transactional fixtures for unit tests. Never use `DatabaseCleaner` against production-like data.
- Mock HTTP with `webmock` + VCR for cassette-based replay. Never hit real network in tests.
- Factory definitions in `spec/factories/` with `factory_bot_rails`. Avoid fixtures — they become stale and tightly coupled.
- Coverage: `simplecov` with floor 80% in `app/`; 90% in `app/services/` and `app/policies/`.

## Security

- Brakeman in CI: `bundle exec brakeman --no-pager`. Block merge on high-confidence warnings.
- Strong parameters on every controller action that mutates state. Never `params.permit!` blindly.
- Authorization via Pundit policies (`app/policies/`). Controllers call `authorize @post` before mutations. Never authorize in views — too late.
- CSRF: Rails enables `protect_from_forgery` by default. Do not disable globally; disable per-action only for explicit API endpoints with token auth.
- Encrypted credentials: `bin/rails credentials:edit` for secrets at rest. Never commit `master.key` to VCS.

## Bundler & Dependency Hygiene

- Pin gems in `Gemfile` with pessimistic version constraints (`~> 7.2`). Avoid `gem 'foo'` without a version pin.
- `Gemfile.lock` committed for applications. Library gems typically omit the lock.
- Vulnerability scanning: `bundle audit --update` against the rubysec/ruby-advisory-db. Block merge on advisories without acknowledged remediation.
- License compliance: `license_finder` with an allowlist. Block GPL contamination.

## Performance

- YJIT enabled in production (`config/boot.rb`: `RubyVM::YJIT.enable`). Verify with `ruby --yjit --version`.
- Profile with `rack-mini-profiler` in dev / staging; `vernier` or `stackprof` for production captures.
- Use `Bullet` to catch N+1 queries in dev / CI. Treat N+1 violations as test failures.
- Cache layer: `Rails.cache.fetch` for read-heavy data with explicit TTL. Use Solid Cache (Rails 8 default), Memcached, or Redis — pin one per environment.

## References

- Ruby 3.3 release notes: https://www.ruby-lang.org/en/news/2023/12/25/ruby-3-3-0-released/ (accessed 2026-05-27, official-docs)
- Rails 8 release notes: https://rubyonrails.org/2024/11/8/Rails-8-no-paas-required (accessed 2026-05-27, official-docs)
- Hotwire docs: https://hotwired.dev/ (accessed 2026-05-27, official-docs)
- ViewComponent: https://viewcomponent.org/ (accessed 2026-05-27, official-docs)

## Cross-References

- `rules/hatch3r-api-design.md` — REST contract floors apply to Rails API endpoints.
- `rules/hatch3r-testing.md` — coverage thresholds carry over to `bundle exec rspec` + SimpleCov.
- `rules/hatch3r-secrets-management.md` — credentials and `.env` handling patterns.
