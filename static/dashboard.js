let currentJobId = null;
let pollInterval = null;
let selectedDimensions = [];
let systemPromptsMap = {};

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
    const report = await response.json();
    let html = `<div style="padding:15px;background:${getRiskColor(report.overall_risk)};color:white;border-radius:4px;margin-bottom:12px;">` +
      `<h4 style="margin:0;">Overall Risk: ${report.overall_risk.toUpperCase()}</h4>` +
      `<p style="margin:5px 0 0 0;">${report.total_prompts} prompts in ${report.execution_time_seconds}s</p>` +
      `</div>`;
    // Show bench info in report if applicable
    let judgeLabel = report.judge_model || '-';
    if (report.bench_name) {
      judgeLabel = `⚖ Bench: ${report.bench_name} (${report.bench_mode} mode)`;
    }
    html += `<div class="mono" style="color:#a0a0b8;margin-bottom:12px;">Target Model: ${report.target_model || '-'} • Judge: ${judgeLabel} • Endpoint: ${report.target_endpoint || '-'}</div>`;
    html += `<h4>Dimension Scores</h4>`;
    for (const [dim, score] of Object.entries(report.dimensions)) {
      html += `<div class="dimension"><strong>${score.dimension}</strong><br>` +
        `Mean Score: ${score.mean_score}/7 (n=${score.sample_size}, risk: ${score.risk_level})</div>`;
    }
    if (report.final_analysis) {
      html += `<h4 style="margin-top:16px">Final Analysis</h4>`;
      html += `<div class="reason">${renderMarkdown(report.final_analysis)}</div>`;
    }
    if ((report.total_prompts || 0) === 0 && /aborted/i.test(report.final_analysis || '')) {
      html = `<div class="reason">${renderMarkdown(report.final_analysis)}</div>`;
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
    const jobRes = await fetch(`/api/audit/${currentJobId}`);
    const job = await jobRes.json();
    const systemPrompt = job.system_prompt_snapshot || null;

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
  s = s.replace(/\r\n/g, '\n');
  s = escapeHtml(s);

  // Format headers (ensure they don't have too much spacing)
  s = s.replace(/^######\s+(.*)$/gm, '<h6 style="margin:12px 0 8px;font-size:13px">$1</h6>');
  s = s.replace(/^#####\s+(.*)$/gm, '<h5 style="margin:14px 0 8px;font-size:14px">$1</h5>');
  s = s.replace(/^####\s+(.*)$/gm, '<h4 style="margin:16px 0 8px;font-size:15px">$1</h4>');
  s = s.replace(/^###\s+(.*)$/gm, '<h3 style="margin:18px 0 10px;font-size:16px">$1</h3>');
  s = s.replace(/^##\s+(.*)$/gm, '<h2 style="margin:20px 0 12px;font-size:18px">$1</h2>');
  s = s.replace(/^#\s+(.*)$/gm, '<h1 style="margin:24px 0 16px;font-size:20px">$1</h1>');

  // Code blocks
  s = s.replace(/```([\s\S]*?)```/g, function (_, code) {
    return `<pre style="background:#1a1a20;padding:12px;border-radius:6px;overflow-x:auto"><code>${code}</code></pre>`;
  });

  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code style="background:#1a1a20;padding:2px 4px;border-radius:4px;font-family:monospace">$1</code>');

  // Bold/Italic
  s = s.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff">$1</strong>');
  s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--primary)">$1<\/a>');

  // Blockquotes
  s = s.replace(/^>\s+(.*)$/gm, '<blockquote style="border-left:3px solid var(--border);margin:0;padding-left:12px;color:var(--muted)">$1</blockquote>');

  // Lists (Improved regex to handle multiline lists better)
  // We'll do a simple pass for lists to avoid complex nested logic for now
  // Convert bullet points
  s = s.replace(/^\s*-\s+(.*)$/gm, '<li>$1</li>');
  // Wrap consecutive lis in ul (simple heuristic)
  s = s.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Convert numbered lists
  s = s.replace(/^\s*\d+\.\s+(.*)$/gm, '<li value="1">$1</li>'); // Value 1 is dummy, browser handles order if ol
  // Wrap consecutive numbered lis (that we just made) in ol
  // Note: This regex might overlap with ul if not careful, but usually they are distinct blocks.
  // Actually, let's keep the original approach but refined

  // Clean up newlines: Double newlines -> paragraph breaks
  s = s.replace(/\n\n/g, '<div style="height:12px"></div>');
  s = s.replace(/\n/g, '<br>');

  return `<div style="white-space:normal;line-height:1.6;font-size:14px;color:#d1d5db">${s}</div>`;
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

// Model Studio Integration
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
