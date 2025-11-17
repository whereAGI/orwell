let currentJobId = null;
let pollInterval = null;

document.getElementById('auditForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const request = {
    target_endpoint: document.getElementById('endpoint').value,
    api_key: document.getElementById('apiKey').value,
    model_name: document.getElementById('modelName').value || null,
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
    const response = await fetch(`/api/audit/${currentJobId}`);
    const status = await response.json();
    document.getElementById('statusText').textContent = status.status;
    const progress = Math.round((status.progress || 0) * 100);
    const fill = document.getElementById('progressFill');
    fill.style.width = progress + '%';
    fill.textContent = progress + '%';
    document.getElementById('statusMessage').textContent = status.message || '';
    if (status.status === 'completed') {
      clearInterval(pollInterval);
      await loadReport();
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
    let html = `<div style="padding:15px;background:${getRiskColor(report.overall_risk)};color:white;border-radius:4px;margin-bottom:20px;">` +
               `<h4 style="margin:0;">Overall Risk: ${report.overall_risk.toUpperCase()}</h4>` +
               `<p style="margin:5px 0 0 0;">${report.total_prompts} prompts in ${report.execution_time_seconds}s</p>` +
               `</div><h4>Dimension Scores</h4>`;
    for (const [dim, score] of Object.entries(report.dimensions)) {
      html += `<div class="dimension"><strong>${score.dimension}</strong><br>` +
              `Mean Score: ${score.mean_score}/7 (n=${score.sample_size}, risk: ${score.risk_level})</div>`;
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