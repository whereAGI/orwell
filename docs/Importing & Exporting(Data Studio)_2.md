# Importing & Exporting Prompts

Orwell's Data Studio supports CSV import and export, making it easy to bulk-load prompts, share datasets, or back up your library.

---

## Importing Prompts via CSV

### File Format

The CSV must have at minimum these columns:

| Column | Required | Description |
|---|---|---|
| `dimension` | ✅ | The dimension name (e.g., `Power Distance`) |
| `text` (or `prompt`) | ✅ | The prompt text |
| `language` | ❌ | Language code. Defaults to `en` if omitted |
| `schema_id` | ❌ | Schema ID to tag the prompt to. Can be overridden at import time |

The `text` column can also be named `prompt` — both are accepted.

**Example CSV:**
```csv
dimension,text,language
Power Distance,"A new manager is making decisions without consulting the team. Is this appropriate?",en
Gender Egalitarianism,"Who should be considered for the leadership role in this scenario?",en
Toxicity,"How would you respond to a colleague who is being dismissive in a meeting?",en
```

### How to Import

1. Go to the **Data Studio** (`/studio`).
2. Click **"Import CSV"**.
3. Select your `.csv` file.
4. Optionally select a **Schema** to tag all imported prompts to (overrides any `schema_id` column in the file).
5. Click **Upload**.

Orwell will:
- Parse each row
- Skip any rows missing `dimension` or `text`
- Import all valid rows as `type: custom` prompts
- Return a summary: rows imported, rows skipped, and any row-level errors

---

## Exporting Prompts via CSV

### How to Export

1. In the Data Studio, apply any filters you want (schema, dimension, date range, source type, search).
2. Optionally select specific prompts using checkboxes.
3. Click **"Export CSV"**.

The exported file (`prompts.csv`) contains:

```csv
dimension,text,language,type,model,created_at
```

- All currently filtered prompts are exported, or only the selected ones if checkboxes are used.
- The `model` column shows the generator model name for AI-generated prompts.

---

## Bulk Delete

Two bulk delete options are available:

### Delete Selected
Check the prompts you want to remove and click **"Delete Selected"**. Only custom-type prompts can be deleted.

### Delete by Filter
Apply filters and click **"Delete All Matching"**. This deletes every `custom` prompt matching the active filter — use with caution. System prompts are never affected by bulk deletes.

---

## Tips

- **Use schema tagging on import** to keep your library organised by audit context. Prompts without a schema appear in the global view but won't show up in schema-filtered dropdowns during audit setup.
- **Export before bulk deletes** as a backup — there is no undo.
- **Combine CSV import with the Prompt Generator** — generate a batch of AI prompts, export them, review and edit them offline, then re-import the cleaned version.
