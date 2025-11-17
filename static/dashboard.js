let currentJobId = null;
let pollInterval = null;

document.getElementById('startBtn').addEventListener('click', async () => {
  const endpoint = document.getElementById('endpoint').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelName = document.getElementById('modelName').value.trim();
  const request = {
    target_endpoint: endpoint || null,
    api_key: apiKey || "",
    model_name: modelName || null,
    sample_size: parseInt(document.getElementById('sampleSize').value),
    language: document.getElementById('language').value,
    judge_model: 'gpt-4o'
  };
  try {
    const response = await fetch('/api/audit/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    const result = await response.json();
    currentJobId = result.job_id;
    document.getElementById('status').style.display = 'block';
    document.getElementById('report').style.display = 'none';
    pollStatus();
    pollInterval = setInterval(pollStatus, 2000);
  } catch (err) {
    alert('Error creating audit: ' + err);
  }
});

async function pollStatus() {
  if (!currentJobId) return;
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
      await loadPromptsAndResponses();
      await loadCriteria();
      await loadReport();
      if (details && details.error_message) {
        document.getElementById('statusMessage').textContent = details.error_message;
      }
    } else if (status.status === 'failed') {
      clearInterval(pollInterval);
      alert('Audit failed: ' + status.message);
    }
  } catch (err) {
    console.error('Error polling status:', err);
  }
}

async function loadReport() {
  try {
    const response = await fetch(`/api/audit/${currentJobId}/report`);
    const report = await response.json();
    let html = `<div style="padding:15px;background:${getRiskColor(report.overall_risk)};color:white;border-radius:4px;margin-bottom:12px;">` +
               `<h4 style="margin:0;">Overall Risk: ${report.overall_risk.toUpperCase()}</h4>` +
               `<p style="margin:5px 0 0 0;">${report.total_prompts} prompts in ${report.execution_time_seconds}s</p>` +
               `</div>`;
    html += `<div class="mono" style="color:#a0a0b8;margin-bottom:12px;">Target Model: ${report.target_model || '-'} • Judge Model: ${report.judge_model || '-'} • Endpoint: ${report.target_endpoint || '-'}</div>`;
    html += `<h4>Dimension Scores</h4>`;
    for (const [dim, score] of Object.entries(report.dimensions)) {
      html += `<div class="dimension"><strong>${score.dimension}</strong><br>` +
              `Mean Score: ${score.mean_score}/7 (n=${score.sample_size}, risk: ${score.risk_level})</div>`;
    }
    if (report.final_analysis) {
      html += `<h4 style="margin-top:16px">Final Analysis</h4>`;
      html += `<div class="reason">${formatResponse(report.final_analysis)}</div>`;
    }
    document.getElementById('reportContent').innerHTML = html;
    document.getElementById('report').style.display = 'block';
  } catch (err) {
    console.error('Error loading report:', err);
  }
}

function getRiskColor(risk) {
  const colors = { low: '#28a745', medium: '#ffc107', high: '#dc3545' };
  return colors[risk] || '#6c757d';
}

async function loadPromptsAndResponses() {
  try {
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
    for (const [pid, item] of byPrompt.entries()) {
      const p = item.prompt;
      const r = item.response;
      accHtml += `
        <div class="qa-item">
          <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="toggleAcc('${pid}')">
            <div><strong>${p.dimension}</strong> • <span class="mono" style="color:#a0a0b8">${pid.slice(0,8)}</span></div>
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

async function loadCriteria() {
  try {
    const cRes = await fetch('/api/criteria');
    const c = await cRes.json();
    let html = `<div class="dimension"><strong>Scale</strong><br>${c.scale}</div>`;
    html += `<div class="dimension"><strong>Risk Buckets</strong><br>low: ${c.risk_buckets.low}<br>medium: ${c.risk_buckets.medium}<br>high: ${c.risk_buckets.high}</div>`;
    html += `<div class="dimension"><strong>Dimensions</strong><br>${(c.dimensions||[]).join(', ')}</div>`;
    html += `<div class="dimension"><strong>Notes</strong><br>${c.notes}</div>`;
    document.getElementById('criteria').innerHTML = html;
  } catch (err) {
    console.error('Error loading criteria:', err);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function formatResponse(text) {
  const t = escapeHtml(text || '')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return `<div style="white-space:normal;line-height:1.5">${t}</div>`;
}

window.toggleAcc = function(id) {
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
            <div class="mono" style="color:#a0a0b8">${a.job_id.slice(0,8)} • ${a.status}</div>
          </div>
          <div class="pill">${Math.round((a.progress||0)*100)}%</div>
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
  if (!confirm('Delete ' + ids.length + ' audits? This cannot be undone.')) return;
  try {
    const url = '/api/audits?' + ids.map(id => 'job_ids=' + encodeURIComponent(id)).join('&');
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    await loadAuditList();
    document.getElementById('qaAccordion').innerHTML = '';
    document.getElementById('report').style.display = 'none';
    document.getElementById('status').style.display = 'none';
  } catch (err) {
    alert('Delete failed: ' + err);
  }
});

loadAuditList();