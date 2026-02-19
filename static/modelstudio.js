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
    
    switch(provider) {
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
