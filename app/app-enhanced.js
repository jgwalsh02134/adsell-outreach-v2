// AdSell.ai Outreach Tracker - Enhanced with Profile Builder

// Shared AI helper (OpenAI proxy via Cloudflare Worker)
async function callAI(prompt, mode = "default") {
    try {
        const response = await fetch(
            "https://adsell-openai-proxy.jgregorywalsh.workers.dev/",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ input: prompt, mode })
            }
        );

        if (!response.ok) {
            console.error("AI HTTP error:", response.status, await response.text());
            return "AI error: HTTP " + response.status;
        }

        const text = await response.text();

        // Try JSON first
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            // Worker may already be returning plain text
            return text;
        }

        // OpenAI Responses API shape
        try {
            return (
                data?.output?.[0]?.content?.[0]?.text ||
                data?.output_text ||
                text
            );
        } catch (err) {
            console.error("AI text extraction error:", err);
            return text;
        }
    } catch (err) {
        console.error("AI fetch failed:", err);
        return "AI error: worker unreachable or network error.";
    }
}
class OutreachTracker {
    constructor() {
        this.contacts = [];
        this.activities = [];
        this.scripts = [];
        this.tags = [];
        this.customFields = [];
        this.currentContact = null;
        this.editingContactId = null;
        this.editingScriptId = null;
        this.pendingImport = null;
        this.visibleColumns = {
            contact: true,
            email: true,
            phone: true,
            category: true,
            status: true,
            lastContact: true,
            actions: true
        };
        this.selectedContactIds = new Set();
        this.advancedFilters = { statuses: [], categories: [], segments: [], tags: [] };
        this.savedFilters = [];
        
        this.init();
    }

    init() {
        // Load data from localStorage
        this.loadData();
        this.loadColumnPreferences();
        this.loadAdvancedFilters();
        
        // Setup event listeners
        this.setupEventListeners();

        // Wire AI buttons if present at load
        document.getElementById("ai-outreach-script")?.addEventListener("click", () => this.aiOutreach());
        document.getElementById("ai-company-research")?.addEventListener("click", () => this.aiCompanyResearch());
        document.getElementById("ai-followup-email")?.addEventListener("click", () => this.aiFollowupEmail());
        document.getElementById("ai-summarize-call")?.addEventListener("click", () => this.aiSummarizeCall());
        document.getElementById("ai-clean-csv")?.addEventListener("click", () => this.aiCleanCSV());
        
        // Render initial page
        this.showPage('dashboard');
        this.updateStats();
        this.renderRecentActivity();
        
        // Add default scripts if none exist
        if (this.scripts.length === 0) {
            this.addDefaultScripts();
        }

        // Initialize default tags if none exist
        if (this.tags.length === 0) {
            this.initializeDefaultTags();
        }
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = e.target.dataset.page;
                this.showPage(page);
            });
        });

        // Mobile nav toggle
        const navToggle = document.querySelector('.nav-toggle');
        const navContainer = document.querySelector('.nav-container');
        if (navToggle && navContainer) {
            navToggle.addEventListener('click', () => {
                navContainer.classList.toggle('nav-open');
            });
        }

        // AI modal close handlers
        const aiClose = document.getElementById('ai-modal-close');
        if (aiClose) {
            aiClose.onclick = hideAIModal;
        }
        const aiClose2 = document.getElementById('ai-modal-close-2');
        if (aiClose2) {
            aiClose2.onclick = hideAIModal;
        }
        window.addEventListener('click', (e) => {
            const modal = document.getElementById('ai-modal');
            if (e.target === modal) hideAIModal();
        });

        // Column chooser
        const columnsChooser = document.getElementById('columns-chooser');
        if (columnsChooser) {
            columnsChooser.addEventListener('change', (e) => {
                const input = e.target;
                if (input && input.matches('input[type="checkbox"][data-col]')) {
                    const colKey = input.getAttribute('data-col');
                    this.visibleColumns[colKey] = input.checked;
                    this.saveColumnPreferences();
                    this.applyColumnVisibility();
                }
            });
        }

        // Row selection (event delegation)
        const tableBody = document.getElementById('contacts-table-body');
        if (tableBody) {
            tableBody.addEventListener('change', (e) => {
                const target = e.target;
                if (target && target.matches('input.row-select[data-id]')) {
                    const id = target.getAttribute('data-id');
                    if (target.checked) {
                        this.selectedContactIds.add(id);
                    } else {
                        this.selectedContactIds.delete(id);
                    }
                    this.updateBulkUI();
                }
            });
        }

        // Bulk action buttons
        const bulkUpdateStatusBtn = document.getElementById('bulk-update-status');
        if (bulkUpdateStatusBtn) {
            bulkUpdateStatusBtn.addEventListener('click', () => this.bulkUpdateStatus());
        }
        const bulkAddTagBtn = document.getElementById('bulk-add-tag');
        if (bulkAddTagBtn) {
            bulkAddTagBtn.addEventListener('click', () => this.bulkAddTag());
        }
        const bulkRemoveTagBtn = document.getElementById('bulk-remove-tag');
        if (bulkRemoveTagBtn) {
            bulkRemoveTagBtn.addEventListener('click', () => this.bulkRemoveTag());
        }
        const bulkDeleteBtn = document.getElementById('bulk-delete');
        if (bulkDeleteBtn) {
            bulkDeleteBtn.addEventListener('click', () => this.bulkDelete());
        }
        const bulkSelectAllBtn = document.getElementById('bulk-select-all');
        if (bulkSelectAllBtn) {
            bulkSelectAllBtn.addEventListener('click', () => this.bulkSelectAll());
        }
        const bulkClearBtn = document.getElementById('bulk-clear');
        if (bulkClearBtn) {
            bulkClearBtn.addEventListener('click', () => this.clearSelection());
        }

        // Export buttons
        const exportCsvBtn = document.getElementById('export-csv');
        if (exportCsvBtn) {
            exportCsvBtn.addEventListener('click', () => this.exportContactsCSV());
        }
        const exportJsonBtn = document.getElementById('export-json');
        if (exportJsonBtn) {
            exportJsonBtn.addEventListener('click', () => this.exportContactsJSON());
        }
        const exportActivitiesCsvBtn = document.getElementById('export-activities-csv');
        if (exportActivitiesCsvBtn) {
            exportActivitiesCsvBtn.addEventListener('click', () => this.exportActivitiesCSV());
        }

        // (AI CSV cleanup handled via init() aiCleanCSV binding)

        // Advanced filters actions (delegation within details)
        const advDetails = document.getElementById('advanced-filters');
        if (advDetails) {
            advDetails.addEventListener('change', (e) => {
                const el = e.target;
                if (el && el.matches('input[type="checkbox"][data-group]')) {
                    const group = el.getAttribute('data-group');
                    const value = el.getAttribute('data-value');
                    const checked = el.checked;
                    const arr = this.advancedFilters[group];
                    if (!Array.isArray(arr)) return;
                    if (checked) {
                        if (!arr.includes(value)) arr.push(value);
                    } else {
                        this.advancedFilters[group] = arr.filter(v => v !== value);
                    }
                    this.saveAdvancedFilters();
                    this.filterContacts();
                }
            });
            advDetails.addEventListener('click', (e) => {
                const btn = e.target;
                if (!(btn instanceof HTMLElement)) return;
                if (btn.id === 'adv-clear') {
                    e.preventDefault();
                    this.advancedFilters = { statuses: [], categories: [], segments: [], tags: [] };
                    this.saveAdvancedFilters();
                    this.renderAdvancedFiltersPanel();
                    this.filterContacts();
                } else if (btn.id === 'adv-save') {
                    e.preventDefault();
                    const name = prompt('Save current filters as:');
                    if (name) {
                        const filter = { id: this.generateId(), name, filters: this.advancedFilters };
                        this.savedFilters.push(filter);
                        localStorage.setItem('adsell_saved_filters', JSON.stringify(this.savedFilters));
                        this.renderAdvancedFiltersPanel();
                        this.showNotification('Filter saved.');
                    }
                } else if (btn.id === 'adv-apply') {
                    e.preventDefault();
                    this.filterContacts();
                } else if (btn.id === 'adv-load') {
                    e.preventDefault();
                    const select = document.getElementById('adv-saved');
                    const id = select ? select.value : '';
                    const found = this.savedFilters.find(f => f.id === id);
                    if (found) {
                        this.advancedFilters = JSON.parse(JSON.stringify(found.filters));
                        this.saveAdvancedFilters();
                        this.renderAdvancedFiltersPanel();
                        this.filterContacts();
                        this.showNotification(`Loaded filter: ${found.name}`);
                    }
                }
            });
        }

        // Contact form
        document.getElementById('contact-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveContact(e.target);
        });

        // Activity form
        document.getElementById('activity-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveActivity(e.target);
        });

        // Script form
        document.getElementById('script-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveScript(e.target);
        });

        // (AI modal buttons use init() aiFollowupEmail/aiSummarizeCall bindings)

        // Search and filters
        document.getElementById('search-input').addEventListener('input', () => this.filterContacts());
        document.getElementById('status-filter').addEventListener('change', () => this.filterContacts());
        document.getElementById('category-filter').addEventListener('change', () => this.filterContacts());
        document.getElementById('segment-filter').addEventListener('change', () => this.filterContacts());

        // CSV upload
        document.getElementById('csv-file-input').addEventListener('change', (e) => {
            this.handleCSVUpload(e.target.files[0]);
        });

        // Close modals on background click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });
    }

    // Data Management
    loadData() {
        this.contacts = JSON.parse(localStorage.getItem('adsell_contacts')) || [];
        this.activities = JSON.parse(localStorage.getItem('adsell_activities')) || [];
        this.scripts = JSON.parse(localStorage.getItem('adsell_scripts')) || [];
        this.tags = JSON.parse(localStorage.getItem('adsell_tags')) || [];
        this.customFields = JSON.parse(localStorage.getItem('adsell_custom_fields')) || [];
    }

    loadColumnPreferences() {
        const stored = JSON.parse(localStorage.getItem('adsell_visible_columns'));
        if (stored && typeof stored === 'object') {
            this.visibleColumns = { ...this.visibleColumns, ...stored };
        }
    }

    loadAdvancedFilters() {
        const stored = JSON.parse(localStorage.getItem('adsell_advanced_filters'));
        if (stored && typeof stored === 'object') {
            this.advancedFilters = { ...this.advancedFilters, ...stored };
        }
        this.savedFilters = JSON.parse(localStorage.getItem('adsell_saved_filters')) || [];
    }

    saveAdvancedFilters() {
        localStorage.setItem('adsell_advanced_filters', JSON.stringify(this.advancedFilters));
    }

    saveColumnPreferences() {
        localStorage.setItem('adsell_visible_columns', JSON.stringify(this.visibleColumns));
    }

    saveData() {
        localStorage.setItem('adsell_contacts', JSON.stringify(this.contacts));
        localStorage.setItem('adsell_activities', JSON.stringify(this.activities));
        localStorage.setItem('adsell_scripts', JSON.stringify(this.scripts));
        localStorage.setItem('adsell_tags', JSON.stringify(this.tags));
        localStorage.setItem('adsell_custom_fields', JSON.stringify(this.customFields));
    }

    initializeDefaultTags() {
        this.tags = [
            { id: this.generateId(), name: 'Hot Lead', color: '#ef4444' },
            { id: this.generateId(), name: 'High Priority', color: '#f59e0b' },
            { id: this.generateId(), name: 'Decision Maker', color: '#8b5cf6' },
            { id: this.generateId(), name: 'Needs Follow-up', color: '#3b82f6' },
            { id: this.generateId(), name: 'Budget Approved', color: '#10b981' },
            { id: this.generateId(), name: 'Large Account', color: '#ec4899' },
            { id: this.generateId(), name: 'Referral', color: '#6366f1' }
        ];
        this.saveData();
    }

    // Navigation
    showPage(pageName) {
        // Update nav links
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.dataset.page === pageName) {
                link.classList.add('active');
            }
        });

        // Update pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        document.getElementById(`${pageName}-page`).classList.add('active');

        // Render page content
        switch(pageName) {
            case 'dashboard':
                this.updateStats();
                this.renderRecentActivity();
                break;
            case 'contacts':
                this.renderContacts();
                this.applyColumnVisibility();
                this.syncColumnChooser();
                this.renderBulkTagOptions();
                this.updateBulkUI();
                this.renderAdvancedFiltersPanel();
                break;
            case 'scripts':
                this.renderScripts();
                break;
            case 'analytics':
                this.renderAnalytics();
                break;
            case 'pipeline':
                this.renderPipeline();
                break;
            case 'calendar':
                this.renderCalendar();
                break;
        }
    }

    // Stats and Dashboard
    updateStats() {
        const total = this.contacts.length;
        const notStarted = this.contacts.filter(c => c.status === 'Not Started').length;
        const inProgress = this.contacts.filter(c => c.status === 'In Progress').length;
        const responded = this.contacts.filter(c => c.status === 'Responded').length;
        const signedUp = this.contacts.filter(c => c.status === 'Signed Up').length;

        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-not-started').textContent = notStarted;
        document.getElementById('stat-in-progress').textContent = inProgress;
        document.getElementById('stat-responded').textContent = responded;
        document.getElementById('stat-signed-up').textContent = signedUp;
    }

    // Calendar
    renderCalendar() {
        if (!this._calendarDate) this._calendarDate = new Date();
        const grid = document.getElementById('calendar-grid');
        const title = document.getElementById('cal-title');
        const d = new Date(this._calendarDate.getFullYear(), this._calendarDate.getMonth(), 1);
        const month = d.getMonth();
        const year = d.getFullYear();
        const monthName = d.toLocaleString('default', { month: 'long' });
        if (title) title.textContent = `${monthName} ${year}`;

        // Controls
        const prevBtn = document.getElementById('cal-prev');
        const nextBtn = document.getElementById('cal-next');
        const todayBtn = document.getElementById('cal-today');
        if (prevBtn) prevBtn.onclick = () => { this._calendarDate.setMonth(this._calendarDate.getMonth() - 1); this.renderCalendar(); };
        if (nextBtn) nextBtn.onclick = () => { this._calendarDate.setMonth(this._calendarDate.getMonth() + 1); this.renderCalendar(); };
        if (todayBtn) todayBtn.onclick = () => { this._calendarDate = new Date(); this.renderCalendar(); };

        if (!grid) return;

        const firstDayIndex = new Date(year, month, 1).getDay(); // 0=Sun
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const weeks = [];
        let cells = [];

        // Weekday headers
        const weekdayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const headerHtml = weekdayNames.map(n => `<div class="calendar-cell"><div class="calendar-cell-header" style="font-weight:600">${n}</div></div>`).join('');

        // Leading blanks
        for (let i = 0; i < firstDayIndex; i++) cells.push(null);

        // Dates
        for (let day = 1; day <= daysInMonth; day++) {
            cells.push(new Date(year, month, day));
        }

        // Trailing blanks to complete grid
        while (cells.length % 7 !== 0) cells.push(null);

        // Map follow-ups
        const byDateKey = (dateObj) => dateObj.toISOString().slice(0,10);
        const itemsByDay = {};
        this.contacts.forEach(c => {
            if (!c.followUpDate) return;
            const fd = new Date(c.followUpDate);
            if (fd.getMonth() === month && fd.getFullYear() === year) {
                const key = byDateKey(fd);
                (itemsByDay[key] = itemsByDay[key] || []).push(c);
            }
        });

        const cellsHtml = cells.map(cellDate => {
            if (!cellDate) {
                return `<div class="calendar-cell"><div class="calendar-cell-header">&nbsp;</div><div class="calendar-cell-body"></div></div>`;
            }
            const key = byDateKey(cellDate);
            const items = itemsByDay[key] || [];
            const itemsHtml = items.map(c => `
                <div class="calendar-item" data-id="${c.id}">
                    ${c.vendorName}
                </div>
            `).join('');
            return `
                <div class="calendar-cell">
                    <div class="calendar-cell-header">${cellDate.getDate()}</div>
                    <div class="calendar-cell-body">
                        ${itemsHtml}
                    </div>
                </div>
            `;
        }).join('');

        grid.innerHTML = headerHtml + cellsHtml;

        grid.querySelectorAll('.calendar-item').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.getAttribute('data-id');
                this.viewContact(id);
            });
        });
    }
    renderRecentActivity() {
        const container = document.getElementById('recent-activity-list');
        const recentActivities = this.activities
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 5);

        if (recentActivities.length === 0) {
            container.innerHTML = '<p class="empty-state">No recent activity</p>';
            return;
        }

        container.innerHTML = recentActivities.map(activity => {
            const contact = this.contacts.find(c => c.id === activity.contactId);
            const vendorName = contact ? contact.vendorName : 'Unknown';
            
            return `
                <div class="activity-item">
                    <div class="activity-header">
                        <span class="activity-type">${activity.type}</span>
                        <span class="activity-date">${this.formatDate(activity.date)}</span>
                    </div>
                    <div class="activity-vendor">${vendorName}</div>
                    <p class="activity-notes">${this.truncateText(activity.notes, 100)}</p>
                </div>
            `;
        }).join('');
    }

    // Contact Management
    renderContacts() {
        const tbody = document.getElementById('contacts-table-body');
        const filteredContacts = this.getFilteredContacts();

        if (filteredContacts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No contacts found</td></tr>';
            return;
        }

        tbody.innerHTML = filteredContacts.map(contact => {
            const tags = contact.tags ? contact.tags.map(tagId => {
                const tag = this.tags.find(t => t.id === tagId);
                return tag ? `<span class="tag-badge" style="background: ${tag.color}20; color: ${tag.color};">${tag.name}</span>` : '';
            }).join('') : '';

            return `
            <tr>
                <td data-col="vendor" data-label="Vendor">
                    <label class="row-select-wrap">
                        <input type="checkbox" class="row-select" data-id="${contact.id}" ${this.selectedContactIds.has(contact.id) ? 'checked' : ''}>
                        <div>
                    <strong>${contact.vendorName}</strong>
                    ${tags ? `<div class="tags-inline">${tags}</div>` : ''}
                        </div>
                    </label>
                </td>
                <td data-col="contact" data-label="Contact">${contact.contactName || '—'}</td>
                <td data-col="email" data-label="Email">${contact.email}</td>
                <td data-col="phone" data-label="Phone">${contact.phone || '—'}</td>
                <td data-col="category" data-label="Category">${contact.category || '—'}</td>
                <td data-col="status" data-label="Status"><span class="status-badge status-${this.slugify(contact.status)}">${contact.status}</span></td>
                <td data-col="lastContact" data-label="Last Contact">${contact.lastContact ? this.formatDate(contact.lastContact) : '—'}</td>
                <td data-col="actions" data-label="Actions">
                    <button class="btn btn-secondary action-btn" onclick="app.viewContact('${contact.id}')">View</button>
                    <button class="btn btn-secondary action-btn" onclick="app.logActivity('${contact.id}')">Log Activity</button>
                </td>
            </tr>
        `}).join('');
    }

    getFilteredContacts() {
        let filtered = [...this.contacts];
        
        const search = document.getElementById('search-input').value.toLowerCase();
        if (search) {
            filtered = filtered.filter(contact => 
                contact.vendorName.toLowerCase().includes(search) ||
                (contact.contactName && contact.contactName.toLowerCase().includes(search)) ||
                (contact.companyName && contact.companyName.toLowerCase().includes(search)) ||
                contact.email.toLowerCase().includes(search) ||
                (contact.phone && contact.phone.includes(search))
            );
        }

        const status = document.getElementById('status-filter').value;
        if (status) {
            filtered = filtered.filter(contact => contact.status === status);
        }

        const category = document.getElementById('category-filter').value;
        if (category) {
            filtered = filtered.filter(contact => contact.category === category);
        }

        const segment = document.getElementById('segment-filter').value;
        if (segment) {
            filtered = filtered.filter(contact => contact.segment === segment);
        }

        // Advanced multi-select filters
        const adv = this.advancedFilters || {};
        if (Array.isArray(adv.statuses) && adv.statuses.length > 0) {
            filtered = filtered.filter(c => adv.statuses.includes(c.status));
        }
        if (Array.isArray(adv.categories) && adv.categories.length > 0) {
            filtered = filtered.filter(c => adv.categories.includes(c.category));
        }
        if (Array.isArray(adv.segments) && adv.segments.length > 0) {
            filtered = filtered.filter(c => adv.segments.includes(c.segment));
        }
        if (Array.isArray(adv.tags) && adv.tags.length > 0) {
            filtered = filtered.filter(c => {
                if (!Array.isArray(c.tags)) return false;
                return c.tags.some(tid => adv.tags.includes(tid));
            });
        }

        return filtered;
    }

    filterContacts() {
        this.renderContacts();
        this.applyColumnVisibility();
    }

    applyColumnVisibility() {
        // Vendor column always visible
        const table = document.querySelector('.contacts-table');
        if (!table) return;

        // Toggle header cells
        table.querySelectorAll('thead th[data-col]').forEach(th => {
            const key = th.getAttribute('data-col');
            if (key === 'vendor') return;
            th.classList.toggle('hidden-column', this.visibleColumns[key] === false);
        });

        // Toggle body cells
        table.querySelectorAll('tbody td[data-col]').forEach(td => {
            const key = td.getAttribute('data-col');
            if (key === 'vendor') return;
            td.classList.toggle('hidden-column', this.visibleColumns[key] === false);
        });
    }

    syncColumnChooser() {
        const chooser = document.getElementById('columns-chooser');
        if (!chooser) return;
        chooser.querySelectorAll('input[type="checkbox"][data-col]').forEach(cb => {
            const key = cb.getAttribute('data-col');
            if (key in this.visibleColumns) {
                cb.checked = this.visibleColumns[key] !== false;
            }
        });
    }

    renderAdvancedFiltersPanel() {
        const container = document.getElementById('advanced-filters-content');
        if (!container) return;
        const statuses = ['Not Started','In Progress','Responded','Signed Up'];
        const categories = ['Ski Resort','Ski Club','Outdoor Gear Shop','Ski/Bike Shop','Equipment Manufacturer','Nordic Ski Center','Tourism Organization','Health/Fitness','Other'];
        const segments = ['Expo','NE','Club'];
        const tags = this.tags;

        const section = (title, html) => `
            <div>
                <div style="font-weight:600; margin-bottom:0.5rem;">${title}</div>
                <div style="display:flex; flex-direction:column; gap:0.25rem;">${html}</div>
            </div>
        `;
        const checkbox = (group, value, label) => `
            <label class="dropdown-check">
                <input type="checkbox" data-group="${group}" data-value="${value}" ${this.advancedFilters[group]?.includes(value) ? 'checked' : ''}>
                <span>${label}</span>
            </label>
        `;

        const savedOptions = ['<option value="">Saved Filters...</option>'].concat(
            (this.savedFilters || []).map(f => `<option value="${f.id}">${f.name}</option>`)
        ).join('');

        container.innerHTML = [
            section('Status', statuses.map(s => checkbox('statuses', s, s)).join('')),
            section('Category', categories.map(c => checkbox('categories', c, c)).join('')),
            section('Segment', segments.map(s => checkbox('segments', s, s)).join('')),
            section('Tags', tags.map(t => checkbox('tags', t.id, t.name)).join('')),
            `<div style="grid-column: 1 / -1; display:flex; gap:0.5rem; align-items:center;">
                <select id="adv-saved" class="filter-select" style="min-width: 200px;">${savedOptions}</select>
                <button class="btn btn-secondary" id="adv-load">Load</button>
                <button class="btn btn-secondary" id="adv-save">Save Current</button>
                <button class="btn btn-secondary" id="adv-apply">Apply</button>
                <button class="btn btn-secondary" id="adv-clear">Clear</button>
            </div>`
        ].join('');
    }

    // Bulk operations
    updateBulkUI() {
        const bar = document.getElementById('bulk-actions');
        const countEl = document.getElementById('bulk-count');
        if (!bar || !countEl) return;
        const count = this.selectedContactIds.size;
        countEl.textContent = count;
        bar.style.display = count > 0 ? 'flex' : 'none';
    }

    renderBulkTagOptions() {
        const select = document.getElementById('bulk-tag');
        if (!select) return;
        const options = ['<option value="">Choose Tag...</option>']
            .concat(this.tags.map(t => `<option value="${t.id}">${t.name}</option>`));
        select.innerHTML = options.join('');
    }

    bulkSelectAll() {
        const filtered = this.getFilteredContacts();
        this.selectedContactIds = new Set(filtered.map(c => c.id));
        this.renderContacts();
        this.applyColumnVisibility();
        this.updateBulkUI();
    }

    clearSelection() {
        this.selectedContactIds.clear();
        this.renderContacts();
        this.applyColumnVisibility();
        this.updateBulkUI();
    }

    bulkUpdateStatus() {
        const status = document.getElementById('bulk-status').value;
        if (!status) {
            alert('Choose a status to set.');
            return;
        }
        this.contacts.forEach(c => {
            if (this.selectedContactIds.has(c.id)) {
                c.status = status;
            }
        });
        this.saveData();
        this.renderContacts();
        this.applyColumnVisibility();
        this.updateStats();
        this.showNotification('Status updated for selected contacts');
    }

    bulkAddTag() {
        const tagId = document.getElementById('bulk-tag').value;
        if (!tagId) {
            alert('Choose a tag to add.');
            return;
        }
        this.contacts.forEach(c => {
            if (this.selectedContactIds.has(c.id)) {
                if (!Array.isArray(c.tags)) c.tags = [];
                if (!c.tags.includes(tagId)) c.tags.push(tagId);
            }
        });
        this.saveData();
        this.renderContacts();
        this.applyColumnVisibility();
        this.showNotification('Tag added to selected contacts');
    }

    bulkRemoveTag() {
        const tagId = document.getElementById('bulk-tag').value;
        if (!tagId) {
            alert('Choose a tag to remove.');
            return;
        }
        this.contacts.forEach(c => {
            if (this.selectedContactIds.has(c.id) && Array.isArray(c.tags)) {
                c.tags = c.tags.filter(tid => tid !== tagId);
            }
        });
        this.saveData();
        this.renderContacts();
        this.applyColumnVisibility();
        this.showNotification('Tag removed from selected contacts');
    }

    bulkDelete() {
        if (this.selectedContactIds.size === 0) return;
        if (!confirm(`Delete ${this.selectedContactIds.size} selected contact(s)? This cannot be undone.`)) return;
        const selectedIds = new Set(this.selectedContactIds);
        this.contacts = this.contacts.filter(c => !selectedIds.has(c.id));
        this.activities = this.activities.filter(a => !selectedIds.has(a.contactId));
        this.selectedContactIds.clear();
        this.saveData();
        this.renderContacts();
        this.applyColumnVisibility();
        this.updateStats();
        this.updateBulkUI();
        this.showNotification('Selected contacts deleted');
    }

    showAddContactModal() {
        this.editingContactId = null;
        document.getElementById('modal-title').textContent = 'Add Contact';
        document.getElementById('contact-form').reset();
        this.renderTagSelector();
        document.getElementById('contact-modal').classList.add('active');
    }

    closeContactModal() {
        document.getElementById('contact-modal').classList.remove('active');
        this.editingContactId = null;
    }

    renderTagSelector() {
        const container = document.getElementById('tag-selector');
        if (!container) return;

        const contact = this.editingContactId ? this.contacts.find(c => c.id === this.editingContactId) : null;
        const selectedTags = contact && contact.tags ? contact.tags : [];

        container.innerHTML = this.tags.map(tag => `
            <label class="tag-checkbox">
                <input type="checkbox" value="${tag.id}" ${selectedTags.includes(tag.id) ? 'checked' : ''}>
                <span class="tag-label" style="background: ${tag.color}20; color: ${tag.color};">${tag.name}</span>
            </label>
        `).join('');
    }

    saveContact(form) {
        const formData = new FormData(form);
        
        // Get selected tags
        const selectedTags = Array.from(document.querySelectorAll('#tag-selector input[type="checkbox"]:checked'))
            .map(cb => cb.value);

        const contact = {
            id: this.editingContactId || this.generateId(),
            // Basic Info
            vendorName: formData.get('vendorName'),
            companyName: formData.get('companyName') || formData.get('vendorName'),
            contactName: formData.get('contactName'),
            title: formData.get('title'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            website: formData.get('website'),
            
            // Business Info
            category: formData.get('category'),
            segment: formData.get('segment'),
            status: formData.get('status'),
            industryVertical: formData.get('industryVertical'),
            companySize: formData.get('companySize'),
            annualRevenue: formData.get('annualRevenue'),
            
            // Contact Details
            linkedin: formData.get('linkedin'),
            twitter: formData.get('twitter'),
            facebook: formData.get('facebook'),
            instagram: formData.get('instagram'),
            
            // Address
            address: formData.get('address'),
            city: formData.get('city'),
            state: formData.get('state'),
            zipCode: formData.get('zipCode'),
            country: formData.get('country') || 'USA',
            
            // Deal Info
            dealStage: formData.get('dealStage'),
            dealValue: formData.get('dealValue'),
            dealProbability: formData.get('dealProbability'),
            expectedCloseDate: formData.get('expectedCloseDate'),
            
            // Decision Making
            decisionMaker: formData.get('decisionMaker') === 'true',
            budget: formData.get('budget'),
            authority: formData.get('authority'),
            
            // Notes & Tags
            notes: formData.get('notes'),
            internalNotes: formData.get('internalNotes'),
            tags: selectedTags,
            
            // Tracking
            leadSource: formData.get('leadSource') || 'Albany Ski Expo',
            referredBy: formData.get('referredBy'),
            
            // Metadata
            createdAt: this.editingContactId ? 
                this.contacts.find(c => c.id === this.editingContactId).createdAt : 
                new Date().toISOString(),
            lastContact: this.editingContactId ? 
                this.contacts.find(c => c.id === this.editingContactId).lastContact : 
                null,
            followUpDate: formData.get('followUpDate') || null,
            nextSteps: formData.get('nextSteps'),
            
            // Custom fields
            customFields: {}
        };

        if (this.editingContactId) {
            const index = this.contacts.findIndex(c => c.id === this.editingContactId);
            this.contacts[index] = contact;
        } else {
            this.contacts.push(contact);
        }

        this.saveData();
        this.closeContactModal();
        this.renderContacts();
        this.updateStats();
        
        this.showNotification('Contact saved successfully!');
    }

    viewContact(id) {
        this.currentContact = this.contacts.find(c => c.id === id);
        if (!this.currentContact) return;

        const contactActivities = this.activities
            .filter(a => a.contactId === id)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        // Get tags
        const contactTags = this.currentContact.tags ? this.currentContact.tags.map(tagId => {
            const tag = this.tags.find(t => t.id === tagId);
            return tag ? `<span class="tag-badge" style="background: ${tag.color}; color: white;">${tag.name}</span>` : '';
        }).join('') : '<span class="text-muted">No tags</span>';

        const content = `
            <div class="contact-detail">
                <div class="contact-header">
                    <div>
                        <h2 class="contact-name">${this.currentContact.contactName || 'No Contact Name'}</h2>
                        ${this.currentContact.title ? `<p class="contact-title">${this.currentContact.title}</p>` : ''}
                        <p class="contact-company">${this.currentContact.companyName || this.currentContact.vendorName}</p>
                    </div>
                    <div class="contact-tags">
                        ${contactTags}
                    </div>
                </div>
                <div class="contact-body">
                    <!-- Contact Information -->
                    <div class="detail-section">
                        <h3>Contact Information</h3>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <span class="detail-label">Email</span>
                                <span class="detail-value"><a href="mailto:${this.currentContact.email}">${this.currentContact.email}</a></span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Phone</span>
                                <span class="detail-value">${this.currentContact.phone || '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Website</span>
                                <span class="detail-value">
                                    ${this.currentContact.website ? `<a href="${this.currentContact.website}" target="_blank">${this.currentContact.website}</a>` : '—'}
                                </span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">LinkedIn</span>
                                <span class="detail-value">
                                    ${this.currentContact.linkedin ? `<a href="${this.currentContact.linkedin}" target="_blank">View Profile</a>` : '—'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- Business Information -->
                    <div class="detail-section">
                        <h3>Business Information</h3>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <span class="detail-label">Category</span>
                                <span class="detail-value">${this.currentContact.category || '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Segment</span>
                                <span class="detail-value">${this.currentContact.segment || '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Company Size</span>
                                <span class="detail-value">${this.currentContact.companySize || '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Annual Revenue</span>
                                <span class="detail-value">${this.currentContact.annualRevenue || '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Status</span>
                                <span class="detail-value">
                                    <span class="status-badge status-${this.slugify(this.currentContact.status)}">
                                        ${this.currentContact.status}
                                    </span>
                                </span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Lead Source</span>
                                <span class="detail-value">${this.currentContact.leadSource || '—'}</span>
                            </div>
                        </div>
                    </div>

                    ${this.currentContact.address ? `
                    <!-- Location -->
                    <div class="detail-section">
                        <h3>Location</h3>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <span class="detail-label">Address</span>
                                <span class="detail-value">${this.currentContact.address}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">City, State</span>
                                <span class="detail-value">${this.currentContact.city || '—'}, ${this.currentContact.state || '—'} ${this.currentContact.zipCode || ''}</span>
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    ${this.currentContact.dealStage || this.currentContact.dealValue ? `
                    <!-- Deal Information -->
                    <div class="detail-section">
                        <h3>Deal Information</h3>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <span class="detail-label">Deal Stage</span>
                                <span class="detail-value">${this.currentContact.dealStage || '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Deal Value</span>
                                <span class="detail-value">${this.currentContact.dealValue ? '$' + this.currentContact.dealValue : '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Probability</span>
                                <span class="detail-value">${this.currentContact.dealProbability ? this.currentContact.dealProbability + '%' : '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Expected Close</span>
                                <span class="detail-value">${this.currentContact.expectedCloseDate ? this.formatDate(this.currentContact.expectedCloseDate) : '—'}</span>
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    ${this.currentContact.decisionMaker || this.currentContact.authority ? `
                    <!-- Decision Making -->
                    <div class="detail-section">
                        <h3>Decision Making</h3>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <span class="detail-label">Decision Maker</span>
                                <span class="detail-value">${this.currentContact.decisionMaker ? '✓ Yes' : 'No'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Authority Level</span>
                                <span class="detail-value">${this.currentContact.authority || '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Budget</span>
                                <span class="detail-value">${this.currentContact.budget || '—'}</span>
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    ${this.currentContact.notes || this.currentContact.internalNotes || this.currentContact.nextSteps ? `
                    <!-- Notes & Next Steps -->
                    <div class="detail-section">
                        <h3>Notes & Next Steps</h3>
                        ${this.currentContact.notes ? `
                            <div class="notes-box">
                                <strong>Public Notes:</strong>
                                <p>${this.currentContact.notes}</p>
                            </div>
                        ` : ''}
                        ${this.currentContact.internalNotes ? `
                            <div class="notes-box internal-notes">
                                <strong>Internal Notes:</strong>
                                <p>${this.currentContact.internalNotes}</p>
                            </div>
                        ` : ''}
                        ${this.currentContact.nextSteps ? `
                            <div class="notes-box">
                                <strong>Next Steps:</strong>
                                <p>${this.currentContact.nextSteps}</p>
                            </div>
                        ` : ''}
                    </div>
                    ` : ''}

                    <!-- Activity Timeline -->
                    <div class="detail-section">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <h3>Activity Timeline</h3>
                            <button class="btn btn-primary" onclick="app.logActivity('${id}')">+ Log Activity</button>
                        </div>
                        ${contactActivities.length > 0 ? `
                            <div class="activity-timeline">
                                ${contactActivities.map(activity => `
                                    <div class="timeline-item">
                                        <div class="timeline-content">
                                            <div class="timeline-header">
                                                <span class="timeline-type">${activity.type}</span>
                                                <span class="timeline-date">${this.formatDate(activity.date)}</span>
                                            </div>
                                            <p class="timeline-notes">${activity.notes}</p>
                                            ${activity.followUpDate ? `<p class="timeline-notes" style="margin-top: 0.5rem;"><strong>Follow-up:</strong> ${this.formatDate(activity.followUpDate)}</p>` : ''}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : '<p class="empty-state">No activity logged yet</p>'}
                    </div>
                </div>
            </div>
        `;

        document.getElementById('contact-detail-content').innerHTML = content;
        this.showPage('contact-detail');
    }

    editContact() {
        if (!this.currentContact) return;
        
        this.editingContactId = this.currentContact.id;
        document.getElementById('modal-title').textContent = 'Edit Contact Profile';
        
        const form = document.getElementById('contact-form');
        
        // Basic Info
        form.vendorName.value = this.currentContact.vendorName || '';
        form.companyName.value = this.currentContact.companyName || '';
        form.contactName.value = this.currentContact.contactName || '';
        form.title.value = this.currentContact.title || '';
        form.email.value = this.currentContact.email || '';
        form.phone.value = this.currentContact.phone || '';
        form.website.value = this.currentContact.website || '';
        
        // Business Info
        form.category.value = this.currentContact.category || '';
        form.segment.value = this.currentContact.segment || '';
        form.status.value = this.currentContact.status || 'Not Started';
        form.companySize.value = this.currentContact.companySize || '';
        form.annualRevenue.value = this.currentContact.annualRevenue || '';
        
        // Social
        form.linkedin.value = this.currentContact.linkedin || '';
        form.twitter.value = this.currentContact.twitter || '';
        form.facebook.value = this.currentContact.facebook || '';
        form.instagram.value = this.currentContact.instagram || '';
        
        // Address
        form.address.value = this.currentContact.address || '';
        form.city.value = this.currentContact.city || '';
        form.state.value = this.currentContact.state || '';
        form.zipCode.value = this.currentContact.zipCode || '';
        
        // Deal Info
        form.dealStage.value = this.currentContact.dealStage || '';
        form.dealValue.value = this.currentContact.dealValue || '';
        form.dealProbability.value = this.currentContact.dealProbability || '';
        form.expectedCloseDate.value = this.currentContact.expectedCloseDate || '';
        
        // Decision Making
        form.decisionMaker.value = this.currentContact.decisionMaker ? 'true' : 'false';
        form.budget.value = this.currentContact.budget || '';
        form.authority.value = this.currentContact.authority || '';
        
        // Notes
        form.notes.value = this.currentContact.notes || '';
        form.internalNotes.value = this.currentContact.internalNotes || '';
        form.followUpDate.value = this.currentContact.followUpDate || '';
        form.nextSteps.value = this.currentContact.nextSteps || '';
        form.leadSource.value = this.currentContact.leadSource || '';
        form.referredBy.value = this.currentContact.referredBy || '';
        
        // Render tag selector with current selections
        this.renderTagSelector();
        
        document.getElementById('contact-modal').classList.add('active');
    }

    deleteContact() {
        if (!this.currentContact) return;
        
        if (confirm(`Are you sure you want to delete ${this.currentContact.vendorName}?`)) {
            this.contacts = this.contacts.filter(c => c.id !== this.currentContact.id);
            this.activities = this.activities.filter(a => a.contactId !== this.currentContact.id);
            this.saveData();
            this.showPage('contacts');
            this.updateStats();
            this.showNotification('Contact deleted successfully!');
        }
    }

    // Activity Management
    logActivity(contactId) {
        this.currentContact = this.contacts.find(c => c.id === contactId);
        document.getElementById('activity-form').reset();
        document.getElementById('activity-modal').classList.add('active');
    }

    closeActivityModal() {
        document.getElementById('activity-modal').classList.remove('active');
    }

    saveActivity(form) {
        if (!this.currentContact) return;

        const formData = new FormData(form);
        const activity = {
            id: this.generateId(),
            contactId: this.currentContact.id,
            type: formData.get('type'),
            notes: formData.get('notes'),
            date: new Date().toISOString(),
            followUpDate: formData.get('followUpDate') || null
        };

        this.activities.push(activity);

        // Update contact's last contact date
        const contact = this.contacts.find(c => c.id === this.currentContact.id);
        if (contact) {
            contact.lastContact = activity.date;
            if (activity.followUpDate) {
                contact.followUpDate = activity.followUpDate;
            }
            // Auto-update status to "In Progress" if it was "Not Started"
            if (contact.status === 'Not Started') {
                contact.status = 'In Progress';
            }
        }

        this.saveData();
        this.closeActivityModal();
        this.viewContact(this.currentContact.id);
        this.renderRecentActivity();
        this.updateStats();
        
        this.showNotification('Activity logged successfully!');
    }

    // Scripts Management (keeping existing implementation)
    renderScripts() {
        const container = document.getElementById('scripts-grid');
        
        if (this.scripts.length === 0) {
            container.innerHTML = '<p class="empty-state">No scripts available</p>';
            return;
        }

        container.innerHTML = this.scripts.map(script => `
            <div class="script-card" onclick="app.viewScript('${script.id}')">
                <span class="script-type-badge">${script.type}</span>
                <h3 class="script-title">${script.title}</h3>
                ${script.subject ? `<p class="script-subject">Subject: ${script.subject}</p>` : ''}
                <p class="script-preview">${script.content}</p>
                <div class="script-actions">
                    <button class="btn btn-secondary action-btn" onclick="event.stopPropagation(); app.copyScript('${script.id}')">Copy</button>
                    <button class="btn btn-secondary action-btn" onclick="event.stopPropagation(); app.editScript('${script.id}')">Edit</button>
                    <button class="btn btn-danger action-btn" onclick="event.stopPropagation(); app.deleteScript('${script.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    }

    showAddScriptModal() {
        this.editingScriptId = null;
        document.getElementById('script-modal-title').textContent = 'Add Script';
        document.getElementById('script-form').reset();
        document.getElementById('script-modal').classList.add('active');
    }

    closeScriptModal() {
        document.getElementById('script-modal').classList.remove('active');
        this.editingScriptId = null;
    }

    saveScript(form) {
        const formData = new FormData(form);
        const script = {
            id: this.editingScriptId || this.generateId(),
            title: formData.get('title'),
            type: formData.get('type'),
            subject: formData.get('subject'),
            content: formData.get('content'),
            createdAt: this.editingScriptId ?
                this.scripts.find(s => s.id === this.editingScriptId).createdAt :
                new Date().toISOString()
        };

        if (this.editingScriptId) {
            const index = this.scripts.findIndex(s => s.id === this.editingScriptId);
            this.scripts[index] = script;
        } else {
            this.scripts.push(script);
        }

        this.saveData();
        this.closeScriptModal();
        this.renderScripts();
        
        this.showNotification('Script saved successfully!');
    }

    viewScript(id) {
        const script = this.scripts.find(s => s.id === id);
        if (!script) return;

        const content = script.subject ? 
            `Subject: ${script.subject}\n\n${script.content}` : 
            script.content;

        alert(`${script.title}\n\n${content}`);
    }

    editScript(id) {
        const script = this.scripts.find(s => s.id === id);
        if (!script) return;

        this.editingScriptId = id;
        document.getElementById('script-modal-title').textContent = 'Edit Script';
        
        const form = document.getElementById('script-form');
        form.title.value = script.title;
        form.type.value = script.type;
        form.subject.value = script.subject || '';
        form.content.value = script.content;
        
        document.getElementById('script-modal').classList.add('active');
    }

    copyScript(id) {
        const script = this.scripts.find(s => s.id === id);
        if (!script) return;

        const content = script.subject ? 
            `Subject: ${script.subject}\n\n${script.content}` : 
            script.content;

        navigator.clipboard.writeText(content).then(() => {
            this.showNotification('Script copied to clipboard!');
        });
    }

    deleteScript(id) {
        if (confirm('Are you sure you want to delete this script?')) {
            this.scripts = this.scripts.filter(s => s.id !== id);
            this.saveData();
            this.renderScripts();
            this.showNotification('Script deleted successfully!');
        }
    }

    addDefaultScripts() {
        const defaultScripts = [
            {
                id: this.generateId(),
                title: 'Initial Outreach - Print Advertising Platform',
                type: 'Email',
                subject: 'Reach more customers for {Vendor Name} with print advertising',
                content: `Hi {Contact Name},

My name is {Your Name} from AdSell.ai. I saw {Vendor Name} at the Albany Ski Expo and wanted to reach out about an opportunity that could help you reach more customers this ski season.

AdSell.ai is an AI-powered platform that makes print advertising incredibly easy and affordable. Instead of going through expensive agencies, you can place ads directly in top newspapers and magazines with just a few clicks.

Here's what makes us different:

✓ Direct access to hundreds of publications - no agency fees
✓ AI helps you target the right publications for your audience
✓ Create and submit ads in minutes, not weeks
✓ Track real ROI and engagement (yes, even for print!)
✓ Better rates than traditional agency pricing

Perfect for {Category} like yours looking to reach local ski enthusiasts and families planning their winter trips.

**Special offer for ski industry businesses:** Use code 2104 to get started with preferred pricing.

Would you be open to a quick 10-minute call this week? I can show you exactly how {Vendor Name} could use print advertising to fill more lift lines/increase foot traffic/boost bookings this season.

Visit www.adsell.ai or reply to schedule a demo.

Best,
{Your Name}
AdSell.ai
support@adsell.ai`,
                createdAt: new Date().toISOString()
            },
            {
                id: this.generateId(),
                title: 'Phone Call Script',
                type: 'Phone Call',
                subject: '',
                content: `Opening:
"Hi, this is {Your Name} from AdSell.ai. I'm calling ski industry businesses in the area about a new way to advertise that's getting great results. Do you have a quick minute?"

If Yes - Build Credibility:
"Great! We work with ski resorts, shops, and clubs to help them reach customers through print advertising - but without the hassle and expense of traditional agencies. Have you done any print advertising before?"

[Listen to their response]

Value Proposition:
"Here's the thing - print advertising still works incredibly well for local businesses, especially in the ski industry. The problem is it's always been expensive and complicated. That's what we've solved.

With AdSell.ai, you can:
• Place ads in major newspapers and magazines yourself - no middleman
• Target publications where your customers actually are
• Get it done in minutes, not weeks
• Pay 50-70% less than traditional agency rates
• Track actual ROI with our AI-powered analytics"

Discovery Questions:
1. "How are you currently reaching new customers? Digital ads? Social media?"
2. "Have you tried print before? What was your experience?"
3. "What are your goals for this ski season - more bookings? More foot traffic?"

Handling Objections:

"We don't have budget for advertising" → 
"I totally get it. That's actually why this makes sense - you're cutting out the agency fees, so you're getting 50-70% more reach for the same budget. You could start small - even a few hundred dollars goes a long way."

"Print doesn't work" →
"I hear that a lot! But here's what we're seeing: ski industry businesses reach an audience through print that they miss completely online - especially families, older skiers, and people planning weekend trips. Plus, our AI helps you target the exact publications your customers read."

"We just do digital" →
"Makes sense - digital is great for immediate response. But think about it: when someone's planning their ski trip, they're looking at local publications, weekend guides, outdoor magazines. That's a completely different audience than who sees your Instagram ad. The businesses we work with do both - digital for immediate, print for building awareness."

"Too complicated" →
"That's exactly what we've solved! It literally takes less time than setting up a Facebook ad. Upload your design (or we can help), pick your publications, and click submit. Our AI even recommends which publications will work best for your business."

"Need to think about it" →
"Absolutely, makes sense. What specific information would help you make a decision? I can send you examples of other ski businesses using our platform, pricing details, or we could just set up a free account so you can see the dashboard yourself - no commitment needed."

Closing:
"How about this - let me set you up with a free account right now. You can log in, explore the publications, see pricing, and even mock up an ad. Takes 2 minutes and you'll know immediately if it's a fit. Sound good?"

[If yes]: "Perfect! I just need your email address..."

Next Steps:
"I'll send you login details and a quick video walkthrough. Try it out, and I'll follow up in a few days to see if you have questions. Fair enough?"

IMPORTANT: 
• Get their main advertising goals (bookings, retail sales, memberships, etc.)
• Note their current advertising channels
• Ask about their busy season timing
• Set specific follow-up date`,
                createdAt: new Date().toISOString()
            },
            {
                id: this.generateId(),
                title: 'Follow-up Email - No Response',
                type: 'Email',
                subject: 'Still interested in reaching more customers? {Vendor Name}',
                content: `Hi {Contact Name},

Following up on my email about AdSell.ai - wanted to make sure this didn't get buried in your inbox.

Quick refresher: We help ski businesses like {Vendor Name} place print ads in newspapers and magazines without the hassle (or cost!) of traditional agencies.

Why this matters for ski season:
• Families plan ski trips by reading local weekend guides and outdoor magazines
• Print reaches a demographic you're missing with digital-only advertising  
• It's WAY cheaper than you think (no agency fees = 50-70% cost reduction)
• Our AI helps you target the exact publications your customers read

Takes literally 5 minutes to create and submit your first ad.

**Ski industry special:** Use code 2104 at www.adsell.ai for preferred access.

Quick question: Are you actively advertising right now, or still figuring out your marketing strategy for the season?

Would love to show you how {Vendor Name} could use this. 10-minute call or I can send you a quick demo video - your choice.

Reply with "Demo" for a video walkthrough or "Call" to schedule 10 minutes.

Thanks,
{Your Name}
AdSell.ai`,
                createdAt: new Date().toISOString()
            },
            {
                id: this.generateId(),
                title: 'Value Proposition - Short Email',
                type: 'Email',
                subject: 'Print advertising without the headache',
                content: `{Contact Name},

Quick question: Does {Vendor Name} do any print advertising?

Most ski businesses tell us they wish they could, but it's too expensive/complicated/time-consuming through traditional agencies.

That's exactly what we built AdSell.ai to solve:

→ Place ads in hundreds of newspapers & magazines yourself (no agency!)
→ Takes minutes, not weeks
→ Pay 50-70% less than traditional rates  
→ AI targets the right publications for your customers
→ Track actual ROI

Perfect for reaching families planning ski trips who aren't on Instagram all day.

Worth a 10-minute conversation? I can show you exactly how it works and what it would cost for {Vendor Name}.

Reply "yes" or visit www.adsell.ai (code 2104 for ski industry access).

{Your Name}
AdSell.ai`,
                createdAt: new Date().toISOString()
            },
            {
                id: this.generateId(),
                title: 'The Albany Ski Expo Connection',
                type: 'Email',
                subject: 'Following up from Albany Ski Expo',
                content: `Hi {Contact Name},

We connected at the Albany Ski Expo (or saw {Vendor Name} was an exhibitor) and wanted to follow up about something that could help you get more value from events like this.

The challenge with expos: you meet hundreds of potential customers, but then what? How do you stay top-of-mind when they're actually ready to book/buy?

That's where print advertising comes in - and why we built AdSell.ai.

Here's how ski businesses are using it:
→ Run ads in local newspapers/magazines right after events
→ Reach the same audience (families, ski enthusiasts) when they're planning trips
→ Reinforce your brand while it's fresh from the expo
→ Do it yourself in minutes, without expensive agencies

**Example:** A ski shop runs an ad in regional outdoor magazines post-expo offering 15% off gear. Cost: $300. Result: 47 customers, $8,200 in sales. That's 27x ROI.

Want to see how this could work for {Vendor Name}? I can show you exactly which publications your expo attendees read.

10-minute call or demo video - your choice. Reply or visit www.adsell.ai (code 2104).

Best,
{Your Name}
AdSell.ai`,
                createdAt: new Date().toISOString()
            }
        ];

        this.scripts = defaultScripts;
        this.saveData();
    }

    // CSV Import - robust header mapping
    handleCSVUpload(file) {
        if (!file) return;

        const reader = new FileReader();

        reader.onload = (e) => {
            const csv = e.target.result;
            // Handle both \n and \r\n and ignore empty lines
            const lines = csv.split(/\r?\n/).filter(line => line.trim().length > 0);
            if (lines.length < 2) {
                alert("CSV appears to be empty or missing data rows.");
                return;
            }

            const headers = this.parseCSVLine(lines[0]).map(h => h.trim());
            const headerMap = headers.map(h => h.toLowerCase());

            const contacts = [];

            // Helper to check if a header contains any of the keywords
            const hasAny = (header, keywords) =>
                keywords.some(k => header.includes(k));

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const values = this.parseCSVLine(line);

                const contact = {
                    id: this.generateId(),
                    vendorName: "",
                    companyName: "",
                    contactName: "",
                    title: "",
                    email: "",
                    phone: "",
                    website: "",
                    category: "",
                    segment: "",
                    status: "Not Started",
                    notes: "",
                    internalNotes: "",
                    tags: [],
                    leadSource: "CSV Import",
                    createdAt: new Date().toISOString(),
                    lastContact: null,
                    followUpDate: null
                };

                const extraNotes = [];

                headers.forEach((header, index) => {
                    const rawValue = values[index] != null ? values[index] : "";
                    const value = rawValue.toString().trim();
                    if (!value) return;

                    const h = headerMap[index];

                    // Vendor / Company / Organization name
                    if (hasAny(h, ["vendor", "business", "organization", "organisation", "org", "company", "account", "brand"])) {
                        if (!contact.vendorName) contact.vendorName = value;
                        if (!contact.companyName) contact.companyName = value;
                    }
                    // Contact name
                    else if (
                        (h.includes("contact") && h.includes("name")) ||
                        hasAny(h, ["marketing_contact_name", "contact_name"]) ||
                        (h === "name" || h.includes("full name"))
                    ) {
                        if (!contact.contactName) contact.contactName = value;
                    }
                    // Email
                    else if (h.includes("email") || h.includes("e-mail")) {
                        if (!contact.email) contact.email = value;
                    }
                    // Phone (direct, alt, mobile, etc.)
                    else if (hasAny(h, ["phone", "tel", "telephone", "mobile", "cell"])) {
                        if (!contact.phone) contact.phone = value;
                        else if (!contact.phone.includes(value)) contact.phone += ` / ${value}`;
                    }
                    // Website / domain / URL
                    else if (hasAny(h, ["website", "domain", "url", "site", "homepage"])) {
                        if (!contact.website) {
                            let v = value;
                            if (!/^https?:\/\//i.test(v) && v) {
                                v = "https://" + v.replace(/^\/+/, "");
                            }
                            contact.website = v;
                        }
                    }
                    // Category / industry / vertical
                    else if (hasAny(h, ["category", "industry", "vertical"])) {
                        if (!contact.category) contact.category = value;
                    }
                    // Segment / region / market / territory
                    else if (hasAny(h, ["segment", "region", "market", "territory"])) {
                        if (!contact.segment) contact.segment = value;
                    }
                    // Status / stage / pipeline
                    else if (hasAny(h, ["status", "stage", "pipeline"])) {
                        contact.status = value || "Not Started";
                    }
                    // Notes / comments / description
                    else if (hasAny(h, ["notes", "note", "comment", "comments", "description"])) {
                        extraNotes.push(`${header}: ${value}`);
                    }
                    // Unknown columns → store in notes so we don't lose info
                    else {
                        extraNotes.push(`${header}: ${value}`);
                    }
                });

                // Fallbacks for vendor/company names
                if (!contact.vendorName) {
                    contact.vendorName =
                        contact.companyName ||
                        contact.contactName ||
                        (contact.email ? contact.email.split("@")[0] : "") ||
                        contact.phone ||
                        "";
                }
                if (!contact.companyName && contact.vendorName) {
                    contact.companyName = contact.vendorName;
                }

                // Merge extra notes into notes field
                if (extraNotes.length) {
                    contact.notes = contact.notes
                        ? contact.notes + "\n" + extraNotes.join("\n")
                        : extraNotes.join("\n");
                }

                // Keep the row if it has any meaningful identifier
                const hasIdentifier =
                    (contact.vendorName && contact.vendorName.trim()) ||
                    (contact.companyName && contact.companyName.trim()) ||
                    (contact.contactName && contact.contactName.trim()) ||
                    (contact.email && contact.email.trim()) ||
                    (contact.phone && contact.phone.trim());

                if (hasIdentifier) {
                    contacts.push(contact);
                }
            }

            if (contacts.length === 0) {
                alert("No usable contact rows were found in this CSV.");
                return;
            }

            this.pendingImport = contacts;
            this.showImportPreview();
        };

        reader.readAsText(file);
    }

    parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);

        return values.map(v => v.replace(/^"|"$/g, ''));
    }

    showImportPreview() {
        if (!this.pendingImport || this.pendingImport.length === 0) {
            alert('No valid contacts found in CSV file');
            return;
        }

        document.getElementById('preview-count').textContent = this.pendingImport.length;

        const preview = this.pendingImport.slice(0, 10).map(contact => `
            <div style="padding: 0.5rem; border-bottom: 1px solid var(--border);">
                <strong>${contact.vendorName || '(No vendor/business name)'}</strong><br>
                ${contact.contactName ? `${contact.contactName} · ` : ''}
                ${contact.email || '(no email)'}<br>
                <span style="font-size: 0.8rem; color: var(--text-secondary);">
                    Status: ${contact.status || 'Not Started'}
                </span>
            </div>
        `).join('');

        document.getElementById('preview-content').innerHTML = preview;
        document.getElementById('upload-preview').style.display = 'block';
    }

    confirmImport() {
        if (!this.pendingImport) return;

        const count = this.pendingImport.length;
        this.contacts.push(...this.pendingImport);
        this.saveData();
        this.pendingImport = null;
        
        this.cancelImport();
        this.showPage('contacts');
        this.updateStats();
        
        this.showNotification(`${count} contacts imported successfully!`);
    }

    cancelImport() {
        this.pendingImport = null;
        document.getElementById('upload-preview').style.display = 'none';
        document.getElementById('csv-file-input').value = '';
    }

    // Analytics
    renderAnalytics() {
        this.renderStatusBreakdown();
        this.renderCategoryDistribution();
        this.renderFollowUpQueue();
    }

    renderStatusBreakdown() {
        const container = document.getElementById('status-chart');
        const statusCounts = {
            'Not Started': 0,
            'In Progress': 0,
            'Responded': 0,
            'Signed Up': 0
        };

        this.contacts.forEach(contact => {
            statusCounts[contact.status]++;
        });

        const total = this.contacts.length || 1;
        
        container.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 1rem;">
                ${Object.entries(statusCounts).map(([status, count]) => `
                    <div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                            <span>${status}</span>
                            <span><strong>${count}</strong> (${Math.round(count / total * 100)}%)</span>
                        </div>
                        <div style="background: var(--border); height: 8px; border-radius: 4px; overflow: hidden;">
                            <div style="background: var(--primary-color); height: 100%; width: ${count / total * 100}%;"></div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderCategoryDistribution() {
        const container = document.getElementById('category-chart');
        const categoryCounts = {};

        this.contacts.forEach(contact => {
            const category = contact.category || 'Other';
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        });

        const sortedCategories = Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1]);

        container.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                ${sortedCategories.map(([category, count]) => `
                    <div style="display: flex; justify-content: space-between; padding: 0.5rem; background: var(--background); border-radius: 0.375rem;">
                        <span>${category}</span>
                        <strong>${count}</strong>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderFollowUpQueue() {
        const container = document.getElementById('followup-list');
        const needsFollowUp = this.contacts
            .filter(c => c.followUpDate && new Date(c.followUpDate) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
            .sort((a, b) => new Date(a.followUpDate) - new Date(b.followUpDate));

        if (needsFollowUp.length === 0) {
            container.innerHTML = '<p class="empty-state">No follow-ups scheduled</p>';
            return;
        }

        container.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 0.75rem; max-height: 400px; overflow-y: auto;">
                ${needsFollowUp.map(contact => `
                    <div style="padding: 1rem; background: var(--background); border-radius: 0.375rem; border-left: 3px solid var(--warning-color); cursor: pointer;" onclick="app.viewContact('${contact.id}')">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
                            <strong>${contact.vendorName}</strong>
                            <span style="color: var(--warning-color);">${this.formatDate(contact.followUpDate)}</span>
                        </div>
                        <div style="font-size: 0.875rem; color: var(--text-secondary);">
                            ${contact.email}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Utilities
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
    }

    slugify(text) {
        return text.toLowerCase().replace(/\s+/g, '-');
    }

    truncateText(text, length) {
        if (!text || text.length <= length) return text;
        return text.substring(0, length) + '...';
    }

    // Download helpers
    downloadTextFile(filename, text) {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
    }

    toCSV(rows) {
        if (!rows || rows.length === 0) return '';
        const escape = (value) => {
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (/[",\n]/.test(str)) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };
        return rows.map(r => r.map(escape).join(',')).join('\n');
    }

    exportContactsCSV() {
        const contacts = this.getFilteredContacts();
        if (contacts.length === 0) {
            alert('No contacts to export for current filters.');
            return;
        }
        const headers = [
            'id','vendorName','companyName','contactName','title','email','phone','website',
            'category','segment','status','companySize','annualRevenue',
            'linkedin','twitter','facebook','instagram',
            'address','city','state','zipCode',
            'dealStage','dealValue','dealProbability','expectedCloseDate',
            'decisionMaker','authority','budget',
            'notes','internalNotes','nextSteps','followUpDate','leadSource','createdAt','lastContact','tags'
        ];
        const rows = [headers].concat(contacts.map(c => [
            c.id, c.vendorName, c.companyName, c.contactName, c.title, c.email, c.phone, c.website,
            c.category, c.segment, c.status, c.companySize, c.annualRevenue,
            c.linkedin, c.twitter, c.facebook, c.instagram,
            c.address, c.city, c.state, c.zipCode,
            c.dealStage, c.dealValue, c.dealProbability, c.expectedCloseDate,
            c.decisionMaker, c.authority, c.budget,
            c.notes, c.internalNotes, c.nextSteps, c.followUpDate, c.leadSource, c.createdAt, c.lastContact,
            Array.isArray(c.tags) ? c.tags.join('|') : ''
        ]));
        const csv = this.toCSV(rows);
        this.downloadTextFile(`contacts_export_${new Date().toISOString().slice(0,10)}.csv`, csv);
        this.showNotification('Contacts CSV exported.');
    }

    exportContactsJSON() {
        const contacts = this.getFilteredContacts();
        if (contacts.length === 0) {
            alert('No contacts to export for current filters.');
            return;
        }
        const json = JSON.stringify(contacts, null, 2);
        this.downloadTextFile(`contacts_export_${new Date().toISOString().slice(0,10)}.json`, json);
        this.showNotification('Contacts JSON exported.');
    }

    exportActivitiesCSV() {
        const filteredIds = new Set(this.getFilteredContacts().map(c => c.id));
        const acts = this.activities.filter(a => filteredIds.has(a.contactId));
        if (acts.length === 0) {
            alert('No activities to export for current filters.');
            return;
        }
        const headers = ['id','contactId','type','notes','date','followUpDate'];
        const rows = [headers].concat(acts.map(a => [
            a.id, a.contactId, a.type, a.notes, a.date, a.followUpDate || ''
        ]));
        const csv = this.toCSV(rows);
        this.downloadTextFile(`activities_export_${new Date().toISOString().slice(0,10)}.csv`, csv);
        this.showNotification('Activities CSV exported.');
    }

    showNotification(message) {
        // Simple alert for now - could be enhanced with a toast notification
        console.log(message);
        // Could add a toast notification system here
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.textContent = message;
        toast.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: var(--success-color); color: white; padding: 1rem 1.5rem; border-radius: 0.5rem; box-shadow: var(--shadow-lg); z-index: 10000; animation: slideIn 0.3s ease-out;';
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Show AI result modal helper
    showAIResult(title, text) {
        const modal = document.getElementById('ai-modal');
        const titleEl = document.getElementById('ai-modal-title');
        const output = document.getElementById('ai-modal-output');
        if (!modal || !titleEl || !output) {
            alert(text);
            return;
        }
        titleEl.textContent = title || 'AI Result';
        output.value = text || '';
        modal.classList.add('active');
    }

    // Pipeline
    renderPipeline() {
        const stages = ['Prospecting','Qualified','Proposal','Negotiation','Closed Won','Closed Lost'];
        const board = document.getElementById('pipeline-board');
        if (!board) return;
        const grouped = {};
        stages.forEach(s => grouped[s] = []);
        this.contacts.forEach(c => {
            const s = c.dealStage && stages.includes(c.dealStage) ? c.dealStage : 'Prospecting';
            grouped[s].push(c);
        });
        board.innerHTML = stages.map(stage => {
            const items = grouped[stage]
                .sort((a,b) => (b.dealValue || 0) - (a.dealValue || 0))
                .map(c => `
                    <div class="pipeline-card" draggable="true" data-id="${c.id}">
                        <div class="card-title">${c.vendorName}</div>
                        <div class="card-sub">${c.contactName || ''} ${c.dealValue ? ' • $' + c.dealValue : ''}</div>
                    </div>
                `).join('');
            return `
                <div class="pipeline-column" data-stage="${stage}">
                    <div class="pipeline-column-header">
                        <span>${stage}</span>
                        <span>${grouped[stage].length}</span>
                    </div>
                    <div class="pipeline-column-body" data-dropzone="true">
                        ${items || '<div class="empty-state" style="padding:0.5rem;">No deals</div>'}
                    </div>
                </div>
            `;
        }).join('');

        // Drag and drop handlers
        board.querySelectorAll('.pipeline-card').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', card.getAttribute('data-id'));
            });
            card.addEventListener('dblclick', () => {
                const id = card.getAttribute('data-id');
                this.viewContact(id);
            });
        });
        board.querySelectorAll('[data-dropzone="true"]').forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.classList.add('pipeline-drop-hover');
            });
            zone.addEventListener('dragleave', () => {
                zone.classList.remove('pipeline-drop-hover');
            });
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('pipeline-drop-hover');
                const id = e.dataTransfer.getData('text/plain');
                const newStage = zone.closest('.pipeline-column').getAttribute('data-stage');
                const contact = this.contacts.find(c => c.id === id);
                if (contact) {
                    contact.dealStage = newStage;
                    // Auto update status based on won/lost
                    if (newStage === 'Closed Won') contact.status = 'Signed Up';
                    this.saveData();
                    this.renderPipeline();
                    this.updateStats();
                    this.showNotification(`Moved to ${newStage}`);
                }
            });
        });
    }
}

// Markdown AI modal helpers
function showAIModal(html) {
    const modal = document.getElementById('ai-modal');
    const body = document.getElementById('ai-modal-body');
    if (!modal || !body) {
        alert(typeof html === 'string' ? html : 'AI result ready.');
        return;
    }
    const rendered = (typeof marked !== 'undefined') ? marked.parse(html) : html;
    body.innerHTML = rendered;
    modal.classList.add('active');
}

function hideAIModal() {
    const modal = document.getElementById('ai-modal');
    if (modal) modal.classList.remove('active');
}

// Initialize app
const app = new OutreachTracker();

// Class prototype AI helpers (delegating to callAI and modal)
OutreachTracker.prototype.showAIModal = function (html) {
    showAIModal(html);
};

OutreachTracker.prototype.aiOutreach = async function () {
    const c = this.currentContact || {};
    const businessName = c.vendorName || c.companyName || "";
    const category = c.category || "";
    const segment = c.segment || "";
    const location = [c.city, c.state].filter(Boolean).join(", ");
    const contactName = c.contactName || "";
    const status = c.status || "";
    const notes = c.notes || "";
    const nextSteps = c.nextSteps || "";
    const website = c.website || "";

    const prompt = `
You are an SDR for AdSell.ai.

AdSell.ai is an AI-powered platform that helps businesses buy PRINT advertising directly in newspapers and magazines, without going through agencies. It:
- recommends relevant print publications and placements,
- simplifies ad creation and submission,
- makes print significantly more affordable than traditional agency/direct print,
- helps businesses reach audiences they miss with digital-only campaigns.

You are reaching out to this account:

- Business: ${businessName || "(unknown name)"}
- Contact: ${contactName || "(unknown contact)"}
- Category / vertical: ${category || "(not specified)"}
- Segment / region: ${segment || "(not specified)"}
- Location: ${location || "(not specified)"}
- Website: ${website || "(unknown)"}
- CRM status: ${status || "(not set)"}
- CRM notes: ${notes || "(no notes)"}
- CRM next steps: ${nextSteps || "(none recorded)"}

First, infer what this business likely does and what vertical/industry it belongs to (for example: ski resort, outdoor retailer, healthcare clinic, SaaS company, B2B services, local restaurant, tourism board, etc.).

Then, write a structured outreach package in Markdown with the following sections:

1. "Vertical / Context"
   - One short paragraph describing:
     - what this business likely is,
     - who their customers are,
     - what they are probably trying to achieve with marketing.

2. "Email Subject Lines"
   - 2–3 subject line options tailored to ${businessName}, taking into account the inferred vertical and goals.

3. "Initial Outreach Email"
   - A concise, friendly email that:
     - acknowledges who they are and what they care about,
     - explains AdSell.ai and the value of smart, targeted print advertising,
     - connects print specifically to their likely goals (based on the inferred vertical),
     - highlights: direct access to print, AI recommendations, lower cost, ease of execution,
     - includes a clear but low-friction CTA (for example: a short call, quick demo, or account walkthrough).

4. "Phone Call Script"
   - A short talk track that includes:
     - opener,
     - a few discovery questions customized to their vertical,
     - a focused AdSell.ai value pitch,
     - 2–3 objection responses (budget, "we only do digital", "print is dead", "no time").

5. "Follow-Up Emails"
   - 2 short follow-up email variants:
     - one for "no response yet",
     - one for "they showed some interest but stalled".

IMPORTANT:
- Adapt your examples and language to the inferred vertical.
- If (and only if) the business appears to be in the ski, snow sports, mountain resort, or outdoor recreation world (for example, category/notes/segment strongly suggests that), you may mention that AdSell.ai is currently running a special free-trial opportunity for ski/outdoor businesses and reference that as an additional reason to talk.
- For all other verticals, do NOT mention the ski/outdoor free trial. Instead, focus on AdSell.ai's general value (targeting, affordability, simplicity).
`;

    this.showAIModal('<p class="text-muted">Generating...</p>');
    const result = await callAI(prompt);
    this.showAIModal(result);
};

OutreachTracker.prototype.aiCompanyResearch = async function () {
    const c = this.currentContact || {};
    const businessName = c.vendorName || c.companyName || "";
    const category = c.category || "";
    const segment = c.segment || "";
    const location = [c.city, c.state].filter(Boolean).join(", ");
    const website = c.website || "";
    const notes = c.notes || "";

    const prompt = `
You are an SDR strategist for AdSell.ai.

AdSell.ai is an AI-powered platform that helps businesses buy PRINT ads directly in newspapers and magazines:
- AI suggests relevant publications and placements,
- campaigns are easier to execute than traditional print,
- costs are typically lower than old-school agency or direct print buys,
- print complements digital and reaches different audiences.

Analyze this account for outreach planning:

- Business: ${businessName || "(unknown name)"}
- Category / vertical: ${category || "(not specified)"}
- Segment / region: ${segment || "(not specified)"}
- Location: ${location || "(not specified)"}
- Website: ${website || "(not known)"}
- CRM notes: ${notes || "(no notes)"}

Tasks:

1. "Inferred Vertical and Customers"
   - Describe what this business likely does and who its customers are, based on the information given.

2. "Likely Marketing Goals"
   - List 3–5 likely marketing priorities or goals for this business (e.g., filling seats, selling products, increasing bookings, driving leads, building awareness), tailored to the inferred vertical.

3. "How AdSell.ai Can Help"
   - List 3–5 specific ways AdSell.ai's print advertising capabilities can support those goals:
     - tie each point to their vertical and customer base,
     - mention examples of print channels (local papers, regional magazines, etc.) that would make sense for this kind of business.

4. "Objections and Responses"
   - Provide 3–5 likely objections (e.g., budget, "we only do digital", "print doesn't work", "no time") and concise, strong responses framed around AdSell.ai's strengths.

5. "Recommended Outreach Angle"
   - Suggest one or two outreach themes or angles an SDR should use when contacting this account (for example, emphasizing local reach, seasonal campaigns, event promotion, etc.), tailored to the inferred vertical.

If the business clearly appears to be ski/outdoor-related (e.g., ski resort, snow sports shop, mountain tourism), you may optionally mention that AdSell.ai currently has a special ski/outdoor-focused initiative or free-trial program. Otherwise, do not mention ski/outdoor promotions; keep the plan general and industry-appropriate.
`;

    this.showAIModal('<p class="text-muted">Generating...</p>');
    const result = await callAI(prompt, "research");
    this.showAIModal(result);
};

OutreachTracker.prototype.aiFollowupEmail = async function () {
    const notesEl = document.getElementById("activity-notes") ||
                    document.querySelector('#activity-form textarea[name="notes"]');
    const notes = notesEl ? notesEl.value : "";
    const c = this.currentContact || {};

    const prompt = `
Write a friendly but professional follow-up email for this sales scenario.

Contact:
Name: ${c.contactName || ""}
Business: ${c.vendorName || c.companyName || ""}
Stage: ${c.status || ""}

My rough notes / context:
${notes || "(no extra notes)"}

Keep it concise, clear, and tailored to ski / outdoor advertising with AdSell.ai.
`;
    if (notesEl) notesEl.value = "Generating follow-up email with AI...";
    const result = await callAI(prompt);
    if (notesEl) notesEl.value = result;
    this.showAIModal(result);
};

OutreachTracker.prototype.aiSummarizeCall = async function () {
    const notesEl = document.getElementById("activity-notes") ||
                    document.querySelector('#activity-form textarea[name="notes"]');
    const rawNotes = notesEl ? notesEl.value : "";
    if (!rawNotes) {
        alert("Paste or type call notes first.");
        return;
    }

    const prompt = `
Take these rough call notes and turn them into a clean sales call summary.

Notes:
${rawNotes}

Provide:
- A 3–5 sentence summary of the call.
- Bullet list of agreed next steps.
- A 0–100 qualification score with 1–2 lines on why.
- A recommended next outreach touch (channel + timing).
`;
    if (notesEl) notesEl.value = "Summarizing with AI...";
    const result = await callAI(prompt);
    if (notesEl) notesEl.value = result;
    this.showAIModal(result);
};

OutreachTracker.prototype.aiCleanCSV = async function () {
    const inputEl = document.getElementById("ai-csv-input");
    const outputEl = document.getElementById("ai-csv-output");
    if (!inputEl || !outputEl) return;

    const rawCsv = inputEl.value.trim();
    if (!rawCsv) {
        outputEl.value = "Paste CSV above first.";
        return;
    }

    const prompt = `
You are a data cleaner preparing CSVs for import into a CRM.

Clean and normalize this CSV:
- Fix capitalization (business names, cities, states).
- Normalize phone formats.
- Trim whitespace.
- Make sure header names are simple: name, email, phone, businessName, contactType, status, city, state, website where possible.
- Keep it valid CSV.

Return ONLY the cleaned CSV, no explanation.

Raw CSV:
${rawCsv}
`;
    outputEl.value = "Cleaning CSV with AI...";
    const result = await callAI(prompt);
    outputEl.value = result;
    this.showAIModal("```\n" + result + "\n```");
};
