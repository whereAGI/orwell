# Running an Audit

Audits are run from the **Playground** at `/` (the home page). This guide walks through every step from setup to reading the results.

---

## Step 1: Select a Schema

Choose the **Audit Schema** that defines what you're testing for. The schema determines:
- Which built-in dimensions are available
- The system prompt used by the judge
- How the report sections are written

Orwell ships with four built-in schemas:
- 🌍 **Cultural Values (GLOBE)** — cross-cultural bias (default)
- 🏷️ **Brand & Product Preference** — commercial steering
- 🗳️ **Political Neutrality** — partisan framing
- ⚖️ **Demographic Fairness** — protected group treatment

You can also select any custom schema you've created at `/schemas`.

---

## Step 2: Select a Target Model

Choose the model you want to audit from the **Target Model** dropdown. This list is populated from the **target-category** models you've registered in the Model Hub.

**Optional — System Prompt:** You can attach a system prompt to the audit. This simulates how the model would be deployed in production (e.g., with a customer service persona). You can paste one directly or select a saved one from your **System Prompts** library.

---

## Step 3: Select a Judge

Choose how responses will be scored:

- **Single Judge** — pick one judge-category model from the dropdown.
- **Judge Bench** — pick a pre-configured bench (supports Random, All, or Jury modes).

If no judge is configured yet, go to the [Model Hub](/model-hub) first.

---

## Step 4: Choose Dimensions & Sample Size

**Dimensions** are the specific axes being evaluated (e.g., `Stereotypes`, `Power Distance`, `Gender Egalitarianism`). The available dimensions come from the custom prompts in your library that are tagged to the selected schema.

- Select individual dimensions or use **"All Dimensions"**.
- Set the **Sample Size** — the number of prompts per dimension that will be sent to the target model. Default is 50. Larger samples give more statistically reliable results but take longer.

---

## Step 5: Start the Audit

Click **"Start Audit"**. Orwell will:
1. Create an audit job and assign it a UUID.
2. Load prompts from the library for the selected dimensions and schema.
3. Send each prompt to the target model and collect responses.
4. Send each (prompt, response) pair to the judge model(s) for scoring.
5. Aggregate scores and generate the full report using the AI analysis persona.

Progress is shown in real time via a **live log stream**. You can see each prompt being sent, each score received, and any errors.

---

## Step 6: Reading the Report

Once the audit completes, click **"View Report"**. The report contains:

### Overall Risk
A top-level risk assessment: **Low** (mean ≥ 5.0), **Medium** (3.0–5.0), or **High** (< 3.0). Thresholds are configurable in `/config`.

### Dimension Scores
A breakdown of mean score and risk level per dimension. Each dimension shows:
- Mean score (1–7 scale)
- Sample size (number of prompts evaluated)
- Risk level badge

### Executive Summary
A narrative written by the AI analysis persona summarising the key findings, identifying the highest-risk dimensions, and contextualising the results.

### Failure Analysis
A detailed look at the lowest-scoring responses — what was asked, what the model said, the score, and the judge's reasoning.

### Recommendations
Actionable remediation steps: specific system prompt clauses you can add to address detected bias patterns, with estimated score improvement.

### PDF Export
Click **"Export PDF"** to download a formatted report suitable for sharing with stakeholders.

---

## Managing Audits

All past audits are listed in the **Audit History** panel. You can:
- **Rename** an audit (click the name to edit)
- **Add notes** to an audit for context
- **Delete** one or multiple audits
- **Abort** a running audit — the job will be marked `aborted` and stop processing new prompts

---

## Audit Filtering by Schema

The audit history can be filtered by schema. Select a schema from the filter dropdown to see only audits run under that schema — useful when comparing runs of the same model across time.

---

## Troubleshooting

**Audit stays at 0% / "pending"**
- The target model may be unreachable. Test the connection in the Model Hub.

**Audit completes with no dimensions scored**
- No prompts exist in the library for the selected schema/dimensions. Go to the Data Studio or Prompt Generator to add prompts first.

**High error rate in logs**
- Check the target model's API key and endpoint. Errors are logged per-prompt and don't abort the entire audit.

**Loop detection triggered**
- The target model entered a reasoning loop. Orwell automatically aborted that prompt. Adjust loop detection thresholds in `/config` if needed.
