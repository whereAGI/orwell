# Audit Schemas Overview

An **Audit Schema** is the complete evaluation configuration for a particular type of bias or safety test. Every audit in Orwell is anchored to a schema. The schema defines:

- What the evaluation is *for* (cultural values, political neutrality, brand bias, etc.)
- What **scoring axis labels** mean (what score 1 and score 7 represent in plain language)
- The **generator system prompt** used when AI-generating prompts for this schema's dimensions
- The **judge system prompt** used when scoring responses
- The **dimension template** shown in the Prompt Generator when defining new dimensions
- The **report prompts** that shape the executive summary, failure analysis, and recommendations sections
- A **schema context** string injected into all report generation calls for grounding

---

## Built-in Schemas

Orwell ships with four built-in schemas that cannot be deleted:

| Schema | Type | Icon | What it tests |
|---|---|---|---|
| **Cultural Values (GLOBE)** | `cultural` | 🌍 | 9-dimension GLOBE cross-cultural framework |
| **Brand & Product Preference** | `brand` | 🏷️ | Unprompted commercial steering toward brands/vendors |
| **Political Neutrality** | `political` | 🗳️ | Partisan framing, one-sided political treatment |
| **Demographic Fairness** | `demographic` | ⚖️ | Differential treatment across protected groups |

Built-in schemas are **partially editable** — you can update their prompt fields (judge system prompt, generator system prompt, dimension template, report prompts, schema context), but you cannot change their name, type, icon, or scoring axis labels. This protects the semantic identity of the schema while allowing you to tune evaluation behaviour.

---

## Custom Schemas

You can create fully custom schemas at `/schemas` for any evaluation domain not covered by the built-ins. Examples:
- **Regulatory Compliance Tone** — does the model communicate legal obligations accurately?
- **Healthcare Safety** — does the model give appropriate medical caveats?
- **Financial Neutrality** — does the model recommend specific financial products?

Custom schemas are fully editable and deletable.

---

## How Schema Prompts Are Resolved

Orwell uses a precedence chain when resolving which prompt to use during an audit:

```
Model-level prompt  →  Schema-level prompt  →  Global Config prompt  →  Hardcoded default
```

For example, when scoring a response:
1. If the judge model has a custom `system_prompt` set **and** `judge_override_global_settings` is on → use model prompt.
2. Else if the schema has a `judge_system_prompt` → use schema prompt.
3. Else → use the hardcoded default judge prompt.

For report generation, the precedence is similar with schema-level report prompts taking priority over generic defaults.

---

## Schema Context

The `schema_context` field is a short plain-text description (1–3 sentences) that gets injected into every report generation call. It grounds the AI persona in the domain of the audit — for example, telling it that it's evaluating cultural bias using the GLOBE framework, not generic safety. This makes report summaries more accurate and domain-specific.

---

## Viewing Schemas

All schemas are listed at `/schemas`. Click any schema to see its full configuration, including all prompt fields.
