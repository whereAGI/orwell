# Introduction to Orwell

**Orwell** is an open-source, local-first platform for systematically auditing and evaluating Large Language Models (LLMs) for bias, safety violations, and behavioural blind spots — before they reach production.

Orwell is designed for researchers, AI engineers, compliance teams, and anyone who needs to stress-test a model against rigorous, structured criteria without sending data to a third-party service.

---

## 🚀 Key Capabilities

### 1. Schema-Driven Auditing
Every audit in Orwell is anchored to an **Audit Schema** — a complete evaluation configuration that defines what you're testing for, how prompts are generated, how responses are scored, and how the report is written. Orwell ships with four built-in schemas:

- 🌍 **Cultural Values (GLOBE)** — 9-dimension cross-cultural bias framework
- 🏷️ **Brand & Product Preference** — unprompted commercial steering detection
- 🗳️ **Political Neutrality** — partisan framing and one-sided treatment
- ⚖️ **Demographic Fairness** — differential treatment across protected groups

You can also create fully custom schemas for any evaluation domain.

### 2. Flexible Judge System
Orwell supports three evaluation modes:
- **Single Judge** — one model scores every response. Fast and simple.
- **Bench (Multi-Judge)** — a panel of models scores responses. Two sub-modes:
  - *All* — every judge scores every response; final score is the mean.
  - *Random* — a random judge is selected per response; useful for high-volume audits.
- **Jury (with Foreman)** — all judges score independently, then a designated *Foreman* model synthesises their arguments into a final verdict. Best for nuanced or contested cases.

### 3. Data Studio & Prompt Library
Orwell includes a built-in **Data Studio** at `/studio` for managing the prompt library that feeds audits. You can browse, search, filter, import, and export prompts. Prompts are tagged by dimension and schema, and can be type `system` (built-in) or `custom` (user-created or AI-generated).

### 4. Prompt Generator
The **Prompt Generator** at `/generate` uses an AI model of your choice to generate new evaluation prompts for any dimension — including entirely new dimensions you define. The generator is schema-aware: it inherits the schema's generator system prompt when one is configured.

### 5. Comprehensive Reporting
Audit reports include:
- **Executive Summary** — risk narrative written by an AI persona you configure
- **Score Distributions** — per-dimension mean scores and risk levels
- **Failure Analysis** — detailed breakdown of low-scoring responses
- **Actionable Recommendations** — system prompt clauses to remediate detected bias
- **PDF Export** — ready-to-share for stakeholders

### 6. Local & Private
Orwell runs entirely on your machine or private cloud. All data — prompts, responses, scores, reports — is stored in a local **SQLite** database (`data/orwell.db` by default). No external telemetry.

---

## 🏗️ System Architecture

Orwell has three layers:

1. **Frontend (UI)** — Vanilla JS + HTML/CSS served as static files. Pages include the Playground (`/`), Data Studio (`/studio`), Prompt Studio (`/prompt-studio`), Model Hub (`/model-hub`), Schemas (`/schemas`), Prompt Generator (`/generate`), Config (`/config`), and Docs (`/docs`).
2. **Backend (FastAPI)** — Python async API at `http://127.0.0.1:8000`. Orchestrates audit jobs, judge evaluation, prompt generation, and report building. Interactive API docs at `/api-docs`.
3. **Database (SQLite via aiosqlite)** — Lightweight, zero-dependency, file-based. Created automatically on first startup at `data/orwell.db`. No separate database process required.

---

## 📚 Methodology & Literature

Orwell's default evaluation framework draws on established AI safety and cross-cultural research:

- **[Constitutional AI: Harmlessness from AI Feedback](https://arxiv.org/abs/2212.08073)** (Anthropic) — Using AI to evaluate AI.
- **[Holistic Evaluation of Language Models (HELM)](https://arxiv.org/abs/2211.09110)** (Stanford CRFM) — Comprehensive LLM evaluation across scenarios.
- **[GLOBE Research Program](https://globeproject.com/)** — The cross-cultural framework underlying Orwell's default cultural schema.

---

## ⏭️ Next Steps

Ready to get started? Head to the [Installation Guide](/docs) to set up Orwell on your machine.
