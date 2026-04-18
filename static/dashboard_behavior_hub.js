// Behavioral Intelligence Hub — loads cross-model behavior profiles
// Called on page load and after audit completion

let behaviorHubLastUpdated = null;

const DECISION_TYPES = ['ASSERT', 'HEDGE', 'BALANCE', 'PIVOT', 'QUALIFY', 'REFUSE'];

const DECISION_COLORS = {
  ASSERT:  '#60a5fa',   // blue — confident, direct
  HEDGE:   '#facc15',   // yellow — cautious, qualified
  BALANCE: '#34d399',   // green — neutral, even-handed
  PIVOT:   '#f472b6',   // pink — deflecting, reframing
  QUALIFY: '#a78bfa',   // purple — wrapped in caveats
  REFUSE:  '#f87171',   // red — declining
};

async function loadBehaviorHub() {
  const container = document.getElementById('behaviorHubContent');
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:32px;color:var(--muted);">
      <div style="text-align:center;">
        <div style="font-size:13px;margin-bottom:4px;">Loading behavior profiles...</div>
        <div style="font-size:11px;opacity:0.6;">Querying dbt mart</div>
      </div>
    </div>`;

  try {
    const res = await fetch('/api/behavior-profile');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    behaviorHubLastUpdated = new Date();
    renderBehaviorHub(container, data.models || []);
  } catch (err) {
    container.innerHTML = `
      <div style="padding:20px;color:var(--danger);font-size:13px;">
        Failed to load behavior profiles: ${escapeHtml(err.message)}
      </div>`;
  }
}

function renderBehaviorHub(container, models) {
  if (!models || models.length === 0) {
    container.innerHTML = `
      <div style="padding:24px 16px;text-align:center;">
        <div style="font-size:32px;margin-bottom:8px;opacity:0.4;">📊</div>
        <h4 style="margin:0 0 8px;font-size:15px;color:var(--text);">No Behavior Data Yet</h4>
        <p style="margin:0;font-size:13px;color:var(--muted);line-height:1.5;">
          Complete audits on your models to build behavior profiles.
          Decision strategy data will appear here once audits finish.
        </p>
      </div>`;
    return;
  }

  // ── Heatmap ──────────────────────────────────────────────────────────────
  const heatmapRows = models.map(m => {
    const cells = DECISION_TYPES.map(dt => {
      const rate = m[dt.toLowerCase() + '_rate'];
      const opacity = (rate && rate > 0) ? Math.min(rate, 1) : 0;
      const color = DECISION_COLORS[dt];
      const tooltip = `${dt}: ${rate != null ? (rate * 100).toFixed(1) + '%' : 'N/A'}`;
      return `
        <div style="
          width:64px;min-width:64px;height:40px;display:flex;align-items:center;justify-content:center;
          background:rgba(${hexToRgb(color)},${opacity.toFixed(2)});
          border:1px solid rgba(${hexToRgb(color)},0.3);border-radius:4px;
          font-size:11px;font-weight:600;color:${opacity > 0.4 ? '#fff' : color};
          cursor:default;" title="${tooltip}">
          ${rate != null ? (rate * 100).toFixed(0) + '%' : '—'}
        </div>`;
    });
    return { model: m, cells };
  });

  // ── Summary cards ─────────────────────────────────────────────────────────
  const summaryCards = models.map(m => {
    const dominantColor = DECISION_COLORS[m.dominant_decision] || '#6c757d';
    return `
      <div style="
        background:#0e0e14;border:1px solid var(--border);border-radius:8px;
        padding:14px;display:flex;flex-direction:column;gap:8px;flex:1;min-width:160px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="font-weight:600;font-size:14px;color:var(--text);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(m.model_name)}">
            ${escapeHtml(m.model_name)}
          </div>
          <div style="
            width:10px;height:10px;border-radius:50%;
            background:${dominantColor};
            box-shadow:0 0 6px ${dominantColor}80;
            flex-shrink:0;" title="Dominant: ${m.dominant_decision}"></div>
        </div>
        <div style="display:flex;gap:12px;font-size:12px;color:var(--muted);">
          <span>Score: <strong style="color:var(--text);">${m.overall_avg_score != null ? m.overall_avg_score.toFixed(2) : '—'}</strong></span>
          <span>Audits: <strong style="color:var(--text);">${m.total_audits || 0}</strong></span>
        </div>
        <div style="font-size:11px;color:${dominantColor};font-weight:600;text-transform:uppercase;letter-spacing:0.03em;">
          ${m.dominant_decision || '—'} dominant
        </div>
        ${m.last_audit_at ? `
        <div style="font-size:10px;color:var(--muted);">
          Last: ${new Date(m.last_audit_at).toLocaleDateString()}
        </div>` : ''}
      </div>`;
  }).join('');

  // ── Most distinct model ──────────────────────────────────────────────────
  const sortedByScore = [...models].sort((a, b) => (b.overall_avg_score || 0) - (a.overall_avg_score || 0));
  const mostDistinct = sortedByScore[0];
  const leastDistinct = sortedByScore[sortedByScore.length - 1];
  const distinctInsight = generateDistinctInsight(models, mostDistinct, leastDistinct);

  // ── Last updated ──────────────────────────────────────────────────────────
  const lastUpdatedStr = behaviorHubLastUpdated
    ? timeAgo(behaviorHubLastUpdated)
    : 'just now';

  container.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h4 style="margin:0;font-size:14px;color:var(--text);">Decision Strategy Heatmap</h4>
        <span style="font-size:11px;color:var(--muted);">Updated ${lastUpdatedStr}</span>
      </div>
      <div style="overflow-x:auto;">
        <div style="display:flex;flex-direction:column;gap:4px;min-width:500px;">
          <!-- Header -->
          <div style="display:flex;gap:4px;align-items:center;padding-left:140px;">
            ${DECISION_TYPES.map(dt => `
              <div style="width:64px;min-width:64px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${DECISION_COLORS[dt]};">
                ${dt}
              </div>`).join('')}
          </div>
          <!-- Rows -->
          ${heatmapRows.map(({ model, cells }) => `
            <div style="display:flex;gap:4px;align-items:center;">
              <div style="width:136px;min-width:136px;font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(model.model_name)}">
                ${escapeHtml(model.model_name)}
              </div>
              ${cells.join('')}
            </div>`).join('')}
        </div>
      </div>
      <!-- Legend -->
      <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
        ${DECISION_TYPES.map(dt => `
          <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--muted);">
            <div style="width:8px;height:8px;border-radius:2px;background:${DECISION_COLORS[dt]};opacity:0.7;"></div>
            ${dt}
          </div>`).join('')}
      </div>
    </div>

    <!-- Summary Cards -->
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 12px;font-size:14px;color:var(--text);">Model Profiles</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${summaryCards}
      </div>
    </div>

    <!-- Insight -->
    ${distinctInsight ? `
    <div style="padding:12px 14px;background:rgba(129,140,248,0.08);border-left:3px solid var(--primary);border-radius:4px;font-size:13px;color:var(--text);line-height:1.5;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--primary);letter-spacing:0.05em;">Cross-Model Insight</span>
      </div>
      ${distinctInsight}
    </div>` : ''}
  `;
}

function generateDistinctInsight(models, mostDistinct, leastDistinct) {
  if (!mostDistinct || !leastDistinct) return '';

  const diff = Math.abs((mostDistinct.overall_avg_score || 0) - (leastDistinct.overall_avg_score || 0));
  if (diff < 0.3) {
    return `${models.length} models profiled — all show similar overall quality scores (within 0.3 points). ` +
      `The main differentiator is rhetorical strategy: ${mostDistinct.model_name} predominantly uses ` +
      `<strong>${mostDistinct.dominant_decision || 'N/A'}</strong> while ${leastDistinct.model_name} favours ` +
      `<strong>${leastDistinct.dominant_decision || 'N/A'}</strong>.`;
  }

  return `${mostDistinct.model_name} scores highest overall (${(mostDistinct.overall_avg_score || 0).toFixed(2)}/7) ` +
    `and relies primarily on <strong>${mostDistinct.dominant_decision || 'N/A'}</strong> responses. ` +
    `${leastDistinct.model_name} scores ${(leastDistinct.overall_avg_score || 0).toFixed(2)}/7 ` +
    `with a <strong>${leastDistinct.dominant_decision || 'N/A'}</strong>-led strategy. ` +
    `Consider whether the lower-scoring model's preferred strategy is appropriate for high-stakes deployments.`;
}

function timeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '128,128,128';
  return `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Re-load behavior hub whenever an audit completes
window.addEventListener('auditCompleted', () => {
  loadBehaviorHub();
});
