
document.addEventListener('DOMContentLoaded', () => {
    loadSchemas();
});

let currentSchemas = [];

async function loadSchemas() {
    const list = document.getElementById('schemaList');
    list.innerHTML = '<div style="color:var(--muted); text-align:center; padding:24px;">Loading schemas...</div>';

    try {
        const res = await fetch('/api/schemas');
        const schemas = await res.json();
        currentSchemas = schemas;
        renderSchemas(schemas);
    } catch (e) {
        console.error("Failed to load schemas:", e);
        list.innerHTML = `<div style="color:var(--error); text-align:center;">Failed to load schemas: ${e.message}</div>`;
    }
}

function renderSchemas(schemas) {
    const list = document.getElementById('schemaList');
    if (schemas.length === 0) {
        list.innerHTML = '<div style="color:var(--muted); text-align:center; padding:24px;">No schemas found. Create one to get started.</div>';
        return;
    }

    list.innerHTML = schemas.map(s => {
        const isBuiltin = s.is_builtin;
        return `
        <div class="card schema-card" style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div style="display:flex; gap:12px; align-items:center;">
                    <div style="font-size:24px; background:var(--bg-secondary); width:40px; height:40px; border-radius:8px; display:flex; align-items:center; justify-content:center;">
                        ${s.icon || '✦'}
                    </div>
                    <div>
                        <div style="font-weight:600; color:var(--text-primary);">${s.name}</div>
                        <div style="font-size:11px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">
                            ${s.schema_type || 'Custom'}
                            ${isBuiltin ? '<span style="margin-left:6px; color:var(--primary); border:1px solid var(--primary-dim); padding:1px 4px; border-radius:4px; font-size:9px;">BUILT-IN</span>' : ''}
                        </div>
                    </div>
                </div>
            </div>

            <div style="font-size:13px; color:var(--text-secondary); line-height:1.4; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; flex:1;">
                ${s.description || 'No description provided.'}
            </div>

            <div style="display:flex; gap:8px; margin-top:auto; padding-top:12px; border-top:1px solid var(--border);">
                <button class="secondary" style="flex:1; padding:6px; font-size:12px;" onclick="openSchemaModal('${s.id}')">
                    Edit
                </button>
                ${!isBuiltin ? `
                <button class="danger" style="width:auto; padding:6px 12px; font-size:12px;" onclick="deleteSchema('${s.id}')">
                    🗑
                </button>
                ` : ''}
            </div>
        </div>
        `;
    }).join('');
}

function openSchemaModal(schemaId = null) {
    const modal = document.getElementById('schemaModal');
    const title = document.getElementById('modalTitle');
    
    // Reset form
    document.getElementById('schemaId').value = '';
    document.getElementById('schemaName').value = '';
    document.getElementById('schemaIcon').value = '';
    document.getElementById('schemaDesc').value = '';
    document.getElementById('schemaLowLabel').value = '';
    document.getElementById('schemaHighLabel').value = '';
    document.getElementById('schemaGenPrompt').value = '';
    document.getElementById('schemaJudgePrompt').value = '';
    document.getElementById('schemaDimTemplate').value = '';
    document.getElementById('schemaContext').value = '';
    document.getElementById('schemaExecPrompt').value = '';
    document.getElementById('schemaFailPrompt').value = '';
    document.getElementById('schemaRecoPrompt').value = '';

    // Enable all fields by default
    const inputs = modal.querySelectorAll('input, textarea, button:not(.secondary)');
    inputs.forEach(el => el.disabled = false);
    document.getElementById('builtinNotice').style.display = 'none';

    if (schemaId) {
        const schema = currentSchemas.find(s => s.id === schemaId);
        if (!schema) return;

        title.textContent = schema.is_builtin ? 'Edit Schema' : 'Edit Schema';
        document.getElementById('schemaId').value = schema.id;
        document.getElementById('schemaName').value = schema.name;
        document.getElementById('schemaIcon').value = schema.icon || '';
        document.getElementById('schemaDesc').value = schema.description || '';
        document.getElementById('schemaLowLabel').value = schema.scoring_axis_low_label || '';
        document.getElementById('schemaHighLabel').value = schema.scoring_axis_high_label || '';
        document.getElementById('schemaGenPrompt').value = schema.generator_system_prompt || '';
        document.getElementById('schemaJudgePrompt').value = schema.judge_system_prompt || '';
        document.getElementById('schemaDimTemplate').value = schema.dimension_template || '';
        document.getElementById('schemaContext').value = schema.schema_context || '';
        document.getElementById('schemaExecPrompt').value = schema.report_executive_summary_prompt || '';
        document.getElementById('schemaFailPrompt').value = schema.report_failure_analysis_prompt || '';
        document.getElementById('schemaRecoPrompt').value = schema.report_recommendations_prompt || '';

        if (schema.is_builtin) {
            document.getElementById('builtinNotice').style.display = 'block';
            
            // Lock structural fields
            const lockedIds = ['schemaName', 'schemaIcon', 'schemaDesc', 'schemaLowLabel', 'schemaHighLabel'];
            lockedIds.forEach(id => document.getElementById(id).disabled = true);
        }
        
        const saveBtn = modal.querySelector('button[onclick="saveSchema()"]');
        if (saveBtn) {
            saveBtn.style.display = 'inline-block';
            saveBtn.textContent = 'Save Changes';
        }
    } else {
        title.textContent = 'Create New Schema';
        const saveBtn = modal.querySelector('button[onclick="saveSchema()"]');
        if (saveBtn) {
            saveBtn.style.display = 'inline-block';
            saveBtn.textContent = 'Create Schema';
        }
    }

    modal.style.display = 'flex';
    updateHints();
}

function updateHints() {
    const fields = [
        { id: 'schemaExecPrompt', hint: null },
        { id: 'schemaFailPrompt', hint: null },
        { id: 'schemaRecoPrompt', hint: null }
    ];
    
    fields.forEach(f => {
        const el = document.getElementById(f.id);
        const hint = el.nextElementSibling;
        if (hint && hint.classList.contains('hint-fallback')) {
            hint.style.display = el.value.trim() ? 'none' : 'block';
        }
    });
}

// Add event listeners for hints
document.addEventListener('DOMContentLoaded', () => {
    ['schemaExecPrompt', 'schemaFailPrompt', 'schemaRecoPrompt'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                const hint = el.nextElementSibling;
                if (hint && hint.classList.contains('hint-fallback')) {
                    hint.style.display = el.value.trim() ? 'none' : 'block';
                }
            });
        }
    });
});

function closeSchemaModal() {
    document.getElementById('schemaModal').style.display = 'none';
}

async function saveSchema() {
    const id = document.getElementById('schemaId').value;
    const payload = {
        name: document.getElementById('schemaName').value.trim(),
        icon: document.getElementById('schemaIcon').value.trim(),
        description: document.getElementById('schemaDesc').value.trim(),
        schema_type: 'custom',
        scoring_axis_low_label: document.getElementById('schemaLowLabel').value.trim(),
        scoring_axis_high_label: document.getElementById('schemaHighLabel').value.trim(),
        generator_system_prompt: document.getElementById('schemaGenPrompt').value.trim() || null,
        judge_system_prompt: document.getElementById('schemaJudgePrompt').value.trim() || null,
        dimension_template: document.getElementById('schemaDimTemplate').value.trim() || null,
        schema_context: document.getElementById('schemaContext').value.trim() || null,
        report_executive_summary_prompt: document.getElementById('schemaExecPrompt').value.trim() || null,
        report_failure_analysis_prompt: document.getElementById('schemaFailPrompt').value.trim() || null,
        report_recommendations_prompt: document.getElementById('schemaRecoPrompt').value.trim() || null
    };

    if (!payload.name) {
        alert('Schema name is required');
        return;
    }

    const btn = document.querySelector('button[onclick="saveSchema()"]');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
        let res;
        if (id) {
            res = await fetch(`/api/schemas/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch('/api/schemas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to save schema');
        }

        closeSchemaModal();
        loadSchemas();
    } catch (e) {
        alert(e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function deleteSchema(id) {
    if (!confirm('Are you sure you want to delete this schema? This cannot be undone.')) return;

    try {
        const res = await fetch(`/api/schemas/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to delete schema');
        }
        loadSchemas();
    } catch (e) {
        alert(e.message);
    }
}
