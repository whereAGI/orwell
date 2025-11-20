let allPrompts = [];
let deleteTargetId = null;

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
let perPage = 50;
let totalItems = 0;

document.addEventListener('DOMContentLoaded', () => {
    loadPrompts(1);

    document.getElementById('prevBtn').addEventListener('click', () => {
        if (currentPage > 1) loadPrompts(currentPage - 1);
    });

    document.getElementById('nextBtn').addEventListener('click', () => {
        if (currentPage * perPage < totalItems) loadPrompts(currentPage + 1);
    });

    // Add listeners for filters
    document.getElementById('search').addEventListener('keyup', () => renderTable());
    document.getElementById('dimFilter').addEventListener('change', () => renderTable());
    document.getElementById('sourceFilter').addEventListener('change', () => loadPrompts(1));
    document.getElementById('rowsPerPage').addEventListener('change', updateRowsPerPage);
});

async function loadPrompts(page = 1) {
    try {
        const source = document.getElementById('sourceFilter').value || 'all';
        const res = await fetch(`/api/data/prompts?page=${page}&per_page=${perPage}&source=${source}`);
        if (!res.ok) throw new Error('Failed to load prompts');
        const data = await res.json();

        allPrompts = data.items;
        totalItems = data.total;
        currentPage = data.page;

        renderTable();
        updatePaginationControls();
        updateFilters();
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

function updatePaginationControls() {
    const totalPages = Math.ceil(totalItems / perPage);
    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages} (Total: ${totalItems})`;
    document.getElementById('prevBtn').disabled = currentPage === 1;
    document.getElementById('nextBtn').disabled = currentPage >= totalPages;
}

function renderTable() {
    const tbody = document.getElementById('promptTable');
    tbody.innerHTML = '';

    const filterText = document.getElementById('search').value.toLowerCase();
    const filterDim = document.getElementById('dimFilter').value;

    allPrompts.forEach((p, index) => {
        // Simple client-side filter for the current page view
        if (filterText && !p.text.toLowerCase().includes(filterText)) return;
        if (filterDim && p.dimension !== filterDim) return;

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50';

        // Row Index (Global)
        const globalIndex = (currentPage - 1) * perPage + index + 1;

        tr.innerHTML = `
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
                ${p.type === 'custom' ? `
                    <button onclick="openDeleteModal('${p.id}')" class="text-red-600 hover:text-red-900">
                        Delete
                    </button>
                ` : '<span class="text-gray-400 text-xs">System</span>'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateFilters() {
    // We can't easily get ALL dimensions from paginated data.
    // So we either fetch all dimensions separately or just show dimensions from current page.
    // For now, let's just show dimensions from current page to avoid extra API calls, 
    // or hardcode common ones?
    // Better: The API could return available dimensions?
    // Let's stick to current page dimensions for simplicity or keep existing options if populated.

    const select = document.getElementById('dimFilter');
    // Only populate if empty (first load)
    if (select.options.length <= 1) {
        const dims = [...new Set(allPrompts.map(p => p.dimension))].sort();
        dims.forEach(d => {
            if (!d) return;
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            select.appendChild(opt);
        });
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
            loadPrompts(currentPage); // Reload current page
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
            loadPrompts(currentPage); // Reload current page
        } else {
            alert("Failed to delete prompt");
        }
    } catch (e) {
        console.error(e);
        alert("Error deleting prompt");
    }
}
