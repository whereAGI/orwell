let currentJobId = null;
let pollInterval = null;
let selectedDimensions = [];
let systemPromptsMap = {};
let currentMarkdownPreviewContent = '';
let currentMarkdownPreviewMode = 'rendered';

function formatDuration(seconds) {
  if (typeof seconds === 'undefined' || seconds === null) return '0s';
  const totalSeconds = Math.floor(Number(seconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  
  return parts.length > 0 ? parts.join(' ') : '0s';
}

document.getElementById('startBtn').addEventListener('click', async (e) => {
  const startBtn = e.currentTarget;
  if (startBtn.textContent === 'Stop Audit') {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }
    if (logEventSource) {
        logEventSource.close();
        logEventSource = null;
    }
    if (currentJobId) {
      try {
        const res = await fetch(`/api/audit/${currentJobId}/abort`, { method: 'POST' });
        if (!res.ok) throw new Error(await res.text());
      } catch (err) {
        console.error('Abort failed:', err);
      }
    }
    document.getElementById('status').style.display = 'block';
    document.getElementById('report').style.display = 'none';
    document.getElementById('live-feed').style.display = 'none';
    document.getElementById('qaAccordion').innerHTML = '';
    startBtn.textContent = 'Start Audit';
    startBtn.style.background = 'var(--primary)';
    startBtn.style.borderColor = 'var(--primary)';
    document.getElementById('statusText').textContent = 'aborted';
    document.getElementById('statusMessage').textContent = 'Aborted by user';
    await loadReport();
    return;
  }
  const endpoint = document.getElementById('endpoint').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelName = document.getElementById('modelName').value.trim();

  const targetModelId = document.getElementById('targetModelSelect').value;

  // Determine judge source: single judge or bench (mutually exclusive)
  const judgeSource = document.querySelector('input[name="judgeSource"]:checked').value;
  let judgeModelId = null;
  let benchId = null;

  if (judgeSource === 'bench') {
    benchId = document.getElementById('benchSelect').value;
    if (!benchId) {
      alert('Please select a Bench');
      return;
    }
  } else {
    judgeModelId = document.getElementById('judgeModelSelect').value;
    if (!judgeModelId) {
      alert('Please select a Judge Model');
      return;
    }
  }

  const sysPromptName = document.getElementById('systemPromptInput').value.trim();
  const sysPrompt = systemPromptsMap[sysPromptName] || (sysPromptName ? sysPromptName : null);

  const request = {
    target_model_id: (targetModelId && targetModelId !== 'custom') ? targetModelId : null,
    judge_model_id: judgeModelId,
    bench_id: benchId,

    // Only send these if custom is selected or needed as fallback
    target_endpoint: (targetModelId === 'custom') ? (endpoint || null) : null,
    api_key: (targetModelId === 'custom') ? (apiKey || "") : "",
    model_name: (targetModelId === 'custom') ? (modelName || null) : null,

    sample_size: parseInt(document.getElementById('sampleSize').value),
    language: document.getElementById('language').value,
    judge_model: null,
    dimensions: selectedDimensions.length ? selectedDimensions : null,
    system_prompt: sysPrompt
  };
  try {
    const response = await fetch('/api/audit/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const result = await response.json();
    currentJobId = result.job_id;
    startBtn.textContent = 'Stop Audit';
    startBtn.style.background = 'var(--danger)';
    startBtn.style.borderColor = 'var(--danger)';
    document.getElementById('status').style.display = 'block';
    document.getElementById('report').style.display = 'none';
    document.getElementById('qaAccordion').innerHTML = '';
    
    // Reset terminal for new job
    const termContent = document.getElementById('terminalContent');
    if (termContent) termContent.innerHTML = '';
    
    // Connect Live Stream
    connectStream(currentJobId);
    
    pollStatus();
    pollInterval = setInterval(pollStatus, 5000);
  } catch (err) {
    alert('Error creating audit: ' + err);
    if (startBtn) {
      startBtn.textContent = 'Start Audit';
      startBtn.style.background = 'var(--primary)';
      startBtn.style.borderColor = 'var(--primary)';
      startBtn.disabled = false;
    }
  }
});

let currentEventSource = null;

function connectStream(jobId) {
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  if (logEventSource) {
    logEventSource.close();
    logEventSource = null;
  }

  const liveFeedContainer = document.getElementById('live-feed');
  const liveFeedContent = document.getElementById('live-feed-content');
  const reportContainer = document.getElementById('report');
  const statusContainer = document.getElementById('status');
  // const badge = document.getElementById('live-status-badge'); // Removed
  const termBar = document.getElementById('terminalProgressBar');
  const termPct = document.getElementById('terminalPercentage');
  const termStatus = document.getElementById('logStatus');
  const qaContainer = document.getElementById('qaAccordion');

  // Reset UI
  // liveFeedContainer.style.display = 'block'; // Removed
  reportContainer.style.display = 'none';
  statusContainer.style.display = 'none'; 
  qaContainer.innerHTML = ''; // Clear previous items
  
  // Show percentage in terminal bar
  termPct.style.display = 'block';
  termPct.textContent = '0%';
  termBar.style.width = '0%';

  const es = new EventSource(`/api/audit/${jobId}/stream`);
  currentEventSource = es;

  // badge.textContent = 'LIVE';
  // badge.style.color = 'var(--success)';
  // badge.style.borderColor = 'var(--success)';

  es.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data);
      
      if (typeof renderLogs === 'function') {
        renderLogs([log]);
      }

      // Handle Structured Events
      if (log.type === 'prompt_start') {
        // Create QA Item (Expanded)
        const d = log.details || {};
        const pid = d.prompt_id;
        
        if (!document.getElementById(`qa-item-${pid}`)) {
            const div = document.createElement('div');
            div.id = `qa-item-${pid}`;
            div.className = 'qa-item';
            div.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="toggleAcc('${pid}')">
                <div><strong>${d.dimension}</strong> • <span class="mono" style="color:#a0a0b8">${pid.slice(0, 8)}</span></div>
                <div class="pill" id="score-pill-${pid}">Running...</div>
              </div>
              <div id="acc-${pid}" style="display:block;margin-top:10px;">
                <div><span class="label">Prompt</span><div style="margin-top:6px">${escapeHtml(d.text)}</div></div>
                <div style="margin-top:10px">
                    <span class="label">Response</span>
                    <div id="resp-${pid}" style="margin-top:6px;white-space:pre-wrap;line-height:1.5;color:#e5e7eb;"></div>
                </div>
                <div id="reason-wrap-${pid}" style="display:none;margin-top:10px">
                    <span class="label">Judge Reason</span>
                    <div id="reason-${pid}" class="reason" style="margin-top:6px; white-space:pre-wrap;"></div>
                </div>
              </div>
            `;
            qaContainer.appendChild(div);
            div.scrollIntoView({ behavior: 'smooth', block: 'end' });
            
            // Update Progress
            const pct = Math.round(((d.index) / d.total) * 100);
            termBar.style.width = `${pct}%`;
            termPct.textContent = `${pct}%`;
            termStatus.textContent = `Auditing: ${d.dimension} (Prompt ${d.index + 1}/${d.total})`;
        }
      } else if (log.type === 'target_stream') {
        const pid = log.details && log.details.prompt_id;
        if (pid) {
            const el = document.getElementById(`resp-${pid}`);
            if (el) {
                // If the log entry ID is the same as the last one we processed, it means content was appended
                // So we should replace the content to avoid duplication (since log.content has the FULL accumulated text for that entry)
                // Wait, log_store.py appends content to the same entry.
                // So log.content grows: "T", "Th", "The"...
                // BUT EventSource receives the *updated* entry object each time.
                // So if we just append, we get "TThThe..."
                
                // We need to track the last handled log ID for this prompt
                // Or simpler: The backend sends the WHOLE content of that log entry each time it updates.
                // So we should replace the content of that specific log chunk.
                
                // However, we might have multiple log entries for one prompt if it gets interrupted or switches types.
                // A robust way is:
                // 1. Assign a unique ID to the span/div for this log entry
                // 2. If it exists, update it. If not, create it.
                
                const logId = `log-${log.id}`;
                let logSpan = document.getElementById(logId);
                if (!logSpan) {
                    logSpan = document.createElement('span');
                    logSpan.id = logId;
                    el.appendChild(logSpan);
                }
                logSpan.textContent = log.content;
            }
        }
      } else if (log.type === 'judge_stream') {
        const pid = log.details && log.details.prompt_id;
        if (pid) {
            const reasonWrap = document.getElementById(`reason-wrap-${pid}`);
            const reasonEl = document.getElementById(`reason-${pid}`);
            
            if (reasonWrap && reasonEl) {
                reasonWrap.style.display = 'block';
                
                const logId = `log-${log.id}`;
                let logSpan = document.getElementById(logId);
                if (!logSpan) {
                    logSpan = document.createElement('span');
                    logSpan.id = logId;
                    reasonEl.appendChild(logSpan);
                }
                logSpan.textContent = log.content;
            }
        }
      } else if (log.type === 'score_result') {
        const d = log.details || {};
        const pid = d.prompt_id;
        if (pid) {
            const scorePill = document.getElementById(`score-pill-${pid}`);
            const reasonWrap = document.getElementById(`reason-wrap-${pid}`);
            const reasonEl = document.getElementById(`reason-${pid}`);
            
            if (scorePill) {
                scorePill.textContent = `Score ${d.score.toFixed(1)}/7`;
                // Color code the pill?
                const score = d.score;
                if (score <= 3) scorePill.style.borderColor = 'var(--danger)';
                else if (score <= 5) scorePill.style.borderColor = 'var(--warning)';
                else scorePill.style.borderColor = 'var(--success)';
            }
            if (reasonWrap && reasonEl) {
                // Construct structured output for single judge or bench
                let content = '';
                
                // If it's a bench, the reason string is already pre-formatted with HTML in engine.py
                // If it's a single judge, we format it here
                if (d.judge_count) {
                    // Bench mode: reason already has HTML structure
                    content = d.reason;
                } else {
                    // Single judge mode
                    const judgeName = d.judge_model || 'Unknown Judge';
                    const cleanReason = (d.reason || '').replace(/^(?:\\n|\n)?Reason:\s*/i, '');
                    content = `
                        <div style="margin-bottom:8px;font-family:monospace;font-size:12px;color:var(--muted);">
                            <strong>JUDGE:</strong> ${escapeHtml(judgeName)}<br>
                            <strong>SCORE:</strong> ${d.score.toFixed(1)}/7
                        </div>
                        <strong>REASON:</strong><br>
                        ${renderMarkdown(cleanReason)}
                    `;
                }
                
                reasonEl.innerHTML = content;
                reasonWrap.style.display = 'block';

                // Also re-render the target model response with markdown now that it's complete
                const respEl = document.getElementById(`resp-${pid}`);
                if (respEl) {
                    respEl.innerHTML = renderMarkdown(respEl.textContent);
                    respEl.style.whiteSpace = 'normal'; // Allow markdown to wrap naturally
                }
            }
        }
      } else if (log.type === 'success' && log.content.includes('Audit completed')) {
         termBar.style.width = '100%';
         termPct.textContent = '100%';
         termStatus.textContent = 'Audit Completed';
         // badge.textContent = 'DONE';
         es.close();
         currentEventSource = null;
         
         // Collapse all sections
         const openSections = document.querySelectorAll('[id^="acc-"]');
         openSections.forEach(el => el.style.display = 'none');
         
         // Trigger final report load (charts etc)
         setTimeout(() => {
             loadReport(); 
         }, 500);
      }

    } catch (e) {
      console.error('Stream error:', e);
    }
  };

  es.onerror = (err) => {
    console.error('EventSource failed:', err);
    if (es.readyState === 2) {
        // badge.textContent = 'DISCONNECTED';
        // badge.style.color = 'var(--danger)';
    }
  };
}

async function pollStatus() {
  if (!currentJobId) return;

  // Poll logs concurrently
  // pollLogs(); // Deprecated in favor of EventSource stream

  try {
    await loadAuditList();
    const response = await fetch(`/api/audit/${currentJobId}`);
    const status = await response.json();
    const detailsRes = await fetch(`/api/audit/${currentJobId}/details`);
    const details = detailsRes.ok ? await detailsRes.json() : null;
    document.getElementById('statusText').textContent = status.status;
    const progress = Math.round((status.progress || 0) * 100);
    const fill = document.getElementById('progressFill');
    fill.style.width = progress + '%';
    fill.textContent = progress + '%';
    
    // Sync terminal loader
    const termBar = document.getElementById('terminalProgressBar');
    const termPct = document.getElementById('terminalPercentage');
    if (termBar) termBar.style.width = progress + '%';
    if (termPct) termPct.textContent = progress + '%';
    document.getElementById('statusMessage').textContent = status.message || '';
    if (status.status === 'completed') {
      clearInterval(pollInterval);
      const startBtn = document.getElementById('startBtn');
      if (startBtn) {
        startBtn.textContent = 'Start Audit';
        startBtn.style.background = 'var(--primary)';
        startBtn.style.borderColor = 'var(--primary)';
      }
      await loadPromptsAndResponses();
      await loadCriteria();
      await loadReport();
      await loadLogsForReport();
      document.getElementById('live-feed').style.display = 'none';
      if (details && details.error_message) {
        document.getElementById('statusMessage').textContent = details.error_message;
      }
    } else if (status.status === 'failed') {
      clearInterval(pollInterval);
      const startBtn = document.getElementById('startBtn');
      if (startBtn) {
        startBtn.textContent = 'Start Audit';
        startBtn.style.background = 'var(--primary)';
        startBtn.style.borderColor = 'var(--primary)';
      }
      document.getElementById('statusText').textContent = 'failed';
      document.getElementById('statusText').style.color = 'var(--danger)';
      document.getElementById('statusMessage').textContent = status.message || 'Audit failed';
      document.getElementById('statusMessage').style.color = 'var(--danger)';
      // alert('Audit failed: ' + status.message);
    } else if (status.status === 'aborted') {
      clearInterval(pollInterval);
      const startBtn = document.getElementById('startBtn');
      if (startBtn) {
        startBtn.textContent = 'Start Audit';
        startBtn.style.background = 'var(--primary)';
        startBtn.style.borderColor = 'var(--primary)';
      }
      document.getElementById('statusText').textContent = 'aborted';
      document.getElementById('statusMessage').textContent = status.message || 'Aborted by user';
    }
  } catch (err) {
    console.error('Error polling status:', err);
  }
}

async function loadReport() {
  try {
    const response = await fetch(`/api/audit/${currentJobId}/report`);
    if (!response.ok) {
      console.warn(`Report not available yet (${response.status})`);
      return;
    }
    const report = await response.json();
    currentReportData = report;

    // Destroy any existing chart instances
    if (window._orwellCharts) {
      window._orwellCharts.forEach(c => { try { c.destroy(); } catch (e) { } });
    }
    window._orwellCharts = [];

    // ─── If structured report_json exists, render multi-section ───
    if (report.report_json && report.report_json.sections) {
      const rj = report.report_json;
      let html = '';

      // Report header with risk banner
      html += `<div style="padding:15px;background:${getRiskColor(report.overall_risk)};color:white;border-radius:8px;margin-bottom:16px;">` +
        `<h4 style="margin:0;">Overall Risk: ${report.overall_risk.toUpperCase()}</h4>` +
        `<p style="margin:5px 0 0 0;">${report.total_prompts} prompts in ${formatDuration(report.execution_time_seconds)}</p>` +
        `</div>`;

      // Show bench/judge info
      let judgeLabel = report.judge_model || '-';
      let judgeSource = rj.meta && rj.meta.judge_config && rj.meta.judge_config.source_url;
      
      if (report.bench_name) {
        judgeLabel = `⚖ Bench: ${report.bench_name} (${report.bench_mode} mode)`;
      } else if (judgeSource) {
        judgeLabel = `<a href="${judgeSource}" target="_blank" style="color:#a0a0b8;text-decoration:underline;">${judgeLabel}</a>`;
      }

      let targetLabel = report.target_model || '-';
      let targetSource = rj.meta && rj.meta.target_model_source;
      if (targetSource) {
        targetLabel = `<a href="${targetSource}" target="_blank" style="color:#a0a0b8;text-decoration:underline;">${targetLabel}</a>`;
      }

      html += `<div class="mono" style="color:#a0a0b8;margin-bottom:16px;">Target Model: ${targetLabel} • Judge: ${judgeLabel}</div>`;

      // Render each section
      for (const section of rj.sections) {
        html += renderReportSection(section);
      }

      document.getElementById('reportContent').innerHTML = html;
      document.getElementById('report').style.display = 'block';

      // Initialize charts after DOM is ready
      setTimeout(() => initReportCharts(rj.sections), 100);
      return;
    }

    // ─── Legacy fallback (no report_json) ───
    let html = `<div style="padding:15px;background:${getRiskColor(report.overall_risk)};color:white;border-radius:4px;margin-bottom:12px;">` +
      `<h4 style="margin:0;">Overall Risk: ${report.overall_risk.toUpperCase()}</h4>` +
      `<p style="margin:5px 0 0 0;">${report.total_prompts} prompts in ${formatDuration(report.execution_time_seconds)}</p>` +
      `</div>`;
    let judgeLabel = report.judge_model || '-';
    if (report.bench_name) {
      judgeLabel = `⚖ Bench: ${report.bench_name} (${report.bench_mode} mode)`;
    }
    html += `<div class="mono" style="color:#a0a0b8;margin-bottom:12px;">Target Model: ${report.target_model || '-'} • Judge: ${judgeLabel} • Endpoint: ${report.target_endpoint || '-'}</div>`;
    html += `<h4>Dimension Scores</h4>`;
    for (const [dim, score] of Object.entries(report.dimensions || {})) {
      html += `<div class="dimension"><strong>${score.dimension}</strong><br>` +
        `Mean Score: ${score.mean_score}/7 (n=${score.sample_size}, risk: ${score.risk_level})</div>`;
    }
    html += `<p style="color:var(--muted);font-style:italic;margin-top:16px;">This is a legacy report without structured sections.</p>`;
    document.getElementById('reportContent').innerHTML = html;
    document.getElementById('report').style.display = 'block';
  } catch (err) {
    console.error('Error loading report:', err);
  }
}

// Global variable to store chart data for modal
let currentRadarData = null;

window.openRadarModal = function() {
  const modal = document.getElementById('radarModal');
  if (!modal || !currentRadarData) return;
  
  modal.style.display = 'flex';
  
  // Initialize modal chart if not already done
  const canvas = document.getElementById('radarChartModal');
  if (canvas) {
    // Destroy existing modal chart if any
    if (window._radarModalChart) {
      window._radarModalChart.destroy();
    }
    
    // Create new chart with same data but larger font
    window._radarModalChart = new Chart(canvas, {
      type: 'radar',
      data: currentRadarData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0,
            max: 7,
            ticks: { stepSize: 1, color: '#666', backdropColor: 'transparent', font: { size: 16 } },
            grid: { color: '#2e2e48' },
            angleLines: { color: '#2e2e48' },
            pointLabels: { color: '#a0a0b8', font: { size: 16, weight: 'bold' } }
          }
        },
        plugins: {
          legend: { labels: { color: '#a0a0b8', font: { size: 16 } } }
        }
      }
    });
  }
};

window.closeRadarModal = function() {
  document.getElementById('radarModal').style.display = 'none';
};

// ─── Section Renderers ───

function extractThinkingProcess(text) {
  if (!text) return { thinking: null, content: '' };
  
  // 1. Try new robust format with explicit delimiter
  const robustMatch = text.match(/^Thinking Process:\n([\s\S]*?)\n===END_THINKING===\n\n/);
  if (robustMatch) {
    return {
      thinking: robustMatch[1],
      content: text.replace(robustMatch[0], '')
    };
  }

  // 2. Fallback: Pattern: Thinking Process:\n...content...\n\nActual Content
  // Note: This is imperfect for multi-paragraph thinking, but kept for backward compatibility
  const match = text.match(/^Thinking Process:\n([\s\S]*?)\n\n/);
  if (match) {
    return {
      thinking: match[1],
      content: text.replace(match[0], '')
    };
  }
  return { thinking: null, content: text };
}

function renderCollapsibleThinking(thinking) {
  if (!thinking) return '';
  return `
    <details style="margin-bottom:12px;background:rgba(30, 30, 40, 0.5);border:1px solid var(--border);border-radius:6px;overflow:hidden;">
      <summary style="padding:8px 12px;cursor:pointer;font-size:11px;font-weight:600;color:var(--muted);user-select:none;outline:none;background:rgba(0,0,0,0.2);">
        SHOW THINKING PROCESS
      </summary>
      <div style="padding:12px;border-top:1px solid var(--border);font-family:monospace;font-size:12px;color:#a0a0b8;white-space:pre-wrap;line-height:1.5;max-height:400px;overflow-y:auto;">${escapeHtml(thinking)}</div>
    </details>
  `;
}

function renderReportSection(section) {
  const type = section.type;
  let html = '';

  switch (type) {
    case 'executive_summary':
      html += renderExecutiveSummary(section);
      break;
    case 'context_methodology':
      html += renderContextMethodology(section);
      break;
    case 'dimension_analysis':
      html += renderDimensionAnalysis(section);
      break;
    case 'score_distribution':
      html += renderScoreDistribution(section);
      break;
    case 'bench_agreement':
      html += renderBenchAgreement(section);
      break;
    case 'failure_analysis':
      html += renderFlaggedResponses(section);
      break;
    case 'ai_failure_analysis':
      html += renderAIFailureAnalysis(section);
      break;
    case 'recommendations':
      html += renderRecommendations(section);
      break;
    default:
      html += `<div class="reason" style="margin-bottom:12px;">${renderMarkdown(JSON.stringify(section, null, 2))}</div>`;
  }
  return html;
}

function renderExplanation(text) {
  if (!text) return '';
  return `
    <div style="margin-top:12px;padding:12px;background:rgba(129, 140, 248, 0.1);border-left:3px solid var(--primary);border-radius:4px;font-size:13px;line-height:1.5;color:var(--text);">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;color:var(--primary);font-weight:600;font-size:11px;text-transform:uppercase;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
        AI Context
      </div>
      ${escapeHtml(text)}
    </div>`;
}

function renderExecutiveSummary(section) {
  const statusColors = { pass: '#28a745', fail: '#dc3545', warning: '#ffc107' };
  const statusColor = statusColors[section.status] || '#6c757d';
  const statusLabel = (section.status || 'info').toUpperCase();

  const { thinking, content } = extractThinkingProcess(section.content);

  return `
    <div style="border-left:4px solid ${statusColor};padding:16px;background:#0f1018;border-radius:0 8px 8px 0;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="background:${statusColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${statusLabel}</span>
        <h4 style="margin:0;">${escapeHtml(section.title)}</h4>
      </div>
      ${renderCollapsibleThinking(thinking)}
      <div class="reason">${renderMarkdown(content)}</div>
    </div>`;
}

function renderContextMethodology(section) {
  const sp = section.system_prompt_card || {};
  const jp = section.judge_profile || {};
  const tp = section.test_parameters || {};

  // System Prompt card
  let spDisplay = '';
  if (sp.text) {
    let cleanText = sp.text;
    // Fix: Unescape literal newlines if present
    if (typeof cleanText === 'string' && cleanText.includes('\\n')) {
      cleanText = cleanText.replace(/\\n/g, '\n');
    }

    const MAX_CHARS = 500;
    const isLong = cleanText.length > MAX_CHARS;
    const preview = isLong ? cleanText.slice(0, MAX_CHARS) + '...' : cleanText;

    spDisplay = `
      <div style="flex:1;display:flex;flex-direction:column;min-height:0;">
        <div style="flex:1;font-family:monospace;white-space:pre-wrap;font-size:12px;color:var(--text);opacity:0.9;background:#0e0e14;padding:10px;border-radius:6px;border:1px solid var(--border);line-height:1.5;overflow-y:auto;">${escapeHtml(preview)}</div>
        ${isLong ? `<button onclick="_showCtxSysPrompt(this.getAttribute('data-full'))" data-full="${escapeHtml(cleanText)}" style="margin-top:8px;padding:8px;font-size:11px;background:#1e1e30;border:1px solid var(--border);border-radius:4px;color:var(--primary);cursor:pointer;width:100%;font-weight:600;transition:background 0.2s;">View Full Prompt ↗</button>` : ''}
      </div>`;
  } else {
    spDisplay = `<div style="flex:1;color:var(--muted);font-style:italic;font-size:13px;background:#0e0e14;padding:10px;border-radius:6px;border:1px solid var(--border);">${escapeHtml(sp.note || 'No system prompt used \u2014 base model behaviour.')}</div>`;
  }

  // Judge Profile
  let judgeDisplay = '';
  if (jp.type === 'bench') {
    judgeDisplay = `
      <div style="font-weight:700;font-size:16px;margin-bottom:4px;">\u2696 ${escapeHtml(jp.bench_name || 'Judge Bench')}</div>
      <div style="color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">${escapeHtml(jp.bench_mode || '')} mode</div>
      <div style="font-size:12px;color:#a0a0b8;">${(jp.models || []).map(m => `<span style="background:#1e1e30;padding:2px 6px;border-radius:4px;margin:2px;display:inline-block;">${escapeHtml(m)}</span>`).join('')}</div>`;
  } else {
    let jModel = escapeHtml(jp.model || '-');
    if (jp.source_url) {
      jModel = `<a href="${jp.source_url}" target="_blank" style="color:var(--primary);text-decoration:underline;">${jModel}</a>`;
    }
    judgeDisplay = `
      <div style="font-weight:700;font-size:15px;margin-bottom:4px;font-family:monospace;color:var(--primary);">${jModel}</div>
      <div style="color:var(--muted);font-size:12px;">Single judge model</div>`;
  }

  // Test Parameters stat pills
  const ps = 'display:inline-flex;flex-direction:column;align-items:center;background:#1e1e30;border:1px solid var(--border);border-radius:8px;padding:10px 16px;min-width:80px;';
  const paramStats = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">
      <div style="${ps}"><span style="font-size:20px;font-weight:700;color:var(--primary);">${tp.sample_size || '-'}</span><span style="font-size:11px;color:var(--muted);margin-top:2px;">PROMPTS</span></div>
      <div style="${ps}"><span style="font-size:20px;font-weight:700;color:var(--primary);">${tp.temperature !== undefined ? tp.temperature : '-'}</span><span style="font-size:11px;color:var(--muted);margin-top:2px;">TEMPERATURE</span></div>
      <div style="${ps}"><span style="font-size:20px;font-weight:700;color:var(--primary);">${escapeHtml((tp.language || 'EN').toUpperCase())}</span><span style="font-size:11px;color:var(--muted);margin-top:2px;">LANGUAGE</span></div>
    </div>`;

  return `
    <div style="margin-bottom:16px;padding:16px;background:#0f1018;border-radius:8px;border:1px solid var(--border);">
      <h4 style="margin:0 0 16px;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(section.title)}</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div style="display:flex;flex-direction:column;">
          <div style="font-weight:600;margin-bottom:8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);">System Prompt</div>
          ${spDisplay}
        </div>
        <div>
          <div style="font-weight:600;margin-bottom:8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);">Judge Profile</div>
          <div style="background:#0e0e14;border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px;">${judgeDisplay}</div>
          <div style="font-weight:600;margin-bottom:8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);">Test Parameters</div>
          ${paramStats}
        </div>
      </div>
      ${renderExplanation(section.explanation)}
    </div>`;
}

window._showCtxSysPrompt = function(text) {
  const el = document.getElementById('fullSystemPrompt');
  if (el) el.textContent = text;
  const modal = document.getElementById('systemPromptModal');
  if (modal) modal.style.display = 'flex';
};
function renderDimensionAnalysis(section) {
  // Render dimension stats table + placeholder for radar chart
  let tableRows = '';
  for (const [dim, data] of Object.entries(section.stats || {})) {
    const riskColor = data.risk_level === 'high' ? '#dc3545' : (data.risk_level === 'medium' ? '#ffc107' : '#28a745');
    tableRows += `
      <tr>
        <td style="padding:8px;border-bottom:1px solid var(--border);">${escapeHtml(dim)}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border);text-align:center;">${data.mean_score}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border);text-align:center;">${data.median_score}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border);text-align:center;">${data.std_dev}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border);text-align:center;">${data.failures}/${data.sample_size}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border);text-align:center;"><span style="color:${riskColor};font-weight:600;">${data.risk_level.toUpperCase()}</span></td>
      </tr>`;
  }

  return `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 12px;">${escapeHtml(section.title)}</h4>
      <div style="display:flex;flex-wrap:wrap;gap:16px;">
        <div style="background:#0f1018;border-radius:8px;border:1px solid var(--border);padding:16px;flex:1;min-width:300px;display:flex;justify-content:center;align-items:center;">
          <div style="width:100%;max-width:600px;position:relative;min-height:400px;">
            <canvas id="radarChart"></canvas>
            <button onclick="openRadarModal()" style="position:absolute;top:0;right:0;width:auto;padding:4px 8px;font-size:11px;background:rgba(30,30,40,0.8);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;">⤢</button>
          </div>
        </div>
        <div style="background:#0f1018;border-radius:8px;border:1px solid var(--border);padding:16px;flex:1;min-width:300px;overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="color:var(--muted);text-transform:uppercase;font-size:11px;">
                <th style="padding:8px;text-align:left;border-bottom:2px solid var(--border);">Dimension</th>
                <th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">Mean</th>
                <th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">Median</th>
                <th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">Std Dev</th>
                <th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">Failures</th>
                <th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">Risk</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
      ${renderExplanation(section.explanation)}
    </div>`;
}

function renderScoreDistribution(section) {
  // Compute stats from histogram data
  const data = (section.histogram && section.histogram.datasets && section.histogram.datasets[0] && section.histogram.datasets[0].data) || [];
  
  let total = 0;
  let weightedSum = 0;
  let lowRisk = 0; // Scores 6-7
  let medRisk = 0; // Scores 4-5
  let highRisk = 0; // Scores 1-3

  data.forEach((count, i) => {
    const score = i + 1;
    total += count;
    weightedSum += (score * count);
    
    if (score <= 3) highRisk += count;
    else if (score <= 5) medRisk += count;
    else lowRisk += count;
  });

  const mean = total > 0 ? (weightedSum / total).toFixed(2) : '0.00';
  const highPct = total > 0 ? Math.round((highRisk / total) * 100) : 0;
  const medPct = total > 0 ? Math.round((medRisk / total) * 100) : 0;
  const lowPct = total > 0 ? Math.round((lowRisk / total) * 100) : 0;

  // Breakdown Table Rows
  let breakdownRows = '';
  // Show scores 7 down to 1
  for (let i = 6; i >= 0; i--) {
    const score = i + 1;
    const count = data[i] || 0;
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    let color = '#28a745';
    if (score <= 3) color = '#dc3545';
    else if (score <= 5) color = '#ffc107';

    breakdownRows += `
      <tr style="border-bottom:1px solid #1f2937;">
        <td style="padding:6px;font-size:12px;">Score ${score}</td>
        <td style="padding:6px;font-size:12px;text-align:right;">${count}</td>
        <td style="padding:6px;font-size:12px;text-align:right;color:${color};font-weight:600;">${pct}%</td>
      </tr>
    `;
  }

  return `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 12px;">${escapeHtml(section.title)}</h4>
      <div style="display:flex;flex-wrap:wrap;gap:16px;">
        <!-- Chart Container -->
        <div style="background:#0f1018;border-radius:8px;border:1px solid var(--border);padding:16px;flex:2;min-width:400px;display:flex;align-items:center;">
          <canvas id="histogramChart" style="width:100%;height:300px;"></canvas>
        </div>
        
        <!-- Stats Container -->
        <div style="background:#0f1018;border-radius:8px;border:1px solid var(--border);padding:16px;flex:1;min-width:250px;display:flex;flex-direction:column;">
          <h5 style="margin:0 0 12px;color:var(--muted);font-size:12px;text-transform:uppercase;">Distribution Summary</h5>
          
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div style="background:#15151a;padding:10px;border-radius:6px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:#fff;">${total}</div>
              <div style="font-size:11px;color:var(--muted);">Total Responses</div>
            </div>
            <div style="background:#15151a;padding:10px;border-radius:6px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:var(--primary);">${mean}</div>
              <div style="font-size:11px;color:var(--muted);">Mean Score</div>
            </div>
          </div>

          <h5 style="margin:0 0 8px;color:var(--muted);font-size:11px;text-transform:uppercase;">Score Breakdown</h5>
          <div style="flex:1;overflow-y:auto;max-height:200px;border:1px solid var(--border);border-radius:6px;">
            <table style="width:100%;border-collapse:collapse;">
              <tbody>${breakdownRows}</tbody>
            </table>
          </div>
          
          <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:11px;color:var(--muted);">
            <span><span style="color:#dc3545;">●</span> Fail: ${highPct}%</span>
            <span><span style="color:#ffc107;">●</span> Warn: ${medPct}%</span>
            <span><span style="color:#28a745;">●</span> Pass: ${lowPct}%</span>
          </div>
        </div>
      </div>
      ${renderExplanation(section.explanation)}
    </div>`;
}

function renderBenchAgreement(section) {
  const matrix = section.matrix || {};
  let rows = '';
  for (const [dim, data] of Object.entries(matrix)) {
    const judges = data.judge_means || {};
    const judgeScores = Object.entries(judges).map(([j, s]) => `${escapeHtml(j)}: ${s}`).join(' | ');
    const agreeColor = data.agreement_level === 'high' ? '#28a745' : (data.agreement_level === 'medium' ? '#ffc107' : '#dc3545');
    rows += `
      <tr>
        <td style="padding:8px;border-bottom:1px solid var(--border);">${escapeHtml(dim)}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border);font-size:12px;">${judgeScores}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border);text-align:center;">${data.variance}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border);text-align:center;"><span style="color:${agreeColor};font-weight:600;">${(data.agreement_level || '').toUpperCase()}</span></td>
      </tr>`;
  }

  return `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 12px;">${escapeHtml(section.title)}</h4>
      <div style="background:#0f1018;border-radius:8px;border:1px solid var(--border);padding:16px;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="color:var(--muted);text-transform:uppercase;font-size:11px;">
              <th style="padding:8px;text-align:left;border-bottom:2px solid var(--border);">Dimension</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid var(--border);">Judge Means</th>
              <th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">Variance</th>
              <th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">Agreement</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${renderExplanation(section.explanation)}
    </div>`;
}

function renderFlaggedResponses(section) {
  const table = section.table || {};
  const rows = table.rows || [];

  if (rows.length === 0) {
    return `
      <div style="margin-bottom:16px;">
        <h4 style="margin:0 0 12px;">${escapeHtml(section.title)} <span style="color:var(--muted);font-size:13px;">(${section.total_flagged || 0} flagged)</span></h4>
        <div style="background:#0f1018;border-radius:8px;border:1px solid var(--border);padding:16px;color:#28a745;">
          ✓ No responses scored below threshold (&lt; 4/7). All responses are within acceptable range.
        </div>
      </div>`;
  }

  const PROMPT_MAX = 300;
  const RESPONSE_MAX = 400;
  let tableRows = '';

  for (const row of rows.slice(0, 20)) {
    const promptText = row.prompt || '';
    const responseText = row.response || '';
    const promptLong = promptText.length > PROMPT_MAX;
    const responseLong = responseText.length > RESPONSE_MAX;
    const promptDisplay = escapeHtml(promptLong ? promptText.slice(0, PROMPT_MAX) + '…' : promptText);
    const responseDisplay = escapeHtml(responseLong ? responseText.slice(0, RESPONSE_MAX) + '…' : responseText);

    const rowData = JSON.stringify({ dimension: row.dimension, score: row.score, prompt: promptText, response: responseText });
    const viewBtn = (promptLong || responseLong)
      ? `<br><button onclick='showFlaggedDetailModal(${rowData.replace(/'/g, "&#39;")})' style="margin-top:6px;padding:2px 8px;font-size:11px;width:auto;background:#252536;border:1px solid var(--border);cursor:pointer;color:var(--primary);border-radius:4px;">View Full ↗</button>`
      : '';

    tableRows += `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid var(--border);font-size:12px;vertical-align:top;">${escapeHtml(row.dimension)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid var(--border);font-size:12px;vertical-align:top;">
          <div style="white-space:pre-wrap;line-height:1.5;">${promptDisplay}</div>${promptLong ? viewBtn : ''}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid var(--border);font-size:12px;vertical-align:top;">
          <div style="white-space:pre-wrap;line-height:1.5;">${responseDisplay}</div>${responseLong ? viewBtn : ''}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid var(--border);text-align:center;font-weight:700;color:#dc3545;vertical-align:top;font-size:14px;">${row.score}/7</td>
      </tr>`;
  }

  return `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 12px;">${escapeHtml(section.title)} <span style="color:var(--muted);font-size:13px;">(${section.total_flagged} flagged)</span></h4>
      <div style="background:#0f1018;border-radius:8px;border:1px solid var(--border);overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="color:var(--muted);text-transform:uppercase;font-size:11px;">
              <th style="padding:10px 8px;text-align:left;border-bottom:2px solid var(--border);width:120px;">Dimension</th>
              <th style="padding:10px 8px;text-align:left;border-bottom:2px solid var(--border);">Prompt</th>
              <th style="padding:10px 8px;text-align:left;border-bottom:2px solid var(--border);">Response</th>
              <th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--border);width:60px;">Score</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${rows.length > 20 ? `<div style="color:var(--muted);font-size:12px;padding:10px 8px;">Showing 20 of ${rows.length} flagged responses</div>` : ''}
      </div>
    </div>`;
}

window.showFlaggedDetailModal = function (data) {
  const modal = document.getElementById('flaggedDetailModal');
  if (!modal) return;
  document.getElementById('flaggedDetailDimension').textContent = data.dimension || '';
  document.getElementById('flaggedDetailScore').textContent = data.score + '/7';
  document.getElementById('flaggedDetailPrompt').textContent = data.prompt || '';
  document.getElementById('flaggedDetailResponse').textContent = data.response || '';
  modal.style.display = 'flex';
};

window.closeFlaggedDetailModal = function () {
  const modal = document.getElementById('flaggedDetailModal');
  if (modal) modal.style.display = 'none';
};


function renderAIFailureAnalysis(section) {
  const { thinking, content } = extractThinkingProcess(section.content);
  return `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 12px;">${escapeHtml(section.title)}</h4>
      ${renderCollapsibleThinking(thinking)}
      <div class="reason">${renderMarkdown(content)}</div>
    </div>`;
}

function renderRecommendations(section) {
  const { thinking, content } = extractThinkingProcess(section.content);
  return `
    <div style="margin-bottom:16px;border-left:4px solid var(--primary);padding:16px;background:#0f1018;border-radius:0 8px 8px 0;">
      <h4 style="margin:0 0 12px;">${escapeHtml(section.title)}</h4>
      ${renderCollapsibleThinking(thinking)}
      <div class="reason">${renderMarkdown(content)}</div>
    </div>`;
}

// ─── Chart.js Initialization ───

function initReportCharts(sections) {
  const chartDefaults = {
    color: '#a0a0b8',
    borderColor: '#2e2e48',
    font: { family: 'system-ui, sans-serif' }
  };

  // Radar Chart
  const dimSection = sections.find(s => s.type === 'dimension_analysis');
  if (dimSection && dimSection.radar_chart) {
    const radarCanvas = document.getElementById('radarChart');
    if (radarCanvas) {
      const chartData = {
        labels: dimSection.radar_chart.labels,
        datasets: dimSection.radar_chart.datasets.map(ds => ({
          label: ds.label,
          data: ds.data,
          backgroundColor: 'rgba(99, 102, 241, 0.15)',
          borderColor: 'rgba(99, 102, 241, 0.8)',
          borderWidth: 2,
          pointBackgroundColor: 'rgba(99, 102, 241, 1)',
          pointBorderColor: '#fff',
          pointHoverRadius: 6,
        }))
      };
      
      // Store data globally for modal
      currentRadarData = JSON.parse(JSON.stringify(chartData)); // Deep copy

      const radarChart = new Chart(radarCanvas, {
        type: 'radar',
        data: chartData,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: 40
          },
          scales: {
            r: {
              min: 0,
              max: 7,
              ticks: { stepSize: 1, color: '#666', backdropColor: 'transparent' },
              grid: { color: '#2e2e48' },
              angleLines: { color: '#2e2e48' },
              pointLabels: { color: '#a0a0b8', font: { size: 12 } }
            }
          },
          plugins: {
            legend: { labels: { color: '#a0a0b8', font: { size: 12 } } }
          }
        }
      });
      window._orwellCharts.push(radarChart);
    }
  }

  // Histogram (Score Distribution)
  const histSection = sections.find(s => s.type === 'score_distribution');
  if (histSection && histSection.histogram) {
    const histCanvas = document.getElementById('histogramChart');
    if (histCanvas) {
      const rawData = histSection.histogram.datasets[0].data;
      const histData = Array.isArray(rawData) ? rawData.map(v => Number(v) || 0) : [];
      const labels = histSection.histogram.labels;
      
      const barColors = histData.map((_, i) => {
        const lVal = parseInt(labels[i]);
        const score = !isNaN(lVal) ? lVal : (i + 1);
        if (score <= 3) return 'rgba(220, 53, 69, 0.8)';
        if (score <= 5) return 'rgba(255, 193, 7, 0.8)';
        return 'rgba(40, 167, 69, 0.8)';
      });

      const histChart = new Chart(histCanvas, {
        type: 'bar',
        data: {
          labels: labels.map(l => `Score ${l}`),
          datasets: [{
            label: 'Response Count',
            data: histData,
            backgroundColor: barColors,
            borderColor: barColors.map(c => c.replace('0.8', '1')),
            borderWidth: 1,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          scales: {
            y: { beginAtZero: true, ticks: { color: '#666', stepSize: 1 }, grid: { color: '#1a1a23' } },
            x: { ticks: { color: '#a0a0b8' }, grid: { display: false } }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
      window._orwellCharts.push(histChart);
    }
  }
}

function getRiskColor(risk) {
  const colors = { low: '#28a745', medium: '#ffc107', high: '#dc3545' };
  return colors[risk] || '#6c757d';
}

async function loadPromptsAndResponses() {
  try {
    const jobRes = await fetch(`/api/audit/${currentJobId}`);
    const job = await jobRes.json();
    let systemPrompt = job.system_prompt_snapshot || null;
    if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.includes('\\n')) {
        systemPrompt = systemPrompt.replace(/\\n/g, '\n');
    }

    const pRes = await fetch(`/api/audit/${currentJobId}/prompts`);
    const prompts = await pRes.json();
    const rRes = await fetch(`/api/audit/${currentJobId}/responses`);
    const responses = await rRes.json();
    const byPrompt = new Map();
    prompts.forEach(p => byPrompt.set(p.prompt_id, { prompt: p, response: null }));
    responses.forEach(r => {
      const x = byPrompt.get(r.prompt_id) || { prompt: { dimension: r.dimension, text: r.prompt_text, prompt_id: r.prompt_id }, response: null };
      x.response = r;
      byPrompt.set(r.prompt_id, x);
    });

    let accHtml = '';

    // Render System Prompt
    if (systemPrompt) {
      window.currentSystemPrompt = systemPrompt;
      const lines = systemPrompt.split('\n');
      // Take first 3 lines or 300 chars for preview
      let preview = systemPrompt;
      let isTruncated = false;

      if (lines.length > 3) {
        preview = lines.slice(0, 3).join('\n');
        isTruncated = true;
      }
      if (preview.length > 300) {
        preview = preview.slice(0, 300) + '...';
        isTruncated = true;
      }

      accHtml += `
        <div style="background:#1a1a23; padding:12px; border-radius:8px; margin-bottom:16px; border:1px solid var(--border)">
            <div style="font-weight:600;margin-bottom:8px;color:var(--muted);font-size:12px;text-transform:uppercase">System Prompt</div>
            <div style="font-family:monospace;white-space:pre-wrap;color:var(--text);opacity:0.9;font-size:13px">${escapeHtml(preview)}</div>
            ${isTruncated ? `<button onclick="showSystemPromptModal()" style="margin-top:8px;padding:4px 8px;font-size:12px;width:auto;background:#252536;border:none;cursor:pointer;color:var(--primary)">Read More</button>` : ''}
        </div>
        `;
    }

    for (const [pid, item] of byPrompt.entries()) {
      const p = item.prompt;
      const r = item.response;
      accHtml += `
        <div class="qa-item">
          <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="toggleAcc('${pid}')">
            <div><strong>${p.dimension}</strong> • <span class="mono" style="color:#a0a0b8">${pid.slice(0, 8)}</span></div>
            <div class="pill">${r && r.score ? `Score ${r.score}/7` : 'No score'}</div>
          </div>
          <div id="acc-${pid}" style="display:none;margin-top:10px;">
            <div><span class="label">Prompt</span><div style="margin-top:6px">${escapeHtml(p.text)}</div></div>
            <div style="margin-top:10px"><span class="label">Response</span><div style="margin-top:6px">${r ? renderMarkdown(r.raw_response) : '<em>No response</em>'}</div></div>
            ${r && r.reason ? (() => {
                const cleanReason = (r.reason || '').replace(/^(?:\\n|\n)?Reason:\s*/i, '');
                return `<div style="margin-top:10px"><span class="label">Judge Reason</span><div class="reason" style="margin-top:6px;">${renderMarkdown(cleanReason)}</div></div>`;
            })() : ''}
          </div>
        </div>`;
    }
    document.getElementById('qaAccordion').innerHTML = accHtml || '<em>No prompts/responses found</em>';
  } catch (err) {
    console.error('Error loading prompts/responses:', err);
  }
}

window.showSystemPromptModal = function () {
  const el = document.getElementById('fullSystemPrompt');
  if (el && window.currentSystemPrompt) {
    el.textContent = window.currentSystemPrompt;
    document.getElementById('systemPromptModal').style.display = 'flex';
  }
};

async function loadCriteria() {
  try {
    const cRes = await fetch('/api/criteria');
    const c = await cRes.json();
    let html = `<div class="dimension"><strong>Scale</strong><br>${c.scale}</div>`;
    html += `<div class="dimension"><strong>Risk Buckets</strong><br>low: ${c.risk_buckets.low}<br>medium: ${c.risk_buckets.medium}<br>high: ${c.risk_buckets.high}</div>`;
    html += `<div class="dimension"><strong>Dimensions</strong><br>${(c.dimensions || []).join(', ')}</div>`;
    html += `<div class="dimension"><strong>Notes</strong><br>${c.notes}</div>`;
    document.getElementById('criteria').innerHTML = html;
  } catch (err) {
    console.error('Error loading criteria:', err);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function formatResponse(text) {
  const t = escapeHtml(text || '')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return `<div style="white-space:normal;line-height:1.5">${t}</div>`;
}

function renderMarkdown(text) {
  let s = String(text || '');
  
  // Handle literal newlines that might have been escaped
  if (s.includes('\\n')) {
    s = s.replace(/\\n/g, '\n');
  }

  // Use marked library if available
  if (typeof marked !== 'undefined') {
    try {
      // Configure marked for GFM and breaks
      // Note: marked 15.x might require using marked.parse(text, options)
      const html = marked.parse(s, { breaks: true, gfm: true });
      return `<div class="markdown-content">${html}</div>`;
    } catch (e) {
      console.error('Markdown parsing error:', e);
    }
  }

  // Fallback to simple escaping if marked is missing or fails
  s = escapeHtml(s).replace(/\n/g, '<br>');
  return `<div class="markdown-content" style="white-space:pre-wrap">${s}</div>`;
}

window.toggleAcc = function (id) {
  const el = document.getElementById('acc-' + id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

const criteriaLink = document.getElementById('criteriaLink');
if (criteriaLink) {
  criteriaLink.addEventListener('click', async (e) => {
    e.preventDefault();
    await loadCriteria();
    const modal = document.getElementById('criteriaModal');
    if (modal) modal.style.display = 'flex';
  });
}

const criteriaClose = document.getElementById('criteriaClose');
if (criteriaClose) {
  criteriaClose.addEventListener('click', () => {
    const modal = document.getElementById('criteriaModal');
    if (modal) modal.style.display = 'none';
  });
}

async function loadAuditList() {
  const container = document.getElementById('auditList');
  try {
    const res = await fetch('/api/audits?t=' + Date.now());
    if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${await res.text()}`);
    }
    const audits = await res.json();
    
    if (!Array.isArray(audits)) {
        throw new Error('Invalid response format: expected array');
    }

    const list = audits.map(a => {
      const date = new Date(a.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      
      let riskColor = '#a0a0b8';
      if (a.overall_risk === 'low') riskColor = 'var(--success)';
      if (a.overall_risk === 'medium') riskColor = 'var(--warning)';
      if (a.overall_risk === 'high') riskColor = 'var(--danger)';
      
      const riskLabel = a.overall_risk ? ` • <span style="color:${riskColor};font-weight:bold;">${a.overall_risk.toUpperCase()}</span>` : '';
      const dims = a.dimensions ? a.dimensions.length + ' dims' : '';
      const judge = a.judge_name || 'Unknown Judge';

      return `
      <div class="audit-item ${a.job_id === currentJobId ? 'selected-audit' : ''}" data-job="${a.job_id}" data-selected="0">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div style="flex:1; min-width:0; padding-right:8px;">
            <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(a.target_model || '')}">${escapeHtml(a.target_model || 'Unknown')}</div>
            <div class="mono" style="font-size:10px; margin-top:4px; color:#a0a0b8; display:flex; flex-direction:column; gap:2px;">
               <span>${date}</span>
               <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(judge)}">${escapeHtml(judge)}</span>
               <span>${dims}${riskLabel}</span>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:end; gap:4px;">
             <div class="audit-progress pill" style="font-size:11px;">${Math.round((a.progress || 0) * 100)}%</div>
             <div class="audit-delete-icon" onclick="deleteSingleAudit(event, '${a.job_id}')" title="Delete Audit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
             </div>
          </div>
        </div>
      </div>`;
    }).join('');

    const container = document.getElementById('auditList');
    container.innerHTML = list || '<div style="padding:16px;text-align:center;color:var(--muted);font-style:italic;">No audits found. Start a new audit to see reports here.</div>';
    
    // Ensure delete bar is hidden after refresh if list is empty or selection is cleared
    updateSelectionUI();

    container.querySelectorAll('.audit-item').forEach(item => {
      item.addEventListener('click', async (event) => {
        if (event.shiftKey) {
          const sel = item.getAttribute('data-selected') === '1';
          item.setAttribute('data-selected', sel ? '0' : '1');
          item.style.borderColor = sel ? 'var(--border)' : '#ef4444';
          updateSelectionUI();
          return;
        }
        
        // Clear previous selections if clicking normally
        document.querySelectorAll('.audit-item[data-selected="1"]').forEach(el => {
            el.setAttribute('data-selected', '0');
            el.style.borderColor = 'var(--border)';
        });
        updateSelectionUI();

        currentJobId = item.getAttribute('data-job');
        // Update highlight manually to avoid full reload
        container.querySelectorAll('.audit-item').forEach(el => el.classList.remove('selected-audit'));
        item.classList.add('selected-audit');
        
        document.getElementById('jobIdText').textContent = currentJobId;
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.style.display = 'block';
        await loadPromptsAndResponses();
        await loadCriteria();
        await loadReport();
        await loadLogsForReport();
      });
    });

    // Auto-select first audit if none selected (e.g. on page load) or if current was deleted
    // Check if currentJobId exists in the new list
    const currentExists = audits.some(a => a.job_id === currentJobId);
    
    if ((!currentJobId || !currentExists) && audits.length > 0) {
      const first = container.querySelector('.audit-item');
      if (first) first.click();
    } else if (audits.length === 0) {
      // Clear main view if no audits
      currentJobId = null;
      document.getElementById('qaAccordion').innerHTML = '';
      document.getElementById('report').style.display = 'none';
      document.getElementById('status').style.display = 'none';
      
      // Show placeholder in report area?
      // The status area is hidden, report is hidden. The user sees empty space.
      // We could show a placeholder div if needed, but for now clearing is what was asked (or "show message").
      // User said: "if there are no reports then we should show a message to start audititing to generate reports"
      const reportContainer = document.getElementById('report');
      if (reportContainer) {
          reportContainer.style.display = 'block';
          reportContainer.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;color:var(--muted);">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="margin-bottom:16px;opacity:0.5;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            <h3>No Reports Available</h3>
            <p>Start an audit to generate a report.</p>
          </div>`;
      }
    }
  } catch (err) {
    console.error('Error loading audits:', err);
    const container = document.getElementById('auditList');
    if (container) {
      container.innerHTML = `
        <div style="padding:16px;text-align:center;color:var(--danger);">
          <p>Failed to load audits: ${err.message}</p>
          <button onclick="loadAuditList()" style="margin-top:8px;padding:6px 12px;cursor:pointer;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--fg-primary);">Retry</button>
        </div>`;
    }
  }
}

window.updateSelectionUI = function() {
  const selected = document.querySelectorAll('.audit-item[data-selected="1"]');
  const count = selected.length;
  const countEl = document.getElementById('selCount');
  if (countEl) countEl.textContent = count;
  
  const bar = document.getElementById('stickyDeleteBar');
  if (bar) {
      // Show only if multiple items selected
      bar.style.display = count > 1 ? 'block' : 'none';
  }
}

window.deleteSingleAudit = async function(event, jobId) {
    event.stopPropagation(); // Prevent item click
    
    // Show custom modal
    const modal = document.getElementById('deleteModal');
    const msg = document.getElementById('deleteMessage');
    msg.textContent = 'Are you sure you want to delete this audit? This action cannot be undone.';
    modal.style.display = 'flex';
    
    // Setup confirm button
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    // Remove old listeners to avoid stacking
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    
    newBtn.addEventListener('click', async () => {
        try {
          const url = '/api/audits?job_ids=' + encodeURIComponent(jobId);
          const res = await fetch(url, { method: 'DELETE' });
          if (!res.ok) throw new Error(await res.text());
          await loadAuditList();
          
          // If we deleted the current job, clear UI
          if (currentJobId === jobId) {
              currentJobId = null;
              document.getElementById('qaAccordion').innerHTML = '';
              document.getElementById('report').style.display = 'none';
              document.getElementById('status').style.display = 'none';
          }
          closeDeleteModal();
        } catch (err) {
          alert('Delete failed: ' + err);
        }
    });
}

document.getElementById('deleteBtn').addEventListener('click', async () => {
  const items = Array.from(document.querySelectorAll('.audit-item')).filter(x => x.getAttribute('data-selected') === '1');
  const ids = items.map(x => x.getAttribute('data-job'));
  if (!ids.length) {
    alert('Hold Shift and click items to select for deletion.');
    return;
  }

  // Show custom modal
  const modal = document.getElementById('deleteModal');
  const msg = document.getElementById('deleteMessage');
  msg.textContent = `Are you sure you want to delete ${ids.length} audit${ids.length > 1 ? 's' : ''}? This action cannot be undone.`;
  modal.style.display = 'flex';

  // Setup confirm button
  const confirmBtn = document.getElementById('confirmDeleteBtn');
  // Remove old listeners to avoid stacking
  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

  newBtn.addEventListener('click', async () => {
    try {
      const url = '/api/audits?' + ids.map(id => 'job_ids=' + encodeURIComponent(id)).join('&');
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      await loadAuditList();
      document.getElementById('qaAccordion').innerHTML = '';
      document.getElementById('report').style.display = 'none';
      document.getElementById('status').style.display = 'none';
      closeDeleteModal();
    } catch (err) {
      alert('Delete failed: ' + err);
    }
  });
});

window.closeDeleteModal = function () {
  document.getElementById('deleteModal').style.display = 'none';
}

async function loadLogsForReport() {
  if (!currentJobId) return;
  const container = document.getElementById('fullLogContent');
  if (!container) return;
  
  // Reset
  container.innerHTML = '<div style="color:#666;font-style:italic;padding:12px">Loading logs...</div>';
  
  try {
    const res = await fetch(`/api/audit/${currentJobId}/logs`);
    if (!res.ok) throw new Error("Failed to fetch logs");
    
    const logs = await res.json();
    if (!logs || logs.length === 0) {
      container.innerHTML = '<div style="color:#666;font-style:italic;padding:12px">No logs available.</div>';
      return;
    }
    
    let html = '';
    logs.forEach(log => {
      // Reuse the same styling classes as terminal
      const time = log.timestamp.split('T')[1].split('.')[0];
      html += `<div class="log-entry">
        <div class="log-meta">
          <span class="log-time">${time}</span> 
          <span class="log-type type-${log.type}">${log.type}</span>
        </div>
        <div class="log-content">${escapeHtml(log.content)}</div>
      </div>`;
    });
    
    container.innerHTML = html;
    // Scroll to bottom? Maybe not for a report view, top is better.
    container.scrollTop = 0;
    
  } catch (err) {
    console.error("Error loading logs:", err);
    container.innerHTML = `<div style="color:#ef4444;padding:12px">Error loading logs: ${escapeHtml(err.message)}</div>`;
  }
}

async function initDimensions() {
  try {
    const res = await fetch('/api/dimensions');
    const data = await res.json();
    const allDims = (data.dimensions || []).sort();

    // Store all dimensions globally for modal
    window.allDimensions = allDims;

    // Initial display: limit to 5
    renderDimensionList(allDims.slice(0, 5));

    const showAllBtn = document.getElementById('dimShowAll');
    if (allDims.length > 5) {
      showAllBtn.style.display = 'inline-block';
      showAllBtn.onclick = openDimModal;
    } else {
      showAllBtn.style.display = 'none';
    }

  } catch (err) {
    console.error('Failed to load dimensions:', err);
  }
}

function renderDimensionList(dims) {
  const listEl = document.getElementById('dimList');
  if (!listEl) return;

  listEl.innerHTML = dims.map(d => `<span class="pill ${selectedDimensions.includes(d) ? 'selected' : ''}" data-dim="${escapeHtml(d)}">${escapeHtml(d)}</span>`).join('');

  listEl.querySelectorAll('.pill').forEach(el => {
    el.addEventListener('click', () => {
      const d = el.getAttribute('data-dim');
      const idx = selectedDimensions.indexOf(d);
      if (idx >= 0) {
        selectedDimensions.splice(idx, 1);
        el.classList.remove('selected');
      } else {
        selectedDimensions.push(d);
        el.classList.add('selected');
      }
    });
  });
}

function openDimModal() {
  const modalList = document.getElementById('modalDimList');
  modalList.innerHTML = window.allDimensions.map(d =>
    `<span class="pill ${selectedDimensions.includes(d) ? 'selected' : ''}" onclick="toggleModalDim(this)" data-dim="${escapeHtml(d)}">${escapeHtml(d)}</span>`
  ).join('');
  document.getElementById('dimModal').style.display = 'flex';
}

// Modal Listeners
document.getElementById('modalSelectAll').addEventListener('click', () => {
  const pills = document.querySelectorAll('#modalDimList .pill');
  pills.forEach(p => p.classList.add('selected'));
});

document.getElementById('modalClear').addEventListener('click', () => {
  const pills = document.querySelectorAll('#modalDimList .pill');
  pills.forEach(p => p.classList.remove('selected'));
});

window.toggleModalDim = function (el) {
  el.classList.toggle('selected');
}

window.closeDimModal = function () {
  document.getElementById('dimModal').style.display = 'none';
}

window.confirmDimSelection = function () {
  const selectedPills = document.querySelectorAll('#modalDimList .pill.selected');
  selectedDimensions = Array.from(selectedPills).map(p => p.getAttribute('data-dim'));

  // Update main view to show ONLY selected dimensions
  renderDimensionList(selectedDimensions);

  // If no selection, revert to default view (first 5)
  if (selectedDimensions.length === 0) {
    renderDimensionList(window.allDimensions.slice(0, 5));
  }

  closeDimModal();
}

// Renaming Logic
const nameDisplay = document.getElementById('auditNameDisplay');
const nameInput = document.getElementById('auditNameInput');
const editNameBtn = document.getElementById('editNameBtn');
const saveDetailsBtn = document.getElementById('saveDetailsBtn');

if (editNameBtn) {
  editNameBtn.addEventListener('click', () => {
    nameDisplay.style.display = 'none';
    nameInput.style.display = 'block';
    nameInput.focus();
  });
}

if (nameDisplay) {
  nameDisplay.addEventListener('click', () => {
    nameDisplay.style.display = 'none';
    nameInput.style.display = 'block';
    nameInput.focus();
  });
}

if (saveDetailsBtn) {
  saveDetailsBtn.addEventListener('click', async () => {
    if (!currentJobId) return;
    const newName = nameInput.value.trim();
    const newNotes = document.getElementById('auditNotes').value.trim();

    try {
      const res = await fetch(`/api/audit/${currentJobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, notes: newNotes })
      });
      if (!res.ok) throw new Error(await res.text());

      // Update UI
      nameDisplay.textContent = newName;
      nameDisplay.style.display = 'block';
      nameInput.style.display = 'none';

      // Reload list to update sidebar
      await loadAuditList();

      alert('Saved successfully');
    } catch (e) {
      console.error(e);
      alert('Failed to save: ' + e);
    }
  });
}

// Removed main view listeners for Select All/Clear as they are now in modal
// Only kept if needed for backward compatibility or future features, but for now they are gone from DOM.

// Let's wrap fetch to include token
const originalFetch = window.fetch;
window.fetch = async (url, options = {}) => {
  if (!options.headers) options.headers = {};
  if (pb.authStore.isValid) {
    options.headers['Authorization'] = `Bearer ${pb.authStore.token}`;
  }
  return originalFetch(url, options);
};

document.addEventListener('DOMContentLoaded', () => {
  loadAuditList();
  loadSystemPrompts();
  loadModels(); // Added
  if (typeof initDimensions === 'function') initDimensions();
});

async function loadSystemPrompts() {
  try {
    const res = await fetch('/api/system-prompts');
    if (!res.ok) return;
    const prompts = await res.json();
    const select = document.getElementById('systemPromptInput');
    select.innerHTML = '<option value="">None (Default)</option>';
    systemPromptsMap = {};

    prompts.forEach(p => {
      systemPromptsMap[p.name] = p.text;
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
  } catch (e) {
    console.error('Failed to load system prompts', e);
  }
}

// Model Hub Integration
async function loadModels() {
  try {
    const response = await fetch('/api/models');
    const models = await response.json();

    const targetSelect = document.getElementById('targetModelSelect');
    const judgeSelect = document.getElementById('judgeModelSelect');

    // Clear existing (except default options)
    targetSelect.innerHTML = '<option value="custom">Custom (Enter manually)</option>';
    judgeSelect.innerHTML = '';

    models.forEach(m => {
      const option = document.createElement('option');
      option.value = m.id;
      option.textContent = `${m.name} (${m.model_key})`;

      if (m.category === 'target') {
        targetSelect.appendChild(option);
      } else if (m.category === 'judge') {
        judgeSelect.appendChild(option);
      }
    });

    // Handle empty states - ensure at least one option is selected or placeholder shown
    if (judgeSelect.options.length === 0) {
      const ph = document.createElement('option');
      ph.value = "";
      ph.textContent = "No judge models available";
      ph.disabled = true;
      ph.selected = true;
      judgeSelect.appendChild(ph);
    } else {
      // Select first available judge by default
      judgeSelect.selectedIndex = 0;
    }

    // Setup change handler
    targetSelect.addEventListener('change', toggleCustomFields);
    toggleCustomFields(); // Init state

    // Also load benches for the bench dropdown
    await loadDashboardBenches();

  } catch (err) {
    console.error('Failed to load models:', err);
  }
}

// ──────────────────────────────────────────────────
// Judge Source Toggle & Bench Loading (Dashboard)
// ──────────────────────────────────────────────────

function toggleJudgeSource() {
  const source = document.querySelector('input[name="judgeSource"]:checked').value;
  document.getElementById('singleJudgeWrap').style.display = source === 'single' ? 'block' : 'none';
  document.getElementById('benchJudgeWrap').style.display = source === 'bench' ? 'block' : 'none';
}

async function loadDashboardBenches() {
  try {
    const res = await fetch('/api/benches');
    const benches = await res.json();
    const select = document.getElementById('benchSelect');
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>Select a Bench</option>';
    benches.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      const modeEmoji = b.mode === 'random' ? '🎲' : '📋';
      opt.textContent = `${modeEmoji} ${b.name} (${(b.judge_model_ids || []).length} judges, ${b.mode})`;
      select.appendChild(opt);
    });

    // Show info on select
    select.addEventListener('change', () => {
      const selected = benches.find(b => b.id === select.value);
      const infoEl = document.getElementById('benchInfo');
      if (selected && infoEl) {
        infoEl.textContent = selected.mode === 'random'
          ? 'Random mode: A random judge scores each response. Low scores trigger re-scoring.'
          : 'All mode: Every judge scores every response. Scores are averaged.';
      }
    });
  } catch (err) {
    console.error('Failed to load benches:', err);
  }
}

function toggleCustomFields() {
  const select = document.getElementById('targetModelSelect');
  const customFields = document.getElementById('customTargetFields');

  if (!select || !customFields) return;

  if (select.value === 'custom') {
    customFields.style.display = 'block';
  } else {
    customFields.style.display = 'none';
  }
}

// Terminal Logic
const terminal = document.getElementById('terminal');
const terminalContent = document.getElementById('terminalContent');
const toggleBtn = document.getElementById('toggleTerminalBtn');
const clearBtn = document.getElementById('clearLogsBtn');
const logStatus = document.getElementById('logStatus');

let isTerminalCollapsed = true;
let lastLogTimestamp = null;

if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    isTerminalCollapsed = !isTerminalCollapsed;
    terminal.classList.toggle('collapsed', isTerminalCollapsed);
    toggleBtn.textContent = isTerminalCollapsed ? '[]' : '_';
  });
}

// Resize Logic
const header = document.getElementById('terminalHeader');
if (header) {
  let isResizing = false;
  let startY, startHeight;

  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return; // Ignore button clicks
    isResizing = true;
    startY = e.clientY;
    startHeight = terminal.clientHeight;
    document.body.style.cursor = 'ns-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    if (isTerminalCollapsed) return; // Don't resize if collapsed

    const delta = startY - e.clientY;
    const newHeight = startHeight + delta;
    if (newHeight > 100 && newHeight < window.innerHeight - 100) {
      terminal.style.height = `${newHeight}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
    }
  });
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    terminalContent.innerHTML = '';
  });
}

let logEventSource = null;

// Inject styles for cursor
const style = document.createElement('style');
style.textContent = `
  @keyframes blink {
    0% { opacity: 1; }
    50% { opacity: 0; }
    100% { opacity: 1; }
  }
  .cursor {
    display: inline-block;
    width: 8px;
    height: 15px;
    background-color: var(--primary, #6366f1);
    animation: blink 1s step-end infinite;
    vertical-align: middle;
    margin-left: 2px;
  }
`;
document.head.appendChild(style);

function startLogStream(jobId) {
    if (logEventSource) {
        logEventSource.close();
        logEventSource = null;
    }
    
    // Connect to SSE
    logEventSource = new EventSource(`/api/audit/${jobId}/stream`);
    
    logEventSource.onmessage = (event) => {
        try {
            const log = JSON.parse(event.data);
            renderLogs([log]);
            if (logStatus) logStatus.textContent = `Live: ${new Date().toLocaleTimeString()}`;
        } catch (e) {
            console.error("Failed to parse SSE log:", e);
        }
    };
    
    logEventSource.onerror = (err) => {
        console.warn("SSE Error (stream might have ended or failed):", err);
        // If connection fails, we might close it or let it retry.
        // For completed jobs, the server closes the stream, which might trigger error in some browsers.
        // We rely on polling status to close it cleanly.
    };
}

function stopLogStream() {
    if (logEventSource) {
        logEventSource.close();
        logEventSource = null;
    }
}

async function pollStatus() {
  if (!currentJobId) return;

  // Start log stream if not active
  if (!currentEventSource && !logEventSource && currentJobId) {
      startLogStream(currentJobId);
  }

  try {
    await loadAuditList();
    const response = await fetch(`/api/audit/${currentJobId}`);
    const status = await response.json();
    const detailsRes = await fetch(`/api/audit/${currentJobId}/details`);
    const details = detailsRes.ok ? await detailsRes.json() : null;
    document.getElementById('statusText').textContent = status.status;
    const progress = Math.round((status.progress || 0) * 100);
    const fill = document.getElementById('progressFill');
    fill.style.width = progress + '%';
    fill.textContent = progress + '%';
    document.getElementById('statusMessage').textContent = status.message || '';
    if (status.status === 'completed') {
      clearInterval(pollInterval);
      stopLogStream(); // Stop streaming logs
      if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
      }
      
      const startBtn = document.getElementById('startBtn');
      if (startBtn) {
        startBtn.textContent = 'Start Audit';
        startBtn.style.background = 'var(--primary)';
        startBtn.style.borderColor = 'var(--primary)';
      }
      await loadPromptsAndResponses();
      await loadCriteria();
      await loadReport();
      await loadLogsForReport();
      if (details && details.error_message) {
        document.getElementById('statusMessage').textContent = details.error_message;
      }
    } else if (status.status === 'failed') {
      clearInterval(pollInterval);
      stopLogStream(); // Stop streaming logs
      if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
      }
      
      const startBtn = document.getElementById('startBtn');
      if (startBtn) {
        startBtn.textContent = 'Start Audit';
        startBtn.style.background = 'var(--primary)';
        startBtn.style.borderColor = 'var(--primary)';
      }
      document.getElementById('statusText').textContent = 'failed';
      document.getElementById('statusText').style.color = 'var(--danger)';
      document.getElementById('statusMessage').textContent = status.message || 'Audit failed';
      document.getElementById('statusMessage').style.color = 'var(--danger)';
    } else if (status.status === 'aborted') {
      clearInterval(pollInterval);
      stopLogStream(); // Stop streaming logs
      if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
      }
      
      const startBtn = document.getElementById('startBtn');
      if (startBtn) {
        startBtn.textContent = 'Start Audit';
        startBtn.style.background = 'var(--primary)';
        startBtn.style.borderColor = 'var(--primary)';
      }
      document.getElementById('statusText').textContent = 'aborted';
      document.getElementById('statusMessage').textContent = status.message || 'Aborted by user';
    }
  } catch (err) {
    console.error('Error polling status:', err);
  }
}

function renderLogs(logs) {
  if (!terminalContent) return;

  const wasAtBottom = terminalContent.scrollTop + terminalContent.clientHeight >= terminalContent.scrollHeight - 50;

  logs.forEach(log => {
    // Check if log already exists by ID
    let div = document.querySelector(`.log-entry[data-log-id="${log.id}"]`);
    
    // Display names mapping
    let displayType = log.type;
    if (log.type === 'target_stream') displayType = 'Target Response';
    if (log.type === 'judge_stream') displayType = 'Judge Analysis';
    
    // Determine if this type should have a cursor
    const isStreamType = (log.type === 'target_stream' || log.type === 'judge_stream');
    
    if (div) {
        // Update existing log
        const contentEl = div.querySelector('.log-content');
        // Check for cursor
        const cursorHtml = isStreamType ? '<span class="cursor"></span>' : '';
        if (contentEl) contentEl.innerHTML = escapeHtml(log.content) + cursorHtml;
        
        // Update timestamp
        const timeEl = div.querySelector('.log-time');
        if (timeEl) timeEl.textContent = `[${new Date(log.timestamp).toLocaleTimeString()}]`;
        
    } else {
        // Create new log entry
        div = document.createElement('div');
        div.className = 'log-entry';
        div.setAttribute('data-log-id', log.id);

        const time = new Date(log.timestamp).toLocaleTimeString();
        const typeClass = `type-${log.type}`;

        let detailsHtml = '';
        if (log.details && Object.keys(log.details).length > 0) {
          detailsHtml = `<div class="json-block">${escapeHtml(JSON.stringify(log.details, null, 2))}</div>`;
        }

        const cursorHtml = isStreamType ? '<span class="cursor"></span>' : '';

        div.innerHTML = `
            <div class="log-meta">
                <span class="log-time">[${time}]</span>
                <span class="log-type ${typeClass}">${escapeHtml(displayType)}</span>
            </div>
            <div class="log-content">${escapeHtml(log.content)}${cursorHtml}</div>
            ${detailsHtml}
        `;

        terminalContent.appendChild(div);
    }
  });
  
  // Cleanup cursors
  const entries = terminalContent.querySelectorAll('.log-entry');
  entries.forEach((entry, index) => {
      // Remove cursor from all entries except possibly the last one
      if (index < entries.length - 1) {
          const cursor = entry.querySelector('.cursor');
          if (cursor) cursor.remove();
      }
      // If the last entry is NOT a stream type, remove cursor too
      if (index === entries.length - 1) {
           const typeLabel = entry.querySelector('.log-type').textContent;
           // We check the display name
           const isStream = (typeLabel === 'Target Response' || typeLabel === 'Judge Analysis');
           if (!isStream) {
               const cursor = entry.querySelector('.cursor');
               if (cursor) cursor.remove();
           }
      }
  });

  if (wasAtBottom) {
    terminalContent.scrollTop = terminalContent.scrollHeight;
  }
}

// --- Report Download Logic ---

function toggleDownloadDropdown() {
  const d = document.getElementById('downloadDropdown');
  if (d) {
    d.style.display = (d.style.display === 'none' || d.style.display === '') ? 'block' : 'none';
  }
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  const d = document.getElementById('downloadDropdown');
  const btn = document.querySelector('button[onclick="toggleDownloadDropdown()"]');
  // Check if click is outside dropdown and button
  if (d && d.style.display === 'block') {
    if (btn && btn.contains(e.target)) return; // Let the button handler work
    if (!d.contains(e.target)) {
      d.style.display = 'none';
    }
  }
});

window.downloadReport = function(format) {
  if (!currentReportData) {
    alert('Report data not loaded yet.');
    return;
  }
  
  const report = currentReportData;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `audit_report_${report.job_id || 'unknown'}_${timestamp}`;
  
  if (format === 'md') {
    const md = generateMarkdown(report);
    showReportPreview('Markdown Report', md, 'md');
  } else if (format === 'pdf') {
    generatePDFReport(report);
  }
};

function downloadMarkdownFile() {
  const content = currentMarkdownPreviewContent || document.getElementById('reportPreviewContent').textContent;
  const report = currentReportData;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `audit_report_${report.job_id || 'unknown'}_${timestamp}.md`;
  
  downloadFile(filename, content, 'text/markdown');
}

window.setMarkdownPreviewMode = function(mode) {
  const renderedView = document.getElementById('markdownRenderedView');
  const rawView = document.getElementById('markdownRawView');
  const renderedTab = document.getElementById('mdRenderedTab');
  const rawTab = document.getElementById('mdRawTab');

  if (!renderedView || !rawView || !renderedTab || !rawTab) return;

  currentMarkdownPreviewMode = mode === 'raw' ? 'raw' : 'rendered';
  const renderedActive = currentMarkdownPreviewMode === 'rendered';

  renderedView.style.display = renderedActive ? 'block' : 'none';
  rawView.style.display = renderedActive ? 'none' : 'block';

  renderedTab.style.background = renderedActive ? '#1f6feb' : '#e9ecef';
  renderedTab.style.color = renderedActive ? '#fff' : '#333';
  renderedTab.style.border = renderedActive ? 'none' : '1px solid #ced4da';

  rawTab.style.background = renderedActive ? '#e9ecef' : '#1f6feb';
  rawTab.style.color = renderedActive ? '#333' : '#fff';
  rawTab.style.border = renderedActive ? '1px solid #ced4da' : 'none';
};

function showReportPreview(title, content, type) {
  const modal = document.getElementById('reportPreviewModal');
  const titleEl = document.getElementById('previewTitle');
  const contentEl = document.getElementById('reportPreviewContent');
  const printBtn = document.getElementById('manualPrintBtn');
  const mdBtn = document.getElementById('downloadMDBtn');
  const tabsEl = document.getElementById('markdownPreviewTabs');

  if (!modal || !contentEl) return;

  titleEl.textContent = title;
  contentEl.style.whiteSpace = 'normal';
  contentEl.style.fontFamily = '"Times New Roman", serif';
  
  if (type === 'html') {
    currentMarkdownPreviewContent = '';
    contentEl.innerHTML = content;
    printBtn.style.display = 'inline-block';
    mdBtn.style.display = 'none';
    if (tabsEl) tabsEl.style.display = 'none';
  } else {
    currentMarkdownPreviewContent = content;
    contentEl.innerHTML = `
      <div id="markdownRenderedView">${renderMarkdown(content)}</div>
      <pre id="markdownRawView" class="markdown-preview-container" style="display:none;">${escapeHtml(content)}</pre>
    `;
    printBtn.style.display = 'none';
    mdBtn.style.display = 'inline-block';
    if (tabsEl) tabsEl.style.display = 'flex';
    window.setMarkdownPreviewMode('rendered');
  }

  modal.style.display = 'flex';
}

function closeReportPreview() {
  currentMarkdownPreviewContent = '';
  currentMarkdownPreviewMode = 'rendered';
  document.getElementById('reportPreviewModal').style.display = 'none';
}

function printPreview() {
  window.print();
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function htmlToPlainText(html) {
  const text = String(html || '');
  let parsed = text;
  parsed = parsed.replace(/<br\s*\/?>/gi, '\n');
  parsed = parsed.replace(/<p>/gi, '\n\n');
  parsed = parsed.replace(/<\/p>/gi, '');
  parsed = parsed.replace(/<[^>]+>/g, '');
  const txt = document.createElement('textarea');
  txt.innerHTML = parsed;
  return txt.value.trim();
}

// Generates a dedicated HTML structure for the PDF report
function generatePDFReport(report) {
  // Close dropdown if open
  const d = document.getElementById('downloadDropdown');
  if (d) d.style.display = 'none';

  // Show processing state
  document.body.style.cursor = 'wait';
  const btn = document.querySelector('button[onclick="toggleDownloadDropdown()"]');
  const originalText = btn ? btn.innerHTML : 'Download';
  if (btn) btn.textContent = 'Generating...';

  // 1. Capture Charts as Images
  // We use the LIVE charts from the dashboard to ensure they are fully rendered.
  // We temporarily switch them to "Light Mode" styles, capture, and then revert.
  const chartImages = {};
  const chartPromises = [];

  if (window._orwellCharts && window._orwellCharts.length > 0) {
      window._orwellCharts.forEach((chart, index) => {
          const p = new Promise((resolve) => {
              // 1. Save original state
              const originalAnimation = chart.options.animation;
              const originalColors = {};
              
              // Helper to save/restore colors
              if (chart.config.type === 'radar') {
                  if (chart.options.scales.r) {
                      originalColors.grid = chart.options.scales.r.grid.color;
                      originalColors.angle = chart.options.scales.r.angleLines.color;
                      originalColors.point = chart.options.scales.r.pointLabels.color;
                      originalColors.backdrop = chart.options.scales.r.ticks.backdropColor;
                      originalColors.font = JSON.parse(JSON.stringify(chart.options.scales.r.pointLabels.font || {}));
                  }
              } else if (chart.config.type === 'bar') {
                  originalColors.xTicks = chart.options.scales.x?.ticks?.color;
                  originalColors.yTicks = chart.options.scales.y?.ticks?.color;
                  originalColors.yGrid = chart.options.scales.y?.grid?.color;
              }
              if (chart.options.plugins?.legend) {
                  originalColors.legend = chart.options.plugins.legend.labels.color;
              }

              // 2. Apply Light Mode Styles
              const textColor = '#000000';
              const gridColor = '#666666';
              
              chart.options.animation = false; // Disable animation for instant repaint

              if (chart.config.type === 'radar') {
                  if (chart.options.scales.r) {
                      chart.options.scales.r.grid.color = gridColor;
                      chart.options.scales.r.angleLines.color = gridColor;
                      chart.options.scales.r.pointLabels.color = textColor;
                      chart.options.scales.r.pointLabels.font = { size: 14, weight: 'bold' };
                      chart.options.scales.r.ticks.backdropColor = 'rgba(255,255,255,0.5)';
                  }
              } else if (chart.config.type === 'bar') {
                  if (chart.options.scales.x) {
                      if (!chart.options.scales.x.ticks) chart.options.scales.x.ticks = {};
                      chart.options.scales.x.ticks.color = textColor;
                  }
                  if (chart.options.scales.y) {
                      if (!chart.options.scales.y.ticks) chart.options.scales.y.ticks = {};
                      if (!chart.options.scales.y.grid) chart.options.scales.y.grid = {};
                      chart.options.scales.y.ticks.color = textColor;
                      chart.options.scales.y.grid.color = gridColor;
                  }
              }
              if (chart.options.plugins?.legend) {
                  chart.options.plugins.legend.labels.color = textColor;
              }

              // 3. Update and Capture
              chart.update();

              // Give it a tick to paint
              setTimeout(() => {
                  try {
                      // Composite onto white background
                      const composite = document.createElement('canvas');
                      composite.width = chart.width;
                      composite.height = chart.height;
                      const ctx = composite.getContext('2d');
                      
                      // Fill white
                      ctx.fillStyle = '#FFFFFF';
                      ctx.fillRect(0, 0, composite.width, composite.height);
                      
                      // Draw chart
                      ctx.drawImage(chart.canvas, 0, 0);
                      
                      chartImages[index] = composite.toDataURL('image/png');
                  } catch (err) {
                      console.error('Chart capture failed:', err);
                  }

                  // 4. Revert Styles
                  chart.options.animation = originalAnimation;
                  
                  if (chart.config.type === 'radar') {
                      if (chart.options.scales.r) {
                          chart.options.scales.r.grid.color = originalColors.grid;
                          chart.options.scales.r.angleLines.color = originalColors.angle;
                          chart.options.scales.r.pointLabels.color = originalColors.point;
                          chart.options.scales.r.ticks.backdropColor = originalColors.backdrop;
                          chart.options.scales.r.pointLabels.font = originalColors.font;
                      }
                  } else if (chart.config.type === 'bar') {
                      if (chart.options.scales.x) chart.options.scales.x.ticks.color = originalColors.xTicks;
                      if (chart.options.scales.y) {
                          chart.options.scales.y.ticks.color = originalColors.yTicks;
                          chart.options.scales.y.grid.color = originalColors.yGrid;
                      }
                  }
                  if (chart.options.plugins?.legend) {
                      chart.options.plugins.legend.labels.color = originalColors.legend;
                  }
                  
                  chart.update(); // Restore dark mode
                  resolve();
              }, 300);
          });
          chartPromises.push(p);
      });
  }

  Promise.all(chartPromises).then(() => {
      // 2. Build HTML Structure
      const dateStr = new Date().toLocaleString();
      
      let html = `
        <div class="pdf-header">
            <div class="pdf-logo">ORWELL<span style="font-weight:300;font-size:0.8em;margin-left:8px;color:#666">AUDIT</span></div>
            <div class="pdf-meta">
                <strong>Report ID:</strong> ${escapeHtml(report.job_id)}<br>
                <strong>Date:</strong> ${dateStr}
            </div>
        </div>

        <div class="pdf-section">
            <div class="pdf-title">Audit Report</div>
            <div class="pdf-subtitle">
                Target: <strong>${escapeHtml(report.target_model || 'N/A')}</strong> | 
                Judge: <strong>${escapeHtml(report.judge_model || report.bench_name || 'N/A')}</strong>
            </div>
            
            <table class="pdf-table">
                <tr>
                    <th style="width:200px">Metric</th>
                    <th>Value</th>
                </tr>
                <tr>
                    <td>Overall Risk</td>
                    <td><strong style="color:${getRiskColor(report.overall_risk ? report.overall_risk.toLowerCase() : 'low')}">${escapeHtml(report.overall_risk ? report.overall_risk.toUpperCase() : 'N/A')}</strong></td>
                </tr>
                <tr>
                    <td>Mean Score</td>
                    <td>${report.mean_score || 'N/A'}</td>
                </tr>
                <tr>
                    <td>Total Prompts</td>
                    <td>${report.total_prompts}</td>
                </tr>
                <tr>
                    <td>Execution Time</td>
                    <td>${formatDuration(report.execution_time_seconds)}</td>
                </tr>
            </table>
        </div>
      `;

      const sections = (report.report_json && report.report_json.sections) ? report.report_json.sections : [];
      const contextSection = sections.find((s) => s.type === 'context_methodology');
      const dimensionSection = sections.find((s) => s.type === 'dimension_analysis');
      const scoreSection = sections.find((s) => s.type === 'score_distribution');
      const contextPrompt = contextSection?.system_prompt_card?.text || contextSection?.system_prompt_card?.note || window.currentSystemPrompt || report.system_prompt_snapshot || 'None (Base Model Behavior)';

      if (contextSection) {
        const jp = contextSection.judge_profile || {};
        const tp = contextSection.test_parameters || {};
        const judgeType = jp.type === 'bench' ? 'Bench' : 'Single Judge';
        const judgeMode = jp.type === 'bench' ? (jp.bench_mode || report.bench_mode || 'N/A') : 'single';
        const judgeModel = jp.type === 'bench'
          ? ((jp.models && jp.models.length > 0) ? jp.models.join(', ') : (jp.model || report.judge_model || 'N/A'))
          : (jp.model || report.judge_model || 'N/A');
        const judgeName = jp.type === 'bench' ? (jp.bench_name || report.bench_name || 'N/A') : (jp.model || report.judge_model || 'N/A');

        html += `
        <div class="pdf-section" style="page-break-inside:avoid">
            <h3 style="font-family:'Helvetica Neue',sans-serif;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:15px;font-size:16px;">${escapeHtml(contextSection.title || 'Context & Methodology')}</h3>
            <table class="pdf-table">
                <tr><th style="width:220px">Field</th><th>Value</th></tr>
                <tr><td>Judge Type</td><td>${escapeHtml(judgeType)}</td></tr>
                <tr><td>Judge Name</td><td>${escapeHtml(judgeName)}</td></tr>
                <tr><td>Judge Mode</td><td>${escapeHtml(String(judgeMode).toUpperCase())}</td></tr>
                <tr><td>Judge Model(s)</td><td>${escapeHtml(judgeModel)}</td></tr>
                <tr><td>Sample Size</td><td>${tp.sample_size || report.total_prompts || 0}</td></tr>
                <tr><td>Temperature</td><td>${tp.temperature !== undefined ? tp.temperature : 'N/A'}</td></tr>
                <tr><td>Language</td><td>${escapeHtml(String(tp.language || report.language || 'EN').toUpperCase())}</td></tr>
            </table>
            <div style="margin-top:12px;">
                <div style="font-size:12px;text-transform:uppercase;color:#666;margin-bottom:8px;font-weight:700">System Prompt</div>
                <div style="font-family:monospace;font-size:11px;background:#f9f9f9;padding:10px;border:1px solid #eee;white-space:pre-wrap;color:#111;line-height:1.5;max-height:260px;overflow:auto;">
                    ${escapeHtml(contextPrompt)}
                </div>
            </div>
            ${contextSection.explanation ? `<div style="margin-top:12px;font-size:12px;color:#333;line-height:1.6;background:#f0f7ff;padding:12px;border-left:3px solid #0066cc"><strong>AI Context:</strong> ${escapeHtml(contextSection.explanation)}</div>` : ''}
        </div>
        `;
      }

      if (dimensionSection || chartImages[0]) {
          let dimensionRows = '';
          if (dimensionSection && dimensionSection.stats) {
              Object.entries(dimensionSection.stats).forEach(([dim, data]) => {
                  const risk = String(data.risk_level || '').toLowerCase();
                  const riskColor = getRiskColor(risk);
                  dimensionRows += `<tr>
                      <td>${escapeHtml(dim)}</td>
                      <td>${data.mean_score ?? 'N/A'}</td>
                      <td>${data.median_score ?? 'N/A'}</td>
                      <td>${data.std_dev ?? 'N/A'}</td>
                      <td>${data.failures ?? 0}/${data.sample_size ?? 0}</td>
                      <td><strong style="color:${riskColor}">${escapeHtml(String(data.risk_level || 'N/A').toUpperCase())}</strong></td>
                  </tr>`;
              });
          }

          html += `
            <div class="pdf-section" style="page-break-inside:avoid">
                <h3 style="font-family:'Helvetica Neue',sans-serif;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:15px;font-size:16px;">${escapeHtml(dimensionSection?.title || 'Dimension Analysis')}</h3>
                ${chartImages[0] ? `<div class="pdf-chart-container"><img src="${chartImages[0]}" class="pdf-chart-img" style="max-height:350px"></div>` : ''}
                ${dimensionRows ? `<table class="pdf-table"><tr><th>Dimension</th><th>Mean</th><th>Median</th><th>Std Dev</th><th>Failures</th><th>Risk</th></tr>${dimensionRows}</table>` : ''}
                ${dimensionSection?.explanation ? `<div style="margin-top:12px;font-size:12px;color:#333;line-height:1.6;background:#f0f7ff;padding:12px;border-left:3px solid #0066cc"><strong>AI Context:</strong> ${escapeHtml(dimensionSection.explanation)}</div>` : ''}
            </div>
          `;
      }

      if (scoreSection || chartImages[1]) {
          const histLabels = scoreSection?.histogram?.labels || ['1', '2', '3', '4', '5', '6', '7'];
          const histData = scoreSection?.histogram?.datasets?.[0]?.data || [];
          let totalResponses = 0;
          let weightedSum = 0;
          const scoreRows = [];
          for (let i = histLabels.length - 1; i >= 0; i--) {
              const label = String(histLabels[i] || i + 1);
              const score = Number(label.replace(/[^\d.-]/g, '')) || (i + 1);
              const count = Number(histData[i] || 0);
              totalResponses += count;
              weightedSum += score * count;
              scoreRows.push({ score: label, count });
          }
          const meanScore = totalResponses > 0 ? (weightedSum / totalResponses).toFixed(2) : '0.00';
          const rowsHtml = scoreRows.map((r) => {
              const pct = totalResponses > 0 ? ((r.count / totalResponses) * 100).toFixed(1) : '0.0';
              return `<tr><td>Score ${escapeHtml(r.score)}</td><td>${r.count}</td><td>${pct}%</td></tr>`;
          }).join('');

          html += `
            <div class="pdf-section" style="page-break-inside:avoid">
                <h3 style="font-family:'Helvetica Neue',sans-serif;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:15px;font-size:16px;">${escapeHtml(scoreSection?.title || 'Score Distribution')}</h3>
                ${chartImages[1] ? `<div class="pdf-chart-container"><img src="${chartImages[1]}" class="pdf-chart-img" style="max-height:350px"></div>` : ''}
                <table class="pdf-table">
                    <tr><th style="width:220px">Summary Metric</th><th>Value</th></tr>
                    <tr><td>Total Responses</td><td>${totalResponses}</td></tr>
                    <tr><td>Mean Score</td><td>${meanScore}</td></tr>
                </table>
                ${rowsHtml ? `<table class="pdf-table"><tr><th>Score</th><th>Count</th><th>Percentage</th></tr>${rowsHtml}</table>` : ''}
                ${scoreSection?.explanation ? `<div style="margin-top:12px;font-size:12px;color:#333;line-height:1.6;background:#f0f7ff;padding:12px;border-left:3px solid #0066cc"><strong>AI Context:</strong> ${escapeHtml(scoreSection.explanation)}</div>` : ''}
            </div>
          `;
      }

      if (sections.length > 0) {
          sections.forEach((section) => {
             if (section.type === 'context_methodology' || section.type === 'dimension_analysis' || section.type === 'score_distribution') return;

             if (section.type === 'bench_agreement') {
                const matrix = section.matrix || {};
                const rows = Object.entries(matrix).map(([dim, data]) => {
                    const means = Object.entries(data.judge_means || {}).map(([j, s]) => `${j}: ${s}`).join(' | ');
                    const level = String(data.agreement_level || '').toLowerCase();
                    return `<tr>
                        <td>${escapeHtml(dim)}</td>
                        <td>${escapeHtml(means)}</td>
                        <td>${data.variance ?? 'N/A'}</td>
                        <td><strong style="color:${getRiskColor(level)}">${escapeHtml(String(data.agreement_level || 'N/A').toUpperCase())}</strong></td>
                    </tr>`;
                }).join('');
                if (rows) {
                    html += `<div class="pdf-section">
                        <h3 style="font-family:'Helvetica Neue',sans-serif;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:15px;font-size:16px;">${escapeHtml(section.title || 'Judge Agreement Matrix')}</h3>
                        <table class="pdf-table"><tr><th>Dimension</th><th>Judge Means</th><th>Variance</th><th>Agreement</th></tr>${rows}</table>
                        ${section.explanation ? `<div style="margin-top:12px;font-size:12px;color:#333;line-height:1.6;background:#f0f7ff;padding:12px;border-left:3px solid #0066cc"><strong>AI Context:</strong> ${escapeHtml(section.explanation)}</div>` : ''}
                    </div>`;
                }
                return;
             }

             if (section.type === 'failure_analysis') {
                const tableRows = section.table?.rows || [];
                const rows = tableRows.map((row) => `<tr>
                    <td>${escapeHtml(row.dimension || '')}</td>
                    <td>${escapeHtml(row.prompt || '')}</td>
                    <td>${escapeHtml(row.response || '')}</td>
                    <td>${row.score ?? ''}</td>
                </tr>`).join('');
                html += `<div class="pdf-section">
                    <h3 style="font-family:'Helvetica Neue',sans-serif;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:15px;font-size:16px;">${escapeHtml(section.title || 'Flagged Responses')}</h3>
                    ${rows ? `<table class="pdf-table"><tr><th>Dimension</th><th>Prompt</th><th>Response</th><th>Score</th></tr>${rows}</table>` : `<div class="pdf-content-text">No flagged responses were detected.</div>`}
                </div>`;
                return;
             }

             if (!section.content || section.content.trim() === '') return;

             html += `<div class="pdf-section">
                <h3 style="font-family:'Helvetica Neue',sans-serif;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:15px;font-size:16px;">${escapeHtml(section.title)}</h3>
                <div class="pdf-content-text">${renderMarkdown(section.content || '')}</div>
             </div>`;
          });
      }

      html += `
        <div class="pdf-section">
            <h3 style="font-family:'Helvetica Neue',sans-serif;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:15px;font-size:16px;">System Prompt Snapshot</h3>
            <div style="font-family:monospace;font-size:11px;background:#f9f9f9;padding:10px;border:1px solid #eee;white-space:pre-wrap;color:#111;line-height:1.5;">${escapeHtml(contextPrompt)}</div>
        </div>
      `;

      // Add Footer
      html += `
        <div class="pdf-footer">
            CONFIDENTIAL - ASM Labs
        </div>
      `;

      // Show Preview Modal
      showReportPreview('PDF Report Preview', html, 'html');
      
      document.body.style.cursor = 'default';
      if (btn) btn.innerHTML = originalText;
  });
}

function generateMarkdown(report) {
  let md = `# ASM Labs Audit Report\n\n`;
  md += `**Date:** ${new Date().toLocaleString()}\n`;
  md += `**Report ID:** ${report.job_id}\n`;
  md += `**Target Model:** ${report.target_model || 'N/A'}\n`;
  md += `**Judge:** ${report.judge_model || report.bench_name || 'N/A'}\n`;
  md += `**Overall Risk:** ${report.overall_risk ? report.overall_risk.toUpperCase() : 'N/A'}\n`;
  md += `**Total Prompts:** ${report.total_prompts}\n`;
  md += `**Execution Time:** ${formatDuration(report.execution_time_seconds)}\n`;
  md += `\n---\n\n`;

  const sections = (report.report_json && report.report_json.sections) ? report.report_json.sections : [];
  let systemPromptSnapshot = window.currentSystemPrompt || report.system_prompt_snapshot || 'None (Base Model Behavior)';

  for (const section of sections) {
    md += `## ${section.title}\n\n`;

    if (section.status) {
      md += `**Status:** ${section.status.toUpperCase()}\n\n`;
    }

    if (section.type === 'context_methodology') {
      const sp = section.system_prompt_card || {};
      const jp = section.judge_profile || {};
      const tp = section.test_parameters || {};
      const judgeType = jp.type === 'bench' ? 'Bench' : 'Single Judge';
      const judgeName = jp.type === 'bench' ? (jp.bench_name || report.bench_name || 'N/A') : (jp.model || report.judge_model || 'N/A');
      const judgeMode = jp.type === 'bench' ? (jp.bench_mode || report.bench_mode || 'N/A') : 'single';
      const judgeModels = jp.type === 'bench'
        ? ((jp.models && jp.models.length > 0) ? jp.models.join(', ') : (jp.model || report.judge_model || 'N/A'))
        : (jp.model || report.judge_model || 'N/A');
      const promptText = sp.text || sp.note || systemPromptSnapshot;
      systemPromptSnapshot = promptText;

      md += `| Field | Value |\n|---|---|\n`;
      md += `| Judge Type | ${judgeType} |\n`;
      md += `| Judge Name | ${judgeName} |\n`;
      md += `| Judge Mode | ${String(judgeMode).toUpperCase()} |\n`;
      md += `| Judge Model(s) | ${judgeModels} |\n`;
      md += `| Sample Size | ${tp.sample_size ?? report.total_prompts ?? 'N/A'} |\n`;
      md += `| Temperature | ${tp.temperature ?? 'N/A'} |\n`;
      md += `| Language | ${String(tp.language || report.language || 'EN').toUpperCase()} |\n\n`;
      md += `### System Prompt\n\n`;
      md += '```\n';
      md += `${promptText}\n`;
      md += '```\n\n';
      if (section.explanation) {
        md += `### AI Context\n\n${section.explanation}\n\n`;
      }
      continue;
    }

    if (section.content) {
      const text = htmlToPlainText(section.content);
      if (text) md += `${text}\n\n`;
    }

    if (section.type === 'dimension_analysis') {
      const stats = section.stats || {};
      md += `### Dimension Statistics\n\n`;
      md += `| Dimension | Mean | Median | Std Dev | Failures | Risk |\n|---|---:|---:|---:|---:|---|\n`;
      Object.entries(stats).forEach(([dim, data]) => {
        md += `| ${dim} | ${data.mean_score ?? 'N/A'} | ${data.median_score ?? 'N/A'} | ${data.std_dev ?? 'N/A'} | ${data.failures ?? 0}/${data.sample_size ?? 0} | ${(data.risk_level || 'N/A').toUpperCase()} |\n`;
      });
      md += `\n`;
      if (section.explanation) {
        md += `### AI Context\n\n${section.explanation}\n\n`;
      }
      continue;
    }

    if (section.type === 'score_distribution' && section.histogram) {
      const labels = section.histogram.labels || ['1', '2', '3', '4', '5', '6', '7'];
      const data = section.histogram.datasets?.[0]?.data || [];
      let total = 0;
      let weighted = 0;
      labels.forEach((label, i) => {
        const score = Number(String(label).replace(/[^\d.-]/g, '')) || (i + 1);
        const count = Number(data[i] || 0);
        total += count;
        weighted += score * count;
      });
      const mean = total > 0 ? (weighted / total).toFixed(2) : '0.00';
      md += `### Distribution Summary\n\n`;
      md += `| Metric | Value |\n|---|---:|\n`;
      md += `| Total Responses | ${total} |\n`;
      md += `| Mean Score | ${mean} |\n\n`;
      md += `### Score Breakdown\n\n`;
      md += `| Score | Count | Percentage |\n|---|---:|---:|\n`;
      for (let i = labels.length - 1; i >= 0; i--) {
        const label = labels[i];
        const count = Number(data[i] || 0);
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
        md += `| Score ${label} | ${count} | ${pct}% |\n`;
      }
      md += `\n`;
      if (section.explanation) {
        md += `### AI Context\n\n${section.explanation}\n\n`;
      }
      continue;
    }

    if (section.type === 'bench_agreement') {
      const matrix = section.matrix || {};
      md += `| Dimension | Judge Means | Variance | Agreement |\n|---|---|---:|---|\n`;
      Object.entries(matrix).forEach(([dim, data]) => {
        const means = Object.entries(data.judge_means || {}).map(([j, s]) => `${j}: ${s}`).join(' | ');
        md += `| ${dim} | ${means} | ${data.variance ?? 'N/A'} | ${(data.agreement_level || 'N/A').toUpperCase()} |\n`;
      });
      md += `\n`;
      if (section.explanation) {
        md += `### AI Context\n\n${section.explanation}\n\n`;
      }
      continue;
    }

    if (section.type === 'failure_analysis') {
      const rows = section.table?.rows || [];
      if (rows.length > 0) {
        md += `| Dimension | Prompt | Response | Score |\n|---|---|---|---:|\n`;
        rows.forEach((row) => {
          const prompt = String(row.prompt || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
          const response = String(row.response || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
          md += `| ${row.dimension || ''} | ${prompt} | ${response} | ${row.score ?? ''} |\n`;
        });
        md += `\n`;
      } else {
        md += `No flagged responses were detected.\n\n`;
      }
      continue;
    }
  }

  md += `## System Prompt Snapshot\n\n`;
  md += '```\n';
  md += `${systemPromptSnapshot}\n`;
  md += '```\n\n';
  md += `\n---\n*Generated by Orwell - ASM Labs*`;
  return md;
}
