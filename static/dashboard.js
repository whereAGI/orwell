let currentJobId = null;
let pollInterval = null;
let selectedDimensions = [];
let systemPromptsMap = {};

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
    pollStatus();
    pollInterval = setInterval(pollStatus, 2000);
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

async function pollStatus() {
  if (!currentJobId) return;

  // Poll logs concurrently
  pollLogs();

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
      const startBtn = document.getElementById('startBtn');
      if (startBtn) {
        startBtn.textContent = 'Start Audit';
        startBtn.style.background = 'var(--primary)';
        startBtn.style.borderColor = 'var(--primary)';
      }
      await loadPromptsAndResponses();
      await loadCriteria();
      await loadReport();
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
      alert('Audit failed: ' + status.message);
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

  return `
    <div style="border-left:4px solid ${statusColor};padding:16px;background:#0f1018;border-radius:0 8px 8px 0;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="background:${statusColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${statusLabel}</span>
        <h4 style="margin:0;">${escapeHtml(section.title)}</h4>
      </div>
      <div class="reason">${renderMarkdown(section.content)}</div>
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
  return `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 12px;">${escapeHtml(section.title)}</h4>
      <div class="reason">${renderMarkdown(section.content)}</div>
    </div>`;
}

function renderRecommendations(section) {
  return `
    <div style="margin-bottom:16px;border-left:4px solid var(--primary);padding:16px;background:#0f1018;border-radius:0 8px 8px 0;">
      <h4 style="margin:0 0 12px;">${escapeHtml(section.title)}</h4>
      <div class="reason">${renderMarkdown(section.content)}</div>
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
            padding: 20
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
      const histData = histSection.histogram.datasets[0].data;
      const barColors = histData.map((_, i) => {
        const score = i + 1;
        if (score <= 2) return 'rgba(220, 53, 69, 0.7)';
        if (score <= 3) return 'rgba(255, 193, 7, 0.7)';
        return 'rgba(40, 167, 69, 0.7)';
      });

      const histChart = new Chart(histCanvas, {
        type: 'bar',
        data: {
          labels: histSection.histogram.labels.map(l => `Score ${l}`),
          datasets: [{
            label: 'Response Count',
            data: histData,
            backgroundColor: barColors,
            borderColor: barColors.map(c => c.replace('0.7', '1')),
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
            <div style="margin-top:10px"><span class="label">Response</span><div style="margin-top:6px">${r ? formatResponse(r.raw_response) : '<em>No response</em>'}</div></div>
            ${r && r.reason ? `<div style="margin-top:10px"><span class="label">Judge Reason</span><div class="reason" style="margin-top:6px">${escapeHtml(r.reason)}</div></div>` : ''}
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
  try {
    const res = await fetch('/api/audits');
    const audits = await res.json();
    const list = audits.map(a => `
      <div class="audit-item" data-job="${a.job_id}" data-selected="0">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:600;">${a.target_model}</div>
            <div class="mono" style="color:#a0a0b8">${a.job_id.slice(0, 8)} • ${a.status}</div>
          </div>
          <div class="pill">${Math.round((a.progress || 0) * 100)}%</div>
        </div>
      </div>`).join('');
    const container = document.getElementById('auditList');
    container.innerHTML = list || '<em>No audits yet</em>';
    container.querySelectorAll('.audit-item').forEach(item => {
      item.addEventListener('click', async (event) => {
        if (event.shiftKey) {
          const sel = item.getAttribute('data-selected') === '1';
          item.setAttribute('data-selected', sel ? '0' : '1');
          item.style.borderColor = sel ? 'var(--border)' : '#ef4444';
          return;
        }
        currentJobId = item.getAttribute('data-job');
        document.getElementById('jobIdText').textContent = currentJobId;
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.style.display = 'block';
        await loadPromptsAndResponses();
        await loadCriteria();
        await loadReport();
      });
    });

    // Auto-select first audit if none selected (e.g. on page load)
    if (!currentJobId && audits.length > 0) {
      const first = container.querySelector('.audit-item');
      if (first) first.click();
    }
  } catch (err) {
    console.error('Error loading audits:', err);
  }
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

async function pollLogs() {
  if (!currentJobId) return;

  try {
    const res = await fetch(`/api/audit/${currentJobId}/logs`);
    if (!res.ok) return;

    const logs = await res.json();
    if (logs.length === 0) return;

    // Filter new logs
    const newLogs = lastLogTimestamp
      ? logs.filter(l => l.timestamp > lastLogTimestamp)
      : logs;

    if (newLogs.length > 0) {
      lastLogTimestamp = newLogs[newLogs.length - 1].timestamp;
      renderLogs(newLogs);
      if (logStatus) logStatus.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
    }
  } catch (e) {
    console.error("Log poll failed", e);
  }
}

function renderLogs(logs) {
  if (!terminalContent) return;

  // Check if we should scroll (if near bottom)
  const wasAtBottom = terminalContent.scrollTop + terminalContent.clientHeight >= terminalContent.scrollHeight - 50;

  logs.forEach(log => {
    const div = document.createElement('div');
    div.className = 'log-entry';

    const time = new Date(log.timestamp).toLocaleTimeString();
    const typeClass = `type-${log.type}`;

    let detailsHtml = '';
    if (log.details && Object.keys(log.details).length > 0) {
      detailsHtml = `<div class="json-block">${escapeHtml(JSON.stringify(log.details, null, 2))}</div>`;
    }

    div.innerHTML = `
            <div class="log-meta">
                <span class="log-time">[${time}]</span>
                <span class="log-type ${typeClass}">${log.type}</span>
            </div>
            <div class="log-content">${escapeHtml(log.content)}</div>
            ${detailsHtml}
        `;

    terminalContent.appendChild(div);
  });

  if (wasAtBottom) {
    terminalContent.scrollTop = terminalContent.scrollHeight;
  }
}
