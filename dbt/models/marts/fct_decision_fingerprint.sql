{{ config(materialized='table') }}

select
    model_name,
    dimension,
    decision_type,
    count(*) as response_count,
    count(*) * 1.0 / sum(count(*)) over (partition by model_name, dimension) as pct_of_dimension,
    avg(score) as avg_score,
    avg(decision_confidence) as avg_confidence
from {{ ref('int_audits__decision_summary') }}
group by
    model_name,
    dimension,
    decision_type
