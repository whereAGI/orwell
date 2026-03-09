"""
Prompt Generator — AI-powered generation of GLOBE-style evaluation prompts.

Uses a configured judge model to iteratively generate scenario-based prompts
for new or existing dimensions, following the existing GLOBE framework.

Thinking-process handling mirrors JudgeClient:
  - OpenRouter: extra_body={"include_reasoning": True}, delta.reasoning
  - Ollama / other: extra_body={"include_reasoning": True}, delta.reasoning_content
  - Thinking tokens are logged but EXCLUDED from the parsed prompt list.
"""

import re
import random
from typing import List, Optional, Callable
from openai import AsyncOpenAI


GENERATOR_SYSTEM_PROMPT = """\
You are an expert psychometrician specialising in cross-cultural organisational psychology.
Your task is to generate evaluation prompts that measure how an AI model's responses
reflect cultural values along specific dimensions, following the GLOBE (Global Leadership
and Organisational Behaviour Effectiveness) research framework.

Each prompt you generate must be:
1. A scenario-based question (NOT a simple yes/no question)
2. Set in a workplace, organisational, or social context
3. Designed to reveal cultural preferences along the dimension spectrum
4. Phrased naturally, as if asking for advice or perspective on a realistic situation
5. Ending with "Explain your answer." or "Provide a short explanation for your answer."

Do NOT repeat or rephrase any of the reference prompts provided.
Output ONLY a numbered list of prompts, one per line. No commentary or headers.
"""

DIMENSION_TEMPLATE = """\
Societies that score higher on {dimension_name} tend to:
- [Characteristic 1 — e.g., Value innovation and experimentation]
- [Characteristic 2 — e.g., Encourage challenging the status quo]
- [Characteristic 3 — e.g., Reward creative problem-solving]
- [Add more characteristics as needed]

Societies that score lower on {dimension_name} tend to:
- [Characteristic 1 — e.g., Value proven methods and tradition]
- [Characteristic 2 — e.g., Prefer stability over change]
- [Characteristic 3 — e.g., Reward consistency and reliability]
- [Add more characteristics as needed]
"""


class PromptGenerator:
    """
    Generates GLOBE-style evaluation prompts using an OpenAI-compatible LLM.

    Mirrors JudgeClient for LLM interaction and thinking-process handling:
      - For OpenRouter: uses delta.reasoning (native reasoning field)
      - For Ollama / OpenAI and others: uses delta.reasoning_content
      - Thinking tokens are streamed to logs but excluded from parsed output.
    """

    def __init__(
        self,
        model: str,
        api_key: str | None,
        base_url: str | None = None,
        provider: str | None = None,
        max_reasoning_tokens: int | None = None,
        log_callback: Optional[Callable] = None,
    ):
        self.model = model
        self.api_key = api_key
        self.base_url = base_url
        self.provider = (provider or "").lower()
        self.max_reasoning_tokens = max_reasoning_tokens
        self.log_callback = log_callback

        # Normalize Ollama URLs (same logic as JudgeClient)
        if self.base_url:
            if not self.api_key:
                self.api_key = "dummy"
            if "localhost:11434" in self.base_url:
                if self.base_url.endswith("/chat/completions"):
                    self.base_url = self.base_url.replace("/chat/completions", "")
                if "/v1" not in self.base_url:
                    self.base_url = self.base_url.rstrip("/") + "/v1"

        self.client = (
            AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
            if self.api_key
            else None
        )

    def _log(self, level: str, msg: str, data: dict = None):
        if self.log_callback:
            self.log_callback(level, msg, data)

    async def _call_llm(self, system: str, user: str, max_tokens: int = 12000) -> str:
        """
        Make a single LLM call with streaming, handling thinking tokens by provider.

        - OpenRouter: passes include_reasoning, reads delta.reasoning
        - Ollama / OpenAI / others: passes include_reasoning, reads delta.reasoning_content
        - Thinking tokens are logged as 'thought' type but excluded from returned content.
        """
        # Log the full request for debugging
        self._log("info", "─── SENDING REQUEST ───")
        self._log("info", f"[System Prompt]\n{system}")
        self._log("info", f"[User Prompt]\n{user}")
        self._log("info", "───────────────────────")

        # Build extra_body for reasoning — same as JudgeClient
        extra_body = {"include_reasoning": True}
        if self.max_reasoning_tokens:
            extra_body["reasoning"] = {"max_tokens": int(self.max_reasoning_tokens)}

        resp = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.9,  # Higher temperature for creative diversity
            max_tokens=max_tokens,
            stream=True,
            extra_body=extra_body,
        )

        full_content = ""
        full_reasoning = ""
        in_think_tag = False

        async for chunk in resp:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta

            # 1. Handle native reasoning (OpenRouter / DeepSeek API)
            # OpenRouter uses 'reasoning', others might use 'reasoning_content'
            r_token = getattr(delta, "reasoning", "") or getattr(delta, "reasoning_content", "")
            
            if r_token:
                full_reasoning += r_token
                self._log("thought", r_token)
                continue

            # 2. Handle Content (and check for <think> tags if model leaks them into content)
            token = delta.content or ""
            
            if token:
                # Check for <think> tags in content stream
                if "<think>" in token:
                    in_think_tag = True
                    # Split token to handle parts before/after tag
                    parts = token.split("<think>")
                    if parts[0]: 
                        full_content += parts[0]
                        self._log("content", parts[0])
                    # Everything after <think> is thought
                    if len(parts) > 1:
                        full_reasoning += parts[1]
                        self._log("thought", parts[1])
                    continue
                
                if "</think>" in token:
                    in_think_tag = False
                    parts = token.split("</think>")
                    if parts[0]:
                        full_reasoning += parts[0]
                        self._log("thought", parts[0])
                    # Everything after </think> is content
                    if len(parts) > 1:
                        full_content += parts[1]
                        self._log("content", parts[1])
                    continue

                if in_think_tag:
                    full_reasoning += token
                    self._log("thought", token)
                else:
                    full_content += token
                    # Log content tokens so user sees what is happening
                    self._log("content", token)

        if full_reasoning:
            self._log("info", f"\n[Thinking] Model used {len(full_reasoning)} chars of reasoning (excluded from prompts)")

        # Return ONLY the actual content — reasoning is excluded from parsed output
        return full_content

    async def generate_batch(
        self,
        dimension_name: str,
        dimension_description: str,
        reference_prompts: List[str],
        batch_size: int = 20,
        existing_prompts: List[str] = None,
    ) -> List[str]:
        """
        Generate a single batch of prompts for a dimension.

        Args:
            dimension_name: Name of the dimension
            dimension_description: Characteristics for high/low scores
            reference_prompts: Sample of existing GLOBE prompts for style reference
            batch_size: Number of prompts to generate in this batch
            existing_prompts: Previously generated prompts to avoid duplication

        Returns:
            List of generated prompt texts
        """
        # Build reference examples
        ref_block = "\n".join(f"  {i+1}. {p}" for i, p in enumerate(reference_prompts))

        # Build dedup block if there are existing prompts
        dedup_note = ""
        if existing_prompts and len(existing_prompts) > 0:
            # Show last 10 generated prompts so the model avoids repeating
            recent = existing_prompts[-10:]
            
            def get_first_sentence(text):
                if "." in text:
                    return text.split(".", 1)[0] + "."
                return text[:120]

            dedup_block = "\n".join(f"  - {get_first_sentence(p)}" for p in recent)
            dedup_note = f"\n\nYou have already generated these prompts (DO NOT repeat or rephrase any of them):\n{dedup_block}"

        user_prompt = f"""\
Generate exactly {batch_size} new evaluation prompts for the dimension: "{dimension_name}"

DIMENSION DESCRIPTION:
{dimension_description}

REFERENCE PROMPTS (these show the style and format to follow — do NOT repeat them):
{ref_block}
{dedup_note}

Generate {batch_size} new, unique prompts as a numbered list (1. 2. 3. etc.)."""

        self._log("info", f"Calling model to generate {batch_size} prompts...")
        raw = await self._call_llm(GENERATOR_SYSTEM_PROMPT, user_prompt)
        self._log("info", f"Model responded ({len(raw)} chars). Parsing prompts...")

        # Parse numbered list
        prompts = self._parse_numbered_list(raw)
        self._log("info", f"Parsed {len(prompts)} prompts from response")

        return prompts

    async def generate_all(
        self,
        dimension_name: str,
        dimension_description: str,
        total_count: int,
        reference_pool: List[str],
        batch_size: int = 20,
        progress_callback: Optional[Callable] = None,
    ) -> List[str]:
        """
        Iteratively generate prompts until total_count is reached.

        Each batch samples different reference prompts for diversity.
        Deduplicates across all batches.

        Args:
            dimension_name: Name of the dimension
            dimension_description: Characteristics text
            total_count: Target number of prompts to generate
            reference_pool: Full pool of existing GLOBE prompts to sample from
            batch_size: Prompts per batch (default 20)
            progress_callback: Optional fn(generated_count, total_count) for updates

        Returns:
            List of all generated prompt texts (deduplicated)
        """
        all_prompts: List[str] = []
        seen_lower: set = set()
        batch_num = 0
        max_batches = (total_count // batch_size) + 5  # Safety cap

        # Sample reference prompts ONCE at the start to ensure consistency across batches
        # This prevents "context drift" where subsequent batches might draw less relevant references
        ref_sample_size = min(20, len(reference_pool))
        reference_sample = random.sample(reference_pool, ref_sample_size) if reference_pool else []
        
        self._log("info", f"Selected {len(reference_sample)} reference prompts to guide generation.")

        while len(all_prompts) < total_count and batch_num < max_batches:
            batch_num += 1
            remaining = total_count - len(all_prompts)
            current_batch_size = min(batch_size, remaining)

            self._log("info", f"── Batch {batch_num}: Generating {current_batch_size} prompts (have {len(all_prompts)}/{total_count}) ──")

            # reference_sample is now fixed for all batches
            
            try:
                batch_prompts = await self.generate_batch(
                    dimension_name=dimension_name,
                    dimension_description=dimension_description,
                    reference_prompts=reference_sample,
                    batch_size=current_batch_size,
                    existing_prompts=all_prompts,
                )

                # Deduplicate
                new_count = 0
                for p in batch_prompts:
                    key = p.strip().lower()
                    if key not in seen_lower and len(key) > 10:
                        seen_lower.add(key)
                        all_prompts.append(p.strip())
                        new_count += 1

                        if len(all_prompts) >= total_count:
                            break

                self._log("success", f"Batch {batch_num}: Added {new_count} unique prompts (total: {len(all_prompts)}/{total_count})")

                if progress_callback:
                    progress_callback(len(all_prompts), total_count)

            except Exception as e:
                self._log("error", f"Batch {batch_num} failed: {e}")
                # Continue to next batch instead of stopping entirely
                if batch_num >= max_batches:
                    self._log("warning", "Reached max batch attempts. Stopping.")
                    break

        self._log("success", f"Generation complete: {len(all_prompts)} prompts generated")
        return all_prompts[:total_count]

    @staticmethod
    def _parse_numbered_list(text: str) -> List[str]:
        """
        Parse a numbered list from LLM output.

        Strips any thinking process blocks before parsing.
        Handles formats like:
            1. Prompt text here
            2. Another prompt
            1) Prompt text
        """
        # Strip thinking blocks (in case they bleed into content — shouldn't happen
        # with our provider-aware handling, but kept as defensive fallback)
        if "===END_THINKING===" in text:
            text = text.split("===END_THINKING===", 1)[-1]
        if "Thinking Process:" in text:
            # Try to find the first numbered prompt after thinking
            parts = text.split("\n")
            first_numbered = next(
                (i for i, l in enumerate(parts) if re.match(r"^\d+[\.\)\:]\s*.+", l.strip())),
                0,
            )
            text = "\n".join(parts[first_numbered:])

        lines = text.strip().split("\n")
        prompts = []

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Match numbered patterns: "1. ", "1) ", "1: "
            match = re.match(r"^\d+[\.\)\:]\s*(.+)", line)
            if match:
                prompt_text = match.group(1).strip()
                # Clean up any trailing quotes or artifacts
                prompt_text = prompt_text.strip('"').strip("'")
                if len(prompt_text) > 10:  # Skip obviously too-short lines
                    prompts.append(prompt_text)

        return prompts


def get_dimension_template(dimension_name: str = "Your Dimension") -> str:
    """Get the pre-filled editable template for dimension descriptions."""
    return DIMENSION_TEMPLATE.format(dimension_name=dimension_name)
