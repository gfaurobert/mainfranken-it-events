# Task 1 Report: Projekt-Scaffold, Dependencies & Config

## Status: DONE

## What Was Implemented

### Step 1: ADK Scaffold
Ran `agents-cli scaffold create ingest --agent adk --prototype --agent-guidance-filename CLAUDE.md` from the worktree root. The command succeeded (GCP credentials warning was non-fatal; scaffold continued).

**ACTUAL agent-code directory: `ingest/app/`** (not `ingest/ingest/`). The scaffold put the ADK agent at `ingest/app/agent.py` with `root_agent` defined there.

### Step 2: Dependencies
Added to `ingest/pyproject.toml` under `dependencies`:
- `litellm>=1.40`, `icalendar>=5.0`, `httpx>=0.27`, `beautifulsoup4>=4.12`, `supabase>=2.4`, `pydantic>=2.0`, `pyyaml>=6.0`

Updated `dev` dependency group to match the brief's minimum versions (`pytest>=8.0`, `pytest-asyncio>=0.23`).

Added `ingest` to `[tool.hatch.build.targets.wheel] packages` and `[tool.ruff.lint.isort] known-first-party`.

`uv sync` installed all dependencies successfully.

### Step 3: `.env.example`
Created `ingest/.env.example` with all 6 required env vars. Both `ingest/.gitignore` (line 109 and 200) and the root `.gitignore` (`.env` and `.env.*` patterns) cover `ingest/.env`.

### Step 4: Failing Test (RED)
Created `ingest/tests/unit/test_config.py` with the exact content from the brief (plus `get_settings.cache_clear()` per the brief's hint).

### Step 5: RED Run
```
cd ingest && uv run pytest tests/unit/test_config.py -v
→ FAILED: ModuleNotFoundError: No module named 'ingest'
```

### Step 6: config.py Implementation
Created:
- `ingest/ingest/__init__.py` — empty package marker
- `ingest/ingest/config.py` — `Settings` dataclass, `get_settings()` (lru_cache), `get_model()` returning `LiteLlm`

**ACTUAL ingest package path: `ingest/ingest/`**

The pytest config has `pythonpath = "."` which resolves to the `ingest/` project directory, making `import ingest` find `ingest/ingest/`.

### Step 7: GREEN Run
```
cd ingest && uv run pytest tests/unit/test_config.py -v
→ 1 passed in 7.49s
```

### Full suite
```
cd ingest && uv run pytest tests/unit/ -v
→ 2 passed (test_settings_read_from_env + test_dummy)
```

## TDD Evidence

**RED:**
```
E   ModuleNotFoundError: No module named 'ingest'
1 error during collection
```

**GREEN:**
```
tests/unit/test_config.py::test_settings_read_from_env PASSED  [100%]
1 passed in 7.49s
```

## Files Changed/Created

| File | Action |
|------|--------|
| `ingest/` (whole dir) | Created by `agents-cli scaffold create` |
| `ingest/pyproject.toml` | Modified: added 7 runtime deps, updated dev deps, added `ingest` to packages/isort |
| `ingest/.env.example` | Created |
| `ingest/ingest/__init__.py` | Created |
| `ingest/ingest/config.py` | Created |
| `ingest/tests/unit/test_config.py` | Created |

## Self-Review Findings

- **No secrets hardcoded** — all values from env vars
- **Functions focused** — `get_settings` and `get_model` are both small
- **lru_cache caveat handled** — test calls `get_settings.cache_clear()` before each test invocation so env monkeypatching works
- **Deprecation warnings** — `BaseAgentConfig is deprecated` comes from google-adk internals, not our code; non-blocking

## Concerns

1. **`BaseAgentConfig` deprecation** from google-adk's internals (5 warnings). Not caused by our code; should be resolved by a future google-adk release.
2. **`ingest/app/agent.py` imports `google.auth.default()`** which will fail in CI without GCP credentials. Integration tests that touch `app/agent.py` will need mocking or env vars. This is scaffolded code, not our config code.
3. **`google-adk[gcp]>=2.0.0,<3.0.0`** already in the scaffold — `google-adk` without `[gcp]` extra was requested in the brief, but `[gcp]` is a superset. This is fine.

## Package Path for Downstream Tasks

**`ingest/ingest/`** — Python import path: `from ingest.config import get_settings`
**ADK agent code**: `ingest/app/` — Python import path: `from app.agent import root_agent`

---

## Task-1 Review Fixes (2026-06-25)

### Changes Applied

| # | File | Change |
|---|------|--------|
| 1 | `ingest/tests/unit/test_config.py` | Removed unused `import os` (ruff F401) |
| 2 | `ingest/tests/unit/test_config.py` | Added `test_get_model_returns_lite_llm` test |
| 3 | `ingest/tests/unit/test_config.py` | Extended `test_settings_read_from_env` to assert all 6 Settings fields |
| 4 | `ingest/tests/unit/test_dummy.py` | Deleted (scaffold placeholder, asserted `1 == 1`) |
| 5 | `ingest/tests/integration/test_agent.py` | Added `pytest.skip(allow_module_level=True)` before scaffold imports |
| 6 | `ingest/tests/integration/test_server_e2e.py` | Added `pytest.skip(allow_module_level=True)` before scaffold imports |

### LiteLlm model-field attribute

The `LiteLlm` class (pydantic model) stores the model string in the `.model` attribute. Verified by instantiating `LiteLlm(model='openai/test', ...)` and inspecting `vars(obj)` — result: `{'model': 'openai/test', 'llm_client': ...}`. The test asserts `m.model == "openai/deep-v4-flash"`.

### Note on skip mechanism

`pytestmark = pytest.mark.skip(...)` alone does NOT prevent collection-time import errors because Python executes module-level imports before pytest can apply skip markers. `pytest.skip(allow_module_level=True)` raises a `Skipped` exception immediately during collection, before any subsequent `from app.agent import ...` line is reached. This is the correct pattern for skipping files whose module-level imports have unavoidable side effects.

### Pytest commands run

**Focused:**
```
cd ingest && python -m pytest tests/unit/test_config.py -v
```

Output:
```
============================= test session starts ==============================
platform linux -- Python 3.11.15, pytest-9.1.1, pluggy-1.6.0
collected 2 items

tests/unit/test_config.py::test_settings_read_from_env PASSED            [ 50%]
tests/unit/test_config.py::test_get_model_returns_lite_llm PASSED        [100%]

======================== 2 passed, 5 warnings in 3.78s =========================
```

**Full suite:**
```
cd ingest && python -m pytest -v
```

Output:
```
============================= test session starts ==============================
platform linux -- Python 3.11.15, pytest-9.1.1, pluggy-1.6.0
collected 2 items / 2 skipped

tests/unit/test_config.py::test_settings_read_from_env PASSED            [ 50%]
tests/unit/test_config.py::test_get_model_returns_lite_llm PASSED        [100%]

=================== 2 passed, 2 skipped, 5 warnings in 3.75s ===================
```

(Warnings are from google-adk internals — `BaseAgentConfig` deprecation — not our code.)
