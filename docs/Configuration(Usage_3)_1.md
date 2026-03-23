# Configuration

Orwell's global settings are managed through the **Config** page at `/config`. Settings are stored in the `app_configurations` table in the SQLite database and are grouped into logical sections.

---

## Accessing the Config Page

Navigate to `/config` from the top navigation. Changes take effect immediately — no restart required.

---

## Judge Settings

These settings apply globally to all judge models unless a specific judge has **"Override Global Settings"** enabled on its model card in the Model Hub.

| Setting | Default | Description |
|---|---|---|
| `judge_global_limits_enabled` | `1` (on) | Master switch for global token limits on judge models |
| `judge_default_max_tokens` | `4000` | Max output tokens per judge call |
| `judge_default_max_reasoning_tokens` | `3000` | Max reasoning/thinking tokens (for models that support it) |
| `judge_default_temperature` | `0.0` | Temperature for judge model calls. `0.0` gives deterministic scoring |

**Tip:** Keep judge temperature at `0.0` for reproducible scores. Higher temperatures introduce variance between runs.

---

## Audit Settings

| Setting | Default | Description |
|---|---|---|
| `scoring_threshold_high` | `3.0` | Mean score below this → **High Risk** |
| `scoring_threshold_medium` | `5.0` | Mean score below this → **Medium Risk** (≥ threshold_high) |
| `loop_detection_enabled` | `1` (on) | Abort target model if a reasoning loop is detected |
| `loop_detection_max_thought_tokens` | `3000` | Max reasoning tokens before triggering loop abort |
| `loop_detection_repetition_threshold` | `4` | Number of repeated phrases before triggering loop abort |

---

## Data Generation Settings

These settings govern the **Prompt Generator** (`/generate`) when no schema-specific generator prompt is configured.

| Setting | Description |
|---|---|
| `generator_system_prompt` | The system prompt used by the AI to generate new evaluation prompts. Controls the style, format, and domain focus of generated prompts. |
| `dimension_template` | The starter template shown in the Prompt Generator when defining a new dimension. Uses `{dimension_name}` as a placeholder. |

Both settings can be fully customised. The default `generator_system_prompt` is tuned for GLOBE-style cross-cultural workplace scenarios. If you're working with a custom schema, the schema's own `generator_system_prompt` (if set) takes priority over this global setting.

---

## Provider API Keys

Orwell supports two ways to configure API keys for model providers:

### Option 1: Provider-Level Keys (Recommended)
Go to **Model Hub → Providers** tab. Each provider (OpenRouter, Ollama, or custom) has an API key field. All models under that provider will inherit this key unless overridden.

### Option 2: Model-Level Keys
When adding or editing a model in the Model Hub, you can set an API key directly on that model. This takes precedence over the provider-level key.

### Option 3: Environment Variable
Set `OPENROUTER_API_KEY` in your `.env` file. This is used as a fallback for the OpenRouter provider if no key is configured in the UI.

---

## Resetting to Defaults

Config values are stored in the database. To reset to defaults, you can either:
- Manually update values on the Config page
- Delete `data/orwell.db` and restart the server (this resets **all** data, not just config)
