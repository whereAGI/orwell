let allPrompts = [];
let deleteTargetId = null;
let editTargetId = null;
let currentSort = '-created_at'; // Default: newest first
let selectAllAcrossPages = false;

// Removed fetch wrapper for pb auth token


let currentPage = 1;
let perPage = 100; // Default to 100
let totalItems = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Load dimensions first, then prompts
    loadDimensions().then(() => {
        loadPrompts(1);
    });

    // Add listeners for filters
    let searchTimeout;
    document.getElementById('search').addEventListener('keyup', () => {
        clearSelection();
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => loadPrompts(1), 300);
    });

    // schemaFilter removed
    document.getElementById('dimFilter').addEventListener('change', () => { clearSelection(); loadPrompts(1); });
    document.getElementById('sourceFilter').addEventListener('change', () => { clearSelection(); loadPrompts(1); });
    document.getElementById('fromDate').addEventListener('change', () => { clearSelection(); loadPrompts(1); });
    document.getElementById('toDate').addEventListener('change', () => { clearSelection(); loadPrompts(1); });
    document.getElementById('rowsPerPage').addEventListener('change', updateRowsPerPage);
});



// loadSchemas removed

async function loadDimensions() {
    try {
        let url = '/api/dimensions';

        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            const dims = data.dimensions || [];
            const select = document.getElementById('dimFilter');
            // Clear existing options except first
            while (select.options.length > 1) {
                select.remove(1);
            }
            dims.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d;
                opt.textContent = d;
                select.appendChild(opt);
            });
        }
    } catch (e) {
        console.error("Error loading dimensions:", e);
    }
}

async function loadPrompts(page = 1) {
    try {
        const source = document.getElementById('sourceFilter').value || 'all';
        const search = document.getElementById('search').value;
        const dimension = document.getElementById('dimFilter').value;
        const fromDate = document.getElementById('fromDate').value;
        const toDate = document.getElementById('toDate').value;

        let url = `/api/data/prompts?page=${page}&per_page=${perPage}&source=${source}&sort=${currentSort}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (dimension) url += `&dimension=${encodeURIComponent(dimension)}`;
        if (fromDate) url += `&from_date=${encodeURIComponent(fromDate)}`;
        if (toDate) url += `&to_date=${encodeURIComponent(toDate)}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load prompts');
        const data = await res.json();

        allPrompts = data.items;
        totalItems = data.total;
        currentPage = data.page;

        renderTable();
        renderPagination();
    } catch (e) {
        console.error(e);
    }
}

function updateRowsPerPage() {
    const val = parseInt(document.getElementById('rowsPerPage').value);
    if (val > 0) {
        perPage = val;
        loadPrompts(1);
    }
}

function renderPagination() {
    const totalPages = Math.ceil(totalItems / perPage);
    const container = document.getElementById('paginationContainer');
    if (!container) return; // Should exist

    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages} (Total: ${totalItems})`;

    container.innerHTML = '';

    // Helper to create button
    const createBtn = (text, page, active = false, disabled = false) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = active ? '' : 'secondary';
        if (active) {
            btn.style.background = 'var(--primary)';
            btn.style.borderColor = 'var(--primary)';
            btn.style.color = '#fff';
        }
        if (disabled) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        } else {
            btn.onclick = () => loadPrompts(page);
        }
        btn.style.padding = '4px 8px';
        btn.style.fontSize = '12px';
        btn.style.width = 'auto'; // Ensure buttons don't stretch
        return btn;
    };

    // Previous Button
    container.appendChild(createBtn('Prev', currentPage - 1, false, currentPage === 1));

    // Page Numbers logic
    // Show: 1 ... current-1 current current+1 ... last
    // Always show first and last
    const pagesToShow = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pagesToShow.push(i);
    } else {
        pagesToShow.push(1);
        if (currentPage > 3) pagesToShow.push('...');

        let start = Math.max(2, currentPage - 1);
        let end = Math.min(totalPages - 1, currentPage + 1);

        if (currentPage <= 3) { end = 4; }
        if (currentPage >= totalPages - 2) { start = totalPages - 3; }

        for (let i = start; i <= end; i++) {
            if (i > 1 && i < totalPages) pagesToShow.push(i);
        }

        if (currentPage < totalPages - 2) pagesToShow.push('...');
        pagesToShow.push(totalPages);
    }

    pagesToShow.forEach(p => {
        if (p === '...') {
            const span = document.createElement('span');
            span.textContent = '...';
            span.style.color = 'var(--muted)';
            span.style.alignSelf = 'center';
            container.appendChild(span);
        } else {
            container.appendChild(createBtn(p, p, p === currentPage));
        }
    });

    // Next Button
    container.appendChild(createBtn('Next', currentPage + 1, false, currentPage === totalPages));
}

function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
    selectAllAcrossPages = false;
    updateBulkDeleteState();
}

function handleRowCheckboxChange(cb) {
    if (!cb.checked && selectAllAcrossPages) {
        selectAllAcrossPages = false;
    }
    const allCheckboxes = document.querySelectorAll('.row-checkbox');
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    const selectAll = document.getElementById('selectAll');
    if (selectAll) selectAll.checked = (allCheckboxes.length > 0 && allCheckboxes.length === checkedBoxes.length);
    
    updateBulkDeleteState();
}

function updateBulkDeleteState() {
    const checkboxes = document.querySelectorAll('.row-checkbox:checked');
    const btn = document.getElementById('bulkDeleteBtn');
    const banner = document.getElementById('selectAllBanner');
    
    if (checkboxes.length > 0) {
        btn.style.display = 'inline-block';
        
        if (selectAllAcrossPages) {
            btn.textContent = `Delete Selected (${totalItems})`;
            if (banner) {
                banner.style.display = 'flex';
                banner.innerHTML = `All <strong>${totalItems}</strong> prompts in this view are selected. <button style="background:none; border:none; color:#6366f1; text-decoration:underline; cursor:pointer; padding:0; font-size:inherit; font-weight:600; margin-left:8px;" onclick="clearSelection()">Clear selection</button>`;
            }
        } else {
            btn.textContent = `Delete Selected (${checkboxes.length})`;
            
            // Check if all visible checkboxes are checked and there are more items than visible
            const allCheckboxes = document.querySelectorAll('.row-checkbox');
            if (checkboxes.length === allCheckboxes.length && totalItems > allCheckboxes.length) {
                if (banner) {
                    banner.style.display = 'flex';
                    banner.innerHTML = `All <strong>${checkboxes.length}</strong> prompts on this page are selected. <button style="background:none; border:none; color:#6366f1; text-decoration:underline; cursor:pointer; padding:0; font-size:inherit; font-weight:600; margin-left:8px;" onclick="selectAllFiltered()">Select all <strong>${totalItems}</strong> prompts</button>`;
                }
            } else {
                if (banner) banner.style.display = 'none';
            }
        }
    } else {
        btn.style.display = 'none';
        if (banner) banner.style.display = 'none';
        selectAllAcrossPages = false;
    }
}

function selectAllFiltered() {
    selectAllAcrossPages = true;
    updateBulkDeleteState();
}

function clearSelection() {
    selectAllAcrossPages = false;
    const selectAll = document.getElementById('selectAll');
    if (selectAll) selectAll.checked = false;
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(cb => cb.checked = false);
    updateBulkDeleteState();
}

async function bulkDelete() {
    document.getElementById('deleteModal').classList.add('active');
    const msg = document.querySelector('#deleteModal p');

    if (selectAllAcrossPages) {
        if (msg) msg.textContent = `Are you sure you want to delete ALL ${totalItems} prompts matching the current filters? This action cannot be undone.`;
        document.getElementById('confirmDeleteBtn').onclick = () => performBulkDeleteFiltered();
    } else {
        const checkboxes = document.querySelectorAll('.row-checkbox:checked');
        const ids = Array.from(checkboxes).map(cb => cb.value);
        if (ids.length === 0) return;

        deleteTargetId = ids; // Store array for bulk delete logic
        if (msg) msg.textContent = `Are you sure you want to delete ${ids.length} prompts? This action cannot be undone.`;
        document.getElementById('confirmDeleteBtn').onclick = () => performBulkDelete(ids);
    }
}

async function performBulkDeleteFiltered() {
    const source = document.getElementById('sourceFilter').value || 'all';
    const search = document.getElementById('search').value;
    const dimension = document.getElementById('dimFilter').value;
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;

    let url = `/api/data/prompts/bulk-filter?source=${source}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (dimension) url += `&dimension=${encodeURIComponent(dimension)}`;
    if (fromDate) url += `&from_date=${encodeURIComponent(fromDate)}`;
    if (toDate) url += `&to_date=${encodeURIComponent(toDate)}`;

    try {
        const res = await fetch(url, {
            method: 'DELETE'
        });

        if (res.ok) {
            clearSelection();
            loadPrompts(1);
            closeDeleteModal();
        } else {
            alert("Failed to delete prompts");
        }
    } catch (e) {
        console.error(e);
        alert("Error deleting prompts");
    }
}

async function performBulkDelete(ids) {
    try {
        const res = await fetch('/api/data/prompts/bulk', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ids)
        });

        if (res.ok) {
            loadPrompts(currentPage);
            const selectAll = document.getElementById('selectAll');
            if (selectAll) selectAll.checked = false;
            updateBulkDeleteState();
            closeDeleteModal();
        } else {
            alert("Failed to delete selected prompts");
        }
    } catch (e) {
        console.error(e);
        alert("Error deleting prompts");
    }
}

function renderTable() {
    const tbody = document.getElementById('promptTable');
    tbody.innerHTML = '';

    // Reset select all
    const selectAll = document.getElementById('selectAll');
    if (selectAll) selectAll.checked = selectAllAcrossPages;

    // Check filter to toggle Model column
    const sourceFilter = document.getElementById('sourceFilter').value;
    const showModel = sourceFilter !== 'system';
    const thModel = document.getElementById('thModel');
    if (thModel) thModel.style.display = showModel ? 'table-cell' : 'none';

    if (allPrompts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${showModel ? 9 : 8}" style="text-align:center;color:var(--muted)">No prompts found.</td></tr>`;
        updateBulkDeleteState();
        return;
    }

    // Data is already filtered by server
    allPrompts.forEach((p, index) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50';

        // Row Index (Global)
        const globalIndex = (currentPage - 1) * perPage + index + 1;

        // Format Date
        let dateStr = '-';
        if (p.created_at) {
            let utcStr = p.created_at;
            // Ensure ISO 8601 format (replace space with T, append Z if missing)
            if (utcStr.includes(' ') && !utcStr.includes('T')) {
                utcStr = utcStr.replace(' ', 'T');
            }
            if (!utcStr.endsWith('Z')) {
                utcStr += 'Z';
            }
            try {
                dateStr = new Date(utcStr).toLocaleString();
            } catch (e) {
                dateStr = p.created_at; // Fallback
            }
        }

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <input type="checkbox" class="row-checkbox" value="${p.id}" ${selectAllAcrossPages ? 'checked' : ''} onchange="handleRowCheckboxChange(this)">
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${globalIndex}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${dateStr}</td>
            <td class="px-6 py-4 text-sm text-gray-900">
                <div class="line-clamp-2" title="${p.dimension}">${p.dimension}</div>
            </td>
            ${showModel ? `<td class="px-6 py-4 text-sm text-gray-500">${p.model || '-'}</td>` : ''}
            <td class="px-6 py-4 text-sm text-gray-900">
                <div class="line-clamp-2" title="${p.text}">${p.text}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${p.language}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                <span class="badge ${p.type === 'custom' ? 'custom' : ''}">${p.type}</span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button onclick="openEditModal('${p.id}')" class="text-blue-600 hover:text-blue-900" style="width:auto; padding:2px 6px; font-size:11px;">
                        Edit
                    </button>
                    <button onclick="openDeleteModal('${p.id}')" class="danger" style="width:auto; padding:2px 6px; font-size:11px;">
                        Delete
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateBulkDeleteState();
}

// Modal Logic
function openAddModal() {
    document.getElementById('addModal').classList.add('active');
}

function closeAddModal() {
    document.getElementById('addModal').classList.remove('active');
    document.getElementById('newDimension').value = '';
    document.getElementById('newText').value = '';
}

function openEditModal(id) {
    const prompt = allPrompts.find(p => p.id === id);
    if (!prompt) return;

    editTargetId = id;
    document.getElementById('editDimension').value = prompt.dimension;
    document.getElementById('editText').value = prompt.text;
    document.getElementById('editLanguage').value = prompt.language || 'en';

    document.getElementById('editModal').classList.add('active');
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('active');
    editTargetId = null;
}

async function submitNewPrompt() {
    const dim = document.getElementById('newDimension').value.trim();
    const text = document.getElementById('newText').value.trim();
    const lang = document.getElementById('newLanguage').value.trim();

    if (!dim || !text) {
        alert("Dimension and Text are required");
        return;
    }

    try {
        const res = await fetch('/api/data/prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dimension: dim, text: text, language: lang })
        });
        if (res.ok) {
            closeAddModal();
            loadPrompts(currentPage); // Reload current page
        } else {
            alert("Failed to save prompt");
        }
    } catch (e) {
        console.error(e);
        alert("Error saving prompt");
    }
}

async function submitEditPrompt() {
    if (!editTargetId) return;

    const dim = document.getElementById('editDimension').value.trim();
    const text = document.getElementById('editText').value.trim();
    const lang = document.getElementById('editLanguage').value.trim();

    if (!dim || !text) {
        alert("Dimension and Text are required");
        return;
    }

    try {
        const res = await fetch(`/api/data/prompts/${editTargetId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dimension: dim, text: text, language: lang })
        });

        if (res.ok) {
            closeEditModal();
            loadPrompts(currentPage);
        } else {
            const err = await res.json();
            alert("Failed to update prompt: " + (err.detail || "Unknown error"));
        }
    } catch (e) {
        console.error(e);
        alert("Error updating prompt");
    }
}

function openDeleteModal(id) {
    deleteTargetId = id;
    document.getElementById('deleteModal').classList.add('active');

    // Reset message for single delete
    const msg = document.querySelector('#deleteModal p');
    if (msg) msg.textContent = "Are you sure you want to delete this prompt? This action cannot be undone.";

    document.getElementById('confirmDeleteBtn').onclick = () => deletePrompt(id);
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    deleteTargetId = null;
}

async function deletePrompt(id) {
    try {
        const res = await fetch(`/api/data/prompts/${id}`, { method: 'DELETE' });
        if (res.ok) {
            closeDeleteModal();
            loadPrompts(currentPage); // Reload current page
        } else {
            alert("Failed to delete prompt");
        }
    } catch (e) {
        console.error(e);
        alert("Error deleting prompt");
    }
}

async function handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        // Show loading state if desired
        const btn = input.nextElementSibling;
        const originalText = btn.textContent;
        btn.textContent = "Uploading...";
        btn.disabled = true;

        const res = await fetch('/api/data/prompts/import', {
            method: 'POST',
            headers: {
                // Do NOT set Content-Type header when sending FormData, 
                // the browser sets it automatically with the boundary
            },
            body: formData
        });

        if (res.ok) {
            const result = await res.json();
            let msg = `Successfully imported ${result.imported} prompts.`;

            // Use custom modal
            document.getElementById('importMessage').textContent = msg;
            const errorDiv = document.getElementById('importErrors');

            if (result.errors && result.errors.length > 0) {
                errorDiv.style.display = 'block';
                errorDiv.innerHTML = `<div style="color:var(--danger);margin-bottom:4px;">${result.errors.length} errors occurred:</div>` +
                    result.errors.join('<br>');
            } else {
                errorDiv.style.display = 'none';
                errorDiv.innerHTML = '';
            }

            document.getElementById('importModal').classList.add('active');
            loadPrompts(1);
        } else {
            const err = await res.json();
            alert("Import failed: " + (err.detail || "Unknown error"));
        }
    } catch (e) {
        console.error(e);
        alert("Error importing file: " + e.message);
    } finally {
        // Reset input
        input.value = '';
        const btn = input.nextElementSibling;
        btn.textContent = "Import CSV";
        btn.disabled = false;
    }
}

function closeImportModal() {
    document.getElementById('importModal').classList.remove('active');
}

async function exportData() {
    const source = document.getElementById('sourceFilter').value || 'all';
    const search = document.getElementById('search').value;
    const dimension = document.getElementById('dimFilter').value;
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    
    const checkboxes = document.querySelectorAll('.row-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.value);

    // If no checkboxes are checked, we export the whole filtered set.
    // If checkboxes are checked, we check if selectAllAcrossPages is true.
    const isExportAllFiltered = (ids.length === 0) || selectAllAcrossPages;

    const payload = {
        source,
        search,
        dimension,
        from_date: fromDate,
        to_date: toDate,
        ids: isExportAllFiltered ? null : ids,
        select_all: isExportAllFiltered
    };

    try {
        const res = await fetch('/api/data/prompts/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `prompts_export_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } else {
            alert("Failed to export data");
        }
    } catch (e) {
        console.error(e);
        alert("Error exporting data");
    }
}

// Sortable Created At column
function toggleDateSort() {
    currentSort = currentSort === '-created_at' ? 'created_at' : '-created_at';
    const btn = document.getElementById('sortCreatedBtn');
    if (btn) btn.textContent = currentSort === '-created_at' ? '▼' : '▲';
    loadPrompts(1);
}

// Load judge models for the generator dropdown
async function loadJudgeModels() {
    try {
        const res = await fetch('/api/models?category=judge');
        if (!res.ok) return;
        judgeModels = await res.json();

        const select = document.getElementById('genModelSelect');
        select.innerHTML = '';

        if (judgeModels.length === 0) {
            select.innerHTML = '<option value="" disabled selected>No judge models configured</option>';
            return;
        }

        judgeModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = `${m.name} (${m.model_key})`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error("Error loading judge models:", e);
    }
}

// Load existing dimensions for the "Existing Dimension" dropdown
async function loadExistingDimensions() {
    try {
        let url = '/api/data/dimensions';

        const res = await fetch(url);
        if (!res.ok) return;
        const dims = await res.json();

        const select = document.getElementById('genExistingDim');
        select.innerHTML = '';

        if (dims.length === 0) {
            select.innerHTML = '<option value="" disabled selected>No dimensions available</option>';
            return;
        }

        dims.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error("Error loading existing dimensions:", e);
    }
}

// Load dimension template
async function loadDimensionTemplate(name) {
    try {
        const res = await fetch(`/api/data/dimension-template?name=${encodeURIComponent(name || 'Your Dimension')}`);
        if (!res.ok) return;
        const data = await res.json();
        document.getElementById('genDimDesc').value = data.template;
    } catch (e) {
        console.error("Error loading template:", e);
    }
}

// Open the generation modal
function openGenerateModal() {
    loadJudgeModels();
    loadExistingDimensions();
    loadDimensionTemplate();

    // Reset to new dimension mode
    toggleDimensionMode('new');
    document.getElementById('genDimName').value = '';
    document.getElementById('genCount').value = '20';

    document.getElementById('generateModal').classList.add('active');
}

function closeGenerateModal() {
    document.getElementById('generateModal').classList.remove('active');
}

// Toggle between New / Existing dimension mode
function toggleDimensionMode(mode) {
    const newBtn = document.getElementById('genModeNew');
    const existBtn = document.getElementById('genModeExisting');
    const newFields = document.getElementById('genNewFields');
    const existFields = document.getElementById('genExistingFields');

    if (mode === 'new') {
        newBtn.classList.add('active');
        existBtn.classList.remove('active');
        newFields.style.display = 'block';
        existFields.style.display = 'none';
    } else {
        newBtn.classList.remove('active');
        existBtn.classList.add('active');
        newFields.style.display = 'none';
        existFields.style.display = 'block';
    }
}

// Update template when dimension name changes
document.addEventListener('DOMContentLoaded', () => {
    const nameInput = document.getElementById('genDimName');
    if (nameInput) {
        let debounce;
        nameInput.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                const name = nameInput.value.trim();
                if (name) loadDimensionTemplate(name);
            }, 500);
        });
    }
});

// Start the generation process
async function startGeneration() {
    const isNewMode = document.getElementById('genModeNew').classList.contains('active');

    let dimensionName, dimensionDescription;

    if (isNewMode) {
        dimensionName = document.getElementById('genDimName').value.trim();
        dimensionDescription = document.getElementById('genDimDesc').value.trim();

        if (!dimensionName) {
            alert('Please enter a dimension name.');
            return;
        }
        if (!dimensionDescription || dimensionDescription.includes('[Characteristic')) {
            alert('Please fill in the dimension description. Replace the placeholder characteristics with real ones.');
            return;
        }
    } else {
        dimensionName = document.getElementById('genExistingDim').value;
        if (!dimensionName) {
            alert('Please select an existing dimension.');
            return;
        }
        // For existing dimensions, use a generic description
        dimensionDescription = `Generate prompts that evaluate the "${dimensionName}" dimension, following the same style and depth as the existing GLOBE prompts for this dimension.`;
    }

    const totalCount = parseInt(document.getElementById('genCount').value);
    if (!totalCount || totalCount < 1 || totalCount > 500) {
        alert('Prompt count must be between 1 and 500.');
        return;
    }

    const modelId = document.getElementById('genModelSelect').value;
    if (!modelId) {
        alert('Please select a generator model.');
        return;
    }

    // Close generation modal, open progress modal
    closeGenerateModal();
    openProgressModal(dimensionName, totalCount);

    const schemaId = getActiveSchema()?.id;

    try {
        const res = await fetch('/api/data/generate-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dimension_name: dimensionName,
                dimension_description: dimensionDescription,
                total_count: totalCount,
                generator_model_id: modelId,
                is_new_dimension: isNewMode,
                schema_id: schemaId,
            })
        });

        if (!res.ok) {
            const err = await res.json();
            addTerminalLog('error', `Failed to start generation: ${err.detail || 'Unknown error'}`);
            document.getElementById('genProgressStatus').textContent = 'Failed';
            document.getElementById('genDoneBtn').disabled = false;
            return;
        }

        const data = await res.json();
        const jobId = data.job_id;

        // Start SSE stream for logs
        connectGenerationStream(jobId);

        // Start polling for progress
        startProgressPolling(jobId);

    } catch (e) {
        addTerminalLog('error', `Error: ${e.message}`);
        document.getElementById('genProgressStatus').textContent = 'Failed';
        document.getElementById('genDoneBtn').disabled = false;
    }
}

function openProgressModal(dimName, total) {
    document.getElementById('genProgressDimName').textContent = dimName;
    document.getElementById('genProgressText').textContent = `Generated 0 / ${total} prompts`;
    document.getElementById('genProgressFill').style.width = '0%';
    document.getElementById('genProgressFill').textContent = '0%';
    document.getElementById('genProgressStatus').textContent = 'Starting...';
    document.getElementById('genDoneBtn').disabled = true;
    document.getElementById('genTerminal').innerHTML = '<div style="color:#666;font-style:italic;">Connecting to generation stream...</div>';
    document.getElementById('genProgressModal').classList.add('active');
}

function closeProgressModal() {
    // Cleanup
    if (genEventSource) {
        genEventSource.close();
        genEventSource = null;
    }
    if (genPollInterval) {
        clearInterval(genPollInterval);
        genPollInterval = null;
    }

    document.getElementById('genProgressModal').classList.remove('active');

    // Refresh the prompt table and dimensions
    loadPrompts(1);
    loadDimensions();
}

// Connect SSE stream for generation logs
function connectGenerationStream(jobId) {
    if (genEventSource) genEventSource.close();

    genEventSource = new EventSource(`/api/data/generate-prompts/${jobId}/stream`);

    genEventSource.onmessage = (event) => {
        try {
            const log = JSON.parse(event.data);
            addTerminalLog(log.type, log.content);
        } catch (e) {
            console.error("Failed to parse SSE event:", e);
        }
    };

    genEventSource.onerror = () => {
        // SSE will auto-reconnect, but if job is done we should close
        if (genEventSource) {
            genEventSource.close();
            genEventSource = null;
        }
    };
}

// Add a log entry to the terminal
function addTerminalLog(type, content) {
    const terminal = document.getElementById('genTerminal');

    // Remove placeholder
    const placeholder = terminal.querySelector('[style*="font-style:italic"]');
    if (placeholder) placeholder.remove();

    const entry = document.createElement('div');
    entry.style.marginBottom = '4px';
    entry.style.fontFamily = 'inherit';

    // Color by type
    const colors = {
        info: '#60a5fa',
        success: '#4ade80',
        warning: '#facc15',
        error: '#f87171',
    };

    const color = colors[type] || '#e5e7eb';
    const time = new Date().toLocaleTimeString();

    entry.innerHTML = `<span style="color:#666;font-size:11px;">${time}</span> <span style="color:${color};font-weight:600;text-transform:uppercase;font-size:11px;">[${type}]</span> <span style="white-space:pre-wrap;">${escapeHtml(content)}</span>`;
    terminal.appendChild(entry);

    // Auto-scroll to bottom
    terminal.scrollTop = terminal.scrollHeight;
}

// Poll for generation progress
function startProgressPolling(jobId) {
    if (genPollInterval) clearInterval(genPollInterval);

    genPollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/data/generate-prompts/${jobId}/status`);
            if (!res.ok) return;
            const data = await res.json();

            const pct = Math.round(data.progress * 100);
            document.getElementById('genProgressFill').style.width = `${pct}%`;
            document.getElementById('genProgressFill').textContent = `${pct}%`;
            document.getElementById('genProgressText').textContent = `Generated ${data.generated} / ${data.total} prompts`;

            if (data.status === 'completed') {
                document.getElementById('genProgressStatus').textContent = '✓ Complete';
                document.getElementById('genProgressStatus').style.color = '#4ade80';
                document.getElementById('genDoneBtn').disabled = false;
                document.getElementById('genDoneBtn').textContent = 'Done';
                document.getElementById('genDoneBtn').className = '';  // Remove secondary class
                clearInterval(genPollInterval);
                genPollInterval = null;
                if (genEventSource) {
                    genEventSource.close();
                    genEventSource = null;
                }
            } else if (data.status === 'failed') {
                document.getElementById('genProgressStatus').textContent = '✗ Failed';
                document.getElementById('genProgressStatus').style.color = '#f87171';
                document.getElementById('genDoneBtn').disabled = false;
                clearInterval(genPollInterval);
                genPollInterval = null;
                if (genEventSource) {
                    genEventSource.close();
                    genEventSource = null;
                }
            } else {
                document.getElementById('genProgressStatus').textContent = 'Generating...';
                document.getElementById('genProgressStatus').style.color = '#60a5fa';
            }
        } catch (e) {
            console.error("Progress poll error:", e);
        }
    }, 1000);
}

// Utility: escape HTML to prevent XSS in terminal logs
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
