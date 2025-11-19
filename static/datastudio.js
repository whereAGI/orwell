let allPrompts = [];
let deleteTargetId = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchPrompts();
});

async function fetchPrompts() {
    try {
        const res = await fetch('/api/data/prompts');
        allPrompts = await res.json();
        renderTable();
        updateFilters();
    } catch (e) {
        console.error("Failed to fetch prompts", e);
    }
}

let currentPage = 1;
let rowsPerPage = 100;
let filteredPrompts = [];

function renderTable() {
    const tbody = document.getElementById('promptTable');
    tbody.innerHTML = '';

    const search = document.getElementById('search').value.toLowerCase();
    const dimFilter = document.getElementById('dimFilter').value;
    const sourceFilter = document.getElementById('sourceFilter').value;

    // 1. Filter
    filteredPrompts = allPrompts.filter(p => {
        const matchesSearch = (p.text || '').toLowerCase().includes(search) || (p.dimension || '').toLowerCase().includes(search);
        const matchesDim = !dimFilter || p.dimension === dimFilter;
        const matchesSource = !sourceFilter || (sourceFilter === 'custom' ? p.source === 'custom' : p.source !== 'custom');
        return matchesSearch && matchesDim && matchesSource;
    });

    // 2. Paginate
    const total = filteredPrompts.length;
    const totalPages = Math.ceil(total / rowsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const pageItems = filteredPrompts.slice(start, end);

    // 3. Render
    pageItems.forEach((p, index) => {
        const tr = document.createElement('tr');
        const isCustom = p.source === 'custom';
        const globalIndex = start + index + 1;
        tr.innerHTML = `
            <td style="color:var(--muted); font-family:monospace;">${globalIndex}</td>
            <td>${p.dimension}</td>
            <td style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${p.text}">${p.text}</td>
            <td>${p.language}</td>
            <td><span class="badge ${isCustom ? 'custom' : ''}">${p.source}</span></td>
            <td>
                ${isCustom ? `<button class="danger" style="padding: 4px 8px; width: auto; font-size: 12px;" onclick="openDeleteModal('${p.id}')">Delete</button>` : '<span style="color:var(--muted);font-size:12px;">System</span>'}
            </td>
        `;
        tbody.appendChild(tr);
    });

    // 4. Update Controls
    document.getElementById('pageInfo').textContent = `Showing ${total > 0 ? start + 1 : 0}-${Math.min(end, total)} of ${total}`;
    document.getElementById('prevBtn').disabled = currentPage === 1;
    document.getElementById('nextBtn').disabled = currentPage === totalPages;
}

function updateFilters() {
    const dims = [...new Set(allPrompts.map(p => p.dimension))].sort();
    const select = document.getElementById('dimFilter');
    const current = select.value;
    select.innerHTML = '<option value="">All Dimensions</option>';
    dims.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        select.appendChild(opt);
    });
    select.value = current;
}

function filterTable() {
    currentPage = 1; // Reset to first page on filter change
    renderTable();
}

function updateRowsPerPage() {
    const val = parseInt(document.getElementById('rowsPerPage').value);
    if (val > 0) {
        rowsPerPage = val;
        currentPage = 1;
        renderTable();
    }
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderTable();
    }
}

function nextPage() {
    const totalPages = Math.ceil(filteredPrompts.length / rowsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        renderTable();
    }
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
            fetchPrompts();
        } else {
            alert("Failed to save prompt");
        }
    } catch (e) {
        console.error(e);
        alert("Error saving prompt");
    }
}

function openDeleteModal(id) {
    deleteTargetId = id;
    document.getElementById('deleteModal').classList.add('active');
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
            fetchPrompts();
        } else {
            alert("Failed to delete prompt");
        }
    } catch (e) {
        console.error(e);
        alert("Error deleting prompt");
    }
}
