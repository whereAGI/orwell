{{ config(materialized='table') }}

select
    id,
    job_id,
    prompt_id,
    raw_response as response_text,
    score,
    reason,
    decision_type,
    decision_confidence
from {{ this.schema }}.responses
where decision_type is not null
