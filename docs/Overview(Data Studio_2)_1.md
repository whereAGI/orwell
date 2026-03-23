# Data Studio Overview

The **Data Studio** at `/studio` is Orwell's prompt library manager. It's the central place to view, search, filter, create, edit, import, and export the prompts that power your audits.

---

## What the Data Studio Contains

Every audit draws prompts from the library stored in the `custom_prompts` table. The Data Studio gives you full visibility and control over this library.

Prompts have the following fields:

| Field | Description |
|---|---|
| **Dimension** | The evaluation axis this prompt tests (e.g., `Power Distance`, `Gender Egalitarianism`) |
| **Text** | The actual prompt text sent to the target model |
| **Language** | Language code (default: `en`) |
| **Type** | `system` (built-in, shipped with Orwell) or `custom` (user-created or AI-generated) |
| **Model** | The generator model used, if the prompt was AI-generated |
| **Schema** | The audit schema this prompt belongs to (can be null for global prompts) |
| **Created At** | Timestamp |

---

## Prompt Types

### System Prompts (`type: system`)
These are the built-in prompts that ship with Orwell — pre-written, curated evaluation scenarios for the default dimensions. They cannot be edited or deleted through the UI.

### Custom Prompts (`type: custom`)
Anything you create manually, import via CSV, or generate using the Prompt Generator. These are fully editable and deletable.

---

## Browsing & Filtering

The Data Studio supports the following filters:

- **Source** — `All`, `System only`, or `Custom only`
- **Schema** — filter by a specific audit schema
- **Dimension** — filter by dimension name (populated from the library)
- **Search** — full-text search across prompt text
- **Date Range** — filter by creation date

Results are paginated (up to 100 per page) and sortable by creation date.

---

## Creating a Prompt Manually

1. Click **"Add Prompt"** in the Data Studio.
2. Fill in:
   - **Dimension** — type or select an existing dimension
   - **Text** — the prompt text
   - **Language** — default `en`
   - **Schema** — which schema to tag it to (optional)
3. Click **Save**.

---

## Editing & Deleting

- Click any custom prompt row to edit its dimension, text, or language inline.
- Click the delete icon to remove a single prompt.
- Use **Bulk Delete** to remove multiple prompts at once — either by selecting checkboxes or by deleting everything matching the current filter.

> ⚠️ System prompts cannot be deleted. Only `custom` type prompts can be modified or removed.

---

## Dimensions List

The filter dropdown is populated from the distinct dimension names present in the library. New dimensions appear automatically once you add or import prompts tagged to them — there is no separate step to "register" a dimension.
