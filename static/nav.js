
function getActiveSchema() {
    try {
        return JSON.parse(localStorage.getItem('orwell_active_schema') || 'null');
    } catch (e) {
        return null;
    }
}

function setActiveSchema(s) {
    localStorage.setItem('orwell_active_schema', JSON.stringify(s));
    window.dispatchEvent(new CustomEvent('schemaChanged', { detail: s }));
}

function clearActiveSchema() {
    localStorage.removeItem('orwell_active_schema');
}

// Make helpers available globally
window.getActiveSchema = getActiveSchema;
window.setActiveSchema = setActiveSchema;
window.clearActiveSchema = clearActiveSchema;

async function renderNavbar(activePage, options = {}) {
    const header = document.querySelector('header');
    if (!header) return;

    // Enforce header styles
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '12px 16px';
    header.style.borderBottom = '1px solid var(--border)';
    header.style.background = '#0d0d13';

    const titleMap = {
        'playground': 'playground',
        'data_studio': 'data studio',
        'prompt_studio': 'prompt studio',
        'model_hub': 'model hub',
        'schemas': 'schemas',
        'config': 'config',
        'docs': 'docs',
        'generate': 'generate'
    };

    const pageTitle = titleMap[activePage] || 'studio';

    // New nav order
    const allLinks = [
        { id: 'schemas', href: '/schemas', text: 'Schemas' },
        { id: 'playground', href: '/', text: 'Playground' },
        { id: 'data_studio', href: '/studio', text: 'Data Studio' },
        { id: 'prompt_studio', href: '/prompt-studio', text: 'Prompt Studio' },
        { id: 'model_hub', href: '/model-hub', text: 'Model Hub' },
        { id: 'config', href: '/config', text: 'Config' },
        { id: 'docs', href: '/docs', text: 'Docs' }
    ];

    const navLinksHtml = allLinks
        .filter(link => link.id !== activePage)
        .map(link => `<a href="${link.href}" style="color:var(--text);text-decoration:none;padding:4px 8px;border-radius:4px;background:#1f2937;">${link.text}</a>`)
        .join('');

    const showSelector = options.showSchemaSelector === true;
    const selectorHtml = showSelector ? `
        <div id="navSchemaWrap" style="display:flex;align-items:center;gap:6px;">
          <span style="color:var(--muted);font-size:13px;">/</span>
          <select id="navSchemaSelect" style="
            background:#1a1a28;
            border:1px solid var(--border);
            color:var(--text);
            border-radius:6px;
            padding:4px 28px 4px 10px;
            font-size:13px;
            font-family:inherit;
            cursor:pointer;
            appearance:none;
            -webkit-appearance:none;
            background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E&quot;);
            background-repeat:no-repeat;
            background-position:right 8px center;
            min-width:160px;
          ">
            <option value="" disabled>Select Schema...</option>
          </select>
        </div>
    ` : '';

    // Note: Logo now links to /schemas
    header.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
            <a href="/schemas" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
                <img src="/static/logo.png" alt="Orwell Logo" style="height:32px;width:auto;">
                <h1 style="margin:0;font-size:16px;letter-spacing:0.3px;color:#e5e7eb;">orwell <span
                        style="color:var(--muted);font-weight:400;">/ ${pageTitle}</span></h1>
            </a>
            ${selectorHtml}
        </div>
        <div class="mono" style="color:var(--muted);display:flex;align-items:center;gap:16px;">
            ${navLinksHtml}
        </div>
    `;

    // Initialize Schema Selector Logic
    if (showSelector) {
        await initSchemaSelector(activePage);
    }
}

async function initSchemaSelector(activePage) {
    const select = document.getElementById('navSchemaSelect');
    if (!select) return;

    try {
        const res = await fetch('/api/schemas');
        if (!res.ok) throw new Error('Failed to fetch schemas');
        const schemas = await res.json();

        // Populate options
        select.innerHTML = '<option value="" disabled>Select Schema...</option>';
        schemas.forEach(s => {
            const icon = s.icon || '🌐'; // Default icon if missing
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = `${icon} ${s.name}`;
            opt.dataset.icon = icon;
            opt.dataset.name = s.name;
            select.appendChild(opt);
        });

        // Set active state
        const active = getActiveSchema();
        if (active && schemas.find(s => s.id === active.id)) {
            select.value = active.id;
        } else if (schemas.length === 1) {
            // Auto-select if only one
            const s = schemas[0];
            const icon = s.icon || '🌐';
            select.value = s.id;
            setActiveSchema({ id: s.id, name: s.name, icon: icon });
        } else if (schemas.length === 0) {
            // No schemas at all → redirect
            if (activePage === 'playground') window.location.href = '/schemas';
        } else {
            // Multiple schemas, none selected → redirect
            if (activePage === 'playground') window.location.href = '/schemas';
        }

        // Handle changes
        select.addEventListener('change', (e) => {
            const opt = select.options[select.selectedIndex];
            const newVal = {
                id: select.value,
                name: opt.dataset.name,
                icon: opt.dataset.icon
            };
            setActiveSchema(newVal);
            
            // If on a page that needs reload or data refresh, the schemaChanged event will handle it
            // or if we are on a page where changing schema requires navigation? 
            // The plan says "schema selector HTML (injected...)" and "Pages that pass showSchemaSelector: true".
            // It assumes the page will react to the event or reload.
        });

    } catch (e) {
        console.error('Schema selector init error:', e);
    }
}

// Export
window.renderNavbar = renderNavbar;
