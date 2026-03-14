/**
 * promptgen.js — 3-step prompt generation flow
 *
 * Step 1: Configure (dimension, rubric, count, model)
 * Step 2: Generate (SSE log stream + polling)
 * Step 3: Review & Save (checkpoint table, approve/reject, save to DB)
 */

// ─── State ────────────────────────────────────────────────
let currentMode = 'new';   // 'new' | 'existing'
let currentJobId = null;
let generatedPrompts = [];  // Full list from job
let currentDimName = '';

let genEventSource = null;
let genPollInterval = null;

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    // loadSchemas() removed - handled by nav
    
    // Initial load based on current schema
    const active = getActiveSchema();
    if (active) {
        onSchemaChanged();
    }

    loadExistingDimensions();
    loadTemplate();

    // Auto-update template when dimension name is typed
    const nameInput = document.getElementById('dimName');
    if (nameInput) {
        let debounce;
        nameInput.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                const name = nameInput.value.trim();
                const schemaId = getActiveSchema()?.id;
                if (name) loadTemplate(name, schemaId);
            }, 600);
        });
    }

    // Toggle Terminal
    const termPanel = document.getElementById('terminal');
    const toggleBtn = document.getElementById('toggleTerminalBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleTerminal);
    }
    
    // Clear Terminal
    const clearBtn = document.getElementById('clearLogsBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            document.getElementById('genTerminal').innerHTML = '<div style="color:#4b5563;font-style:italic;">Logs cleared.</div>';
        });
    }

    // Resize Terminal Logic
    // const termPanel = document.getElementById('terminal'); // Already declared above
    const resizeHandle = document.getElementById('termResize');
    let isResizing = false;

    if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            // Calculate new height (distance from bottom)
            const newHeight = window.innerHeight - e.clientY;
            if (newHeight >= 40 && newHeight <= window.innerHeight - 100) {
                termPanel.style.height = `${newHeight}px`;
                if (newHeight > 40 && termPanel.classList.contains('collapsed')) {
                    termPanel.classList.remove('collapsed');
                    document.getElementById('toggleTerminalBtn').textContent = '_';
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = 'default';
            }
        });
    }
});

function toggleTerminal() {
    const termPanel = document.getElementById('terminal');
    const toggleBtn = document.getElementById('toggleTerminalBtn');
    const isCollapsed = termPanel.classList.toggle('collapsed');
    toggleBtn.textContent = isCollapsed ? '[]' : '_';
}

// ─── Load Models ──────────────────────────────────────────
async function loadModels() {
    try {
        const res = await fetch('/api/models?category=judge');
        if (!res.ok) return;
        const models = await res.json();

        const sel = document.getElementById('modelSelect');
        sel.innerHTML = '';

        if (!models.length) {
            sel.innerHTML = '<option value="" disabled selected>No judge models configured — add one in Model Hub</option>';
            return;
        }

        models.forEach(m => {
            const o = document.createElement('option');
            o.value = m.id;
            o.textContent = `${m.name} (${m.model_key})`;
            sel.appendChild(o);
        });
    } catch (e) {
        console.error('Failed to load models:', e);
    }
}

// loadSchemas removed

async function onSchemaChanged() {
    const schemaId = getActiveSchema()?.id;
    if (!schemaId) return;

    // Reload dimensions for this schema
    loadExistingDimensions(schemaId);
    // Reload template for this schema
    const name = document.getElementById('dimName')?.value?.trim();
    if (name) loadTemplate(name, schemaId);
}

// Listen for nav schema changes
window.addEventListener('schemaChanged', onSchemaChanged);

// ─── Load Existing Dimensions ─────────────────────────────
async function loadExistingDimensions(schemaId = null) {
    try {
        let url = '/api/data/dimensions';
        // The API endpoint /api/data/dimensions doesn't seem to support schema_id filtering yet based on my read of main.py
        // Wait, main.py has /api/dimensions which supports schema_id, but /api/data/dimensions (list_dimensions) does not?
        // Let's check main.py again. list_dimensions (line 1233) uses custom_prompts table. 
        // get_dimensions (line 1209) also uses custom_prompts. 
        // /api/dimensions seems to be the one used by dashboard.js. 
        // promptgen.js uses /api/data/dimensions. 
        // I should probably switch promptgen.js to use /api/dimensions or update /api/data/dimensions.
        // For now, let's use /api/dimensions as it supports schema_id.
        
        if (schemaId) url = `/api/dimensions?schema_id=${schemaId}`;
        else url = '/api/dimensions'; // Use the one that supports filtering if possible, or fallback

        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const dims = data.dimensions || [];

        const sel = document.getElementById('existingDimSelect');
        sel.innerHTML = '';

        if (!dims.length) {
            sel.innerHTML = '<option value="" disabled selected>No dimensions available for this schema</option>';
            return;
        }

        dims.forEach(d => {
            const o = document.createElement('option');
            o.value = d;
            o.textContent = d;
            sel.appendChild(o);
        });
    } catch (e) {
        console.error('Failed to load dimensions:', e);
    }
}

// ─── Load Rubric Template ─────────────────────────────────
async function loadTemplate(name = 'Your Dimension', schemaId = null) {
    try {
        let url = `/api/data/dimension-template?name=${encodeURIComponent(name)}`;
        // Note: The backend /api/data/dimension-template doesn't strictly support schema_id yet to fetch *schema-specific* template.
        // It fetches a config value 'dimension_template'.
        // However, if we want to support schema-specific templates, we should probably update the backend endpoint or fetch the schema details directly.
        // For now, let's fetch schema details if schemaId is provided to get the template.
        
        let templateText = '';
        
        if (schemaId) {
            const schemaRes = await fetch(`/api/schemas/${schemaId}`);
            if (schemaRes.ok) {
                const schema = await schemaRes.json();
                if (schema.dimension_template) {
                    templateText = schema.dimension_template.replace('{dimension_name}', name);
                }
            }
        }
        
        if (!templateText) {
             const res = await fetch(url);
             if (res.ok) {
                 const data = await res.json();
                 templateText = data.template;
             }
        }
        
        const desc = document.getElementById('dimDesc');
        if (desc && templateText) desc.value = templateText;
    } catch (e) {
        console.error('Failed to load template:', e);
    }
}

// ─── Mode Toggle ──────────────────────────────────────────
function setMode(mode) {
    currentMode = mode;
    document.getElementById('modeNewBtn').classList.toggle('active', mode === 'new');
    document.getElementById('modeExistingBtn').classList.toggle('active', mode === 'existing');
    document.getElementById('newFields').style.display = mode === 'new' ? 'block' : 'none';
    document.getElementById('existingFields').style.display = mode === 'existing' ? 'block' : 'none';
}

// ─── Step Navigation ──────────────────────────────────────
function showStep(n) {
    document.getElementById('step1').style.display = n === 1 ? 'block' : 'none';
    document.getElementById('step2').style.display = n === 2 ? 'block' : 'none';
    document.getElementById('step3').style.display = n === 3 ? 'block' : 'none';

    // Update step indicators
    for (let i = 1; i <= 3; i++) {
        const el = document.getElementById(`step${i}Indicator`);
        el.classList.remove('active', 'done');
        if (i < n) el.classList.add('done');
        if (i === n) el.classList.add('active');
    }
}

// ─── Start Generation ─────────────────────────────────────
async function startGeneration() {
    const errEl = document.getElementById('step1Error');
    errEl.style.display = 'none';

    let dimName, dimDesc;

    if (currentMode === 'new') {
        dimName = document.getElementById('dimName').value.trim();
        dimDesc = document.getElementById('dimDesc').value.trim();
        if (!dimName) { showError('Please enter a dimension name.'); return; }
        if (!dimDesc || dimDesc.includes('[Characteristic')) {
            showError('Please complete the dimension description. Replace placeholder text with real characteristics.');
            return;
        }
    } else {
        dimName = document.getElementById('existingDimSelect').value;
        if (!dimName) { showError('Please select an existing dimension.'); return; }
        dimDesc = `Generate prompts that evaluate the "${dimName}" dimension, following the same style and depth as the existing GLOBE prompts.`;
    }

    const count = parseInt(document.getElementById('promptCount').value);
    if (!count || count < 1 || count > 500) { showError('Prompt count must be between 1 and 500.'); return; }

    const modelId = document.getElementById('modelSelect').value;
    if (!modelId) { showError('Please select a generator model.'); return; }
    
    const schemaId = getActiveSchema()?.id;
    if (!schemaId) { showError('Please select a target schema in the navigation bar.'); return; }

    currentDimName = dimName;

    // Transition to Step 2
    document.getElementById('genDimLabel').textContent = dimName;
    document.getElementById('genProgressText').textContent = `0 / ${count} prompts`;
    document.getElementById('genProgressFill').style.width = '0%';
    document.getElementById('genProgressFill').textContent = '0%';
    document.getElementById('genStatus').textContent = 'Starting...';
    
    // Reset terminal (new persistent panel)
    const terminal = document.getElementById('genTerminal');
    terminal.innerHTML = '<div style="color:#4b5563;font-style:italic;">Connecting...</div>';
    
    // Auto-open terminal if collapsed
    const termPanel = document.getElementById('terminal');
    if (termPanel.classList.contains('collapsed')) {
        toggleTerminal();
    }

    showStep(2);

    try {
        const res = await fetch('/api/data/generate-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dimension_name: dimName,
                dimension_description: dimDesc,
                total_count: count,
                generator_model_id: modelId,
                is_new_dimension: currentMode === 'new',
                schema_id: schemaId
            }),
        });

        if (!res.ok) {
            const err = await res.json();
            appendLog('error', `Failed to start: ${err.detail || 'Unknown error'}`);
            document.getElementById('genStatus').textContent = '✗ Failed';
            return;
        }

        const data = await res.json();
        currentJobId = data.job_id;

        // Connect SSE stream
        connectStream(currentJobId);

        // Poll for progress
        startPolling(currentJobId);

    } catch (e) {
        appendLog('error', `Error: ${e.message}`);
        document.getElementById('genStatus').textContent = '✗ Failed';
    }
}

function showError(msg) {
    const el = document.getElementById('step1Error');
    el.textContent = msg;
    el.style.display = 'block';
}

// ─── SSE Stream ───────────────────────────────────────────
function connectStream(jobId) {
    if (genEventSource) genEventSource.close();

    genEventSource = new EventSource(`/api/data/generate-prompts/${jobId}/stream`);

    genEventSource.onmessage = (event) => {
        try {
            const log = JSON.parse(event.data);
            appendLog(log.type, log.content);
        } catch (e) {
            console.warn('SSE parse error:', e);
        }
    };

    genEventSource.onerror = () => {
        if (genEventSource) { genEventSource.close(); genEventSource = null; }
    };
}

// ─── Progress Polling ─────────────────────────────────────
function startPolling(jobId) {
    if (genPollInterval) clearInterval(genPollInterval);

    genPollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/data/generate-prompts/${jobId}/status`);
            if (!res.ok) return;
            const data = await res.json();

            const pct = Math.round(data.progress * 100);
            document.getElementById('genProgressFill').style.width = `${pct}%`;
            document.getElementById('genProgressFill').textContent = `${pct}%`;
            document.getElementById('genProgressText').textContent = `${data.generated} / ${data.total} prompts`;

            if (data.status === 'completed') {
                document.getElementById('genStatus').textContent = '✓ Complete';
                document.getElementById('genStatus').style.color = '#4ade80';
                stopPolling();

                // Transition to Step 3 — pass prompts into review
                generatedPrompts = data.prompts || [];
                renderReviewTable(generatedPrompts);
                showStep(3);

            } else if (data.status === 'failed') {
                document.getElementById('genStatus').textContent = '✗ Failed';
                document.getElementById('genStatus').style.color = '#f87171';
                stopPolling();
            } else {
                document.getElementById('genStatus').textContent = 'Generating...';
                document.getElementById('genStatus').style.color = '#60a5fa';
            }
        } catch (e) {
            console.error('Poll error:', e);
        }
    }, 1000);
}

function stopPolling() {
    if (genPollInterval) { clearInterval(genPollInterval); genPollInterval = null; }
    if (genEventSource) { genEventSource.close(); genEventSource = null; }
}

// ─── Terminal Log ─────────────────────────────────────────
function appendLog(type, content) {
    const terminal = document.getElementById('genTerminal');

    // Remove placeholder
    const ph = terminal.querySelector('[style*="font-style:italic"]');
    if (ph) ph.remove();

    const colors = { info: 'lt-info', success: 'lt-success', warning: 'lt-warning', error: 'lt-error', thought: 'lt-thought', content: 'lt-content' };
    const cls = colors[type] || 'lt-info';
    
    // Check if the last log line has the same type. If so, append to it.
    // This allows for smooth token streaming.
    const lastLine = terminal.lastElementChild;
    if (lastLine && lastLine.dataset.type === type) {
        const contentSpan = lastLine.querySelector('.log-content');
        if (contentSpan) {
            contentSpan.textContent += content;
            terminal.scrollTop = terminal.scrollHeight;
            return;
        }
    }

    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'log-line';
    div.dataset.type = type; // Mark type for merging
    div.innerHTML = `<span class="log-time">${time}</span><span class="log-type ${cls}">[${type}]</span><span class="log-content" style="white-space:pre-wrap;">${escHtml(content)}</span>`;
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ─── Review Table ─────────────────────────────────────────
function renderReviewTable(prompts) {
    const tbody = document.getElementById('reviewTableBody');
    tbody.innerHTML = '';
    
    const today = new Date().toISOString().split('T')[0];
    const modelSelect = document.getElementById('modelSelect');
    let modelName = 'Unknown';
    if (modelSelect && modelSelect.selectedIndex >= 0) {
        modelName = modelSelect.options[modelSelect.selectedIndex].text.split('(')[0].trim();
    }

    prompts.forEach((text, i) => {
        const tr = document.createElement('tr');
        tr.dataset.index = i;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.addEventListener('change', () => {
            tr.classList.toggle('rejected', !cb.checked);
            updateReviewCounts();
        });

        const tdCb = document.createElement('td');
        tdCb.appendChild(cb);

        const tdNum = document.createElement('td');
        tdNum.style.cssText = 'color:var(--muted);font-size:12px;';
        tdNum.textContent = i + 1;
        
        // Date
        const tdDate = document.createElement('td');
        tdDate.style.fontSize = '12px';
        tdDate.style.color = 'var(--muted)';
        tdDate.textContent = today;
        
        // Dimension
        const tdDim = document.createElement('td');
        tdDim.style.fontSize = '12px';
        tdDim.textContent = currentDimName;

        // Prompt Text Cell (truncated + view button logic)
        const tdText = document.createElement('td');
        const MAX_LEN = 600; // Increased to show more context
        const isLong = text.length > MAX_LEN;
        const display = isLong ? text.slice(0, MAX_LEN) + '... ' : text;
        
        const textDiv = document.createElement('div');
        textDiv.textContent = display;
        textDiv.title = text; // Show full text on hover
        textDiv.style.lineHeight = '1.5';
        // Allow wrapping if short enough, otherwise truncate
        textDiv.style.whiteSpace = 'pre-wrap'; 

        if (isLong) {
            const viewMore = document.createElement('span');
            viewMore.textContent = 'View More';
            viewMore.style.color = '#60a5fa';
            viewMore.style.cursor = 'pointer';
            viewMore.style.marginLeft = '4px';
            viewMore.onclick = (e) => {
                e.stopPropagation();
                showFullPrompt(text);
            };
            textDiv.appendChild(viewMore);
        }

        tdText.appendChild(textDiv);
        
        // Model
        const tdModel = document.createElement('td');
        tdModel.style.fontSize = '12px';
        tdModel.style.color = 'var(--muted)';
        tdModel.textContent = modelName;

        tr.appendChild(tdCb);
        tr.appendChild(tdNum);
        tr.appendChild(tdDate);
        tr.appendChild(tdDim);
        tr.appendChild(tdText);
        tr.appendChild(tdModel);
        tbody.appendChild(tr);
    });

    updateReviewCounts();
}

function showFullPrompt(text) {
    document.getElementById('fullPromptContent').textContent = text;
    document.getElementById('viewPromptModal').classList.add('active');
}

function updateReviewCounts() {
    const rows = document.querySelectorAll('#reviewTableBody tr');
    let approved = 0;
    rows.forEach(r => {
        const cb = r.querySelector('input[type=checkbox]');
        if (cb && cb.checked) approved++;
    });
    const rejected = rows.length - approved;
    document.getElementById('reviewApprovedCount').textContent = approved;
    document.getElementById('reviewRejectedCount').textContent = rejected;
}

function selectAllReview(checked) {
    document.querySelectorAll('#reviewTableBody tr').forEach(r => {
        const cb = r.querySelector('input[type=checkbox]');
        if (cb) {
            cb.checked = checked;
            r.classList.toggle('rejected', !checked);
        }
    });
    updateReviewCounts();
}

// ─── Save Approved ────────────────────────────────────────
async function saveApproved() {
    const saveBtn = document.getElementById('saveBtn');
    const statusEl = document.getElementById('saveStatus');

    // Collect approved prompts
    const approved = [];
    document.querySelectorAll('#reviewTableBody tr').forEach((r, i) => {
        const cb = r.querySelector('input[type=checkbox]');
        if (cb && cb.checked && generatedPrompts[i]) {
            approved.push(generatedPrompts[i]);
        }
    });

    if (!approved.length) {
        statusEl.textContent = 'No prompts selected.';
        statusEl.style.color = 'var(--danger)';
        statusEl.style.display = 'inline';
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    statusEl.style.display = 'none';

    try {
        const res = await fetch(`/api/data/generate-prompts/${currentJobId}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                approved_prompts: approved,
                dimension_name: currentDimName,
                language: 'en',
                schema_id: getActiveSchema()?.id
            }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Unknown error');
        }

        const data = await res.json();
        saveBtn.textContent = `✓ Saved ${data.saved} Prompts`;
        saveBtn.style.background = 'var(--success)';
        saveBtn.disabled = true;

        statusEl.textContent = `${data.saved} prompts added to "${data.dimension_name}". Go to Data Studio to view them.`;
        statusEl.style.color = '#4ade80';
        statusEl.style.display = 'inline';

        // Show link to Data Studio
        setTimeout(() => {
            statusEl.innerHTML = `${data.saved} prompts saved! <a href="/studio" style="color:#60a5fa;">Open Data Studio →</a>`;
        }, 1500);

    } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Approved Prompts';
        statusEl.textContent = `Save failed: ${e.message}`;
        statusEl.style.color = 'var(--danger)';
        statusEl.style.display = 'inline';
    }
}

// ─── Start Over ───────────────────────────────────────────
function startOver() {
    stopPolling();
    currentJobId = null;
    generatedPrompts = [];
    currentDimName = '';

    // Reset Step 1 form
    if (currentMode === 'new') {
        document.getElementById('dimName').value = '';
        loadTemplate();
    }
    document.getElementById('promptCount').value = '20';
    document.getElementById('step1Error').style.display = 'none';

    // Reset Step 2
    const terminal = document.getElementById('genTerminal');
    terminal.innerHTML = '<div style="color:#4b5563;font-style:italic;">Connecting to generation stream...</div>';
    document.getElementById('genStatus').textContent = 'Starting...';
    document.getElementById('genStatus').style.color = '';
    document.getElementById('genProgressFill').style.width = '0%';
    document.getElementById('genProgressFill').textContent = '0%';

    // Reset Step 3 save button
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Approved Prompts';
    saveBtn.style.background = '';
    document.getElementById('saveStatus').style.display = 'none';

    showStep(1);
}
