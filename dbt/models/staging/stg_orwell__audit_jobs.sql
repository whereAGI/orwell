{{ config(materialized='table') }}

select
    id as job_id,
    target_model as model_name,
    status,
    created_at,
    schema_id
from {{ this.schema }}.audit_jobs
where status = 'completed'
