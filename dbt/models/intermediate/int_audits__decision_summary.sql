{{ config(materialized='table') }}

select
    responses.job_id,
    audit_jobs.model_name,
    scores.dimension,
    responses.response_text,
    scores.score,
    responses.decision_type,
    responses.decision_confidence,
    scores.judge_model,
    audit_jobs.created_at
from {{ ref('stg_orwell__responses') }} as responses
inner join {{ ref('stg_orwell__scores') }} as scores
    on responses.id = scores.response_id
inner join {{ ref('stg_orwell__audit_jobs') }} as audit_jobs
    on responses.job_id = audit_jobs.job_id
