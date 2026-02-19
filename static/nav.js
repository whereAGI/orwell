
function renderNavbar(activePage) {
    const header = document.querySelector('header');
    if (!header) return;

    // Enforce header styles to ensure consistency
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
        'model_studio': 'model studio'
    };
    
    const pageTitle = titleMap[activePage] || 'studio';

    // Define all available links
    const allLinks = [
        { id: 'playground', href: '/', text: 'Playground' },
        { id: 'data_studio', href: '/studio', text: 'Data Studio' },
        { id: 'prompt_studio', href: '/prompt-studio', text: 'Prompt Studio' },
        { id: 'model_studio', href: '/model-studio', text: 'Model Studio' }
    ];

    // Filter out current page to match the pattern "links to other places"
    const navLinksHtml = allLinks
        .filter(link => link.id !== activePage)
        .map(link => `<a href="${link.href}" style="color:var(--text);text-decoration:none;padding:4px 8px;border-radius:4px;background:#1f2937;">${link.text}</a>`)
        .join('');

    header.innerHTML = `
        <a href="/" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
            <img src="/static/logo.png" alt="Orwell Logo" style="height:32px;width:auto;">
            <h1 style="margin:0;font-size:16px;letter-spacing:0.3px;color:#e5e7eb;">orwell <span
                    style="color:var(--muted);font-weight:400;">/ ${pageTitle}</span></h1>
        </a>
        <div class="mono" style="color:var(--muted);display:flex;align-items:center;gap:16px;">
            ${navLinksHtml}
            <a href="/" id="criteriaLink" style="color:#9ec1ff;text-decoration:none">Evaluation Criteria</a>
            <span id="userEmail" style="color:var(--muted);"></span>
            <button id="logoutBtn"
                style="width:auto;padding:4px 8px;background:#ef4444;border-color:#ef4444;font-size:12px;">Logout</button>
        </div>
    `;

    // Attach listeners
    attachNavListeners();
}

function attachNavListeners() {
    // 1. Populate User Email
    const userEmailSpan = document.getElementById('userEmail');
    if (userEmailSpan && window.pb && window.pb.authStore.model) {
        userEmailSpan.textContent = window.pb.authStore.model.email;
    }

    // 2. Handle Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (window.logout) {
                window.logout();
            } else if (window.pb) {
                window.pb.authStore.clear();
                window.location.href = '/login';
            }
        });
    }
    
    // 3. Handle Criteria Link
    const criteriaLink = document.getElementById('criteriaLink');
    if (criteriaLink) {
        // If we are not on the playground (index.html or /), redirect to playground
        // Note: The link href is already "/" in the HTML template above, so default click will go to /
        // But if we want to open the modal on the playground page, we need to handle that.
        // If we are ALREADY on playground, we should prevent default and open modal (if logic exists).
        // But the navbar is shared. The playground specific logic (opening modal) might need to be hooked up.
        // However, the prompt studio link just goes to "/".
        
        // Let's keep it simple: if on playground, try to open modal. If not, go to /.
        if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
             criteriaLink.addEventListener('click', (e) => {
                e.preventDefault();
                // Check if the modal logic exists (it's in dashboard.js usually)
                // We can dispatch a custom event or check for the modal element directly
                const modal = document.getElementById('criteriaModal');
                if (modal) {
                    modal.style.display = 'flex';
                }
            });
        }
    }
}

// Export
window.renderNavbar = renderNavbar;
