# Model Hub

The **Model Hub** at `/model-hub` is where you register and manage all AI models that Orwell will interact with — both the models you're testing (Target Models) and the models used to score responses (Judge Models). It also manages model providers and judge benches.

---

## Model Categories

Every model in Orwell is assigned one of two categories:

| Category | Purpose |
|---|---|
| **Target** | The model you are auditing. Its responses are the ones being scored. |
| **Judge** | The model used to evaluate and score the target model's responses. Also used for report generation and prompt generation. |

A single model can only be one category at a time. You can add the same underlying model (e.g., GPT-4o) as both a Target and a Judge by creating two separate entries.

---

## Adding a Model

1. Click **"Add Model"** on the Model Hub.
2. Fill in the required fields:

| Field | Description |
|---|---|
| **Name** | A friendly display name (e.g., `GPT-4o (Audit Target)`) |
| **Category** | `target` or `judge` |
| **Provider** | Select from your registered providers (e.g., OpenRouter, Ollama) |
| **Base URL** | The OpenAI-compatible endpoint (auto-filled from provider) |
| **Model Key** | The model identifier sent in API calls (e.g., `openai/gpt-4o`, `llama3`) |
| **API Key** | Optional. Overrides the provider-level API key for this model only. |

3. Click **"Test Connection"** to verify the model is reachable before saving.
4. Click **"Save"**.

---

## Advanced Model Settings (Judge Models)

Judge models have additional settings:

| Field | Description |
|---|---|
| **Temperature** | Per-model temperature override. Leave empty to use the global judge temperature from Config. |
| **System Prompt** | Custom judge system prompt. Overrides the schema-level and global judge system prompt when set. |
| **Analysis Persona** | The AI persona used when writing the executive summary and report sections (e.g., `"Senior AI Safety Auditor"`, `"Risk Officer"`). |
| **Reasoning Effort** | For models that support it (e.g., `o3`): `high`, `medium`, `low`, or `disabled`. |
| **Max Output Tokens** | Cap the number of output tokens per judge call. |
| **Max Reasoning Tokens** | Cap reasoning/thinking token budget for supported models. |
| **Token Limits Enabled** | Toggle to activate the per-model token limits above. |
| **Override Global Settings** | When enabled, this model's token and temperature settings take precedence over the global Config values. |

---

## Testing a Connection

The **"Test Connection"** button sends a minimal `{"role": "user", "content": "hi"}` request to the model's endpoint. If successful, the model is verified. If it fails, Orwell shows the HTTP status code, raw response, and diagnostic hints (e.g., missing API key, wrong endpoint format, rate limit).

All provider endpoints must be **OpenAI-compatible** (i.e., expose a `/chat/completions` endpoint). If your base URL doesn't end in `/chat/completions`, Orwell appends it automatically.

---

## Providers

The **Providers** tab manages the registry of model providers.

Orwell ships with two built-in providers that cannot be deleted:
- **OpenRouter** — `https://openrouter.ai/api/v1`
- **Ollama** — `http://localhost:11434/v1`

You can add custom providers for any OpenAI-compatible API (e.g., a self-hosted vLLM server, Azure OpenAI, Anthropic via a proxy).

Custom providers have:
- **Name** — display name
- **Base URL** — the API base URL
- **API Key** — shared key for all models under this provider
- **Website** — optional reference URL

Built-in providers cannot be deleted, but their API keys and base URLs can be updated.

---

## Judge Benches

The **Benches** tab lets you create multi-judge configurations.

A **Judge Bench** is a named group of 1–5 judge models, with a scoring mode:

| Mode | How it works |
|---|---|
| **All (Consensus)** | Every judge scores every response. Final score = mean of all judges. Highest accuracy. |
| **Random** | A random judge is selected for each response. Good for large-scale audits where speed matters. |
| **Jury** | All judges score independently, then a **Foreman** model synthesises their arguments into a final verdict. Best for nuanced or ambiguous cases. |

For **Jury** mode, you must also designate a Foreman model — this must be a registered judge-category model.

To use a bench in an audit, select it from the **Judge** dropdown in the Playground instead of a single judge model.

---

## Deleting Models

Models can be deleted freely unless they are referenced by an active bench. Delete the bench first, then delete the model. Deleting a custom provider with `force=true` will also delete all models under that provider.
