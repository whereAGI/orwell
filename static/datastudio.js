let allPrompts = [];
let deleteTargetId = null;
let editTargetId = null;

// Wrap fetch to include token
const originalFetch = window.fetch;
window.fetch = async (url, options = {}) => {
    if (!options.headers) options.headers = {};
    if (pb.authStore.isValid) {
        options.headers['Authorization'] = `Bearer ${pb.authStore.token} `;
    }
    return originalFetch(url, options);
};

let currentPage = 1;
let perPage = 100; // Default to 100
let totalItems = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Load dimensions first so dropdown is populated
    loadDimensions().then(() => {
        loadPrompts(1);
    });

    // Add listeners for filters
    let searchTimeout;
    document.getElementById('search').addEventListener('keyup', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => loadPrompts(1), 300);
    });
    
    document.getElementById('dimFilter').addEventListener('change', () => loadPrompts(1));
    document.getElementById('sourceFilter').addEventListener('change', () => loadPrompts(1));
    document.getElementById('rowsPerPage').addEventListener('change', updateRowsPerPage);
});

async function loadDimensions() {
    try {
        const res = await fetch('/api/data/dimensions');
        if (res.ok) {
            const dims = await res.json();
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
        
        let url = `/api/data/prompts?page=${page}&per_page=${perPage}&source=${source}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (dimension) url += `&dimension=${encodeURIComponent(dimension)}`;
        
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
    updateBulkDeleteState();
}

function updateBulkDeleteState() {
    const checkboxes = document.querySelectorAll('.row-checkbox:checked');
    const btn = document.getElementById('bulkDeleteBtn');
    if (checkboxes.length > 0) {
        btn.style.display = 'inline-block';
        btn.textContent = `Delete Selected (${checkboxes.length})`;
    } else {
        btn.style.display = 'none';
    }
}

async function bulkDelete() {
    const checkboxes = document.querySelectorAll('.row-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.value);
    
    if (ids.length === 0) return;
    
    // Use the custom modal for bulk delete too
    deleteTargetId = ids; // Store array for bulk delete logic
    document.getElementById('deleteModal').classList.add('active');
    
    // Update message
    const msg = document.querySelector('#deleteModal p');
    if (msg) msg.textContent = `Are you sure you want to delete ${ids.length} prompts? This action cannot be undone.`;
    
    document.getElementById('confirmDeleteBtn').onclick = () => performBulkDelete(ids);
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
    if (selectAll) selectAll.checked = false;
    updateBulkDeleteState();

    // Data is already filtered by server
    allPrompts.forEach((p, index) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50';

        // Row Index (Global)
        const globalIndex = (currentPage - 1) * perPage + index + 1;

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <input type="checkbox" class="row-checkbox" value="${p.id}" onchange="updateBulkDeleteState()">
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${globalIndex}</td>
            <td class="px-6 py-4 text-sm text-gray-900">
                <div class="line-clamp-2" title="${p.dimension}">${p.dimension}</div>
            </td>
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
