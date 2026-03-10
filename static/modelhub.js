let currentTab = 'target';
let currentModels = {}; // Store models by ID to avoid escaping issues
let providerKeyCache = {}; // { provider: {has_key, masked_key} }

document.addEventListener('DOMContentLoaded', () => {
    loadModels();

    // Setup modal close handlers
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', closeModal);
    });
});

async function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab[onclick="switchTab('${tab}')"]`).classList.add('active');

    // Show/hide bench UI elements
    const benchBtn = document.getElementById('createBenchBtn');
    const benchSection = document.getElementById('benchSection');

    // Load models first to ensure we have names for resolution
    await loadModels();

    if (tab === 'judge') {
        benchBtn.style.display = 'inline-block';
        benchSection.style.display = 'block';
        loadBenches();
    } else {
        benchBtn.style.display = 'none';
        benchSection.style.display = 'none';
    }
}

async function loadModels() {
    try {
        const response = await fetch(`/api/models?category=${currentTab}`);
        const models = await response.json();

        // Store models in global map
        currentModels = {};
        models.forEach(m => currentModels[m.id] = m);

        renderModels(models);
    } catch (err) {
        console.error('Failed to load models:', err);
    }
}

function renderModels(models) {
    const container = document.getElementById('modelList');

    if (models.length === 0) {
        container.innerHTML = '<div style="color:var(--muted); text-align:center; padding:24px;">No models found. Add one to get started.</div>';
        return;
    }

    let html = `
        <table style="width:100%; border-collapse:collapse;">
            <thead>
                <tr style="border-bottom:1px solid var(--border); color:var(--muted); text-align:left;">
                    <th style="padding:12px;">Name</th>
                    <th style="padding:12px;">Provider</th>
                    <th style="padding:12px;">Model Key</th>
                    <th style="padding:12px;">Base URL</th>
                    <th style="padding:12px; text-align:right;">Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    models.forEach(m => {
        html += `
            <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:12px;">
                    ${m.source_url ? `<a href="${m.source_url}" target="_blank" style="color:var(--text);text-decoration:underline;">${m.name}</a>` : m.name}
                </td>
                <td style="padding:12px;"><span class="pill" style="background:#2d3748; color:#a0aec0; padding:2px 8px; border-radius:12px; font-size:12px;">${m.provider}</span></td>
                <td style="padding:12px; font-family:monospace; color:var(--primary);">${m.model_key}</td>
                <td style="padding:12px; font-size:12px; color:var(--muted);">${m.base_url}</td>
                <td style="padding:12px; text-align:right; white-space:nowrap;">
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button class="secondary" style="padding:4px 8px; font-size:12px; width:auto;" onclick="testModelFromList('${m.id}', this)">Test</button>
                        <button class="secondary" style="padding:4px 8px; font-size:12px; width:auto;" onclick="editModel('${m.id}')">Edit</button>
                        <button class="danger" style="padding:4px 8px; font-size:12px; width:auto;" onclick="deleteModel('${m.id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function openModal() {
    document.getElementById('modelModal').style.display = 'flex';
    document.getElementById('modelId').value = ''; // Clear ID for new
    document.getElementById('modelCategory').value = currentTab;

    // Update Modal Title
    const title = currentTab === 'target' ? 'Add New Target Model' : 'Add New Judge Model';
    document.getElementById('modalTitle').textContent = title;

    // Reset fields to defaults
    document.getElementById('modelName').value = '';
    document.getElementById('modelProvider').value = 'openai';
    document.getElementById('modelBaseUrl').value = 'https://api.openai.com/v1';
    document.getElementById('modelSourceUrl').value = '';
    document.getElementById('modelKeyInput').value = '';
    document.getElementById('modelSystemPrompt').value = '';
    document.getElementById('modelAnalysisPersona').value = '';
    document.getElementById('modelReasoning').value = '';
    document.getElementById('modelMaxReasoningTokens').value = '';

    // For judge models, prefill both prompts with current defaults as a starting point
    if (currentTab === 'judge') {
        fetch('/api/models/judge/default-prompt')
            .then(res => res.json())
            .then(data => {
                if (!document.getElementById('modelSystemPrompt').value) {
                    document.getElementById('modelSystemPrompt').value = data.prompt || '';
                }
                if (!document.getElementById('modelAnalysisPersona').value) {
                    document.getElementById('modelAnalysisPersona').value = data.analysis_persona || '';
                }
            })
            .catch(err => console.error('Failed to load default judge prompts', err));
    }

    toggleJudgeFields();
    updateProviderDefaults();
}

function editModel(modelId) {
    const model = currentModels[modelId];
    if (!model) {
        console.error("Model not found:", modelId);
        return;
    }

    document.getElementById('modelModal').style.display = 'flex';
    document.getElementById('modelId').value = model.id;
    document.getElementById('modelCategory').value = model.category;

    document.getElementById('modalTitle').textContent = 'Edit Model';

    document.getElementById('modelName').value = model.name;
    document.getElementById('modelProvider').value = model.provider;
    document.getElementById('modelBaseUrl').value = model.base_url;
    document.getElementById('modelSourceUrl').value = model.source_url || '';

    // Set existing prompt first
    document.getElementById('modelSystemPrompt').value = model.system_prompt || '';
    document.getElementById('modelAnalysisPersona').value = model.analysis_persona || '';
    document.getElementById('modelTemperature').value = (model.temperature !== undefined && model.temperature !== null) ? model.temperature : 0.7;
    document.getElementById('modelReasoning').value = model.reasoning_effort || '';
    document.getElementById('modelMaxReasoningTokens').value = model.max_reasoning_tokens || '';

    // If it's a judge model and has no scoring prompt, fetch the default as a starting point
    if (model.category === 'judge' && !model.system_prompt) {
        fetch('/api/models/judge/default-prompt')
            .then(res => res.json())
            .then(data => {
                if (!document.getElementById('modelSystemPrompt').value)
                    document.getElementById('modelSystemPrompt').value = data.prompt || '';
                if (!document.getElementById('modelAnalysisPersona').value)
                    document.getElementById('modelAnalysisPersona').value = data.analysis_persona || '';
            })
            .catch(err => console.error('Failed to load default judge prompts', err));
    }

    toggleJudgeFields();

    // Trigger provider update to show correct key input
    updateProviderDefaults().then(() => {
        // After defaults are set, override with existing values
        document.getElementById('modelBaseUrl').value = model.base_url; // Ensure custom URL persists

        if (model.provider === 'ollama') {
            // If we have a dropdown, try to select it
            const select = document.getElementById('modelKeySelect');
            if (select.style.display !== 'none') {
                select.value = model.model_key;
            }
            // Always populate text input as fallback
            document.getElementById('modelKeyInput').value = model.model_key;
        } else {
            document.getElementById('modelKeyInput').value = model.model_key;
        }
    });
}

function closeModal() {
    document.getElementById('modelModal').style.display = 'none';
    // Reset form
    document.getElementById('modelName').value = '';
    document.getElementById('modelKeyInput').value = '';
    document.getElementById('modelKeySelect').innerHTML = '<option value="" disabled selected>Select a local model...</option>';
    document.getElementById('modelSystemPrompt').value = '';
    document.getElementById('modelAnalysisPersona').value = '';
    document.getElementById('modelTemperature').value = '0.7';
    document.getElementById('modelReasoning').value = '';
    document.getElementById('modelMaxReasoningTokens').value = '';
}

function toggleJudgeFields() {
    const category = document.getElementById('modelCategory').value;
    const isJudge = category === 'judge';
    const containers = ['judgeSystemPromptContainer', 'judgeAnalysisPersonaContainer'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isJudge ? 'block' : 'none';
    });
}

/**
 * Renders the provider key status notice into `el`.
 * Shows ✅ if configured, or ⚠️ with a link to Settings if not.
 */
function renderProviderKeyStatus(el, provider, status) {
    if (!el) return;
    if (!status || !status.has_key) {
        el.innerHTML = `
            <span style="color:#f6ad55; font-weight:600;">⚠ No API key configured for this provider.</span>
            <a href="/config#group-model-providers" target="_blank"
               style="color:var(--primary); margin-left:6px; font-size:12px; text-decoration:underline;">
               Set up in Settings →
            </a>`;
    } else {
        el.innerHTML = `<span style="color:#48bb78; font-weight:600;">✅ API key configured</span>
            <span style="color:var(--muted); font-size:11px; margin-left:6px;">${status.masked_key || ''}</span>`;
    }
}

async function updateProviderDefaults() {
    const provider = document.getElementById('modelProvider').value;
    const baseUrlInput = document.getElementById('modelBaseUrl');
    const linkContainer = document.getElementById('providerLink');
    const keyStatusEl = document.getElementById('providerKeyStatus');

    const keyInput = document.getElementById('modelKeyInput');
    const keySelect = document.getElementById('modelKeySelect');
    const keyHelp = document.getElementById('modelKeyHelp');

    // Reset inputs
    keyInput.style.display = 'block';
    keySelect.style.display = 'none';
    keyHelp.style.display = 'none';

    // Fetch & update provider key status (only for managed providers)
    const managedProviders = ['openai', 'openrouter'];
    if (keyStatusEl) {
        if (managedProviders.includes(provider)) {
            // Use cache if available, otherwise fetch
            if (providerKeyCache[provider] !== undefined) {
                renderProviderKeyStatus(keyStatusEl, provider, providerKeyCache[provider]);
            } else {
                keyStatusEl.innerHTML = '<span style="color:var(--muted);">Checking key...</span>';
                try {
                    const res = await fetch('/api/provider-keys');
                    if (res.ok) {
                        const list = await res.json();
                        list.forEach(p => { providerKeyCache[p.provider] = p; });
                    }
                } catch (e) { /* silent */ }
                renderProviderKeyStatus(keyStatusEl, provider, providerKeyCache[provider]);
            }
        } else {
            keyStatusEl.innerHTML = ''; // No status for ollama/custom
        }
    }

    switch (provider) {
        case 'openai':
            baseUrlInput.value = 'https://api.openai.com/v1';
            linkContainer.innerHTML = '<a href="https://platform.openai.com/docs/models" target="_blank" style="color:var(--primary)">View OpenAI Models</a>';
            break;
        case 'openrouter':
            baseUrlInput.value = 'https://openrouter.ai/api/v1';
            linkContainer.innerHTML = '<a href="https://openrouter.ai/models" target="_blank" style="color:var(--primary)">View OpenRouter Models</a>';
            break;
        case 'ollama':
            baseUrlInput.value = 'http://localhost:11434/v1/chat/completions';
            linkContainer.innerHTML = '<a href="https://ollama.com/library" target="_blank" style="color:var(--primary)">View Ollama Library</a>';

            // Try to fetch local models
            keyInput.style.display = 'none';
            keySelect.style.display = 'block';
            keyHelp.style.display = 'block';
            keyHelp.textContent = 'Fetching local models...';

            try {
                // Try fetching from localhost directly first (if CORS allows)
                // Note: Standard Ollama setup might block this unless OLLAMA_ORIGINS is set
                // If it fails, we fall back to manual input
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);

                const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    const models = data.models || [];

                    keySelect.innerHTML = '<option value="" disabled selected>Select a local model...</option>';
                    if (models.length > 0) {
                        models.forEach(m => {
                            const opt = document.createElement('option');
                            opt.value = m.name;
                            opt.textContent = m.name;
                            keySelect.appendChild(opt);
                        });
                        keyHelp.textContent = `${models.length} local models found.`;
                    } else {
                        keyHelp.textContent = 'No models found in Ollama.';
                    }
                } else {
                    throw new Error('Failed to fetch');
                }
            } catch (e) {
                console.warn('Ollama fetch failed, falling back to manual input', e);
                keyInput.style.display = 'block';
                keySelect.style.display = 'none';
                keyHelp.style.color = 'var(--danger)';
                keyHelp.textContent = 'Could not connect to Ollama (http://localhost:11434). Enter model name manually.';
            }
            break;
        case 'custom':
            baseUrlInput.value = '';
            linkContainer.innerHTML = '';
            break;
    }
}

async function saveModel() {
    const id = document.getElementById('modelId').value;
    const provider = document.getElementById('modelProvider').value;
    let modelKey = document.getElementById('modelKeyInput').value;

    // If Ollama and select is visible, use that value
    if (provider === 'ollama' && document.getElementById('modelKeySelect').style.display !== 'none') {
        modelKey = document.getElementById('modelKeySelect').value;
    }

    const model = {
        id: id || undefined,
        name: document.getElementById('modelName').value,
        category: currentTab,
        provider: provider,
        base_url: document.getElementById('modelBaseUrl').value,
        source_url: document.getElementById('modelSourceUrl').value || null,
        model_key: modelKey,
        api_key: null, // API key is managed at provider level in Settings
        system_prompt: document.getElementById('modelSystemPrompt').value || null,
        analysis_persona: document.getElementById('modelAnalysisPersona').value || null,
        reasoning_effort: document.getElementById('modelReasoning').value || null,
        max_reasoning_tokens: document.getElementById('modelMaxReasoningTokens').value ? parseInt(document.getElementById('modelMaxReasoningTokens').value) : null,
    };

    if (!model.name || !model.base_url || !model.model_key) {
        alert('Please fill in all required fields (Name, Base URL, Model Key)');
        return;
    }

    const saveBtn = document.getElementById('saveModelBtn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    try {
        let response;
        if (id) {
            // Update
            response = await fetch(`/api/models/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(model)
            });
        } else {
            // Create
            response = await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(model)
            });
        }

        if (!response.ok) {
            const errorText = await response.text();
            try {
                const errorJson = JSON.parse(errorText);
                throw new Error(errorJson.detail || errorText);
            } catch (e) {
                if (e.message && e.message !== 'Unexpected end of JSON input') throw e;
                throw new Error(errorText);
            }
        }

        closeModal();
        loadModels();
    } catch (err) {
        alert('Failed to save model: ' + err.message);
    } finally {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    }
}

let deleteTargetId = null;

function openDeleteModal(id) {
    deleteTargetId = id;
    document.getElementById('deleteModal').style.display = 'flex';
    document.getElementById('confirmDeleteBtn').onclick = () => confirmDeleteModel(id);
}

function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
    deleteTargetId = null;
}

async function confirmDeleteModel(id) {
    try {
        const response = await fetch(`/api/models/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(await response.text());
        closeDeleteModal();
        loadModels();
    } catch (err) {
        alert('Failed to delete model: ' + err.message);
    }
}

async function deleteModel(id) {
    openDeleteModal(id);
}

// ══════════════════════════════════════════════════
// Judge Bench Functions
// ══════════════════════════════════════════════════

let cachedJudgeModels = [];

async function loadBenches() {
    try {
        const res = await fetch('/api/benches');
        const benches = await res.json();
        renderBenches(benches);
    } catch (err) {
        console.error('Failed to load benches:', err);
    }
}

function renderBenches(benches) {
    const container = document.getElementById('benchList');
    if (!container) return;

    if (benches.length === 0) {
        container.innerHTML = '<div style="color:var(--muted); text-align:center; padding:16px; font-size:13px;">No benches created yet. Create one to evaluate with multiple judges.</div>';
        return;
    }

    let html = '';
    benches.forEach(b => {
        let modeLabel = '🎲 Random';

        if (b.mode === 'all') modeLabel = '📋 All';
        if (b.mode === 'jury') modeLabel = '⚖️ Jury';

        const judgeCount = (b.judge_model_ids || []).length;

        // Resolve judge names
        const judgeNames = (b.judge_model_ids || []).map(id => {
            const m = currentModels[id];
            return m ? m.name : 'Unknown';
        });

        // Resolve foreman
        let foremanName = null;
        if (b.mode === 'jury' && b.foreman_model_id) {
            const f = currentModels[b.foreman_model_id];
            foremanName = f ? f.name : 'Unknown';
        }

        html += `
            <div style="padding:12px; border:1px solid var(--border); border-radius:8px; background:var(--card); margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                        <div style="font-weight:600; font-size:15px;">${b.name}</div>
                        <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
                            <span class="pill" style="background:#2d3748; color:#a0aec0; padding:2px 8px; border-radius:12px; font-size:11px;">${modeLabel}</span>
                            <span style="font-size:12px; color:var(--muted);">${judgeCount} judge${judgeCount !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="secondary" style="padding:4px 8px; font-size:12px; width:auto;" onclick='editBench(${JSON.stringify(b)})'>Edit</button>
                        <button class="danger" style="padding:4px 8px; font-size:12px; width:auto;" onclick="deleteBench('${b.id}')">Delete</button>
                    </div>
                </div>
                
                <div style="margin-top:12px; border-top:1px solid var(--border); padding-top:8px;">
                    <div style="font-size:12px; color:var(--muted); margin-bottom:4px;">Judges:</div>
                    <div style="display:flex; flex-wrap:wrap; gap:6px;">
                        ${judgeNames.map(name =>
            `<span style="background:#1a202c; color:var(--text); padding:2px 8px; border-radius:4px; font-size:12px; border:1px solid var(--border);">${name}</span>`
        ).join('')}
                    </div>
                    
                    ${foremanName ? `
                    <div style="margin-top:8px; display:flex; align-items:center; gap:6px;">
                        <span style="font-size:12px; color:var(--muted);">Foreman:</span>
                        <span style="font-size:12px; font-weight:600; color:#fbbf24; margin-left: 4px;">⚡ ${foremanName}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

async function openBenchModal(existingBench) {
    const modal = document.getElementById('benchModal');
    const title = document.getElementById('benchModalTitle');
    const nameInput = document.getElementById('benchName');
    const idInput = document.getElementById('benchId');

    // Reset
    idInput.value = '';
    nameInput.value = '';
    document.querySelector('input[name="benchMode"][value="random"]').checked = true;
    updateBenchModeDesc();

    if (existingBench) {
        title.textContent = 'Edit Judge Bench';
        idInput.value = existingBench.id;
        nameInput.value = existingBench.name;
        const modeRadio = document.querySelector(`input[name="benchMode"][value="${existingBench.mode}"]`);
        if (modeRadio) modeRadio.checked = true;
        updateBenchModeDesc();
    } else {
        title.textContent = 'Create Judge Bench';
    }

    // Fetch judge models for checkboxes
    try {
        const res = await fetch('/api/models?category=judge');
        cachedJudgeModels = await res.json();
    } catch (err) {
        console.error('Failed to load judge models for bench:', err);
        cachedJudgeModels = [];
    }

    // Populate Foreman Dropdown
    const foremanSelect = document.getElementById('benchForeman');
    if (foremanSelect) {
        foremanSelect.innerHTML = '<option value="">Select a foreman...</option>';
        cachedJudgeModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = `${m.name} (${m.model_key})`;
            foremanSelect.appendChild(opt);
        });

        // Set existing foreman if any
        if (existingBench && existingBench.foreman_model_id) {
            foremanSelect.value = existingBench.foreman_model_id;
        }
    }

    const listEl = document.getElementById('benchJudgeList');
    if (cachedJudgeModels.length === 0) {
        listEl.innerHTML = '<div style="color:var(--muted); font-size:13px;">No judge models found. Create judge models first.</div>';
    } else {
        const selectedIds = existingBench ? (existingBench.judge_model_ids || []) : [];
        listEl.innerHTML = cachedJudgeModels.map(m => `
            <label class="bench-judge-item">
                <input type="checkbox" class="bench-judge-cb" value="${m.id}" ${selectedIds.includes(m.id) ? 'checked' : ''}>
                <span class="bench-judge-name">${m.name}</span>
                <span class="bench-judge-key">(${m.model_key})</span>
            </label>
        `).join('');
    }

    modal.style.display = 'flex';
}

function closeBenchModal() {
    document.getElementById('benchModal').style.display = 'none';
}

function editBench(bench) {
    openBenchModal(bench);
}

async function deleteBench(benchId) {
    if (!confirm('Delete this bench? This cannot be undone.')) return;
    try {
        const res = await fetch(`/api/benches/${benchId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        loadBenches();
    } catch (err) {
        alert('Failed to delete bench: ' + err.message);
    }
}

async function saveBench() {
    const id = document.getElementById('benchId').value;
    const name = document.getElementById('benchName').value.trim();
    const mode = document.querySelector('input[name="benchMode"]:checked').value;
    const checkboxes = document.querySelectorAll('.bench-judge-cb:checked');
    const judgeModelIds = Array.from(checkboxes).map(cb => cb.value);
    const foremanModelId = document.getElementById('benchForeman') ? document.getElementById('benchForeman').value : null;

    if (!name) {
        showInAppAlert('Please enter a bench name');
        return;
    }
    if (judgeModelIds.length < 1) {
        showInAppAlert('Please select at least 1 judge model');
        return;
    }
    if (judgeModelIds.length > 5) {
        showInAppAlert('A bench can have at most 5 judge models');
        return;
    }
    if (mode === 'jury' && !foremanModelId) {
        showInAppAlert('Please select a Foreman for the Jury bench');
        return;
    }

    const payload = {
        name: name,
        mode: mode,
        judge_model_ids: judgeModelIds,
        foreman_model_id: mode === 'jury' ? foremanModelId : null
    };

    try {
        let res;
        if (id) {
            res = await fetch(`/api/benches/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch('/api/benches', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }
        if (!res.ok) throw new Error(await res.text());
        closeBenchModal();
        loadBenches();
    } catch (err) {
        showInAppAlert('Failed to save bench: ' + err.message);
    }
}

function showInAppAlert(message, title = 'Alert') {
    const modal = document.getElementById('alertModal');
    const titleEl = document.getElementById('alertTitle');
    const msgEl = document.getElementById('alertMessage');

    if (modal && titleEl && msgEl) {
        titleEl.textContent = title;
        // If it's an error, maybe style it differently, but for now just text
        msgEl.textContent = message;

        // Ensure z-index is higher than bench modal (which is 1000)
        modal.style.zIndex = '1100';
        modal.style.display = 'flex';
    } else {
        // Fallback
        alert(message);
    }
}

function closeAlertModal() {
    document.getElementById('alertModal').style.display = 'none';
}

function updateBenchModeDesc() {
    const mode = document.querySelector('input[name="benchMode"]:checked').value;
    const descEl = document.getElementById('benchModeDesc');
    const foremanContainer = document.getElementById('foremanSelectContainer');

    if (mode === 'random') {
        descEl.textContent = 'Random: A random judge scores each response. Low scores (<4) trigger a re-score by another judge. A random judge writes the final report.';
        if (foremanContainer) foremanContainer.style.display = 'none';
    } else if (mode === 'all') {
        descEl.textContent = 'All: Every judge in the bench scores every response. All critiques are aggregated for the final report, balancing out individual biases.';
        if (foremanContainer) foremanContainer.style.display = 'none';
    } else if (mode === 'jury') {
        descEl.textContent = 'Jury: All judges score independently. A designated Foreman model then reviews all critiques to synthesize a final verdict.';
        if (foremanContainer) foremanContainer.style.display = 'block';
    }
}

// Attach mode radio change listeners
document.querySelectorAll('input[name="benchMode"]').forEach(radio => {
    radio.addEventListener('change', updateBenchModeDesc);
});

async function runTest(payload, btn) {
    const originalText = btn.textContent;
    btn.textContent = "Testing...";
    btn.disabled = true;

    try {
        const res = await fetch('/api/models/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        showTestResult(data);

    } catch (err) {
        showTestResult({
            success: false,
            error: err.message,
            raw_text: "Network or Server Error"
        });
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function testModelFromList(modelId, btn) {
    const model = currentModels[modelId];
    if (!model) {
        console.error("Model not found for testing:", modelId);
        return;
    }

    const payload = {
        provider: model.provider,
        base_url: model.base_url,
        model_key: model.model_key,
        api_key: null // Resolved by backend from provider-level key in Settings
    };

    await runTest(payload, btn);
}

async function testConnection() {
    const provider = document.getElementById('modelProvider').value;
    const baseUrl = document.getElementById('modelBaseUrl').value;
    let modelKey = document.getElementById('modelKeyInput').value;

    // If Ollama and select is visible, use that value
    if (provider === 'ollama' && document.getElementById('modelKeySelect').style.display !== 'none') {
        modelKey = document.getElementById('modelKeySelect').value;
    }

    if (!baseUrl || !modelKey) {
        showInAppAlert('Please enter Base URL and Model Key to test connection.');
        return;
    }

    // api_key is omitted — backend will resolve from provider-level key in Settings
    const payload = {
        provider,
        base_url: baseUrl,
        model_key: modelKey,
        api_key: null
    };

    const btn = document.querySelector('#modelModal button[onclick="testConnection()"]');
    await runTest(payload, btn);
}

function showTestResult(result) {
    const modal = document.getElementById('testResultModal');
    const title = document.getElementById('testResultTitle');
    const content = document.getElementById('testResultContent');

    modal.style.display = 'flex';
    // Ensure it's on top of the model modal
    modal.style.zIndex = '1200';

    let html = '';

    if (result.success) {
        title.textContent = "✅ Connection Successful";
        title.style.color = "#48bb78"; // Green

        html += `<div style="margin-bottom:16px; padding:12px; background:rgba(72, 187, 120, 0.1); border:1px solid #48bb78; border-radius:6px; color:#48bb78;">
            Model is active and responding.
        </div>`;
    } else {
        title.textContent = "❌ Connection Failed";
        title.style.color = "#f56565"; // Red

        const errorMsg = result.error || "Unknown error occurred";
        html += `<div style="margin-bottom:16px; padding:12px; background:rgba(245, 101, 101, 0.1); border:1px solid #f56565; border-radius:6px; color:#f56565;">
            <strong>Error:</strong> ${errorMsg}
        </div>`;
    }

    if (result.response || result.raw_text) {
        const raw = result.response ? JSON.stringify(result.response, null, 2) : result.raw_text;
        html += `
            <div style="font-size:12px; font-weight:600; margin-bottom:4px; color:var(--muted);">Full Response:</div>
            <pre style="background:#0e0e14; padding:12px; border-radius:6px; overflow-x:auto; font-size:12px; color:#e2e8f0; border:1px solid var(--border); max-height: 300px;">${escapeHtml(raw)}</pre>
        `;
    }

    content.innerHTML = html;
}

function closeTestResultModal() {
    document.getElementById('testResultModal').style.display = 'none';
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
