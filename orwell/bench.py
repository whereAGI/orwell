import random
import asyncio
import hashlib
import statistics
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

    def __init__(self, judges: List[JudgeClient], mode: str, log_callback=None, foreman_client: Optional[JudgeClient] = None):
        if not judges:
            raise ValueError("BenchExecutor requires at least one judge")
        if mode not in ("random", "all", "jury"):
            raise ValueError(f"Invalid bench mode: {mode}. Must be 'random', 'all', or 'jury'.")
        if mode == "jury" and not foreman_client:
            raise ValueError("Jury mode requires a foreman_client")
        
        self.judges = judges
        self.mode = mode
        self.log_callback = log_callback
        self.foreman_client = foreman_client
        
        # Cache successful judge scores for the current prompt to avoid redundant re-scoring during retries
        self._current_prompt_hash = None
        self._judge_cache: Dict[str, Dict] = {} # judge_model -> result_dict

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
        elif self.mode == "jury":
            return await self._score_jury(prompt_text, response_text, dimension)
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
        
        # Calculate prompt hash for caching
        content = f"{prompt_text}::{response_text}::{dimension}"
        current_hash = hashlib.sha256(content.encode('utf-8')).hexdigest()
        
        if self._current_prompt_hash != current_hash:
            # New prompt/response, clear cache
            self._current_prompt_hash = current_hash
            self._judge_cache = {}
        
        # Filter judges that haven't succeeded yet
        judges_to_run = []
        cached_results = []
        
        for j in self.judges:
            if j.model in self._judge_cache:
                # Already have a successful result
                cached_results.append(self._judge_cache[j.model])
            else:
                judges_to_run.append(j)
        
        if not judges_to_run:
            self._log("info", "[Bench/All] Using cached results for all judges")
            return cached_results
            
        self._log("info", f"[Bench/All] Scoring with {len(judges_to_run)} judges ({len(cached_results)} cached)")

        async def _score_one(judge: JudgeClient) -> Dict:
            MAX_RETRIES = 3
            for attempt in range(MAX_RETRIES):
                try:
                    score_val, reason = await judge.score(prompt_text, response_text, dimension)
                    self._log("success", f"[Bench/All] {judge.model} scored: {score_val}/7", {"reason": reason})
                    
                    result = {
                        "score": score_val,
                        "reason": reason,
                        "judge_model": judge.model,
                        "is_rescore": False,
                    }
                    # Cache success
                    self._judge_cache[judge.model] = result
                    return result
                    
                except Exception as e:
                    if attempt < MAX_RETRIES - 1:
                        self._log("warning", f"[Bench/All] {judge.model} failed (Attempt {attempt+1}/{MAX_RETRIES}). Retrying...", {"error": str(e)})
                        await asyncio.sleep(2)
                    else:
                        self._log("error", f"[Bench/All] {judge.model} failed after {MAX_RETRIES} attempts: {e}")
                        return {
                            "score": 0,
                            "reason": f"Error: {e}",
                            "judge_model": judge.model,
                            "is_rescore": False,
                        }

        new_results = await asyncio.gather(*[_score_one(j) for j in judges_to_run])
        
        # Combine cached and new results
        # NOTE: We must not modify cached_results directly or share references if we plan to mutate them later.
        # But here we just return them.
        
        all_results = list(cached_results) + list(new_results)
        return all_results

    async def _score_jury(
        self, prompt_text: str, response_text: str, dimension: str
    ) -> List[Dict]:
        """Jury mode: All judges score, then Foreman adjudicates."""
        # 1. Get all juror scores
        juror_results = await self._score_all(prompt_text, response_text, dimension)
        
        # Check for juror failures - Jury mode is strict
        failed_jurors = [r for r in juror_results if r["score"] == 0]
        if failed_jurors:
            error_details = "; ".join([f"{r['judge_model']}: {r['reason']}" for r in failed_jurors])
            raise RuntimeError(f"Jury audit failed. The following jurors encountered errors: {error_details}. Please check the models or try different ones.")

        # 2. Check for Consensus / Outliers
        scores = [r["score"] for r in juror_results]
        stdev = 0.0
        if len(scores) > 1:
            stdev = statistics.stdev(scores)
        
        is_high_disagreement = stdev > 1.5
        
        # 3. Foreman adjudicates
        self._log("info", f"[Bench/Jury] Foreman ({self.foreman_client.model}) adjudicating... (Stdev: {stdev:.2f})")
        try:
            score, reason = await self.foreman_client.adjudicate(
                prompt_text, response_text, dimension, juror_results, is_high_disagreement
            )
            self._log("success", f"[Bench/Jury] Foreman Verdict: {score}/7", {"reason": reason})
            
            foreman_result = {
                "score": score,
                "reason": reason,
                "judge_model": self.foreman_client.model,
                "is_rescore": False,
                "is_foreman": True,
                "consensus_stdev": stdev
            }
            # Return Foreman result + Juror results
            return [foreman_result] + juror_results
            
        except Exception as e:
            self._log("error", f"[Bench/Jury] Foreman failed: {e}")
            foreman_result = {
                "score": 0,
                "reason": f"Foreman Error: {e}",
                "judge_model": self.foreman_client.model,
                "is_rescore": False,
                "is_foreman": True
            }
            return [foreman_result] + juror_results

    # ───────────────────────────────────────────────
    # Summary / Report Generation
    # ───────────────────────────────────────────────

    def _get_report_author(self) -> JudgeClient:
        """Returns the judge responsible for writing reports (Foreman or Random)."""
        if self.mode == "jury" and self.foreman_client:
            return self.foreman_client
        judge, _ = self._pick_random()
        return judge

    async def generate_summary(
        self, report_dims: dict, overall_risk: str, low_score_records: List[Dict] = None
    ) -> str:
        """
        Generate the final analysis summary using the foreman (Jury mode) or a random judge.
        
        In All/Jury mode, the low_score_records should include per-judge critiques
        so the summarizing judge has comprehensive bias context.
        """
        judge = self._get_report_author()
        self._log("info", f"[Bench] Generating final report with: {judge.model}")
        return await judge.generate_summary(report_dims, overall_risk, low_score_records)

    async def generate_report_sections(
        self,
        dim_stats: Dict[str, Any],
        overall_risk: str,
        bottom_5: List[Dict],
        system_prompt_snapshot: Optional[str] = None,
        schema_name: Optional[str] = None,
        schema_context: Optional[str] = None,
        schema_low_label: Optional[str] = None,
        schema_high_label: Optional[str] = None,
        exec_prompt_override: Optional[str] = None,
        fail_prompt_override: Optional[str] = None,
        reco_prompt_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate multi-stage report sections using the foreman or random judge.
        Delegates to JudgeClient.generate_report_sections().
        """
        judge = self._get_report_author()
        self._log("info", f"[Bench] Generating report sections with: {judge.model}")
        return await judge.generate_report_sections(
            dim_stats, overall_risk, bottom_5, system_prompt_snapshot,
            schema_name, schema_context, schema_low_label, schema_high_label,
            exec_prompt_override, fail_prompt_override, reco_prompt_override
        )

    async def generate_section_explanations(
        self,
        sections: List[Dict[str, Any]],
        overall_risk: str,
        schema_name: Optional[str] = None,
        schema_context: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        Delegates explanation generation to the foreman or random judge.
        """
        judge = self._get_report_author()
        self._log("info", f"[Bench] Generating explanations with: {judge.model}")
        return await judge.generate_section_explanations(
            sections, overall_risk, schema_name, schema_context
        )

    # ───────────────────────────────────────────────
    # Utility
    # ───────────────────────────────────────────────

    @staticmethod
    def compute_mean_score(score_records: List[Dict]) -> float:
        """Compute the mean score. If a foreman score exists (Jury mode), use that instead of mean."""
        # Check for foreman score
        foreman_record = next((r for r in score_records if r.get("is_foreman")), None)
        if foreman_record and foreman_record["score"] > 0:
            return foreman_record["score"]

        valid = [r["score"] for r in score_records if r["score"] > 0]
        if not valid:
            return 0.0
        return sum(valid) / len(valid)
