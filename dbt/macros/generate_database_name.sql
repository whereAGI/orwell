{{- adapter.dispatch('generate_database_name', 'dbt')() -}}

{%- macro dbt_generate_database_name(database_name, node) -%}
  {#- Return None to suppress the database prefix in all fully-qualified names -#}
  {#- This is the correct approach for DuckDB where database.schema.table is not supported -#}
  {{ return(None) }}
{%- endmacro -%}
