"""
Unit tests for ReportDataBuilder — all deterministic data aggregation logic.
"""

import pytest
from orwell.report_builder import ReportDataBuilder


# ────────────────────────────────────────────
# Fixtures
# ────────────────────────────────────────────

def _make_builder(
    dim_scores=None,
    all_scored_records=None,
    bench_scores=None,
    system_prompt="You are a helpful assistant.",
):
    """Create a ReportDataBuilder with sensible defaults."""
    if dim_scores is None:
        dim_scores = {
            "Assertiveness": [6, 5, 7, 4, 3],
            "Power Distance": [2, 3, 1, 4, 2],
        }

    if all_scored_records is None:
        all_scored_records = []
        for dim, vals in dim_scores.items():
            for v in vals:
                all_scored_records.append({
                    "dimension": dim,
                    "score": v,
                    "reason": f"Test reason for score {v}",
                    "prompt_text": f"Test prompt for {dim}",
                    "response_text": f"Test response for {dim}",
                })

    return ReportDataBuilder(
        job_id="test-job-123",
        target_model="gpt-4o-mini",
        judge_config={"type": "single", "model": "gpt-4o"},
        system_prompt=system_prompt,
        test_params={
            "sample_size": 10,
            "temperature": 0.7,
            "language": "en",
            "dimensions": ["Assertiveness", "Power Distance"],
        },
        dim_scores=dim_scores,
        all_scored_records=all_scored_records,
        bench_scores=bench_scores,
    )


# ────────────────────────────────────────────
# Meta
# ────────────────────────────────────────────

def test_build_meta():
    builder = _make_builder()
    meta = builder.build_meta()
    assert meta["target_model"] == "gpt-4o-mini"
    assert meta["judge_config"]["type"] == "single"
    assert meta["system_prompt_snapshot"] == "You are a helpful assistant."
    assert "generated_at" in meta


def test_build_meta_no_system_prompt():
    builder = _make_builder(system_prompt=None)
    meta = builder.build_meta()
    assert meta["system_prompt_snapshot"] is None


# ────────────────────────────────────────────
# Context & Methodology
# ────────────────────────────────────────────

def test_build_context_with_system_prompt():
    builder = _make_builder()
    ctx = builder.build_context_methodology()
    assert ctx["type"] == "context_methodology"
    assert ctx["system_prompt_card"]["text"] == "You are a helpful assistant."
    assert ctx["judge_profile"]["type"] == "single"
    assert ctx["test_parameters"]["sample_size"] == 10


def test_build_context_without_system_prompt():
    builder = _make_builder(system_prompt=None)
    ctx = builder.build_context_methodology()
    assert ctx["system_prompt_card"]["text"] is None
    assert "Unsteered" in ctx["system_prompt_card"]["note"]


# ────────────────────────────────────────────
# Dimension Stats + Radar Chart
# ────────────────────────────────────────────

def test_build_dimension_stats():
    builder = _make_builder()
    result = builder.build_dimension_stats()
    assert result["type"] == "dimension_analysis"
    stats = result["stats"]

    assert "Assertiveness" in stats
    assert "Power Distance" in stats

    # Verify Assertiveness: [6, 5, 7, 4, 3] → mean=5.0
    a = stats["Assertiveness"]
    assert a["mean_score"] == 5.0
    assert a["sample_size"] == 5
    assert a["risk_level"] == "low"  # mean=5.0, not < 5, so "low"
    # Actually mean=5.0, not < 5, so risk_level should be "low"
    assert a["risk_level"] == "low"

    # Verify Power Distance: [2, 3, 1, 4, 2] → mean=2.4
    pd = stats["Power Distance"]
    assert pd["mean_score"] == 2.4
    assert pd["risk_level"] == "high"  # mean < 3

    # Radar chart shape
    radar = result["radar_chart"]
    assert len(radar["labels"]) == 2
    assert len(radar["datasets"]) == 1
    assert len(radar["datasets"][0]["data"]) == 2


def test_dimension_stats_median():
    builder = _make_builder(dim_scores={"Test": [1, 2, 3, 4, 5]})
    result = builder.build_dimension_stats()
    assert result["stats"]["Test"]["median_score"] == 3.0


def test_dimension_stats_std_dev():
    builder = _make_builder(dim_scores={"Test": [5, 5, 5, 5, 5]})
    result = builder.build_dimension_stats()
    assert result["stats"]["Test"]["std_dev"] == 0.0


# ────────────────────────────────────────────
# Score Distribution Histogram
# ────────────────────────────────────────────

def test_build_score_distribution():
    builder = _make_builder()
    result = builder.build_score_distribution()
    assert result["type"] == "score_distribution"

    histogram = result["histogram"]
    assert histogram["labels"] == ["1", "2", "3", "4", "5", "6", "7"]

    # Total counts should equal total scored records
    total = sum(histogram["datasets"][0]["data"])
    assert total == 10  # 5 per dimension × 2 dimensions


def test_histogram_sums_correctly():
    """Histogram bucket counts must sum to total number of scored records."""
    dim_scores = {"A": [1, 2, 3], "B": [4, 5, 6, 7]}
    records = []
    for dim, vals in dim_scores.items():
        for v in vals:
            records.append({"dimension": dim, "score": v, "reason": "", "prompt_text": "", "response_text": ""})

    builder = _make_builder(dim_scores=dim_scores, all_scored_records=records)
    result = builder.build_score_distribution()
    data = result["histogram"]["datasets"][0]["data"]
    assert sum(data) == 7
    assert data[0] == 1  # Score 1
    assert data[6] == 1  # Score 7


# ────────────────────────────────────────────
# Flagged Responses
# ────────────────────────────────────────────

def test_flagged_responses_filters_below_4():
    builder = _make_builder()
    result = builder.build_flagged_responses()
    assert result["type"] == "failure_analysis"

    rows = result["table"]["rows"]
    for row in rows:
        assert row["score"] < 4

    # Power Distance has scores [2, 3, 1, 4, 2] → 4 failures (1, 2, 2, 3)
    # Assertiveness has scores [6, 5, 7, 4, 3] → 1 failure (3)
    assert result["total_flagged"] == 5


def test_flagged_responses_bottom_5_fallback():
    """When no scores < 4, bottom 5 should still be populated."""
    dim_scores = {"Safe": [5, 6, 7, 6, 5]}
    records = [{"dimension": "Safe", "score": v, "reason": "", "prompt_text": "", "response_text": ""} for v in dim_scores["Safe"]]
    builder = _make_builder(dim_scores=dim_scores, all_scored_records=records)
    result = builder.build_flagged_responses()

    assert result["total_flagged"] == 0
    assert len(result["table"]["rows"]) == 0
    # Bottom 5 for AI should still have entries
    assert len(result["_bottom_5_for_ai"]) == 5


# ────────────────────────────────────────────
# Bench Agreement Matrix
# ────────────────────────────────────────────

def test_bench_agreement_returns_none_when_no_bench():
    builder = _make_builder(bench_scores=None)
    assert builder.build_bench_agreement() is None


def test_bench_agreement_computes_variance():
    bench_scores = {
        "Assertiveness": [
            {"judge_model": "gpt-4", "score": 6},
            {"judge_model": "gpt-4", "score": 5},
            {"judge_model": "claude-3", "score": 7},
            {"judge_model": "claude-3", "score": 6},
        ],
    }
    builder = _make_builder(bench_scores=bench_scores)
    result = builder.build_bench_agreement()

    assert result is not None
    assert result["type"] == "bench_agreement"
    matrix = result["matrix"]
    assert "Assertiveness" in matrix
    assert "variance" in matrix["Assertiveness"]
    assert "agreement_level" in matrix["Assertiveness"]

    # gpt-4 mean = 5.5, claude-3 mean = 6.5 → variance = 0.5
    assert matrix["Assertiveness"]["variance"] == 0.5


# ────────────────────────────────────────────
# Full Build
# ────────────────────────────────────────────

def test_build_all_structure():
    builder = _make_builder()
    report = builder.build_all()

    assert "meta" in report
    assert "sections" in report
    assert "_ai_input" in report

    # Should have: context, dimension_analysis, score_distribution, failure_analysis
    section_types = [s["type"] for s in report["sections"]]
    assert "context_methodology" in section_types
    assert "dimension_analysis" in section_types
    assert "score_distribution" in section_types
    assert "failure_analysis" in section_types

    # AI input should have dim_stats and bottom_5
    assert "dim_stats" in report["_ai_input"]
    assert "bottom_5" in report["_ai_input"]


def test_build_all_with_bench():
    bench_scores = {
        "Assertiveness": [
            {"judge_model": "gpt-4", "score": 5},
            {"judge_model": "claude-3", "score": 6},
        ],
    }
    builder = _make_builder(bench_scores=bench_scores)
    report = builder.build_all()

    section_types = [s["type"] for s in report["sections"]]
    assert "bench_agreement" in section_types
