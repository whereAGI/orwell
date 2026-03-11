let allConfigs = {};
let providerKeyStatus = {}; // { provider -> {has_key, masked_key} }
let modelProviders = [];

document.addEventListener('DOMContentLoaded', () => {
    loadConfigs();
    setupScrollSpy();

    // Setup modal close handlers
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', closeProviderModal);
    });
});

async function loadConfigs() {
    try {
        const token = localStorage.getItem('pb_auth_token');
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const [configRes, providerRes] = await Promise.all([
            fetch('/api/config', { headers }),
            fetch('/api/model-providers')
        ]);
        if (!configRes.ok) throw new Error('Failed to load configs');
        allConfigs = await configRes.json();

        // Build provider list
        if (providerRes.ok) {
            modelProviders = await providerRes.json();
        }

        renderLayout();

    } catch (e) {
        document.getElementById('config-container').innerHTML = `<div style="color: #ef4444;">Error loading configuration: ${e.message}</div>`;
        document.getElementById('sidebar-nav').innerHTML = '';
    }
}

function setupScrollSpy() {
    const mainContainer = document.getElementById('config-container');

    // Throttled scroll listener
    let ticking = false;
    mainContainer.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                updateActiveNav();
                ticking = false;
            });
            ticking = true;
        }
    });
}

function updateActiveNav() {
    const sections = document.querySelectorAll('.config-section');
    const navItems = document.querySelectorAll('.nav-item');
    const mainContainer = document.getElementById('config-container');

    let currentSectionId = '';

    // Find the section that is currently most visible or at the top
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.offsetHeight;
        const scrollPosition = mainContainer.scrollTop + 100; // Offset for better feel

        if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
            currentSectionId = section.id;
        }
    });

    // If we're at the very top, highlight the first one
    if (mainContainer.scrollTop < 50 && sections.length > 0) {
        currentSectionId = sections[0].id;
    }

    navItems.forEach(item => {
        item.classList.remove('active');
        // Extract ID from href (#group-id)
        const href = item.getAttribute('href');
        if (href === `#${currentSectionId}`) {
            item.classList.add('active');
        }
    });
}

function renderLayout() {
    const sidebar = document.getElementById('sidebar-nav');
    const container = document.getElementById('config-container');

    sidebar.innerHTML = '';
    container.innerHTML = '';

    // 1. Create Sidebar Header
    const sbHeader = document.createElement('div');
    sbHeader.className = 'sidebar-header';
    sbHeader.textContent = 'Settings';
    sidebar.appendChild(sbHeader);

    // 2. Always render the Model Providers section first
    const providerNavItem = document.createElement('a');
    providerNavItem.className = 'nav-item active';
    providerNavItem.textContent = 'Model Providers';
    providerNavItem.href = '#group-model-providers';
    providerNavItem.onclick = (e) => {
        e.preventDefault();
        document.getElementById('group-model-providers')?.scrollIntoView({ behavior: 'smooth' });
    };
    sidebar.appendChild(providerNavItem);
    renderProviderSection(container);

    const groups = Object.keys(allConfigs);

    if (groups.length === 0) return;

    groups.forEach(groupName => {
        if (groupName === 'Model Providers') return;

        const groupId = `group-${groupName.replace(/\s+/g, '-').toLowerCase()}`;

        const navItem = document.createElement('a');
        navItem.className = 'nav-item';
        navItem.textContent = groupName;
        navItem.href = `#${groupId}`;
        navItem.onclick = (e) => {
            e.preventDefault();
            const target = document.getElementById(groupId);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        };
        sidebar.appendChild(navItem);

        renderGroupSection(container, groupName, groupId, allConfigs[groupName]);
    });
}

// ──────────────────────────────────────────────────
// Model Providers Section
// ──────────────────────────────────────────────────

function renderProviderSection(container) {
    const section = document.createElement('div');
    section.className = 'config-section';
    section.id = 'group-model-providers';

    section.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <h2 class="config-group-title" style="margin:0;">Model Providers</h2>
            <button onclick="openProviderModal()" style="width:auto; padding:8px 16px; font-size:13px;">+ Add Provider</button>
        </div>
        <div class="config-group-desc" style="margin-top:8px;">
            Store API keys per provider here. The Model Hub will use these automatically.
        </div>
        <div id="provider-cards" style="display:grid; grid-template-columns:1fr 1fr; gap:24px;"></div>
    `;
    container.appendChild(section);

    const cardsEl = section.querySelector('#provider-cards');
    modelProviders.forEach(p => {
        cardsEl.appendChild(buildProviderCard(p));
    });
}

function buildProviderCard(p) {
    const hasKey = !!p.api_key;
    const card = document.createElement('div');
    card.className = 'config-item config-item-compact';
    card.id = `provider-card-${p.slug}`;
    card.style.cssText = 'display:flex; flex-direction:column; gap:12px; position:relative;';

    const docsLink = p.website ? `<a href="${p.website}" target="_blank" style="font-size:12px; color:var(--primary); text-decoration:none;">${p.website.replace('https://','').replace(/\/$/, '')} ↗</a>` : '';
    
    // Action buttons
    let actionButtons = '';
    
    if (!p.is_builtin) {
        actionButtons += `
            <button class="secondary" style="padding:4px 8px; font-size:11px; width:auto;" onclick="editProvider('${p.slug}')">Edit</button>
            <button class="danger" style="padding:4px 8px; font-size:11px; width:auto;" onclick="deleteProvider('${p.slug}')">Delete</button>
        `;
    } else {
         actionButtons += `
            <button class="secondary" style="padding:4px 8px; font-size:11px; width:auto;" onclick="editProvider('${p.slug}')">Edit</button>
        `;
    }

    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="config-label" style="margin:0;">${p.name}</span>
                    <span style="font-size:12px; font-weight:600; color:${hasKey ? 'var(--success, #48bb78)' : 'var(--muted)'};">
                        ${hasKey ? `✅ Configured` : '⚪ Not configured'}
                    </span>
                </div>
                <div style="font-size:12px; color:var(--muted); margin-top:4px;">
                    ${p.base_url || 'No base URL'}
                </div>
            </div>
            <div style="display:flex; gap:6px;">
                ${actionButtons}
            </div>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:-4px;">
             ${docsLink}
        </div>

        <div style="display:flex; gap:8px; align-items:center;">
            <input type="password"
                   id="provider-key-input-${p.slug}"
                   class="config-input"
                   placeholder="${hasKey ? 'Stored (Enter to update)' : 'Enter API Key'}"
                   style="flex:1; margin:0;"
                   autocomplete="new-password">
            <button class="save-btn" style="flex-shrink:0;" onclick="updateProviderKey('${p.slug}')">Save Key</button>
            ${hasKey ? `<button class="save-btn" style="flex-shrink:0; background:var(--danger,#e53e3e);" onclick="clearProviderKey('${p.slug}')">Clear</button>` : ''}
        </div>
        <span id="provider-save-status-${p.slug}" class="save-status"></span>
    `;
    return card;
}

// Just update the key (and maybe base url if we exposed it in card, but for now just key)
async function updateProviderKey(slug) {
    const input = document.getElementById(`provider-key-input-${slug}`);
    const statusEl = document.getElementById(`provider-save-status-${slug}`);
    const key = input.value.trim();
    
    if (!key) {
        statusEl.textContent = 'Please enter a key.';
        statusEl.style.color = 'var(--danger, #e53e3e)';
        statusEl.style.opacity = '1';
        return;
    }

    const provider = modelProviders.find(p => p.slug === slug);
    if (!provider) return;

    try {
        const res = await fetch(`/api/model-providers/${slug}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...provider, api_key: key }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to save');
        }
        
        const updated = await res.json();
        // Update local list
        const idx = modelProviders.findIndex(p => p.slug === slug);
        if (idx !== -1) modelProviders[idx] = updated;

        input.value = '';
        statusEl.textContent = 'Saved successfully';
        statusEl.style.color = 'var(--success, #48bb78)';
        statusEl.style.opacity = '1';
        setTimeout(() => { statusEl.style.opacity = '0'; }, 2500);

        // Refresh the card
        const card = document.getElementById(`provider-card-${slug}`);
        if (card) card.replaceWith(buildProviderCard(updated));

    } catch (e) {
        statusEl.textContent = `Error: ${e.message}`;
        statusEl.style.color = 'var(--danger, #e53e3e)';
        statusEl.style.opacity = '1';
    }
}

async function clearProviderKey(slug) {
    if (!confirm(`Remove the stored API key for ${slug}?`)) return;

    const provider = modelProviders.find(p => p.slug === slug);
    if (!provider) return;

    try {
        // We update with empty key
        const res = await fetch(`/api/model-providers/${slug}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...provider, api_key: '' }),
        });
        if (!res.ok) throw new Error('Failed to clear key');

        const updated = await res.json();
        const idx = modelProviders.findIndex(p => p.slug === slug);
        if (idx !== -1) modelProviders[idx] = updated;

        const card = document.getElementById(`provider-card-${slug}`);
        if (card) card.replaceWith(buildProviderCard(updated));

    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

// ──────────────────────────────────────────────────
// Delete Provider
// ──────────────────────────────────────────────────

let deleteTargetSlug = null;

function deleteProvider(slug) {
    deleteTargetSlug = slug;
    const modal = document.getElementById('deleteModal');
    const msg = document.getElementById('deleteMessage');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    
    msg.textContent = `Are you sure you want to delete the provider '${slug}'? This cannot be undone.`;
    confirmBtn.onclick = () => confirmDeleteProvider(false);
    
    modal.style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
    deleteTargetSlug = null;
}

function closeDependencyModal() {
    document.getElementById('dependencyModal').style.display = 'none';
    deleteTargetSlug = null;
}

async function confirmDeleteProvider(force = false) {
    if (!deleteTargetSlug) return;
    const slug = deleteTargetSlug;
    
    // Determine which button to update state on
    const btnId = force ? 'forceDeleteBtn' : 'confirmDeleteBtn';
    const btn = document.getElementById(btnId);
    const originalText = btn.textContent;
    btn.textContent = 'Deleting...';
    btn.disabled = true;
    
    try {
        const url = `/api/model-providers/${slug}` + (force ? '?force=true' : '');
        const res = await fetch(url, { method: 'DELETE' });
        
        if (!res.ok) {
            const err = await res.json();
            
            // Check for dependency conflict (409)
            if (res.status === 409) {
                // Parse count from error message if possible, or just show modal
                // Backend msg: "Provider is used by {count} models..."
                const msg = err.detail || '';
                const match = msg.match(/used by (\d+) models/);
                const count = match ? match[1] : 'some';
                
                // Close first modal
                closeDeleteModal();
                deleteTargetSlug = slug; // Restore slug
                
                // Open dependency modal
                const depModal = document.getElementById('dependencyModal');
                document.getElementById('depCount').textContent = count;
                document.getElementById('forceDeleteBtn').onclick = () => confirmDeleteProvider(true);
                depModal.style.display = 'flex';
                return;
            }
            
            throw new Error(err.detail || 'Failed to delete');
        }
        
        // Success
        // Remove from list
        modelProviders = modelProviders.filter(p => p.slug !== slug);
        
        // Remove card
        const card = document.getElementById(`provider-card-${slug}`);
        if (card) card.remove();
        
        if (force) closeDependencyModal();
        else closeDeleteModal();
        
    } catch(e) {
        alert(e.message);
    } finally {
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}


// ──────────────────────────────────────────────────
// Add/Edit Provider Modal
// ──────────────────────────────────────────────────

let editingProviderSlug = null;

function openProviderModal() {
    editingProviderSlug = null;
    document.getElementById('providerModal').style.display = 'flex';
    document.getElementById('providerModalTitle').textContent = 'Add New Provider';
    document.getElementById('provName').value = '';
    document.getElementById('provName').disabled = false;
    document.getElementById('provBaseUrl').value = '';
    document.getElementById('provApiKey').value = '';
    document.getElementById('provWebsite').value = '';
    document.getElementById('saveProviderBtn').textContent = 'Save Provider';
}

function editProvider(slug) {
    const p = modelProviders.find(x => x.slug === slug);
    if (!p) return;
    
    editingProviderSlug = slug;
    document.getElementById('providerModal').style.display = 'flex';
    document.getElementById('providerModalTitle').textContent = 'Edit Provider';
    
    document.getElementById('provName').value = p.name;
    // Don't allow renaming built-ins to avoid confusion or slug mismatch issues if we relied on slug
    // But for custom providers, we can allow renaming if backend supports it. 
    // Backend doesn't support changing slug, so name change is just cosmetic label.
    document.getElementById('provName').disabled = false; 
    
    document.getElementById('provBaseUrl').value = p.base_url || '';
    document.getElementById('provApiKey').value = ''; // Don't show existing key
    document.getElementById('provApiKey').placeholder = p.api_key ? 'Stored (Enter to update)' : 'sk-...';
    document.getElementById('provWebsite').value = p.website || '';
    
    document.getElementById('saveProviderBtn').textContent = 'Update Provider';
}

function closeProviderModal() {
    document.getElementById('providerModal').style.display = 'none';
    editingProviderSlug = null;
}

async function saveProvider() {
    const name = document.getElementById('provName').value.trim();
    const baseUrl = document.getElementById('provBaseUrl').value.trim();
    const apiKey = document.getElementById('provApiKey').value.trim();
    const website = document.getElementById('provWebsite').value.trim();

    if (!name) return alert('Provider Name is required');
    if (!baseUrl) return alert('Base URL is required');

    const btn = document.getElementById('saveProviderBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
        let res;
        let method = 'POST';
        let url = '/api/model-providers';
        let payload = {
            slug: editingProviderSlug || '', 
            name,
            base_url: baseUrl,
            api_key: apiKey || null,
            website: website || null
        };
        
        if (editingProviderSlug) {
            method = 'PUT';
            url = `/api/model-providers/${editingProviderSlug}`;
            
            // If we are editing, we need to preserve the existing key if the user left the field blank
            // Backend handles this: if we send null/empty string for api_key, it might clear it. 
            // Our backend logic: "if new_key and ('...' in new_key or new_key == '***'): ignore".
            // But if user sends "", we need to know if they meant "clear it" or "keep it".
            // The prompt says "Enter to update". If empty, we usually mean "keep existing".
            // Let's check backend implementation again.
            // Backend: "if new_key and ...". If new_key is empty string, it updates to empty string.
            // So we should NOT send api_key field if it is empty during update, OR we fetch existing to check.
            
            // Better approach: If apiKey is empty string, send null/undefined to signal "no change"? 
            // Backend pydantic model expects string optional.
            // Let's modify logic: if empty, don't send api_key in payload at all?
            // Or assume empty input = keep existing.
            // If user wants to clear, they use the "Clear" button on the card.
            if (!apiKey) {
                const existing = modelProviders.find(p => p.slug === editingProviderSlug);
                payload.api_key = existing.api_key; // Send back existing (masked)
            }
        }

        res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to save provider');
        }

        const savedProvider = await res.json();
        
        if (editingProviderSlug) {
            // Update in place
            const idx = modelProviders.findIndex(p => p.slug === editingProviderSlug);
            if (idx !== -1) modelProviders[idx] = savedProvider;
            
            const card = document.getElementById(`provider-card-${editingProviderSlug}`);
            if (card) card.replaceWith(buildProviderCard(savedProvider));
        } else {
            // Add new
            modelProviders.push(savedProvider);
            const cardsEl = document.getElementById('provider-cards');
            if (cardsEl) cardsEl.appendChild(buildProviderCard(savedProvider));
        }
        
        closeProviderModal();

    } catch (e) {
        alert(e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function renderGroupSection(container, groupName, groupId, groupData) {
    const section = document.createElement('div');
    section.className = 'config-section';
    section.id = groupId;

    const title = document.createElement('h2');
    title.className = 'config-group-title';
    title.textContent = groupName;
    section.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'config-group-desc';
    desc.textContent = getGroupDescription(groupName);
    section.appendChild(desc);

    groupData.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'config-item';

        const label = document.createElement('label');
        label.className = 'config-label';
        label.textContent = formatKey(item.key);

        const itemDesc = document.createElement('div');
        itemDesc.className = 'config-desc';
        itemDesc.textContent = item.description || '';

        let input;
        const isLongText = (item.type === 'text' && (item.value.length > 50 || item.key.includes('prompt') || item.key.includes('persona')));

        if (isLongText) {
            input = document.createElement('textarea');
            input.className = 'config-textarea';
            input.rows = 12; // Taller for system prompts

            // Add placeholder hint if it's a template
            if (item.value.includes('{persona}')) {
                const hint = document.createElement('div');
                hint.className = 'config-hint';
                hint.innerHTML = '<code>{persona}</code> will be replaced by the <strong>Analysis Persona</strong> defined in Report Settings.';
                itemDiv.appendChild(hint);
            }
        } else {
            input = document.createElement('input');
            input.className = 'config-input';
            input.type = item.type === 'number' ? 'number' : 'text';
            if (item.type === 'number') input.step = "0.1";
        }

        input.value = item.value;
        input.id = `input-${item.key}`;

        // Action Bar
        const actionBar = document.createElement('div');
        actionBar.className = 'action-bar';

        const statusSpan = document.createElement('span');
        statusSpan.className = 'save-status';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'save-btn';
        saveBtn.textContent = 'Save';

        saveBtn.onclick = () => saveConfig(item.key, input.value, saveBtn, statusSpan);

        actionBar.appendChild(statusSpan);
        actionBar.appendChild(saveBtn);

        // Only append label and desc if not already appended (logic was correct, just ensure hint is placed right)
        itemDiv.appendChild(label);
        itemDiv.appendChild(itemDesc);
        // Hint was appended above if needed
        itemDiv.appendChild(input);
        itemDiv.appendChild(actionBar);

        // Use grid layout for short inputs to save space
        if (!isLongText) {
            itemDiv.classList.add('config-item-compact');
        }

        section.appendChild(itemDiv);
    });

    // Adjust section class to grid if it contains compact items
    if (section.querySelectorAll('.config-item-compact').length > 0) {
        section.classList.add('config-section-grid');
    }

    container.appendChild(section);
}

function getGroupDescription(groupName) {
    // Optional helper to add descriptions to groups if not present in data
    const map = {
        'Judge Settings': 'Configure the AI Judge behavior, including scoring criteria and strictness.',
        'Jury Settings': 'Settings for the multi-judge consensus mechanism.',
        'Report Settings': 'Customize the tone, style, and templates used for generating audit reports.',
        'Target Model Defaults': 'Fallback settings for target models when not explicitly configured.',
        'Data Generation': 'Customize the system prompts and templates used for generating evaluation data.'
    };
    return map[groupName] || `Configuration settings for ${groupName}`;
}

function formatKey(key) {
    // judge_system_prompt -> Judge System Prompt
    return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function saveConfig(key, value, btn, statusSpan) {
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    statusSpan.style.opacity = '0';

    try {
        const token = localStorage.getItem('pb_auth_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/config', {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ key, value })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to save');
        }

        statusSpan.textContent = 'Saved successfully';
        statusSpan.style.color = 'var(--success)';
        statusSpan.style.opacity = '1';

        setTimeout(() => {
            statusSpan.style.opacity = '0';
        }, 2000);

        // Update local cache
        for (const g in allConfigs) {
            const found = allConfigs[g].find(i => i.key === key);
            if (found) {
                found.value = value;
                break;
            }
        }
    } catch (e) {
        statusSpan.textContent = `Error: ${e.message}`;
        statusSpan.style.color = 'var(--danger)';
        statusSpan.style.opacity = '1';
        console.error(e);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}
