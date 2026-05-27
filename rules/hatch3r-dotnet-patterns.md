---
id: hatch3r-dotnet-patterns
type: rule
description: .NET 9 + C# 13 conventions covering minimal APIs, nullable reference types, async/await, Entity Framework Core, dependency injection, structured logging, and xUnit testing
scope: conditional
globs: "**/*.cs,**/*.csproj,**/*.sln,**/*.fsproj,**/*.vbproj,**/Directory.Build.props,**/Directory.Build.targets,**/global.json,**/nuget.config,**/appsettings.json,**/appsettings.*.json,**/Program.cs,**/Startup.cs"
tags: [implementation]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# .NET Patterns

> Applies when the project ships a .NET / C# solution. Detection signals: `*.csproj` / `*.sln` files, `global.json`, or any `*.cs` source at repo root. Includes ASP.NET Core, console apps, libraries, and Blazor projects.

## .NET / C# Language Floor

- Target .NET 9.0 (LTS-supporting upgrade path) or the current LTS (.NET 8). Pin via `global.json` (`sdk.version`) and `*.csproj` `<TargetFramework>net9.0</TargetFramework>`.
- Use C# 13+ features: collection expressions (`[1, 2, 3]`), primary constructors on non-record classes, `params Span<T>`. Avoid mixing older syntax with new — pick the modern form across the codebase.
- Enable nullable reference types (`<Nullable>enable</Nullable>` in `*.csproj`). Treat warnings as errors: `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`.
- Use `Directory.Build.props` to centralize SDK version, lang version, code-analysis rules, and shared package versions across all projects.

## Project Layout

- Solution structure:
  - `src/<ProjectName>/<ProjectName>.csproj` — main library / app projects.
  - `src/<ProjectName>.Api/` — ASP.NET Core API projects.
  - `tests/<ProjectName>.Tests/` — unit tests per project.
  - `tests/<ProjectName>.IntegrationTests/` — integration tests with `WebApplicationFactory`.
- Use `Microsoft.NET.Sdk` (or `Microsoft.NET.Sdk.Web` for ASP.NET) — do not use the legacy `csproj` format. Configure central package management via `Directory.Packages.props` to lock NuGet versions across the solution.
- Public API exposed via top-level types; internal helpers marked `internal`. Use `InternalsVisibleTo` for test projects only.

## ASP.NET Core (Minimal APIs)

- Prefer Minimal APIs in `Program.cs` for new services — they reduce boilerplate and integrate with Native AOT.
- Use route groups (`app.MapGroup("/api/v1")`) with `RequireAuthorization()`, `AddEndpointFilter`, and `WithOpenApi()` modifiers. Versioning via route prefix or `Asp.Versioning.Http` package.
- Endpoint handlers receive parameters via attributes: `[FromBody]`, `[FromQuery]`, `[FromRoute]`, `[FromServices]`. Async handlers return `Results.Ok(...)`, `Results.Problem(...)`, `Results.ValidationProblem(...)` — never raw exceptions for expected error paths.
- For controllers: use `[ApiController]` with `[Route("api/[controller]")]`. Model binding + validation is automatic; opt out of `[ApiController]`-implied filters only when you need different conventions and document the rationale.

## Dependency Injection

- Built-in `IServiceCollection` is the floor. Register via lifetime-explicit methods: `AddSingleton`, `AddScoped`, `AddTransient`. Document the lifetime choice in a comment when non-obvious.
- Constructor injection only. Property injection via the framework is a smell — refactor to constructor injection or accept the value through a method parameter.
- Configuration via the `Options` pattern: `services.Configure<MyOptions>(config.GetSection("My"))`. Inject `IOptions<MyOptions>` (or `IOptionsMonitor<T>` for change-tolerant readers). Do not inject `IConfiguration` directly.
- Disposable singletons: the container disposes them on app shutdown. Never call `Dispose()` manually on a resolved singleton.

## Async / Await

- Use `async Task<T>` / `async ValueTask<T>` end-to-end. Never `.Result` / `.Wait()` — they deadlock under ASP.NET Core's synchronization context.
- Pass `CancellationToken` as a parameter; propagate through every layer. Endpoint handlers automatically receive `HttpContext.RequestAborted`.
- `ConfigureAwait(false)` on library code; `ConfigureAwait(true)` (default) in UI / ASP.NET handlers. The `Microsoft.VisualStudio.Threading.Analyzers` package catches missing `ConfigureAwait` in libraries.
- For parallel async work: `Task.WhenAll` (all must succeed) or `Parallel.ForEachAsync` (Bounded parallelism). Avoid `Task.Run` in ASP.NET — it consumes a thread-pool slot for no benefit.

## Entity Framework Core

- EF Core 9.x is the floor. Use `AddDbContextPool<>` for ASP.NET — context pooling reduces allocation overhead.
- Migrations: `dotnet ef migrations add <Name>` per schema change; check generated files into VCS. Never edit migration `Designer.cs` by hand.
- Query discipline: prefer projected `Select(x => new Dto { ... })` over fetching entities. Use `AsNoTracking()` for read-only queries — the change tracker is unnecessary overhead.
- Avoid `.Include().Include()` chains beyond one level — denormalize the query into a projection.
- Set timeouts: `dbContext.Database.SetCommandTimeout(TimeSpan.FromSeconds(30))`. Default is unbounded.
- Use raw SQL (`FromSqlInterpolated`) for queries EF can't express. Never string-concatenate user input into SQL; `FromSqlInterpolated` parameterizes correctly.

## Structured Logging

- Use `Microsoft.Extensions.Logging` with structured-message templates: `logger.LogInformation("User {UserId} created order {OrderId}", userId, orderId)`. Never use interpolated strings (`$"..."`) — they lose the structure.
- Pin a logging provider in production: Serilog (`Serilog.AspNetCore`) for the richest sink ecosystem, or OpenTelemetry exporter for vendor-neutral pipelines.
- Configure log levels per category in `appsettings.json`. `Microsoft.AspNetCore` → `Warning` in production to mute request-pipeline noise.
- Correlation IDs: enable `ActivityIdFormat = ActivityIdFormat.W3C` for W3C Trace Context. Every log entry includes the active trace ID automatically via `TraceContext` enrichment.

## Testing

- Unit tests with xUnit (`Microsoft.NET.Test.Sdk` + `xunit` + `xunit.runner.visualstudio`). Naming convention: `Method_State_ExpectedBehavior`.
- Use `FluentAssertions` for readable assertions — `result.Should().BeOfType<Ok<User>>()`.
- Mocking: NSubstitute (recommended) or Moq. Hand-rolled fakes for interfaces with ≤3 methods.
- Integration tests: `WebApplicationFactory<TEntryPoint>` from `Microsoft.AspNetCore.Mvc.Testing`. Replace external dependencies (database, cache) via `IServiceCollection` overrides in `ConfigureWebHost`. Use Testcontainers (`Testcontainers.PostgreSql`, `Testcontainers.Redis`) for real-database integration tests.
- Coverage: `dotnet test --collect:"XPlat Code Coverage"` with Coverlet. Floor: 80% line coverage in `src/`, 90% in critical modules (auth, billing, persistence).

## Native AOT & Performance

- Native AOT support (`PublishAot=true`) for cold-start-sensitive workloads (CLI tools, serverless). Audit dependencies — reflection-heavy packages (e.g., older Newtonsoft.Json paths) break AOT.
- Trimming (`PublishTrimmed=true`) for self-contained deploys to reduce binary size. Mark trim-unsafe APIs with `[RequiresUnreferencedCode]`.
- Use `Span<T>` / `Memory<T>` for hot-path buffer manipulation. `ArrayPool<T>.Shared` for transient large buffers to reduce GC pressure.
- Profile with `dotnet-trace` and `dotnet-counters` before optimizing.

## NuGet Hygiene

- Central package management: define versions once in `Directory.Packages.props` (`<PackageVersion Include="Foo" Version="1.2.3" />`). Per-project references then drop the `Version` attribute.
- Vulnerability scanning: `dotnet list package --vulnerable --include-transitive` in CI. Block merge on listed advisories.
- License compliance: `dotnet-project-licenses` tool with an allowlist. Block GPL contamination via the allowlist.
- Pin to released versions only — never `*` or floating prerelease versions.

## References

- .NET 9 release notes: https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-9 (accessed 2026-05-27, official-docs)
- ASP.NET Core Minimal APIs: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/ (accessed 2026-05-27, official-docs)
- EF Core 9.x: https://learn.microsoft.com/en-us/ef/core/what-is-new/ (accessed 2026-05-27, official-docs)
- C# 13 features: https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13 (accessed 2026-05-27, official-docs)

## Cross-References

- `rules/hatch3r-api-design.md` — REST/GraphQL/gRPC contract floors apply to ASP.NET Core services.
- `rules/hatch3r-testing.md` — coverage thresholds carry over to `dotnet test` + Coverlet.
- `rules/hatch3r-observability-logging.md` — `Microsoft.Extensions.Logging` integration with the canonical logging contract.
