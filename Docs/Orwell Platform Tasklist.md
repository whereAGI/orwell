# Orwell Platform Development Tasklist & Journal (POC-first)

## Working Principles
- Review cadence: update this tasklist after each feature change; weekly summary.
- Course-correct: if progress diverges from spec, add a note and corrective actions.
- Documentation: create/update docs in `Docs/` for modules, decisions, and debugging notes.
- Git: use branches per feature; commit when green; tag demo-ready milestones.
- Testing: add unit/integration tests in `tests/`; run locally and in CI.

## Status Legend
- [NS] Not started
- [IP] In progress
- [C] Completed
- [NR] Not required
- [B] Blocked

## Phase 0 — Foundations & Repo Setup
- [C] Initialize Python project structure per spec
  - Subtasks:
    - Create `orwell/`, `data/llm_globe/`, `static/` directories
    - Add `requirements.txt`, `config.yaml`, `.gitignore`
    - Prepare `schema.sql` file for SQLite
  - Notes:
- [NS] Initialize git and baseline commit
  - Subtasks:
    - Initialize repo, set main branch, add remote
    - Commit scaffolding, tag `poc-start`
  - Notes:

## Phase 1 — Database (SQLite)
- [C] Implement SQLite schema and initialization
  - Subtasks:
    - Create `schema.sql` with tables: `audit_jobs`, `prompts`, `responses`, `scores`, `reports`
    - Implement `orwell/database.py` with `init_database()` and `get_db()`
    - Ensure index creation for common queries
  - Notes:

## Phase 2 — Data Models
- [C] Implement Pydantic models for requests/responses
  - Subtasks:
    - Define `JobStatus`, `AuditRequest`, `JobResponse`, `DimensionScore`, `AuditReport` in `orwell/models.py`
    - Validate fields and defaults per spec
  - Notes:

## Phase 3 — FastAPI App
- [C] Build FastAPI app and endpoints
  - Subtasks:
    - Create `orwell/main.py`; mount `/static` for web UI
    - Endpoints: `/api/audit/create`, `/api/audit/{job_id}`, `/api/audit/{job_id}/report`, `/health`
    - Startup hook to initialize database
    - Background task `run_audit(job_id, request)`
  - Notes:

## Phase 4 — Audit Engine
- [C] Implement audit workflow controller
  - Subtasks:
    - Create `orwell/engine.py` with `AuditEngine`
    - Phases: load module → generate prompts → query model → judge scoring → report
    - Persist prompts, responses, scores; update status/progress throughout
  - Notes:

## Phase 5 — LLM-GLOBE Module
- [C] Implement prompt generation from LLM-GLOBE data
  - Subtasks:
    - Create `orwell/llm_globe.py` with `LLMGlobeModule`
    - Load `closed_prompts.csv`, `open_prompts.csv`, `rubrics.csv`
    - Generate prompts per selected dimensions and language; sample size control
  - Notes:

## Phase 6 — Judge Client
- [C] Implement LLM-as-judge scoring
  - Subtasks:
    - Create `orwell/judge.py` with `JudgeClient`
    - Score responses on 1–7 scale; return value and reasoning
    - Default to `gpt-4o` and support OpenAI-compatible APIs
  - Notes:

## Phase 7 — Reporting
- [C] Aggregate scores and persist report
  - Subtasks:
    - Compute mean per dimension, risk classification (low/medium/high)
    - Build `AuditReport` JSON and insert into `reports` table
    - Optional: Jinja2 templated summary for UI
  - Notes:

## Phase 8 — Static Web UI
- [C] Implement minimal dashboard
  - Subtasks:
    - Create `static/index.html` and `static/dashboard.js`
    - Form to start audit; poll status; progress bar; render dimension scores
    - Risk color coding (low/medium/high)
  - Notes:

## Phase 9 — Configuration & Runtime
- [C] Provide runtime configuration
  - Subtasks:
    - Add `config.yaml` with version, server, defaults, data path
    - Load defaults in app; allow overrides via env vars
  - Notes:

## Phase 10 — Dependencies & Deployment
- [C] Define dependencies
  - Subtasks:
    - Populate `requirements.txt` with FastAPI, Uvicorn, aiosqlite, httpx, pydantic, pandas, numpy, OpenAI
  - Notes:
- [C] Containerize application
  - Subtasks:
    - Create `Dockerfile` per spec; expose `8000`
    - Build and run locally; volume mount `orwell.db`
  - Notes:

## Phase 11 — Testing Strategy
- [C] Set up testing framework
  - Subtasks:
    - Create `tests/` folder; choose `pytest`
    - Add test config and basic fixtures (temp SQLite)
  - Notes:
- [C] Unit tests: database and models
  - Subtasks:
    - Test schema initialization and CRUD operations
    - Validate Pydantic models and enums
  - Notes:
- [IP] Integration tests: audit engine
  - Subtasks:
    - Mock target endpoint and judge; run full audit path
    - Assert persisted prompts/responses/scores and report correctness
  - Notes:
- [C] API tests
  - Subtasks:
    - Test `/api/audit/create`, status polling, and report retrieval
    - Health check
  - Notes:

## Phase 12 — Demo Prep
- [NS] Prepare partner/investor demo flow
  - Subtasks:
    - Populate data; set sample size to 20; validate <5 min run
    - Script: dashboard usage and results walkthrough
  - Notes:

## Phase 13 — Post-POC Enhancements (Roadmap)
- [NS] Add more modules (e.g., BEATS, LangBiTe)
- [NS] Distributed execution (workers)
- [NS] Production DB (PostgreSQL)
- [NS] Secrets management (Vault)
- [NS] Advanced reporting (PDF, charts)
- [NS] Authentication (JWT/OAuth)
- [NS] Multi-tenancy
- [NS] Monitoring (Prometheus, Grafana)
  - Notes:

## Ongoing — Documentation Tasks
- [NS] Document module APIs and schemas in `Docs/`
  - Subtasks:
    - Create per-module docs (`database.md`, `engine.md`, `llm_globe.md`, `judge.md`, `reporting.md`)
    - Record decisions, deviations, and debugging findings
  - Notes:
- [NS] Maintain CHANGELOG for notable changes
  - Subtasks:
    - Update after each feature merge; link PRs/commits
  - Notes:

## Ongoing — Git & Workflow Tasks
- [NS] Branch per feature; PRs with reviews
  - Subtasks:
    - Enforce commit messages; link tasks to commits
  - Notes:
- [NS] Tag milestones and releases
  - Subtasks:
    - Tag `poc-0.1.0` when demo-ready; write release notes
  - Notes:

## Ongoing — Quality & Validation
- [NS] Lint/type-check commands and CI
  - Subtasks:
    - Define `make lint`, `make typecheck`, `make test`; wire CI
  - Notes:
- [NS] Performance sanity checks
  - Subtasks:
    - Ensure 20-prompt audit <5 minutes; DB <10MB typical
  - Notes:

## Journal Notes
- Use this section to log progress, deviations from spec, and corrective actions.
- Entry format: date, task, status change, notes, follow-ups.

- 2025-11-17: Created this tasklist document. Status: [C]. Notes: Initialized project plan and status legend; all build tasks set to [NS] pending implementation.
- 2025-11-17: Implemented POC scaffold, DB schema, models, FastAPI app, engine, LLM-GLOBE module (CSV-based), judge client (heuristic), reporting, UI, config, Dockerfile. Adjusted `requirements.txt` to `numpy==1.26.4` for `pandas==2.2.0` compatibility.
- 2025-11-17: Dev server running with health endpoint; added basic e2e tests (2 passing). Added config loader for DB/data paths.

## Spec References
- Architecture and endpoints: `Docs/ORWELL POC - SIMPLIFIED TECHNICAL SPECIFICATION.md:26-51`, `265-387`
- Database schema: `Docs/ORWELL POC - SIMPLIFIED TECHNICAL SPECIFICATION.md:117-175`
- Audit engine overview: `Docs/ORWELL POC - SIMPLIFIED TECHNICAL SPECIFICATION.md:393-570`
- Static UI behavior: `Docs/ORWELL POC - SIMPLIFIED TECHNICAL SPECIFICATION.md:1009-1119`
- Configuration defaults: `Docs/ORWELL POC - SIMPLIFIED TECHNICAL SPECIFICATION.md:1126-1146`
- Requirements and Dockerfile: `Docs/ORWELL POC - SIMPLIFIED TECHNICAL SPECIFICATION.md:1156-1190`, `1194-1219`
- Demo script and metrics: `Docs/ORWELL POC - SIMPLIFIED TECHNICAL SPECIFICATION.md:1226-1282`