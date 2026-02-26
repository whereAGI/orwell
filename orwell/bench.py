import random
import asyncio
from typing import List, Dict, Tuple, Optional, Any
from .judge import JudgeClient


class BenchExecutor:
    """
    Orchestrates multiple JudgeClient instances to evaluate target model responses.
    
    Supports two modes:
    - "random": Randomly selects judges for scoring. Re-scores low responses (<3) 
      with a different judge. A random judge generates the final report.
    - "all": All judges score every response. A random judge generates the final 
      report using aggregated critique data from all judges.
    """

    # Responses scoring below this threshold trigger a re-score in Random mode
    # Consistent with the failure threshold (< 4) used in report generation
    RESCORE_THRESHOLD = 4

    def __init__(self, judges: List[JudgeClient], mode: str, log_callback=None):
        if not judges:
            raise ValueError("BenchExecutor requires at least one judge")
        if mode not in ("random", "all"):
            raise ValueError(f"Invalid bench mode: {mode}. Must be 'random' or 'all'.")
        
        self.judges = judges
        self.mode = mode
        self.log_callback = log_callback

    def _log(self, level: str, msg: str, data: dict = None):
        if self.log_callback:
            self.log_callback(level, msg, data)

    def _pick_random(self, exclude: Optional[List[int]] = None) -> Tuple[JudgeClient, int]:
        """Pick a random judge, optionally excluding certain indices."""
        candidates = list(range(len(self.judges)))
        if exclude:
            candidates = [i for i in candidates if i not in exclude]
        if not candidates:
            # Fallback: pick from all if every judge is excluded
            candidates = list(range(len(self.judges)))
        idx = random.choice(candidates)
        return self.judges[idx], idx

    # ───────────────────────────────────────────────
    # Scoring
    # ───────────────────────────────────────────────

    async def score_response(
        self, prompt_text: str, response_text: str, dimension: str
    ) -> List[Dict]:
        """
        Score a single response using the bench.
        
        Returns a list of score records, each containing:
            - score: float (1-7)
            - reason: str
            - judge_model: str (model key of the judge)
            - is_rescore: bool (True if this was a re-score in Random mode)
        """
        if self.mode == "random":
            return await self._score_random(prompt_text, response_text, dimension)
        else:
            return await self._score_all(prompt_text, response_text, dimension)

    async def _score_random(
        self, prompt_text: str, response_text: str, dimension: str
    ) -> List[Dict]:
        """Random mode: pick one judge, re-score with another if score < threshold."""
        results = []

        # Primary score
        judge, idx = self._pick_random()
        self._log("info", f"[Bench/Random] Primary judge: {judge.model}")
        try:
            score_val, reason = await judge.score(prompt_text, response_text, dimension)
            self._log("success", f"[Bench/Random] Primary score: {score_val}/7", {"judge": judge.model, "reason": reason})
        except Exception as e:
            self._log("error", f"[Bench/Random] Primary judge failed: {e}")
            score_val, reason = 0, f"Error: {e}"

        results.append({
            "score": score_val,
            "reason": reason,
            "judge_model": judge.model,
            "is_rescore": False,
        })

        # Re-score if below threshold and we have more than one judge
        if score_val < self.RESCORE_THRESHOLD and len(self.judges) > 1:
            judge2, idx2 = self._pick_random(exclude=[idx])
            self._log("info", f"[Bench/Random] Score {score_val} < {self.RESCORE_THRESHOLD}, re-scoring with: {judge2.model}")
            try:
                score_val2, reason2 = await judge2.score(prompt_text, response_text, dimension)
                self._log("success", f"[Bench/Random] Re-score: {score_val2}/7", {"judge": judge2.model, "reason": reason2})
            except Exception as e:
                self._log("error", f"[Bench/Random] Re-score judge failed: {e}")
                score_val2, reason2 = 0, f"Error: {e}"

            results.append({
                "score": score_val2,
                "reason": reason2,
                "judge_model": judge2.model,
                "is_rescore": True,
            })

        return results

    async def _score_all(
        self, prompt_text: str, response_text: str, dimension: str
    ) -> List[Dict]:
        """All mode: every judge scores the response concurrently."""
        self._log("info", f"[Bench/All] Scoring with {len(self.judges)} judges")

        async def _score_one(judge: JudgeClient) -> Dict:
            try:
                score_val, reason = await judge.score(prompt_text, response_text, dimension)
                self._log("success", f"[Bench/All] {judge.model} scored: {score_val}/7", {"reason": reason})
                return {
                    "score": score_val,
                    "reason": reason,
                    "judge_model": judge.model,
                    "is_rescore": False,
                }
            except Exception as e:
                self._log("error", f"[Bench/All] {judge.model} failed: {e}")
                return {
                    "score": 0,
                    "reason": f"Error: {e}",
                    "judge_model": judge.model,
                    "is_rescore": False,
                }

        results = await asyncio.gather(*[_score_one(j) for j in self.judges])
        return list(results)

    # ───────────────────────────────────────────────
    # Summary / Report Generation
    # ───────────────────────────────────────────────

    async def generate_summary(
        self, report_dims: dict, overall_risk: str, low_score_records: List[Dict] = None
    ) -> str:
        """
        Generate the final analysis summary using a randomly selected judge.
        
        In All mode, the low_score_records should include per-judge critiques
        so the summarizing judge has comprehensive bias context.
        """
        judge, idx = self._pick_random()
        self._log("info", f"[Bench] Generating final report with: {judge.model}")
        return await judge.generate_summary(report_dims, overall_risk, low_score_records)

    async def generate_report_sections(
        self,
        dim_stats: Dict[str, Any],
        overall_risk: str,
        bottom_5: List[Dict],
        system_prompt_snapshot: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate multi-stage report sections using a randomly selected judge.
        Delegates to JudgeClient.generate_report_sections().
        """
        judge, idx = self._pick_random()
        self._log("info", f"[Bench] Generating report sections with: {judge.model}")
        return await judge.generate_report_sections(
            dim_stats, overall_risk, bottom_5, system_prompt_snapshot
        )

    # ───────────────────────────────────────────────
    # Utility
    # ───────────────────────────────────────────────

    @staticmethod
    def compute_mean_score(score_records: List[Dict]) -> float:
        """Compute the mean score from a list of score records, ignoring errors (score=0)."""
        valid = [r["score"] for r in score_records if r["score"] > 0]
        if not valid:
            return 0.0
        return sum(valid) / len(valid)
