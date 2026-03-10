
// Shared Model Editor Logic
// Used by both Model Hub and Playground

// State - expected to be populated by the consumer (dashboard.js or modelhub.js)
// If included in dashboard.js, these should be accessible.
// We'll attach them to window to be safe if this is a separate file.
window.currentModels = window.currentModels || {};
window.currentBenches = window.currentBenches || {};

// Callback hooks for refreshing data after edits
window.onModelSaved = window.onModelSaved || function() {};
window.onBenchSaved = window.onBenchSaved || function() {};

function editModel(modelId) {
    const model = window.currentModels[modelId];
    if (!model) {
        console.error("Model not found:", modelId);
        return;
    }

    const modal = document.getElementById('modelModal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    document.getElementById('modelId').value = model.id;
    document.getElementById('modelCategory').value = model.category;

    const title = document.getElementById('modalTitle');
    if (title) title.textContent = 'Edit Model';

    setValue('modelName', model.name);
    setValue('modelProvider', model.provider);
    setValue('modelBaseUrl', model.base_url);
    setValue('modelSourceUrl', model.source_url || '');

    // Set existing prompt first
    setValue('modelSystemPrompt', model.system_prompt || '');
    setValue('modelAnalysisPersona', model.analysis_persona || '');
    setValue('modelTemperature', (model.temperature !== undefined && model.temperature !== null) ? model.temperature : 0.7);
    setValue('modelReasoning', model.reasoning_effort || '');
    setValue('modelMaxReasoningTokens', model.max_reasoning_tokens || '');

    // If it's a judge model and has no scoring prompt, fetch the default as a starting point
    if (model.category === 'judge' && !model.system_prompt) {
        fetch('/api/models/judge/default-prompt')
            .then(res => res.json())
            .then(data => {
                if (!document.getElementById('modelSystemPrompt').value) {
                    setValue('modelSystemPrompt', data.prompt || '');
                }
            })
            .catch(console.error);
        
        if (!model.analysis_persona) {
             fetch('/api/models/judge/default-persona')
                .then(res => res.json())
                .then(data => {
                    if (!document.getElementById('modelAnalysisPersona').value) {
                         setValue('modelAnalysisPersona', data.persona || '');
                    }
                })
                .catch(console.error);
        }
    }

    // Key handling
    const keyInput = document.getElementById('modelKeyInput');
    const keySelect = document.getElementById('modelKeySelect');
    const keyHelp = document.getElementById('modelKeyHelp');
    
    if (model.provider === 'ollama') {
        keyInput.style.display = 'none';
        keySelect.style.display = 'block';
        keyHelp.style.display = 'block';
        fetchOllamaModels(model.model_key); // Pre-select
    } else {
        keyInput.style.display = 'block';
        keySelect.style.display = 'none';
        keyHelp.style.display = 'none';
        keyInput.value = model.model_key || ''; // Key might be masked or hidden in real app, but here we show it if available
        // Note: The API might mask the key. If so, we might not want to overwrite it with **** on save unless changed.
        // Assuming the API returns the key or we handle it.
    }

    toggleJudgeFields();
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function closeModal() {
    const modal = document.getElementById('modelModal');
    if (modal) modal.style.display = 'none';
}

function closeBenchModal() {
    const modal = document.getElementById('benchModal');
    if (modal) modal.style.display = 'none';
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

function updateProviderDefaults() {
    const provider = document.getElementById('modelProvider').value;
    const baseUrlInput = document.getElementById('modelBaseUrl');
    const keyInput = document.getElementById('modelKeyInput');
    const keySelect = document.getElementById('modelKeySelect');
    const keyHelp = document.getElementById('modelKeyHelp');
    const linkDiv = document.getElementById('providerLink');

    let defaultUrl = '';
    let linkHtml = '';

    keyInput.style.display = 'block';
    keySelect.style.display = 'none';
    keyHelp.style.display = 'none';

    switch (provider) {
        case 'openai':
            defaultUrl = 'https://api.openai.com/v1';
            linkHtml = '<a href="https://platform.openai.com/api-keys" target="_blank">Get API Key</a>';
            break;
        case 'openrouter':
            defaultUrl = 'https://openrouter.ai/api/v1';
            linkHtml = '<a href="https://openrouter.ai/keys" target="_blank">Get API Key</a>';
            break;
        case 'ollama':
            defaultUrl = 'http://localhost:11434/v1';
            linkHtml = 'Ensure Ollama is running (<code>ollama serve</code>)';
            keyInput.style.display = 'none';
            keySelect.style.display = 'block';
            keyHelp.style.display = 'block';
            fetchOllamaModels();
            break;
        case 'custom':
            defaultUrl = '';
            break;
    }

    if (baseUrlInput && !baseUrlInput.value) {
        baseUrlInput.value = defaultUrl;
    }
    if (linkDiv) linkDiv.innerHTML = linkHtml;
}

async function fetchOllamaModels(preSelect = null) {
    const keySelect = document.getElementById('modelKeySelect');
    const keyHelp = document.getElementById('modelKeyHelp');
    
    if (!keySelect) return;

    keySelect.innerHTML = '<option value="" disabled selected>Loading...</option>';
    
    // We can't easily fetch from client to localhost:11434 due to CORS usually, 
    // unless the server proxies it or user has configured CORS.
    // But assuming the server has an endpoint or we try directly.
    // The original modelhub.js implementation:
    try {
        // Try via our backend proxy if it exists, or direct if CORS allows.
        // Assuming we have a backend route or we just try direct.
        // For now, let's try a direct fetch, and if it fails, show error.
        // Actually, better to check how modelhub.js did it.
        // modelhub.js: fetch('http://localhost:11434/api/tags')
        
        const response = await fetch('http://localhost:11434/api/tags');
        if (!response.ok) throw new Error('Failed to connect to Ollama');
        
        const data = await response.json();
        keySelect.innerHTML = '<option value="" disabled selected>Select a local model...</option>';
        
        data.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.textContent = m.name;
            if (preSelect && m.name === preSelect) opt.selected = true;
            keySelect.appendChild(opt);
        });
        
        if (keyHelp) keyHelp.textContent = 'Found ' + data.models.length + ' models';
        
    } catch (err) {
        console.warn('Ollama fetch failed', err);
        keySelect.innerHTML = '<option value="" disabled>Connection failed</option>';
        if (keyHelp) keyHelp.innerHTML = '<span style="color:var(--danger)">Could not connect to Ollama at localhost:11434</span>';
    }
}

async function saveModel() {
    const id = document.getElementById('modelId').value;
    const name = document.getElementById('modelName').value.trim();
    const provider = document.getElementById('modelProvider').value;
    const baseUrl = document.getElementById('modelBaseUrl').value.trim();
    const sourceUrl = document.getElementById('modelSourceUrl').value.trim();
    const category = document.getElementById('modelCategory').value;
    
    let modelKey;
    if (provider === 'ollama') {
        modelKey = document.getElementById('modelKeySelect').value;
    } else {
        modelKey = document.getElementById('modelKeyInput').value.trim();
    }

    const systemPrompt = document.getElementById('modelSystemPrompt').value;
    const analysisPersona = document.getElementById('modelAnalysisPersona').value;
    const temperature = parseFloat(document.getElementById('modelTemperature').value);
    const reasoning = document.getElementById('modelReasoning').value;
    const maxReasoningTokens = document.getElementById('modelMaxReasoningTokens').value ? parseInt(document.getElementById('modelMaxReasoningTokens').value) : null;

    if (!name || !provider || !baseUrl || !modelKey) {
        alert('Please fill in all required fields (Name, Provider, Base URL, Key)');
        return;
    }

    const payload = {
        name,
        provider,
        base_url: baseUrl,
        source_url: sourceUrl,
        model_key: modelKey,
        category,
        system_prompt: systemPrompt || null,
        analysis_persona: analysisPersona || null,
        temperature: isNaN(temperature) ? 0.7 : temperature,
        reasoning_effort: reasoning || null,
        max_reasoning_tokens: maxReasoningTokens
    };

    try {
        let res;
        if (id) {
            res = await fetch(`/api/models/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText);
        }

        closeModal();
        if (window.onModelSaved) window.onModelSaved();
    } catch (err) {
        alert('Failed to save model: ' + err.message);
    }
}

async function runTest(payload, btn) {
    if (!btn) return;
    const originalText = btn.textContent;
    btn.textContent = 'Testing...';
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
            raw_text: 'Network or Server Error'
        });
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function testConnection() {
    const provider = document.getElementById('modelProvider').value;
    const baseUrl = document.getElementById('modelBaseUrl').value.trim();
    let modelKey = document.getElementById('modelKeyInput').value.trim();

    if (provider === 'ollama' && document.getElementById('modelKeySelect').style.display !== 'none') {
        modelKey = document.getElementById('modelKeySelect').value;
    }

    if (!baseUrl || !modelKey) {
        alert('Please enter Base URL and Model Key to test connection.');
        return;
    }

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
    if (!modal || !title || !content) return;

    modal.style.display = 'flex';
    modal.style.zIndex = '1200';

    let html = '';

    if (result.success) {
        title.textContent = '✅ Connection Successful';
        title.style.color = '#48bb78';
        html += `<div style="margin-bottom:16px; padding:12px; background:rgba(72, 187, 120, 0.1); border:1px solid #48bb78; border-radius:6px; color:#48bb78;">Model is active and responding.</div>`;
    } else {
        title.textContent = '❌ Connection Failed';
        title.style.color = '#f56565';
        html += `<div style="margin-bottom:16px; padding:12px; background:rgba(245, 101, 101, 0.1); border:1px solid #f56565; border-radius:6px; color:#f56565;">${result.error || 'Unknown error occurred.'}</div>`;
    }

    if (result.raw_text) {
        html += `<div style="margin-top:12px;"><h4 style="margin:0 0 8px 0; color:var(--text);">Raw Response</h4><pre style="margin:0; padding:12px; background:#0e0e14; border:1px solid var(--border); border-radius:6px; white-space:pre-wrap; word-break:break-word; color:var(--muted); font-size:12px; max-height:260px; overflow:auto;">${String(result.raw_text)}</pre></div>`;
    }

    content.innerHTML = html;
}

function closeTestResultModal() {
    const modal = document.getElementById('testResultModal');
    if (modal) modal.style.display = 'none';
}

// Bench Logic

async function openBenchModal(benchIdOrObj) {
    const modal = document.getElementById('benchModal');
    if (!modal) return;
    
    const title = document.getElementById('benchModalTitle');
    const nameInput = document.getElementById('benchName');
    const idInput = document.getElementById('benchId');

    // Reset
    idInput.value = '';
    nameInput.value = '';
    // Reset mode radios if they exist
    const randomRadio = document.querySelector('input[name="benchMode"][value="random"]');
    if (randomRadio) randomRadio.checked = true;

    let existingBench = null;
    if (typeof benchIdOrObj === 'string') {
        existingBench = window.currentBenches[benchIdOrObj];
    } else if (typeof benchIdOrObj === 'object') {
        existingBench = benchIdOrObj;
    }

    if (existingBench) {
        if (title) title.textContent = 'Edit Judge Bench';
        idInput.value = existingBench.id;
        nameInput.value = existingBench.name;
        const modeRadio = document.querySelector(`input[name="benchMode"][value="${existingBench.mode}"]`);
        if (modeRadio) modeRadio.checked = true;
    } else {
        if (title) title.textContent = 'Create Judge Bench';
    }
    
    updateBenchModeDesc();

    // Load Judges List for checkboxes
    // We need all judge models. 
    // If currentModels contains both target and judge, we filter.
    const judgeModels = Object.values(window.currentModels || {}).filter(m => m.category === 'judge');
    
    const listEl = document.getElementById('benchJudgeList');
    if (listEl) {
        if (judgeModels.length === 0) {
            listEl.innerHTML = '<div style="color:var(--muted); font-size:13px;">No judge models found. Create judge models first.</div>';
        } else {
            const selectedIds = existingBench ? (existingBench.judge_model_ids || []) : [];
            listEl.innerHTML = judgeModels.map(m => `
                <label class="bench-judge-item">
                    <input type="checkbox" class="bench-judge-cb" value="${m.id}" ${selectedIds.includes(m.id) ? 'checked' : ''}>
                    <span class="bench-judge-name">${m.name}</span>
                    <span class="bench-judge-key">(${m.model_key})</span>
                </label>
            `).join('');
        }
    }
    
    // Foreman selection
    const foremanSelect = document.getElementById('benchForeman');
    if (foremanSelect) {
        foremanSelect.innerHTML = '<option value="">Select a foreman...</option>';
        judgeModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (existingBench && existingBench.foreman_model_id === m.id) opt.selected = true;
            foremanSelect.appendChild(opt);
        });
    }

    modal.style.display = 'flex';
}

function updateBenchModeDesc() {
    const mode = document.querySelector('input[name="benchMode"]:checked')?.value;
    const desc = document.getElementById('benchModeDesc');
    const foremanContainer = document.getElementById('foremanSelectContainer');
    
    if (desc) {
        if (mode === 'random') {
            desc.textContent = 'A single judge is randomly selected from the pool for each prompt. Re-scoring picks a new judge.';
            if (foremanContainer) foremanContainer.style.display = 'none';
        } else if (mode === 'all') {
            desc.textContent = 'Every judge scores every prompt. The final score is the average.';
            if (foremanContainer) foremanContainer.style.display = 'none';
        } else if (mode === 'jury') {
            desc.textContent = 'All judges evaluate the prompt. A "Foreman" model then synthesizes their arguments into a final verdict.';
            if (foremanContainer) foremanContainer.style.display = 'block';
        }
    }
}

async function saveBench() {
    const id = document.getElementById('benchId').value;
    const name = document.getElementById('benchName').value.trim();
    const mode = document.querySelector('input[name="benchMode"]:checked').value;
    const foremanModelId = document.getElementById('benchForeman').value;

    const cbs = document.querySelectorAll('.bench-judge-cb:checked');
    const judgeModelIds = Array.from(cbs).map(cb => cb.value);

    if (!name) {
        alert('Please enter a bench name');
        return;
    }
    if (judgeModelIds.length === 0) {
        alert('Please select at least one judge model');
        return;
    }
    if (mode === 'jury' && !foremanModelId) {
        alert('Please select a foreman for Jury mode');
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
        if (window.onBenchSaved) window.onBenchSaved();
    } catch (err) {
        alert('Failed to save bench: ' + err.message);
    }
}
