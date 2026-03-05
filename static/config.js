let allConfigs = {};

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
        
        const res = await fetch('/api/config', { headers });
        if (!res.ok) throw new Error('Failed to load configs');
        allConfigs = await res.json();
        
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
    
    const groups = Object.keys(allConfigs);
    
    if (groups.length === 0) {
        container.innerHTML = '<div style="color: var(--muted);">No configurations found.</div>';
        return;
    }

    // Sort groups if needed, or keep server order (usually alphabetical or insertion order)
    // Let's rely on server order for now.

    // 1. Create Sidebar Header
    const sbHeader = document.createElement('div');
    sbHeader.className = 'sidebar-header';
    sbHeader.textContent = 'Settings';
    sidebar.appendChild(sbHeader);

    groups.forEach(groupName => {
        const groupId = `group-${groupName.replace(/\s+/g, '-').toLowerCase()}`;
        
        // 2. Add Sidebar Item
        const navItem = document.createElement('a');
        navItem.className = 'nav-item';
        navItem.textContent = groupName;
        navItem.href = `#${groupId}`;
        navItem.onclick = (e) => {
            e.preventDefault();
            // Scroll to section
            const target = document.getElementById(groupId);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
                // Let scroll listener update the active class
            }
        };
        sidebar.appendChild(navItem);
        
        // 3. Render Section in Main Content
        renderGroupSection(container, groupName, groupId, allConfigs[groupName]);
    });
    
    // Set first item active initially
    if (sidebar.querySelector('.nav-item')) {
        sidebar.querySelector('.nav-item').classList.add('active');
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
        'Target Model Defaults': 'Fallback settings for target models when not explicitly configured.'
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
