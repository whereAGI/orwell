let currentTab = 'target';

document.addEventListener('DOMContentLoaded', () => {
    loadModels();

    // Setup modal close handlers
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', closeModal);
    });
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab[onclick="switchTab('${tab}')"]`).classList.add('active');

    // Show/hide bench UI elements
    const benchBtn = document.getElementById('createBenchBtn');
    const benchSection = document.getElementById('benchSection');
    if (tab === 'judge') {
        benchBtn.style.display = 'inline-block';
        benchSection.style.display = 'block';
        loadBenches();
    } else {
        benchBtn.style.display = 'none';
        benchSection.style.display = 'none';
    }

    loadModels();
}

async function loadModels() {
    try {
        const response = await fetch(`/api/models?category=${currentTab}`);
        const models = await response.json();
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
                <td style="padding:12px;">${m.name}</td>
                <td style="padding:12px;"><span class="pill" style="background:#2d3748; color:#a0aec0; padding:2px 8px; border-radius:12px; font-size:12px;">${m.provider}</span></td>
                <td style="padding:12px; font-family:monospace; color:var(--primary);">${m.model_key}</td>
                <td style="padding:12px; font-size:12px; color:var(--muted);">${m.base_url}</td>
                <td style="padding:12px; text-align:right; white-space:nowrap;">
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button class="secondary" style="padding:4px 8px; font-size:12px; width:auto;" onclick='editModel(${JSON.stringify(m)})'>Edit</button>
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
    document.getElementById('modelKeyInput').value = '';
    document.getElementById('modelApiKey').value = '';
    document.getElementById('modelSystemPrompt').value = '';

    // For judge models, fetch and set the default system prompt
    if (currentTab === 'judge') {
        fetch('/api/models/judge/default-prompt')
            .then(res => res.json())
            .then(data => {
                // Check if user hasn't typed anything yet (though it should be empty since we just cleared it)
                if (!document.getElementById('modelSystemPrompt').value) {
                    document.getElementById('modelSystemPrompt').value = data.prompt;
                }
            })
            .catch(err => console.error('Failed to load default judge prompt', err));
    }

    toggleJudgeFields();
    updateProviderDefaults();
}

function editModel(model) {
    document.getElementById('modelModal').style.display = 'flex';
    document.getElementById('modelId').value = model.id;
    document.getElementById('modelCategory').value = model.category;

    document.getElementById('modalTitle').textContent = 'Edit Model';

    document.getElementById('modelName').value = model.name;
    document.getElementById('modelProvider').value = model.provider;
    document.getElementById('modelBaseUrl').value = model.base_url;
    document.getElementById('modelApiKey').value = model.api_key || '';

    // Set existing prompt first
    document.getElementById('modelSystemPrompt').value = model.system_prompt || '';
    document.getElementById('modelTemperature').value = (model.temperature !== undefined && model.temperature !== null) ? model.temperature : 0.7;

    // If it's a judge model and has no prompt, fetch default
    if (model.category === 'judge' && !model.system_prompt) {
        fetch('/api/models/judge/default-prompt')
            .then(res => res.json())
            .then(data => {
                // Only set if still empty (race condition check)
                if (!document.getElementById('modelSystemPrompt').value) {
                    document.getElementById('modelSystemPrompt').value = data.prompt;
                }
            })
            .catch(err => console.error('Failed to load default judge prompt', err));
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
    document.getElementById('modelApiKey').value = '';
    document.getElementById('modelSystemPrompt').value = '';
    document.getElementById('modelTemperature').value = '0.7';
}

function toggleJudgeFields() {
    const category = document.getElementById('modelCategory').value;
    const container = document.getElementById('judgeSystemPromptContainer');
    if (container) {
        container.style.display = category === 'judge' ? 'block' : 'none';
    }
}

async function updateProviderDefaults() {
    const provider = document.getElementById('modelProvider').value;
    const baseUrlInput = document.getElementById('modelBaseUrl');
    const linkContainer = document.getElementById('providerLink');

    const keyInput = document.getElementById('modelKeyInput');
    const keySelect = document.getElementById('modelKeySelect');
    const keyHelp = document.getElementById('modelKeyHelp');

    // Reset inputs
    keyInput.style.display = 'block';
    keySelect.style.display = 'none';
    keyHelp.style.display = 'none';

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
        id: id || undefined, // Include ID if editing
        name: document.getElementById('modelName').value,
        category: currentTab,
        provider: provider,
        base_url: document.getElementById('modelBaseUrl').value,
        model_key: modelKey,
        api_key: document.getElementById('modelApiKey').value || null,
        system_prompt: document.getElementById('modelSystemPrompt').value || null
    };

    if (!model.name || !model.base_url || !model.model_key) {
        alert('Please fill in all required fields (Name, Base URL, Model Key)');
        return;
    }

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

        if (!response.ok) throw new Error(await response.text());

        closeModal();
        loadModels();
    } catch (err) {
        alert('Failed to save model: ' + err.message);
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
        const modeLabel = b.mode === 'random' ? '🎲 Random' : '📋 All';
        const judgeCount = (b.judge_model_ids || []).length;
        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--card); margin-bottom:8px;">
                <div>
                    <div style="font-weight:600;">${b.name}</div>
                    <div style="font-size:12px; color:var(--muted); margin-top:2px;">
                        <span class="pill" style="background:#2d3748; color:#a0aec0; padding:2px 8px; border-radius:12px; font-size:11px;">${modeLabel}</span>
                        &nbsp; ${judgeCount} judge${judgeCount !== 1 ? 's' : ''}
                    </div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="secondary" style="padding:4px 8px; font-size:12px; width:auto;" onclick='editBench(${JSON.stringify(b)})'>Edit</button>
                    <button class="danger" style="padding:4px 8px; font-size:12px; width:auto;" onclick="deleteBench('${b.id}')">Delete</button>
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

    const payload = {
        name: name,
        mode: mode,
        judge_model_ids: judgeModelIds
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
    if (mode === 'random') {
        descEl.textContent = 'Random: A random judge scores each response. Low scores (<4) trigger a re-score by another judge. A random judge writes the final report.';
    } else {
        descEl.textContent = 'All: Every judge in the bench scores every response. All critiques are aggregated for the final report, balancing out individual biases.';
    }
}

// Attach mode radio change listeners
document.querySelectorAll('input[name="benchMode"]').forEach(radio => {
    radio.addEventListener('change', updateBenchModeDesc);
});
