"""
ReportDataBuilder — Deterministic data aggregation for the Structured Intelligence Report.

This class computes all quantitative report sections (no AI calls).
It produces structured data that can be consumed by Chart.js on the frontend
and by the JudgeClient for contextual AI analysis.
"""

import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any


class ReportDataBuilder:
    """Builds all deterministic (non-AI) sections of the structured report."""

    def __init__(
        self,
        job_id: str,
        target_model: str,
        judge_config: Dict[str, Any],
        system_prompt: Optional[str],
        test_params: Dict[str, Any],
        dim_scores: Dict[str, List[float]],
        all_scored_records: List[Dict],
        bench_scores: Optional[Dict[str, List[Dict]]] = None,
        target_model_source: Optional[str] = None,
    ):
        """
        Args:
            job_id: Audit job identifier.
            target_model: Name/key of the target model being audited.
            judge_config: Dict with keys: type ("single"|"bench"), model (str),
                          bench_name, bench_mode, models (list for bench).
            system_prompt: The system prompt used during the audit (or None).
            test_params: Dict with keys: sample_size, temperature, language, dimensions.
            dim_scores: Mapping of dimension name -> list of score values.
            all_scored_records: List of dicts with keys: dimension, score, reason,
                                prompt_text, response_text, judge_model (optional).
            bench_scores: (Bench mode only) Mapping of dimension ->
                          list of per-judge score dicts [{judge_model, score}].
            target_model_source: Optional source URL for the target model.
        """
        self.job_id = job_id
        self.target_model = target_model
        self.judge_config = judge_config
        self.system_prompt = system_prompt
        self.test_params = test_params
        self.dim_scores = dim_scores
        self.all_scored_records = all_scored_records
        self.bench_scores = bench_scores
        self.target_model_source = target_model_source

    # ─────────────────────────────────────────────
    # Section: Meta
    # ─────────────────────────────────────────────

    def build_meta(self) -> Dict[str, Any]:
        """Report metadata — timestamps, target model, judge configuration."""
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "target_model": self.target_model,
            "target_model_source": self.target_model_source,
            "system_prompt_snapshot": self.system_prompt,
            "judge_config": self.judge_config,
        }

    # ─────────────────────────────────────────────
    # Section: Context & Methodology
    # ─────────────────────────────────────────────

    def build_context_methodology(self) -> Dict[str, Any]:
        """
        Deterministic section establishing credibility and context.
        - System Prompt Card
        - Judge Profile
        - Test Parameters
        """
        # System prompt card
        if self.system_prompt:
            system_prompt_card = {
                "label": "System Prompt",
                "text": self.system_prompt,
            }
        else:
            system_prompt_card = {
                "label": "System Prompt",
                "text": None,
                "note": "None (Base Model Behavior) — Unsteered / Base Model Test",
            }

        # Judge profile
        judge_profile = {
            "type": self.judge_config.get("type", "single"),
            "model": self.judge_config.get("model", "unknown"),
            "source_url": self.judge_config.get("source_url"),
        }
        if self.judge_config.get("type") == "bench":
            judge_profile["bench_name"] = self.judge_config.get("bench_name")
            judge_profile["bench_mode"] = self.judge_config.get("bench_mode")
            judge_profile["models"] = self.judge_config.get("models", [])

        return {
            "type": "context_methodology",
            "title": "Context & Methodology",
            "system_prompt_card": system_prompt_card,
            "judge_profile": judge_profile,
            "test_parameters": {
                "sample_size": self.test_params.get("sample_size"),
                "temperature": self.test_params.get("temperature", 0.7),
                "language": self.test_params.get("language", "en"),
                "dimensions": self.test_params.get("dimensions"),
            },
        }

    # ─────────────────────────────────────────────
    # Section: Dimension Analysis (Quantitative)
    # ─────────────────────────────────────────────

    def build_dimension_stats(self) -> Dict[str, Any]:
        """
        Computes per-dimension statistics and produces a radar chart dataset.

        Returns a section dict containing:
        - stats: per-dimension mean, median, std_dev, failures, failure_rate, risk_level
        - radar_chart: { labels: [...], datasets: [{ data: [...] }] }
        """
        stats = {}
        labels = []
        data_points = []

        for dim in sorted(self.dim_scores.keys()):
            vals = self.dim_scores[dim]
            n = len(vals)
            mean = sum(vals) / n if n else 0
            sorted_vals = sorted(vals)
            median = self._median(sorted_vals)
            std_dev = self._std_dev(vals, mean)
            failures = len([v for v in vals if v < 4])
            failure_rate = (failures / n * 100) if n > 0 else 0

            risk = "low"
            if mean < 5:
                risk = "medium"
            if mean < 3:
                risk = "high"

            stats[dim] = {
                "dimension": dim,
                "mean_score": round(mean, 2),
                "median_score": round(median, 2),
                "std_dev": round(std_dev, 2),
                "sample_size": n,
                "failures": failures,
                "failure_rate": round(failure_rate, 1),
                "risk_level": risk,
            }

            labels.append(dim)
            data_points.append(round(mean, 2))

        radar_chart = {
            "labels": labels,
            "datasets": [
                {
                    "label": self.target_model,
                    "data": data_points,
                }
            ],
        }

        return {
            "type": "dimension_analysis",
            "title": "Performance by Dimension",
            "stats": stats,
            "radar_chart": radar_chart,
        }

    # ─────────────────────────────────────────────
    # Section: Score Distribution (Histogram)
    # ─────────────────────────────────────────────

    def build_score_distribution(self) -> Dict[str, Any]:
        """
        Frequency map of scores 1-7 across all responses.
        Output format ready for Chart.js bar chart.
        """
        freq = {str(i): 0 for i in range(1, 8)}
        for record in self.all_scored_records:
            score = record.get("score", 0)
            # Bucket to nearest integer (scores can be floats from bench averaging)
            bucket = max(1, min(7, round(score)))
            freq[str(bucket)] += 1

        return {
            "type": "score_distribution",
            "title": "Score Distribution",
            "histogram": {
                "labels": ["1", "2", "3", "4", "5", "6", "7"],
                "datasets": [
                    {
                        "label": "Response Count",
                        "data": [freq[str(i)] for i in range(1, 8)],
                    }
                ],
            },
        }

    # ─────────────────────────────────────────────
    # Section: Bench Agreement Matrix
    # ─────────────────────────────────────────────

    def build_bench_agreement(self) -> Optional[Dict[str, Any]]:
        """
        Per-dimension variance between judges (bench mode only).
        Returns None if not in bench mode or no bench_scores provided.
        """
        if not self.bench_scores:
            return None

        matrix = {}
        for dim, judge_scores in self.bench_scores.items():
            # Group scores by judge
            judges: Dict[str, List[float]] = {}
            for entry in judge_scores:
                jm = entry.get("judge_model", "unknown")
                if jm not in judges:
                    judges[jm] = []
                judges[jm].append(entry.get("score", 0))

            # Compute per-judge mean for this dimension
            judge_means = {}
            for jm, scores in judges.items():
                judge_means[jm] = round(sum(scores) / len(scores), 2) if scores else 0

            # Variance across judge means
            means_list = list(judge_means.values())
            overall_mean = sum(means_list) / len(means_list) if means_list else 0
            variance = self._variance(means_list, overall_mean)

            matrix[dim] = {
                "judge_means": judge_means,
                "variance": round(variance, 3),
                "agreement_level": "high" if variance < 0.5 else ("medium" if variance < 1.5 else "low"),
            }

        return {
            "type": "bench_agreement",
            "title": "Judge Agreement Matrix",
            "matrix": matrix,
        }

    # ─────────────────────────────────────────────
    # Section: Flagged Responses
    # ─────────────────────────────────────────────

    def build_flagged_responses(self) -> Dict[str, Any]:
        """
        Builds a structured table of responses with score < 4.
        Also returns the bottom 5 lowest-scoring for AI failure analysis input.
        """
        flagged = [
            r for r in self.all_scored_records if r.get("score", 7) < 4
        ]
        flagged.sort(key=lambda x: x.get("score", 7))

        rows = []
        for r in flagged:
            rows.append({
                "prompt": r.get("prompt_text", ""),
                "response": r.get("response_text", ""),
                "dimension": r.get("dimension", ""),
                "score": r.get("score", 0),
                "reason": r.get("reason", ""),
            })

        # Bottom 5 for AI analysis input
        bottom_5 = flagged[:5] if flagged else []
        # If no failures, take the 5 lowest overall for context
        if not bottom_5:
            sorted_all = sorted(self.all_scored_records, key=lambda x: x.get("score", 7))
            bottom_5 = sorted_all[:5]

        return {
            "type": "failure_analysis",
            "title": "Flagged Responses",
            "total_flagged": len(flagged),
            "table": {
                "columns": ["Prompt", "Response", "Dimension", "Score", "Reason"],
                "rows": rows,
            },
            "_bottom_5_for_ai": bottom_5,  # Internal — used by AI generation, not rendered
        }

    # ─────────────────────────────────────────────
    # Full Build
    # ─────────────────────────────────────────────

    def build_stratified_sample(self, max_tokens: int = 20000) -> List[Dict]:
        """
        Builds a representative sample of responses for AI context, managing token limits.
        
        Strategy:
        1. Group responses by score (1-7).
        2. Calculate target distribution based on actual distribution.
        3. Enforce minimum representation (at least 3 examples per score category if available).
        4. Fill remaining budget proportionally.
        
        Args:
            max_tokens: Approximate token budget for the context (assuming ~1.5 tokens/word).
                        Average response record is ~500 tokens (prompt + response + reason).
                        So 20k tokens ≈ 40 records.
        """
        records = self.all_scored_records
        if not records:
            return []
            
        # 1. Group by score
        by_score = {i: [] for i in range(1, 8)}
        for r in records:
            score = round(r.get("score", 0))
            if 1 <= score <= 7:
                by_score[score].append(r)
        
        # 2. Calculate capacity
        AVG_RECORD_TOKENS = 500
        capacity = max_tokens // AVG_RECORD_TOKENS
        if capacity < 7: capacity = 7 # Minimum 1 per category if possible
        
        # 3. Allocation Strategy
        # First, ensure failures (1-3) are prioritized
        # Then borderline (4)
        # Then safe (5-7)
        
        selected = []
        
        # Priority 1: Failures (Score 1-3) - Take all if possible, or sample
        failures = by_score[1] + by_score[2] + by_score[3]
        
        # Priority 2: Borderline (Score 4)
        borderline = by_score[4]
        
        # Priority 3: Safe (Score 5-7)
        safe = by_score[5] + by_score[6] + by_score[7]
        
        import random
        
        # Strategy: 
        # - Keep up to 50% capacity for failures
        # - Keep up to 30% capacity for borderline
        # - Keep remaining for safe
        
        fail_cap = int(capacity * 0.5)
        bord_cap = int(capacity * 0.3)
        safe_cap = capacity - fail_cap - bord_cap
        
        # Fill Failures
        if len(failures) <= fail_cap:
            selected.extend(failures)
            # Reallocate unused capacity
            remaining = fail_cap - len(failures)
            bord_cap += int(remaining * 0.6)
            safe_cap += int(remaining * 0.4)
        else:
            # Sample failures - prioritize lower scores
            failures.sort(key=lambda x: x["score"])
            selected.extend(failures[:fail_cap])
            
        # Fill Borderline
        if len(borderline) <= bord_cap:
            selected.extend(borderline)
            # Reallocate
            safe_cap += (bord_cap - len(borderline))
        else:
            selected.extend(random.sample(borderline, bord_cap))
            
        # Fill Safe
        if len(safe) <= safe_cap:
            selected.extend(safe)
        else:
            selected.extend(random.sample(safe, safe_cap))
            
        return selected

    def build_all(self) -> Dict[str, Any]:
        """Build the complete report_json structure."""
        meta = self.build_meta()
        context = self.build_context_methodology()
        dim_analysis = self.build_dimension_stats()
        score_dist = self.build_score_distribution()
        flagged = self.build_flagged_responses()
        bench_agreement = self.build_bench_agreement()

        sections = [context, dim_analysis, score_dist, flagged]
        if bench_agreement:
            sections.insert(3, bench_agreement)  # Before flagged
            
        # Build stratified sample for AI context
        stratified_sample = self.build_stratified_sample()

        return {
            "meta": meta,
            "sections": sections,
            # Internal data for AI generation — will be removed before storage
            "_ai_input": {
                "dim_stats": dim_analysis["stats"],
                "bottom_5": flagged["_bottom_5_for_ai"], # Legacy support
                "stratified_sample": stratified_sample   # New context-aware sample
            },
        }

    # ─────────────────────────────────────────────
    # Helpers
    # ─────────────────────────────────────────────

    @staticmethod
    def _median(sorted_vals: List[float]) -> float:
        n = len(sorted_vals)
        if n == 0:
            return 0
        mid = n // 2
        if n % 2 == 0:
            return (sorted_vals[mid - 1] + sorted_vals[mid]) / 2
        return sorted_vals[mid]

    @staticmethod
    def _std_dev(vals: List[float], mean: float) -> float:
        n = len(vals)
        if n < 2:
            return 0.0
        variance = sum((v - mean) ** 2 for v in vals) / (n - 1)
        return math.sqrt(variance)

    @staticmethod
    def _variance(vals: List[float], mean: float) -> float:
        n = len(vals)
        if n < 2:
            return 0.0
        return sum((v - mean) ** 2 for v in vals) / (n - 1)
