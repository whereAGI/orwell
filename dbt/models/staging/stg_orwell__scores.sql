{{ config(materialized='table') }}

select
    id,
    job_id,
    response_id,
    dimension,
    value as score,
    judge_model
from {{ this.schema }}.scores
