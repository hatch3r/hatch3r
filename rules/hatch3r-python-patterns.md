---
id: hatch3r-python-patterns
type: rule
description: Python 3.12+ conventions covering uv project management, Ruff lint+format, mypy strict typing, pytest parametrize, and the FastAPI/Django request-path + ORM N+1 floor
scope: conditional
globs: "**/*.py,**/pyproject.toml,**/requirements.txt,**/manage.py,**/setup.cfg,**/tox.ini,**/Pipfile,**/conftest.py"
tags: [implementation, lang:python]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Python Patterns

**Pillars:** P2 (Scientific & Practical Quality), CQ8 (Maintainability Quality)

> Applies when the project ships Python. Detection signals: `pyproject.toml`, `setup.py`, `requirements.txt`, `Pipfile`, `setup.cfg`, or `tox.ini` at repo root, or `manage.py` for Django.

## Python Language Floor

- Target Python 3.12+. Declare `requires-python = ">=3.12"` in `pyproject.toml`. Drop Python 2 idioms (`from __future__`, `six`, `u""` prefixes) entirely.
- Centralize all tool config in `pyproject.toml` — single source of truth for build, Ruff, mypy, and pytest. Do not split config across `setup.cfg` + `.flake8` + `.isort.cfg`.
- Use `uv` for dependency + environment management. Commit `uv.lock`. Run every tool through `uv run <tool>` so the resolved environment is deterministic across machines; never activate a virtualenv manually in CI.
- Treat lint, format-check, type, and test as four separate gates: `uv run ruff check`, `uv run ruff format --check`, `uv run mypy src/`, `uv run pytest`. Any non-zero exit blocks merge.

## Linting & Formatting (Ruff)

- Use Ruff for both linting and formatting — it replaces flake8 + isort + black + pyupgrade in one tool with drop-in Black formatting parity.
- Enable at minimum these rule families in `[tool.ruff.lint]` `select`: `E`/`F` (pyflakes + pycodestyle), `I` (import sort), `B` (bugbear), `UP` (pyupgrade), `SIM` (flake8-simplify), `RUF` (Ruff-native). Add `ASYNC` for async codebases.
- Run `ruff format` (not standalone black). Set `line-length = 100` (or the team standard) once in `[tool.ruff]` so the linter and formatter agree.
- Wire `astral-sh/ruff-pre-commit` so lint + format run before every commit; CI re-runs the same checks as the authoritative gate.

## Typing (mypy)

- Enable `strict = true` in `[tool.mypy]` from day one — adding strict typing to a typed-from-the-start codebase is cheaper than retrofitting it later.
- Type every public function signature: parameters and return. Prefer `X | None` over `Optional[X]` (3.10+ union syntax). Use `collections.abc` protocols (`Sequence`, `Mapping`, `Iterable`) for parameters, concrete types for returns.
- Exclude the test directory from strict mode only when test fixtures fight the type checker — keep `src/` strict. Never blanket-suppress with `# type: ignore` without a specific error code (`# type: ignore[arg-type]`).
- For data shapes, prefer `@dataclass(slots=True)` or Pydantic v2 `BaseModel` over untyped dicts. Pydantic v2 validates at the boundary; dataclasses are zero-overhead internal records.

## Testing (pytest)

- pytest is the floor — do not use `unittest.TestCase` for new suites. Test files `test_*.py`, functions `test_*`.
- Use `@pytest.mark.parametrize` for input-table tests instead of loops — each case reports independently, mirroring Go table-driven subtests.
- Fixtures over `setUp`/`tearDown`: scope fixtures (`function`/`module`/`session`) deliberately. Put shared fixtures in `conftest.py`.
- Coverage floor: `pytest --cov=src --cov-fail-under=80`. Critical paths (auth, billing, migrations) at 90%. Use `pytest-randomly` to surface inter-test state leakage.
- Mark slow/integration tests (`@pytest.mark.slow`) and gate them behind `-m "not slow"` in the fast pre-commit loop; run the full set in CI.

## Async & Web (FastAPI / Django)

- In an async request path use async all the way down: `httpx` over `requests`, `asyncio.sleep` over `time.sleep`, an async ORM/driver (`asyncpg`, SQLAlchemy `AsyncSession`, or SQLModel) over a blocking one. A single blocking call stalls the event loop for every concurrent request.
- FastAPI runs plain `def` handlers in a threadpool automatically — only mark a handler `async def` when it actually awaits async I/O. Do not put blocking DB calls inside an `async def` without an async driver.
- Prevent N+1 queries: Django `select_related()` (FK / one-to-one) and `prefetch_related()` (reverse FK / M2M); SQLAlchemy `selectinload()` / `joinedload()`. Accessing a related attribute inside a loop over N rows silently issues N+1 queries.
- Validate every request body and response with Pydantic v2 models (FastAPI) or DRF serializers (Django) — never trust raw request dicts. Keep request/response schemas distinct from ORM models.
- Django: run `manage.py check --deploy` in CI; never ship with `DEBUG = True`; load secrets from the environment, not `settings.py`.

## Dependency Hygiene

- Pin direct dependencies in `pyproject.toml` and lock the full graph in `uv.lock`. Reproducible installs (`uv sync --frozen`) in CI.
- Vulnerability scanning: `pip-audit` (or `uv`'s audit) in CI against the locked graph. Block merge on known CVE matches.
- Keep runtime and dev dependencies separate (`[project.dependencies]` vs `[dependency-groups]` / `[project.optional-dependencies]`). Production images install runtime-only.

## References

- Ruff documentation: https://docs.astral.sh/ruff/ (accessed 2026-06-05, official-docs)
- Modern Python tooling (uv + Ruff + mypy), 2026: https://softaims.com/blog/modern-python-tooling-uv-ruff-mypy-2026 (accessed 2026-06-05, established-practitioner)
- FastAPI async patterns + ORM N+1, 2025: https://shiladityamajumder.medium.com/async-apis-with-fastapi-patterns-pitfalls-best-practices-2d72b2b66f25 (accessed 2026-06-05, established-practitioner)

## Cross-References

- `rules/hatch3r-api-design.md` — REST/GraphQL/gRPC contract floors apply to FastAPI / Django services.
- `rules/hatch3r-testing.md` — coverage thresholds carry over to `pytest --cov`.
- `rules/hatch3r-observability-logging.md` — structured-logging contract applies to Python `logging` / `structlog`.
