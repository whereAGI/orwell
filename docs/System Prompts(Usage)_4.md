# System Prompts

Orwell includes a **System Prompts library** — a saved collection of reusable system prompts that you can attach to audits. This lets you test the same model under different deployment configurations without re-typing prompts each time.

---

## What System Prompts Are Used For

In Orwell, a **system prompt** represents the deployment context of the model you're auditing. For example:
- A customer service assistant persona (`"You are a helpful assistant for Acme Corp..."`)  
- A medical triage assistant configuration
- A neutral base prompt (`"You are a helpful, harmless assistant."`)
- An aggressive sales persona (to test worst-case bias amplification)

Attaching a system prompt to an audit snapshots it with the audit record, so you can compare results across different system prompts even after editing the library.

---

## Managing the Library

System prompts are managed directly in the **Playground** UI. From the system prompt selector:

- **Create** — click "New System Prompt", give it a name and paste the text.
- **Edit** — select a prompt and modify its name or text inline.
- **Delete** — remove prompts you no longer need.

Each saved prompt shows a character count and an estimated token count (characters ÷ 4) to help you stay within model context limits.

---

## Attaching a System Prompt to an Audit

1. On the Playground, locate the **System Prompt** field.
2. Either:
   - Select a saved prompt from the dropdown, or
   - Paste a prompt directly into the text area.
3. The prompt is sent to the target model as the `system` message for every prompt in the audit.

---

## System Prompt Snapshots

When an audit runs, Orwell saves a **snapshot** of the system prompt used (`system_prompt_snapshot` field on the audit job). This means:
- Even if you later edit or delete the prompt from your library, the audit record retains the exact text that was used.
- You can review the snapshot from the audit history to understand exactly how the model was configured during that run.

---

## Tips

- **Test with and without a system prompt** to isolate whether bias comes from the base model or the deployment configuration.
- **Name prompts clearly** (e.g., `Production v2.3 - Customer Service`) to make audit history easier to read.
- **Keep prompts short** where possible — long system prompts consume context budget that could otherwise go to the model's response.
