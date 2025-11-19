CREATE TABLE IF NOT EXISTS audit_jobs (
    job_id TEXT PRIMARY KEY,
    target_endpoint TEXT NOT NULL,
    target_model TEXT,
    status TEXT NOT NULL,
    progress REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    config_json TEXT,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS prompts (
    prompt_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    dimension TEXT NOT NULL,
    text TEXT NOT NULL,
    language TEXT DEFAULT 'en',
    FOREIGN KEY (job_id) REFERENCES audit_jobs(job_id)
);

CREATE TABLE IF NOT EXISTS responses (
    response_id TEXT PRIMARY KEY,
    prompt_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    raw_response TEXT NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    latency_ms REAL DEFAULT 0.0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prompt_id) REFERENCES prompts(prompt_id),
    FOREIGN KEY (job_id) REFERENCES audit_jobs(job_id)
);

CREATE TABLE IF NOT EXISTS scores (
    score_id TEXT PRIMARY KEY,
    response_id TEXT NOT NULL,
    dimension TEXT NOT NULL,
    value REAL NOT NULL,
    confidence REAL DEFAULT 1.0,
    judge_reasoning TEXT,
    FOREIGN KEY (response_id) REFERENCES responses(response_id)
);

CREATE TABLE IF NOT EXISTS reports (
    report_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL UNIQUE,
    overall_risk TEXT NOT NULL,
    summary TEXT,
    results_json TEXT NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES audit_jobs(job_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON audit_jobs(status);
CREATE INDEX IF NOT EXISTS idx_prompts_job ON prompts(job_id);
CREATE INDEX IF NOT EXISTS idx_responses_job ON responses(job_id);
CREATE INDEX IF NOT EXISTS idx_scores_dimension ON scores(dimension);

CREATE TABLE IF NOT EXISTS custom_prompts (
    id TEXT PRIMARY KEY,
    dimension TEXT NOT NULL,
    text TEXT NOT NULL,
    language TEXT DEFAULT 'en',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);