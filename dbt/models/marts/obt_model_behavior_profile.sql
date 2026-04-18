{{ config(materialized='table') }}

with decision_rates as (
    select
        model_name,
        decision_type,
        avg(pct_of_dimension) as avg_pct_of_dimension
    from {{ ref('fct_decision_fingerprint') }}
    group by
        model_name,
        decision_type
),

pivoted_rates as (
    select
        model_name,
        avg(case when upper(decision_type) = 'ASSERT' then avg_pct_of_dimension end) as assert_rate,
        avg(case when upper(decision_type) = 'HEDGE' then avg_pct_of_dimension end) as hedge_rate,
        avg(case when upper(decision_type) = 'BALANCE' then avg_pct_of_dimension end) as balance_rate,
        avg(case when upper(decision_type) = 'PIVOT' then avg_pct_of_dimension end) as pivot_rate,
        avg(case when upper(decision_type) = 'QUALIFY' then avg_pct_of_dimension end) as qualify_rate,
        avg(case when upper(decision_type) = 'REFUSE' then avg_pct_of_dimension end) as refuse_rate
    from decision_rates
    group by model_name
),

dominant_decisions as (
    select
        model_name,
        decision_type as dominant_decision
    from (
        select
            model_name,
            decision_type,
            avg_pct_of_dimension,
            row_number() over (
                partition by model_name
                order by avg_pct_of_dimension desc, decision_type
            ) as decision_rank
        from decision_rates
    ) ranked_decisions
    where decision_rank = 1
),

model_scores as (
    select
        model_name,
        avg(avg_score) as overall_avg_score
    from {{ ref('fct_decision_fingerprint') }}
    group by model_name
),

audit_stats as (
    select
        model_name,
        count(distinct dimension) as total_audits,
        max(created_at) as last_audit_at
    from {{ ref('int_audits__decision_summary') }}
    group by model_name
)

select
    pivoted_rates.model_name,
    pivoted_rates.assert_rate,
    pivoted_rates.hedge_rate,
    pivoted_rates.balance_rate,
    pivoted_rates.pivot_rate,
    pivoted_rates.qualify_rate,
    pivoted_rates.refuse_rate,
    dominant_decisions.dominant_decision,
    model_scores.overall_avg_score,
    audit_stats.total_audits,
    audit_stats.last_audit_at
from pivoted_rates
inner join dominant_decisions
    on pivoted_rates.model_name = dominant_decisions.model_name
inner join model_scores
    on pivoted_rates.model_name = model_scores.model_name
inner join audit_stats
    on pivoted_rates.model_name = audit_stats.model_name
