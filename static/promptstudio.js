let allPrompts = [];
let deleteTargetId = null;
let editingId = null;

// Override fetch to include auth header
const originalFetch = window.fetch;
window.fetch = async (url, options = {}) => {
    if (!options.headers) options.headers = {};
    if (pb.authStore.isValid) {
        options.headers['Authorization'] = `Bearer ${pb.authStore.token}`;
    }
    return originalFetch(url, options);
};

document.addEventListener('DOMContentLoaded', () => {
    loadPrompts();
});

async function loadPrompts() {
    try {
        const res = await fetch('/api/system-prompts');
        if (!res.ok) throw new Error('Failed to load prompts');
        allPrompts = await res.json();
        renderTable();
    } catch (e) {
        console.error(e);
        alert('Error loading prompts: ' + e.message);
    }
}

function renderTable() {
    const tbody = document.getElementById('promptTable');
    tbody.innerHTML = '';

    if (allPrompts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted)">No system prompts found. Create one!</td></tr>';
        return;
    }

    allPrompts.forEach(p => {
        const tr = document.createElement('tr');
        
        const dateStr = new Date(p.created_at).toLocaleDateString();
        
        tr.innerHTML = `
            <td><div style="font-weight:600">${escapeHtml(p.name)}</div></td>
            <td><div style="max-height:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)">${escapeHtml(p.text)}</div></td>
            <td style="font-size:12px;">
                <div style="color:var(--text);font-weight:600">${p.token_count} tokens</div>
                <div style="color:var(--muted)">${p.char_count} chars</div>
            </td>
            <td style="color:var(--muted);font-size:12px;">${dateStr}</td>
            <td>
                <div style="display:flex;gap:4px;">
                    <button style="padding:4px 8px;font-size:12px;" onclick="openEditModal('${p.id}')">Edit</button>
                    <button class="secondary" style="padding:4px 8px;font-size:12px;" onclick="clonePrompt('${p.id}')">Clone</button>
                    <button class="danger" style="padding:4px 8px;font-size:12px;" onclick="openDeleteModal('${p.id}')">Delete</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Modal Logic
function openAddModal() {
    editingId = null;
    document.getElementById('modalTitle').textContent = 'Add System Prompt';
    document.getElementById('newName').value = '';
    document.getElementById('newText').value = '';
    document.getElementById('addModal').classList.add('active');
}

function openEditModal(id) {
    const prompt = allPrompts.find(p => p.id === id);
    if (!prompt) return;

    editingId = id;
    document.getElementById('modalTitle').textContent = 'Edit System Prompt';
    document.getElementById('newName').value = prompt.name;
    document.getElementById('newText').value = prompt.text;
    document.getElementById('addModal').classList.add('active');
}

function clonePrompt(id) {
    const prompt = allPrompts.find(p => p.id === id);
    if (!prompt) return;

    editingId = null; // New prompt
    document.getElementById('modalTitle').textContent = 'Clone System Prompt';
    document.getElementById('newName').value = `${prompt.name} (Copy)`;
    document.getElementById('newText').value = prompt.text;
    document.getElementById('addModal').classList.add('active');
}

function closeAddModal() {
    document.getElementById('addModal').classList.remove('active');
    document.getElementById('newName').value = '';
    document.getElementById('newText').value = '';
    editingId = null;
}

async function submitPrompt() {
    const name = document.getElementById('newName').value.trim();
    const text = document.getElementById('newText').value.trim();

    if (!name || !text) {
        alert('Please fill in all fields');
        return;
    }

    try {
        let url = '/api/system-prompts';
        let method = 'POST';

        if (editingId) {
            url = `/api/system-prompts/${editingId}`;
            method = 'PATCH';
        }

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, text })
        });

        if (!res.ok) throw new Error(await res.text());

        closeAddModal();
        loadPrompts();
    } catch (e) {
        alert('Error saving prompt: ' + e.message);
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
        const res = await fetch(`/api/system-prompts/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error(await res.text());
        
        closeDeleteModal();
        loadPrompts();
    } catch (e) {
        alert('Error deleting prompt: ' + e.message);
    }
}
