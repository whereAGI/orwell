let allConfigs = {};
let providerKeyStatus = {}; // { provider -> {has_key, masked_key} }

document.addEventListener('DOMContentLoaded', () => {
    loadConfigs();
    setupScrollSpy();
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
            fetch('/api/provider-keys')
        ]);
        if (!configRes.ok) throw new Error('Failed to load configs');
        allConfigs = await configRes.json();

        // Build provider key status map
        if (providerRes.ok) {
            const list = await providerRes.json();
            list.forEach(p => { providerKeyStatus[p.provider] = p; });
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

const PROVIDER_META = {
    openai: {
        label: 'OpenAI',
        docsUrl: 'https://platform.openai.com/api-keys',
        docsLabel: 'Get API key →',
        placeholder: 'sk-...',
    },
    openrouter: {
        label: 'OpenRouter',
        docsUrl: 'https://openrouter.ai/settings/keys',
        docsLabel: 'Get API key →',
        placeholder: 'sk-or-...',
    },
};

function renderProviderSection(container) {
    const section = document.createElement('div');
    section.className = 'config-section';
    section.id = 'group-model-providers';

    section.innerHTML = `
        <h2 class="config-group-title">Model Providers</h2>
        <div class="config-group-desc">
            Store API keys per provider here. The Model Hub will use these automatically — 
            no need to enter a key each time you add a new model.
        </div>
        <div id="provider-cards" style="display:grid; grid-template-columns:1fr 1fr; gap:24px;"></div>
    `;
    container.appendChild(section);

    const cardsEl = section.querySelector('#provider-cards');
    Object.entries(PROVIDER_META).forEach(([provider, meta]) => {
        cardsEl.appendChild(buildProviderCard(provider, meta));
    });
}

function buildProviderCard(provider, meta) {
    const status = providerKeyStatus[provider] || { has_key: false, masked_key: null };

    const card = document.createElement('div');
    card.className = 'config-item config-item-compact';
    card.id = `provider-card-${provider}`;
    card.style.cssText = 'display:flex; flex-direction:column; gap:12px;';

    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="config-label" style="margin:0;">${meta.label}</span>
            <span id="provider-status-${provider}" style="font-size:12px; font-weight:600; color:${status.has_key ? 'var(--success, #48bb78)' : 'var(--muted)'};">
                ${status.has_key ? `✅ Configured &nbsp;<code style="font-size:11px; opacity:0.7;">${status.masked_key}</code>` : '⚪ Not configured'}
            </span>
        </div>
        <a href="${meta.docsUrl}" target="_blank" style="font-size:12px; color:var(--primary); text-decoration:none;">${meta.docsLabel}</a>
        <div style="display:flex; gap:8px; align-items:center;">
            <input type="password"
                   id="provider-key-input-${provider}"
                   class="config-input"
                   placeholder="${meta.placeholder}"
                   style="flex:1; margin:0;"
                   autocomplete="new-password">
            <button class="save-btn" style="flex-shrink:0;" onclick="saveProviderKey('${provider}')">Save</button>
            ${status.has_key ? `<button class="save-btn" style="flex-shrink:0; background:var(--danger,#e53e3e);" onclick="clearProviderKey('${provider}')">Clear</button>` : ''}
        </div>
        <span id="provider-save-status-${provider}" class="save-status"></span>
    `;
    return card;
}

async function saveProviderKey(provider) {
    const input = document.getElementById(`provider-key-input-${provider}`);
    const statusEl = document.getElementById(`provider-save-status-${provider}`);
    const key = input.value.trim();

    if (!key) {
        statusEl.textContent = 'Please enter a key.';
        statusEl.style.color = 'var(--danger, #e53e3e)';
        statusEl.style.opacity = '1';
        return;
    }

    try {
        const res = await fetch(`/api/provider-keys/${provider}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: key }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to save');
        }

        // Update local status cache
        const masked = key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : '***';
        providerKeyStatus[provider] = { has_key: true, masked_key: masked };

        input.value = '';
        statusEl.textContent = 'Saved successfully';
        statusEl.style.color = 'var(--success, #48bb78)';
        statusEl.style.opacity = '1';
        setTimeout(() => { statusEl.style.opacity = '0'; }, 2500);

        // Refresh the card to show Clear button
        const card = document.getElementById(`provider-card-${provider}`);
        if (card) card.replaceWith(buildProviderCard(provider, PROVIDER_META[provider]));

    } catch (e) {
        statusEl.textContent = `Error: ${e.message}`;
        statusEl.style.color = 'var(--danger, #e53e3e)';
        statusEl.style.opacity = '1';
    }
}

async function clearProviderKey(provider) {
    if (!confirm(`Remove the stored API key for ${PROVIDER_META[provider]?.label || provider}?`)) return;

    try {
        const res = await fetch(`/api/provider-keys/${provider}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to clear key');

        providerKeyStatus[provider] = { has_key: false, masked_key: null };

        // Refresh the card to remove Clear button + reset status
        const card = document.getElementById(`provider-card-${provider}`);
        if (card) card.replaceWith(buildProviderCard(provider, PROVIDER_META[provider]));

    } catch (e) {
        alert(`Error: ${e.message}`);
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
