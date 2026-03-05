document.addEventListener('DOMContentLoaded', async () => {
    const sidebarNav = document.getElementById('sidebar-nav');
    const markdownContent = document.getElementById('markdown-content');
    const mainContainer = document.getElementById('docs-container'); // Scrollable container

    // Function to render the sidebar
    function renderSidebar(sections) {
        sidebarNav.innerHTML = '';
        
        if (sections.length === 0) {
            sidebarNav.innerHTML = '<div style="padding: 12px; color: var(--muted);">No documentation found.</div>';
            return;
        }

        sections.forEach(section => {
            const header = document.createElement('div');
            header.className = 'sidebar-header';
            header.textContent = section.header;
            sidebarNav.appendChild(header);
            
            section.pages.forEach(page => {
                const item = document.createElement('div');
                item.className = 'nav-item';
                item.textContent = page.title;
                item.dataset.filename = page.filename;
                
                // Sub-navigation container (initially hidden/empty)
                const subNav = document.createElement('div');
                subNav.className = 'nav-sub-container';
                subNav.id = `sub-${page.filename.replace(/[^a-zA-Z0-9]/g, '-')}`;
                
                item.addEventListener('click', () => {
                    // Update active state
                    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
                    // Hide all other sub-navs
                    document.querySelectorAll('.nav-sub-container').forEach(el => el.style.display = 'none');
                    
                    item.classList.add('active');
                    subNav.style.display = 'block';
                    
                    // Load page content
                    loadPage(page.filename, subNav);
                });
                
                sidebarNav.appendChild(item);
                sidebarNav.appendChild(subNav);
            });
        });
    }
    
    // Function to load page content
    async function loadPage(filename, subNavContainer) {
        markdownContent.innerHTML = '<div style="color: var(--muted);">Loading content...</div>';
        // Clear previous sub-nav if not passed directly (e.g. initial load)
        if (!subNavContainer) {
             const item = sidebarNav.querySelector(`.nav-item[data-filename="${filename}"]`);
             if (item) subNavContainer = item.nextElementSibling;
        }
        if (subNavContainer) subNavContainer.innerHTML = '';

        try {
            const response = await fetch(`/api/docs/content/${encodeURIComponent(filename)}`);
            if (!response.ok) {
                throw new Error(`Failed to load content: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // Format date
            let dateHtml = '';
            if (data.last_modified) {
                const date = new Date(data.last_modified);
                const formattedDate = date.toLocaleDateString(undefined, { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                dateHtml = `<div style="margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    Last updated: ${formattedDate}
                </div>`;
            }
            
            // Render markdown using marked
            const renderedContent = marked.parse(data.content);
            markdownContent.innerHTML = dateHtml + renderedContent;
            
            // Generate Table of Contents
            generateTOC(subNavContainer);
            
        } catch (error) {
            console.error('Error loading page:', error);
            markdownContent.innerHTML = `<div style="color: var(--danger);">Error loading page content: ${error.message}</div>`;
        }
    }

    function generateTOC(container) {
        if (!container) return;
        
        const headers = markdownContent.querySelectorAll('h2, h3');
        if (headers.length === 0) return;
        
        headers.forEach((header, index) => {
            // Generate ID if missing
            if (!header.id) {
                const slug = header.textContent
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, '');
                header.id = slug || `header-${index}`;
            }
            
            const link = document.createElement('a');
            link.className = 'nav-sub-item';
            link.textContent = header.textContent;
            link.href = `#${header.id}`;
            link.dataset.target = header.id;
            
            // Indent h3
            if (header.tagName === 'H3') {
                link.style.paddingLeft = '24px';
                link.style.fontSize = '12px';
            }
            
            link.onclick = (e) => {
                e.preventDefault();
                header.scrollIntoView({ behavior: 'smooth' });
                // Update active state manually for immediate feedback
                container.querySelectorAll('.nav-sub-item').forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            };
            
            container.appendChild(link);
        });
        
        // Setup Scroll Spy
        setupScrollSpy(container);
    }
    
    function setupScrollSpy(navContainer) {
        if (!navContainer) return;
        
        // Remove existing listener if any (simple way: replace the element clone? No, let's just use a flag or re-add)
        // Since mainContainer is global, we can just attach one listener that checks the CURRENT navContainer
        // But we need to know WHICH navContainer is active.
        // Let's attach a property to mainContainer to store the current active TOC container
        mainContainer._activeTOC = navContainer;
    }

    // Global scroll listener
    let isTicking = false;
    mainContainer.addEventListener('scroll', () => {
        if (!isTicking) {
            window.requestAnimationFrame(() => {
                updateActiveTOC();
                isTicking = false;
            });
            isTicking = true;
        }
    });

    function updateActiveTOC() {
        const navContainer = mainContainer._activeTOC;
        if (!navContainer || navContainer.style.display === 'none') return;
        
        const headers = markdownContent.querySelectorAll('h2, h3');
        const scrollPos = mainContainer.scrollTop + 100; // Offset
        
        let currentHeaderId = '';
        
        headers.forEach(header => {
            if (header.offsetTop <= scrollPos) {
                currentHeaderId = header.id;
            }
        });
        
        // If at top
        if (mainContainer.scrollTop < 50 && headers.length > 0) {
             currentHeaderId = headers[0].id;
        }
        
        navContainer.querySelectorAll('.nav-sub-item').forEach(link => {
            link.classList.remove('active');
            if (link.dataset.target === currentHeaderId) {
                link.classList.add('active');
            }
        });
    }

    // Initial load
    try {
        const response = await fetch('/api/docs/list');
        if (!response.ok) {
            throw new Error(`Failed to load docs list: ${response.statusText}`);
        }
        
        const data = await response.json();
        renderSidebar(data.sections);
        
        // Load first page by default if available
        if (data.sections.length > 0 && data.sections[0].pages.length > 0) {
            const firstPage = data.sections[0].pages[0];
            
            // Find its item and container
            setTimeout(() => {
                const firstItem = sidebarNav.querySelector(`.nav-item[data-filename="${firstPage.filename}"]`);
                if (firstItem) {
                    firstItem.classList.add('active');
                    const subNav = firstItem.nextElementSibling;
                    if (subNav) subNav.style.display = 'block';
                    loadPage(firstPage.filename, subNav);
                }
            }, 0);
        }
    } catch (error) {
        console.error('Error fetching docs list:', error);
        sidebarNav.innerHTML = '<div style="padding: 12px; color: var(--danger);">Error loading documentation structure.</div>';
    }
});
