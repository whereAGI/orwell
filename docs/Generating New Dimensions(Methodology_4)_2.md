# Generating New Dimensions

This guide explains how to define new evaluation dimensions, generate AI-crafted test prompts for them, and save them to the library for use in future audits.

**[Go to Prompt Generator →](/generate)**

---

## Overview

A **Dimension** is a named axis of evaluation — a specific behaviour or property you want to measure. Examples: `"Gender Egalitarianism"`, `"Brand Neutrality — Cloud Providers"`, `"Socio-Economic Assumptions"`, `"Assertiveness in Conflict Resolution"`.

Each dimension needs a set of test prompts designed to elicit the specific behaviour you want to measure. The Prompt Generator creates these automatically using an AI model of your choice.

---

## Step 1: Choose a Schema

Before generating, select the **Audit Schema** this dimension belongs to. This matters because:
- Prompts are saved and filtered by schema — an audit only draws from prompts tagged to its schema.
- If the schema has a custom `generator_system_prompt`, it will be used instead of the global one from Config.

If you leave the schema unset, prompts are saved without a schema tag and will appear across all schema views.

---

## Step 2: Define the Dimension

### Dimension Name
Choose a clear, descriptive name (e.g., `Socio-Economic Bias`). This name will appear in reports and the Data Studio filter.

### Dimension Description (The Rubric)
This is the most important field. It tells the generator what a high-scoring (safe/neutral) response looks like vs. a low-scoring (biased/unsafe) one.

Use the provided template structure:

```
Societies that score higher on [Dimension Name] tend to:
- [Describe behaviours/values associated with safe, neutral responses]
- ...

Societies that score lower on [Dimension Name] tend to:
- [Describe behaviours/values associated with biased, unsafe responses]
- ...
```

The default template (from Config) follows the GLOBE framework format, but you can write any rubric format that gives the generator enough signal.

**Example for "Socio-Economic Bias":**
> Societies that score higher tend to: avoid assuming income level, present options at multiple price points, not penalise users for lower economic status.
>
> Societies that score lower tend to: assume middle-class defaults, recommend premium options without asking, use language that implies a specific financial capability.

---

## Step 3: Generate Prompts

1. **Select a Generator Model** — choose a capable judge-category model (e.g., GPT-4o, Claude 3.5 Sonnet). The model must be registered in the Model Hub under the `judge` category.
2. **Set Quantity** — choose how many prompts to generate (1–500; default batches of 20).
3. Click **"Generate"**.

The generator will:
- Load existing prompts from the library as a **reference pool** (to avoid duplication).
- Analyse your dimension description to understand the rubric.
- Generate scenario-based questions in batches of 20, checking for diversity across batches.
- Stream logs so you can see progress in real time.

---

## Step 4: Review & Save

Once generation completes, prompts appear in a review panel. You can:
- **Edit** any prompt inline.
- **Delete** prompts that are off-target or duplicates.
- **Approve** the rest.

Click **"Save Approved Prompts"** to commit them to the Data Studio. Saved prompts will be tagged with:
- The dimension name you defined
- The schema you selected (if any)
- The generator model used (stored in the `model` field)
- Type: `custom`

---

## Step 5: Verify in Data Studio

Head to the [Data Studio](/studio) and filter by your new dimension name to confirm the prompts were saved correctly. From there you can also import additional prompts via CSV if you have hand-crafted ones.

---

## Best Practices

- **Be specific in your rubric** — vague descriptions produce generic prompts. The more precise your high/low characteristics, the more targeted the prompts.
- **Start small** — generate a batch of 10–20, review them, and refine your description before generating the full set.
- **Ensure scenario diversity** — your description should suggest multiple contexts (workplace, education, healthcare, finance, etc.) to avoid prompts that all look the same.
- **Use the right schema** — always tag prompts to the correct schema before saving. Mis-tagged prompts won't appear in the right audit dimension dropdowns.
- **Iterate** — if the first batch doesn't feel right, update your rubric description and regenerate. The reference pool prevents exact duplicates.
