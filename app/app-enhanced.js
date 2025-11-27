window.addEventListener('error', (e) => {
    console.error('[AdSell CRM][Global Error]', e.error || e.message || e);
});

console.log('[AdSell CRM] app-enhanced.js loaded at', new Date().toISOString());

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
            let resultText = "";

            if (Array.isArray(data?.output)) {
                for (const item of data.output) {
                    if (
                        item &&
                        item.type === "message" &&
                        item.content &&
                        item.content[0] &&
                        typeof item.content[0].text === "string"
                    ) {
                        resultText = item.content[0].text;
                        break;
                    }
                }
            }

            if (!resultText && typeof data.output_text === "string") {
                resultText = data.output_text;
            }

            if (!resultText) {
                resultText = text;
            }

            return resultText;
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
        console.log('[AdSell CRM] constructor');
        /**
         * Project objects are stored in this.projects and synced via KV.
         * Shape:
         * - id: string
         * - name: string
         * - status: optional, one of: Planning | Active | On Hold | Completed
         * - owner: optional string (rep / owner)
         * - startDate: optional string (YYYY-MM-DD)
         * - endDate: optional string (YYYY-MM-DD)
         * - description: optional string
         */
        this.contacts = [];
        this.activities = [];
        this.scripts = [];
        this.tags = [];
        this.customFields = [];
        this.tasks = [];
        this.projects = [];
        this.currentContact = null;
        this.editingContactId = null;
        this.editingScriptId = null;
        this.pendingImport = null;
        this.visibleColumns = {
            contact: true,
            email: true,
            phone: true,
            category: true,
            project: true,
            status: true,
            lastContact: true,
            actions: true
        };
        this.sortBy = null;
        this.sortDir = 'asc';
        this.selectedContactIds = new Set();
        this.advancedFilters = { statuses: [], categories: [], segments: [], tags: [] };
        this.savedFilters = [];
        
        this.init();
    }

    async init() {
        console.log('[AdSell CRM] init() starting');
        // Load data from API (with localStorage fallback)
        await this.loadData();
        this.loadColumnPreferences();
        this.loadAdvancedFilters();
        
        // Setup event listeners
        this.setupEventListeners();

        // Wire AI and RocketReach buttons if present at load
        document.getElementById("ai-outreach-script")?.addEventListener("click", () => this.aiOutreach());
        document.getElementById("ai-company-research")?.addEventListener("click", () => this.aiCompanyResearch());
        document.getElementById("ai-followup-email")?.addEventListener("click", () => this.aiFollowupEmail());
        document.getElementById("ai-summarize-call")?.addEventListener("click", () => this.aiSummarizeCall());
        document.getElementById("ai-clean-csv")?.addEventListener("click", () => this.aiCleanCSV());
        document.getElementById("rr-enrich-contact")?.addEventListener("click", () => this.enrichCurrentContactWithRocketReach());
        document.getElementById("rr-enrich-company")?.addEventListener("click", () => this.enrichCurrentCompanyWithRocketReach());
        const csvInput = document.getElementById("csv-file-input");
        if (csvInput) {
            csvInput.addEventListener("change", (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) {
                    this.handleCSVUpload(file);
                }
            });
        }
        
        // Render initial page
        this.showPage('dashboard');
        this.updateStats();
        this.renderRecentActivity();

        // Set default active tab in mobile tabbar
        const defaultTab = document.querySelector('.mobile-tabbar .tab-link[data-page="dashboard"]');
        if (defaultTab) {
            defaultTab.classList.add('active');
        }
        
        // Add default scripts if none exist
        if (this.scripts.length === 0) {
            this.addDefaultScripts();
        }

        // Initialize default tags if none exist
        if (this.tags.length === 0) {
            this.initializeDefaultTags();
        }

        // Calendar Day modal close wiring
        const calDayModal = document.getElementById('calendar-day-modal');
        const calDayClose = document.getElementById('calendar-day-close');
        if (calDayModal && calDayClose) {
            calDayClose.addEventListener('click', () => {
                calDayModal.classList.remove('active');
            });
            calDayModal.addEventListener('click', (e) => {
                if (e.target === calDayModal) {
                    calDayModal.classList.remove('active');
                }
            });
        }

        console.log('[AdSell CRM] init() finished');

        // Initial tasks-related renders
        if (typeof this.renderDashboardTasks === 'function') {
            this.renderDashboardTasks();
        }
    }

    setupEventListeners() {
        const navContainer = document.querySelector('.nav-container');
        const navToggle = document.querySelector('.nav-toggle');

        // Top navigation links (including brand header with data-page)
        const primaryNavButtons = document.querySelectorAll('.nav-link, .brand-link[data-page]');
        primaryNavButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const page = btn.dataset.page || e.target.dataset.page;
                if (page) {
                this.showPage(page);
                }

                // Close mobile dropdown if open
                if (navContainer && navContainer.classList.contains('nav-open')) {
                    navContainer.classList.remove('nav-open');
                }

                // Sync mobile tabbar active state
                const tabLinks = document.querySelectorAll('.mobile-tabbar .tab-link');
                tabLinks.forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.page === page);
                });
            });
        });

        // Mobile nav toggle (hamburger)
        if (navToggle && navContainer) {
            navToggle.addEventListener('click', () => {
                navContainer.classList.toggle('nav-open');
            });
        }

        // Bottom mobile tab bar
        const tabLinks = document.querySelectorAll('.mobile-tabbar .tab-link');
        tabLinks.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const page = btn.dataset.page;
                if (!page) return;

                this.showPage(page);

                // Update active state on tabbar
                tabLinks.forEach(b => b.classList.toggle('active', b === btn));

                // Also close the hamburger menu if it's open
                if (navContainer && navContainer.classList.contains('nav-open')) {
                    navContainer.classList.remove('nav-open');
                }
            });
        });

        // Dashboard stat cards → shortcuts
        const dashboardLinks = document.querySelectorAll('.stat-card.dashboard-link');
        dashboardLinks.forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                const targetPage = card.dataset.target || 'contacts';
                if (!targetPage) return;

                this.showPage(targetPage);

                // Close mobile nav if open
                if (navContainer && navContainer.classList.contains('nav-open')) {
                    navContainer.classList.remove('nav-open');
                }
            });
        });

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

        // Contacts table header sorting
        const contactsTable = document.querySelector('.contacts-table');
        if (contactsTable) {
            const headerCells = contactsTable.querySelectorAll('thead th[data-sort]');
            headerCells.forEach(th => {
                th.addEventListener('click', (e) => {
                    e.preventDefault();
                    const sortKey = th.getAttribute('data-sort');
                    if (!sortKey) return;
                    this.setSort(sortKey);
                });
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
        const bulkUpdateProjectBtn = document.getElementById('bulk-update-project');
        if (bulkUpdateProjectBtn) {
            bulkUpdateProjectBtn.addEventListener('click', () => this.bulkUpdateProject());
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

        // Contacts mobile toggles for filters and quick add
        const filtersToggleBtn = document.getElementById('contacts-mobile-filters-btn');
        const quickAddToggleBtn = document.getElementById('contacts-mobile-quickadd-btn');
        const filtersBar = document.querySelector('.filters-bar');
        const quickAddCard = document.getElementById('contacts-quick-add');

        if (filtersToggleBtn && filtersBar) {
            filtersToggleBtn.addEventListener('click', () => {
                if (window.innerWidth > 768) return;
                filtersBar.classList.toggle('mobile-open');
            });
        }

        if (quickAddToggleBtn && quickAddCard) {
            quickAddToggleBtn.addEventListener('click', () => {
                if (window.innerWidth > 768) return;
                quickAddCard.classList.toggle('mobile-open');
            });
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
        const contactForm = document.getElementById('contact-form');
        if (contactForm) {
            contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveContact(e.target);
        });
        }

        // Activity form
        const activityForm = document.getElementById('activity-form');
        if (activityForm) {
            activityForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveActivity(e.target);
        });
        }

        // Script form
        const scriptForm = document.getElementById('script-form');
        if (scriptForm) {
            scriptForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveScript(e.target);
        });
        }

        // Task form
        const taskForm = document.getElementById('task-form');
        if (taskForm) {
            taskForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveTask(e.target);
            });
        }

        const taskCancel = document.getElementById('task-cancel');
        const taskClose = document.getElementById('task-modal-close');
        if (taskCancel) {
            taskCancel.addEventListener('click', () => this.closeTaskModal());
        }
        if (taskClose) {
            taskClose.addEventListener('click', () => this.closeTaskModal());
        }

        // (AI modal buttons use init() aiFollowupEmail/aiSummarizeCall bindings)

        // Search and filters
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => this.filterContacts());
        }
        const statusFilter = document.getElementById('status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => this.filterContacts());
        }
        const categoryFilter = document.getElementById('category-filter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', () => this.filterContacts());
        }
        const segmentFilter = document.getElementById('segment-filter');
        if (segmentFilter) {
            segmentFilter.addEventListener('change', () => this.filterContacts());
        }

        const projectFilter = document.getElementById('project-filter');
        if (projectFilter) {
            projectFilter.addEventListener('change', () => this.filterContacts());
        }

        // Tasks page buttons
        const tasksAddBtn = document.getElementById('tasks-add-btn');
        if (tasksAddBtn) {
            tasksAddBtn.addEventListener('click', () => this.openTaskModal());
        }

        const tasksAiBtn = document.getElementById('tasks-ai-suggest');
        if (tasksAiBtn) {
            tasksAiBtn.addEventListener('click', () => {
                this.showAIModal('AI task recommendations coming soon.');
            });
        }

        // CSV upload
        const csvInput = document.getElementById('csv-file-input');
        if (csvInput) {
            csvInput.addEventListener('change', (e) => {
            this.handleCSVUpload(e.target.files[0]);
        });
        }

        // Contacts quick add form
        const quickAddForm = document.getElementById('contacts-quick-add-form');
        if (quickAddForm) {
            quickAddForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(quickAddForm);
                const vendorName = (formData.get('vendorName') || '').trim();
                if (!vendorName) {
                    alert('Please enter a company / organization name.');
                    return;
                }
                const contactData = {
                    vendorName,
                    contactName: (formData.get('contactName') || '').trim(),
                    email: (formData.get('email') || '').trim(),
                    phone: (formData.get('phone') || '').trim(),
                    project: (formData.get('project') || '').trim(),
                    category: (formData.get('category') || '').trim()
                };
                this.quickAddContact(contactData);
                quickAddForm.reset();
            });
        }

        // Projects: add/edit modal wiring
        const addProjectBtn = document.getElementById('add-project-btn');
        if (addProjectBtn) {
            addProjectBtn.addEventListener('click', () => this.showProjectModal(null));
        }
        const projectModalClose = document.getElementById('project-modal-close');
        if (projectModalClose) {
            projectModalClose.addEventListener('click', () => this.closeProjectModal());
        }
        const projectCancelBtn = document.getElementById('project-cancel-btn');
        if (projectCancelBtn) {
            projectCancelBtn.addEventListener('click', () => this.closeProjectModal());
        }
        const projectForm = document.getElementById('project-form');
        if (projectForm) {
            projectForm.addEventListener('submit', (e) => this.handleProjectFormSubmit(e));
        }

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
    async loadData() {
        let apiData = null;

        try {
            const res = await fetch("https://adsell-openai-proxy.jgregorywalsh.workers.dev/contacts", {
                method: "GET"
            });
            if (res.ok) {
                apiData = await res.json();
            } else {
                console.error("loadData: failed to load from KV API, status:", res.status);
            }
        } catch (err) {
            console.error("Failed to load from KV API:", err);
        }

        const localContacts = JSON.parse(localStorage.getItem('adsell_contacts') || '[]');
        const localActivities = JSON.parse(localStorage.getItem('adsell_activities') || '[]');
        const localScripts = JSON.parse(localStorage.getItem('adsell_scripts') || '[]');
        const localTags = JSON.parse(localStorage.getItem('adsell_tags') || '[]');
        const localCustomFields = JSON.parse(localStorage.getItem('adsell_custom_fields') || '[]');
        const localTasks = JSON.parse(localStorage.getItem('adsell_tasks') || '[]');
        const localProjects = JSON.parse(localStorage.getItem('adsell_projects') || '[]');

        const localHasData =
            localContacts.length ||
            localActivities.length ||
            localScripts.length ||
            localTags.length ||
            localCustomFields.length ||
            localTasks.length ||
            localProjects.length;

        let useApi = false;
        if (apiData && (
            (Array.isArray(apiData.contacts) && apiData.contacts.length) ||
            (Array.isArray(apiData.activities) && apiData.activities.length) ||
            (Array.isArray(apiData.scripts) && apiData.scripts.length) ||
            (Array.isArray(apiData.tags) && apiData.tags.length) ||
            (Array.isArray(apiData.customFields) && apiData.customFields.length) ||
            (Array.isArray(apiData.tasks) && apiData.tasks.length) ||
            (Array.isArray(apiData.projects) && apiData.projects.length)
        )) {
            useApi = true;
        }

        if (useApi) {
            this.contacts = Array.isArray(apiData.contacts) ? apiData.contacts : [];
            this.activities = Array.isArray(apiData.activities) ? apiData.activities : [];
            this.scripts = Array.isArray(apiData.scripts) ? apiData.scripts : [];
            this.tags = Array.isArray(apiData.tags) ? apiData.tags : [];
            this.customFields = Array.isArray(apiData.customFields) ? apiData.customFields : [];
            this.tasks = Array.isArray(apiData.tasks) ? apiData.tasks : [];
            this.projects = Array.isArray(apiData.projects) ? apiData.projects : [];

            // cache back to localStorage
        localStorage.setItem('adsell_contacts', JSON.stringify(this.contacts));
        localStorage.setItem('adsell_activities', JSON.stringify(this.activities));
        localStorage.setItem('adsell_scripts', JSON.stringify(this.scripts));
        localStorage.setItem('adsell_tags', JSON.stringify(this.tags));
        localStorage.setItem('adsell_custom_fields', JSON.stringify(this.customFields));
            localStorage.setItem('adsell_tasks', JSON.stringify(this.tasks));
            localStorage.setItem('adsell_projects', JSON.stringify(this.projects));
        } else if (localHasData) {
            // prefer localStorage data if API is empty
            this.contacts = localContacts;
            this.activities = localActivities;
            this.scripts = localScripts;
            this.tags = localTags;
            this.customFields = localCustomFields;
            this.tasks = localTasks;
            this.projects = localProjects;
        } else {
            // nothing anywhere
            this.contacts = [];
            this.activities = [];
            this.scripts = [];
            this.tags = [];
            this.customFields = [];
            this.tasks = [];
            this.projects = [];
        }
        // Normalize projects collection to always be an array of Project objects
        if (!Array.isArray(this.projects)) {
            this.projects = [];
        }
        const normalizedProjects = [];
        const seenNames = new Set();
        (this.projects || []).forEach(p => {
            let projectObj = null;
            if (typeof p === 'string') {
                const name = p.trim();
                if (!name) return;
                projectObj = {
                    id: this.generateId(),
                    name,
                    status: 'Active',
                    owner: '',
                    startDate: '',
                    endDate: '',
                    description: ''
                };
            } else if (p && typeof p === 'object') {
                const name = (p.name || '').trim();
                if (!name) return;
                projectObj = {
                    id: p.id || this.generateId(),
                    name,
                    status: p.status || '',
                    owner: p.owner || '',
                    startDate: p.startDate || '',
                    endDate: p.endDate || '',
                    description: p.description || ''
                };
            }
            if (!projectObj) return;
            const key = projectObj.name.toLowerCase();
            if (seenNames.has(key)) return;
            seenNames.add(key);
            normalizedProjects.push(projectObj);
        });
        this.projects = normalizedProjects;

        // Ensure projects list includes any project strings on contacts and tasks
        (this.contacts || []).forEach(c => {
            if (c && c.project) {
                this.ensureProjectExists(c.project);
            }
        });
        (this.tasks || []).forEach(t => {
            if (t && t.project) {
                this.ensureProjectExists(t.project);
            }
        });
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

    async saveData() {
        // keep local cache
        localStorage.setItem('adsell_contacts', JSON.stringify(this.contacts));
        localStorage.setItem('adsell_activities', JSON.stringify(this.activities));
        localStorage.setItem('adsell_scripts', JSON.stringify(this.scripts));
        localStorage.setItem('adsell_tags', JSON.stringify(this.tags));
        localStorage.setItem('adsell_custom_fields', JSON.stringify(this.customFields));
        localStorage.setItem('adsell_tasks', JSON.stringify(this.tasks));
        localStorage.setItem('adsell_projects', JSON.stringify(this.projects));

        const hasAnyData =
            (this.contacts && this.contacts.length > 0) ||
            (this.activities && this.activities.length > 0) ||
            (this.scripts && this.scripts.length > 0) ||
            (this.tags && this.tags.length > 0) ||
            (this.customFields && this.customFields.length > 0) ||
            (this.tasks && this.tasks.length > 0) ||
            (this.projects && this.projects.length > 0);

        // push to shared API only when there is meaningful data
        if (!hasAnyData) {
            console.warn("saveData: no data to sync to KV; skipping /contacts/import.");
            return;
        }

        try {
            await fetch("https://adsell-openai-proxy.jgregorywalsh.workers.dev/contacts/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contacts: this.contacts,
                    activities: this.activities,
                    scripts: this.scripts,
                    tags: this.tags,
                    customFields: this.customFields,
                    tasks: this.tasks,
                    projects: this.projects
                })
            });
        } catch (err) {
            console.error("saveData: failed to sync to shared contacts API:", err);
        }
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
        console.log('[AdSell CRM] showPage()', pageName);

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
        const pageEl = document.getElementById(`${pageName}-page`);
        if (pageEl) {
            pageEl.classList.add('active');
        } else {
            console.warn('[AdSell CRM] showPage: missing page element for', pageName);
        }

        // Render page content
        switch (pageName) {
            case 'dashboard':
                this.updateStats();
                this.renderRecentActivity();
                if (typeof this.renderDashboardTasks === 'function') {
                    this.renderDashboardTasks();
                }
                break;
            case 'contacts':
                this.renderContacts();
                this.applyColumnVisibility();
                this.syncColumnChooser();
                this.renderBulkTagOptions();
                this.updateBulkUI();
                this.renderAdvancedFiltersPanel();
                if (typeof this.renderProjectFilterOptions === 'function') {
                    this.renderProjectFilterOptions();
                }
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
            case 'tasks':
                this.renderTasksPage();
                break;
            case 'projects':
                this.renderProjectsPage();
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
        console.log('[AdSell CRM] updateStats()', { total, notStarted, inProgress, responded, signedUp });

        const elTotal = document.getElementById('stat-total');
        const elNot = document.getElementById('stat-not-started');
        const elProg = document.getElementById('stat-in-progress');
        const elResp = document.getElementById('stat-responded');
        const elSign = document.getElementById('stat-signed-up');

        if (!elTotal || !elNot || !elProg || !elResp || !elSign) {
            console.warn('[AdSell CRM] updateStats: one or more stat elements missing');
        }

        if (elTotal) elTotal.textContent = total;
        if (elNot) elNot.textContent = notStarted;
        if (elProg) elProg.textContent = inProgress;
        if (elResp) elResp.textContent = responded;
        if (elSign) elSign.textContent = signedUp;
    }

    renderDashboardTasks() {
        const container = document.getElementById('dashboard-tasks-widget');
        if (!container) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayKey = today.toISOString().slice(0, 10);

        const tasks = (this.tasks || []).filter(t => t.status === 'open' && t.dueDate);

        const todayTasks = tasks.filter(t => t.dueDate === todayKey);
        const overdueTasks = tasks.filter(t => t.dueDate < todayKey);

        const topTasks = [...todayTasks, ...overdueTasks].slice(0, 5);

        if (topTasks.length === 0) {
            container.innerHTML = '<p class="empty-state">No open tasks for today.</p>';
            return;
        }

        const html = `
            <div class="card">
                <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="font-size:0.95rem;font-weight:600;">Today&apos;s &amp; Overdue Tasks</h3>
                    <button class="btn btn-secondary btn-sm" type="button" onclick="app.showPage('tasks')">View All</button>
                </div>
                <div class="card-body">
                    ${topTasks.map(task => {
                        const isOverdue = task.dueDate < todayKey;
                        const contact = this.contacts.find(c => c.id === task.contactId);
                        const contactName = contact ? (contact.vendorName || contact.companyName || contact.contactName) : '';
                        const dueLabel = isOverdue ? 'Overdue' : 'Today';
                        return `
                            <div class="dashboard-task-item ${isOverdue ? 'task-overdue' : ''}">
                                <div>
                                    <div>${task.title}</div>
                                    ${contactName ? `<div style="font-size:0.75rem;color:var(--text-secondary);">${contactName}</div>` : ''}
                                </div>
                                <div style="font-size:0.75rem;color:var(--text-secondary);">${dueLabel}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    getProjectNames() {
        const names = (this.projects || [])
            .map(p => (p.name || '').trim())
            .filter(Boolean);
        return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
    }

    ensureProjectExists(projectName) {
        const name = (projectName || '').trim();
        if (!name) return null;
        if (!Array.isArray(this.projects)) {
            this.projects = [];
        }
        const existing = this.getProjectByName(name);
        if (existing) {
            return existing;
        }
        const project = {
            id: this.generateId(),
            name,
            status: 'Active',
            owner: '',
            startDate: '',
            endDate: '',
            description: ''
        };
        this.projects.push(project);
        return project;
    }

    getProjectById(id) {
        if (!id) return null;
        return (this.projects || []).find(p => p.id === id) || null;
    }

    getProjectByName(name) {
        const target = (name || '').trim().toLowerCase();
        if (!target) return null;
        return (this.projects || []).find(
            p => (p.name || '').trim().toLowerCase() === target
        ) || null;
    }

    upsertProject(projectObj) {
        if (!projectObj) return null;
        const name = (projectObj.name || '').trim();
        if (!name) return null;

        if (!Array.isArray(this.projects)) {
            this.projects = [];
        }

        const id = projectObj.id || this.generateId();
        const existingIndex = this.projects.findIndex(p => p.id === id);
        const base = existingIndex !== -1 ? this.projects[existingIndex] : {};

        const next = {
            id,
            name,
            status: projectObj.status || base.status || '',
            owner: projectObj.owner || base.owner || '',
            startDate: projectObj.startDate || base.startDate || '',
            endDate: projectObj.endDate || base.endDate || '',
            description: projectObj.description || base.description || ''
        };

        if (existingIndex !== -1) {
            this.projects[existingIndex] = next;
        } else {
            this.projects.push(next);
        }

        return next;
    }

    deleteProject(projectId) {
        if (!projectId) return;
        if (!Array.isArray(this.projects)) {
            this.projects = [];
            return;
        }
        this.projects = this.projects.filter(p => p.id !== projectId);
    }

    renderProjectFilterOptions() {
        const select = document.getElementById('project-filter');
        if (!select) return;

        const projects = this.getProjectNames();

        const options = ['<option value="">All Projects</option>']
            .concat(projects.map(p => `<option value="${p}">${p}</option>`));

        const currentValue = select.value;
        select.innerHTML = options.join('');
        if (currentValue && projects.includes(currentValue)) {
            select.value = currentValue;
        }
    }

    renderProjectsPage() {
        const container = document.getElementById('projects-list');
        if (!container) return;

        const projects = Array.isArray(this.projects) ? this.projects.slice() : [];

        if (!projects.length) {
            container.innerHTML = '<p class="empty-state">No projects yet. Assign a project name on contacts to get started.</p>';
            return;
        }

        const projectsData = projects.map(project => {
            const name = (project.name || '').trim();
            const contactsForProject = (this.contacts || []).filter(
                c => (c.project || '').trim().toLowerCase() === name.toLowerCase()
            );
            const tasksForProject = (this.tasks || []).filter(
                t => (t.project || '').trim().toLowerCase() === name.toLowerCase()
            );
            return {
                project,
                contactsCount: contactsForProject.length,
                tasksCount: tasksForProject.length
            };
        });

        container.innerHTML = projectsData.map(p => {
            const proj = p.project;
            const name = (proj.name || '').trim();
            const status = (proj.status || '').trim();
            const owner = (proj.owner || '').trim();
            const startDate = (proj.startDate || '').trim();
            const endDate = (proj.endDate || '').trim();
            const hasDates = startDate || endDate;
            const dateRange = hasDates
                ? `${startDate || '—'} \u2192 ${endDate || '—'}`
                : '';

            return `
            <div class="project-card" data-project-id="${proj.id || ''}">
                <div class="project-card-header">
                    <h3>${name || 'Untitled Project'}</h3>
                </div>
                <div class="project-card-body">
                    <div class="project-card-meta">
                        ${status ? `<span class="status-badge project-status-badge">${status}</span>` : ''}
                        ${owner ? `<span class="project-meta-text">Owner: ${owner}</span>` : ''}
                        ${dateRange ? `<span class="project-meta-text">${dateRange}</span>` : ''}
                    </div>
                    <div class="project-card-summary">
                        ${p.contactsCount} contacts &middot; ${p.tasksCount} tasks
                    </div>
                    ${proj.description ? `<div class="project-card-description">${proj.description}</div>` : ''}
                    <div class="project-card-actions">
                        <button type="button" class="btn btn-secondary project-edit-btn">Edit</button>
                        <button type="button" class="btn btn-danger project-delete-btn">Delete</button>
                    </div>
                </div>
            </div>
            `;
        }).join('');

        // Wire card interactions
        container.querySelectorAll('.project-card').forEach(card => {
            const projectId = card.getAttribute('data-project-id');
            if (!projectId) return;

            // Card body click → filter contacts by project
            card.addEventListener('click', (e) => {
                const target = e.target;
                if (target.closest('.project-card-actions')) {
                    return;
                }
                const project = this.getProjectById(projectId);
                if (!project) return;
                const name = project.name;
                this.showPage('contacts');
                const projectFilter = document.getElementById('project-filter');
                if (projectFilter) {
                    projectFilter.value = name;
                    this.filterContacts();
                }
            });

            const editBtn = card.querySelector('.project-edit-btn');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showProjectModal(projectId);
                });
            }

            const deleteBtn = card.querySelector('.project-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const ok = window.confirm('Delete this project? This will not modify existing contacts or tasks.');
                    if (!ok) return;
                    this.deleteProject(projectId);
                    await this.saveData();
                    this.renderProjectsPage();
                    if (typeof this.renderProjectFilterOptions === 'function') {
                        this.renderProjectFilterOptions();
                    }
                });
            }
        });
    }

    showProjectModal(projectId) {
        const modal = document.getElementById('project-modal');
        const titleEl = document.getElementById('project-modal-title');
        const form = document.getElementById('project-form');
        if (!modal || !titleEl || !form) return;

        const idInput = form.querySelector('input[name="projectId"]');
        const nameInput = form.querySelector('input[name="name"]');
        const statusSelect = form.querySelector('select[name="status"]');
        const ownerInput = form.querySelector('input[name="owner"]');
        const startDateInput = form.querySelector('input[name="startDate"]');
        const endDateInput = form.querySelector('input[name="endDate"]');
        const descInput = form.querySelector('textarea[name="description"]');

        if (!projectId) {
            titleEl.textContent = 'Add Project';
            if (idInput) idInput.value = '';
            if (nameInput) nameInput.value = '';
            if (statusSelect) statusSelect.value = '';
            if (ownerInput) ownerInput.value = '';
            if (startDateInput) startDateInput.value = '';
            if (endDateInput) endDateInput.value = '';
            if (descInput) descInput.value = '';
        } else {
            const project = this.getProjectById(projectId);
            if (!project) return;
            titleEl.textContent = 'Edit Project';
            if (idInput) idInput.value = project.id || '';
            if (nameInput) nameInput.value = project.name || '';
            if (statusSelect) statusSelect.value = project.status || '';
            if (ownerInput) ownerInput.value = project.owner || '';
            if (startDateInput) startDateInput.value = project.startDate || '';
            if (endDateInput) endDateInput.value = project.endDate || '';
            if (descInput) descInput.value = project.description || '';
        }

        modal.classList.add('active');
    }

    closeProjectModal() {
        const modal = document.getElementById('project-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    async handleProjectFormSubmit(event) {
        event.preventDefault();
        const form = event.target;
        if (!form) return;

        const formData = new FormData(form);
        const id = (formData.get('projectId') || '').toString().trim();
        const name = (formData.get('name') || '').toString().trim();
        const status = (formData.get('status') || '').toString().trim();
        const owner = (formData.get('owner') || '').toString().trim();
        const startDate = (formData.get('startDate') || '').toString().trim();
        const endDate = (formData.get('endDate') || '').toString().trim();
        const description = (formData.get('description') || '').toString().trim();

        if (!name) {
            alert('Project name is required.');
            return;
        }

        const projectData = {
            id: id || undefined,
            name,
            status,
            owner,
            startDate,
            endDate,
            description
        };

        this.upsertProject(projectData);
        await this.saveData();
        this.renderProjectsPage();
        if (typeof this.renderProjectFilterOptions === 'function') {
            this.renderProjectFilterOptions();
        }
        this.closeProjectModal();
    }

    // ===== Tasks Page Rendering & Modal =====

    renderTasksPage() {
        const todayEl = document.getElementById('tasks-today');
        const overdueEl = document.getElementById('tasks-overdue');
        const upcomingEl = document.getElementById('tasks-upcoming');
        const completedEl = document.getElementById('tasks-completed');
        if (!todayEl || !overdueEl || !upcomingEl || !completedEl) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayKey = today.toISOString().slice(0, 10);

        const tasks = (this.tasks || []).slice();

        const openTasks = tasks.filter(t => t.status === 'open');
        const completedTasks = tasks.filter(t => t.status === 'completed');

        const overdueTasks = openTasks.filter(t => t.dueDate && t.dueDate < todayKey);
        const todayTasks = openTasks.filter(t => t.dueDate === todayKey);
        const upcomingTasks = openTasks.filter(t => t.dueDate && t.dueDate > todayKey);

        const renderList = (list, el) => {
            if (!list.length) {
                el.innerHTML = '<p class="empty-state">None</p>';
                return;
            }
            el.innerHTML = list.map(t => {
                const contact = t.contactId ? this.contacts.find(c => c.id === t.contactId) : null;
                const contactName = contact ? (contact.vendorName || contact.companyName || contact.contactName) : '';
                const priorityClass = `task-priority-${(t.priority || 'Medium').toLowerCase()}`;
                const isOverdue = t.dueDate && t.dueDate < todayKey;
                const extraClasses = [
                    'task-row',
                    priorityClass,
                    t.status === 'completed' ? 'task-completed' : '',
                    isOverdue ? 'task-overdue' : ''
                ].filter(Boolean).join(' ');
                const dueLabel = t.dueDate ? this.formatDate(t.dueDate) : 'No due date';
                return `
                    <div class="${extraClasses}" data-task-id="${t.id}">
                        <div class="task-main">
                            <div class="task-title">${t.title}</div>
                            <div class="task-meta">
                                ${contactName ? contactName + ' • ' : ''}${t.priority || 'Medium'} • ${dueLabel}
                            </div>
                        </div>
                        <div class="task-controls">
                            <button type="button" class="btn btn-secondary btn-sm task-complete-btn">${t.status === 'completed' ? 'Reopen' : 'Complete'}</button>
                            <button type="button" class="btn btn-secondary btn-sm task-edit-btn">Edit</button>
                            <button type="button" class="btn btn-danger btn-sm task-delete-btn">Delete</button>
                        </div>
                    </div>
                `;
            }).join('');
        };

        renderList(todayTasks, todayEl);
        renderList(overdueTasks, overdueEl);
        renderList(upcomingTasks, upcomingEl);
        renderList(completedTasks, completedEl);

        // Wire task buttons
        const container = document.getElementById('tasks-page');
        if (!container) return;
        container.querySelectorAll('.task-row').forEach(row => {
            const taskId = row.getAttribute('data-task-id');
            if (!taskId) return;

            const completeBtn = row.querySelector('.task-complete-btn');
            const editBtn = row.querySelector('.task-edit-btn');
            const deleteBtn = row.querySelector('.task-delete-btn');

            if (completeBtn) {
                completeBtn.addEventListener('click', async () => {
                    const task = this.tasks.find(t => t.id === taskId);
                    if (!task) return;
                    const newStatus = task.status === 'completed' ? 'open' : 'completed';
                    await this.updateTask(taskId, { status: newStatus });
                });
            }

            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    this.openTaskModal(taskId);
                });
            }

            if (deleteBtn) {
                deleteBtn.addEventListener('click', async () => {
                    const confirmed = window.confirm('Delete this task? This cannot be undone.');
                    if (!confirmed) return;
                    await this.deleteTask(taskId);
                });
            }
        });
    }

    openTaskModal(taskId) {
        const modal = document.getElementById('task-modal');
        const titleEl = document.getElementById('task-modal-title');
        const form = document.getElementById('task-form');
        const contactSelect = document.getElementById('task-contact');
        if (!modal || !titleEl || !form || !contactSelect) return;

        this.editingTaskId = taskId || null;

        // Populate contact options
        contactSelect.innerHTML = '<option value="">(No contact)</option>' + this.contacts.map(c => {
            const label = c.vendorName || c.companyName || c.contactName || '(No name)';
            return `<option value="${c.id}">${label}</option>`;
        }).join('');

        if (this.editingTaskId) {
            const task = this.tasks.find(t => t.id === this.editingTaskId);
            if (!task) return;
            titleEl.textContent = 'Edit Task';
            form.title.value = task.title || '';
            form.contactId.value = task.contactId || '';
            form.dueDate.value = task.dueDate || '';
            form.priority.value = task.priority || 'Medium';
            form.notes.value = task.notes || '';
        } else {
            titleEl.textContent = 'Add Task';
            form.reset();
            form.priority.value = 'Medium';
            form.contactId.value = this.currentContact ? this.currentContact.id : '';
        }

        modal.classList.add('active');
    }

    openTaskForContact(contactId) {
        const contact = this.contacts.find(c => c.id === contactId);
        if (!contact) return;
        this.currentContact = contact;
        this.openTaskModal(null);
    }

    closeTaskModal() {
        const modal = document.getElementById('task-modal');
        if (modal) modal.classList.remove('active');
        this.editingTaskId = null;
    }

    async saveTask(form) {
        const formData = new FormData(form);
        const taskData = {
            title: formData.get('title') || '',
            contactId: formData.get('contactId') || null,
            dueDate: formData.get('dueDate') || null,
            priority: formData.get('priority') || 'Medium',
            notes: formData.get('notes') || ''
        };

        if (this.editingTaskId) {
            await this.updateTask(this.editingTaskId, taskData);
        } else {
            await this.addTask(taskData);
        }

        this.closeTaskModal();
        this.showNotification('Task saved successfully!');
    }

    async openCalendarDayModal(dateKey) {
        const modal = document.getElementById('calendar-day-modal');
        const title = document.getElementById('calendar-day-title');
        const followupList = document.getElementById('calendar-day-list');
        const taskList = document.getElementById('calendar-day-task-list');
        const contactSelect = document.getElementById('calendar-day-contact-select');
        const addFollowupBtn = document.getElementById('calendar-day-add-followup');
        const taskTitleInput = document.getElementById('calendar-day-task-title');
        const addTaskBtn = document.getElementById('calendar-day-add-task');

        if (!modal || !title || !followupList || !taskList || !contactSelect || !addFollowupBtn || !taskTitleInput || !addTaskBtn) return;

        this._selectedCalendarDate = dateKey;
        title.textContent = `Follow-ups and Tasks for ${this.formatDate(dateKey)}`;

        const contactsForDay = this.contacts.filter(
            c => c.followUpDate && c.followUpDate.startsWith(dateKey)
        );

        const tasksForDay = (this.tasks || []).filter(
            t => t.dueDate && t.dueDate.startsWith(dateKey) && t.status !== 'completed'
        );

        // Render follow-ups
        if (!contactsForDay.length) {
            followupList.innerHTML = '<p class="text-muted">No follow-ups on this day yet.</p>';
        } else {
            followupList.innerHTML = contactsForDay.map(c => `
                <div class="calendar-day-row" data-id="${c.id}">
                    <div class="calendar-day-main">
                        <div class="calendar-day-name">${c.vendorName || c.companyName || c.contactName || '(No name)'}</div>
                        <div class="calendar-day-meta">
                            ${(c.status || 'Status not set')}${c.category ? ' • ' + c.category : ''}
                        </div>
                    </div>
                    <div class="calendar-day-controls">
                        <button type="button" class="btn btn-secondary btn-sm calendar-day-view">View</button>
                        <button type="button" class="btn btn-secondary btn-sm calendar-day-change">Change Date</button>
                        <button type="button" class="btn btn-danger btn-sm calendar-day-clear">Clear</button>
                    </div>
                </div>
            `).join('');
        }

        // Render tasks
        if (!tasksForDay.length) {
            taskList.innerHTML = '<p class="text-muted">No tasks on this day yet.</p>';
        } else {
            taskList.innerHTML = tasksForDay.map(t => {
                const contact = t.contactId ? this.contacts.find(c => c.id === t.contactId) : null;
                const contactName = contact ? (contact.vendorName || contact.companyName || contact.contactName) : '(No linked contact)';
                return `
                    <div class="calendar-day-row" data-task-id="${t.id}">
                        <div class="calendar-day-main">
                            <div class="calendar-day-name">${t.title}</div>
                            <div class="calendar-day-meta">${contactName}</div>
                        </div>
                        <div class="calendar-day-controls">
                            <button type="button" class="btn btn-secondary btn-sm calendar-day-task-complete">${t.status === 'completed' ? 'Reopen' : 'Complete'}</button>
                            <button type="button" class="btn btn-secondary btn-sm calendar-day-task-edit">Edit</button>
                            <button type="button" class="btn btn-danger btn-sm calendar-day-task-delete">Delete</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Wire follow-up row buttons
        followupList.querySelectorAll('.calendar-day-row[data-id]').forEach(row => {
            const id = row.getAttribute('data-id');
            if (!id) return;

            const viewBtn = row.querySelector('.calendar-day-view');
            const changeBtn = row.querySelector('.calendar-day-change');
            const clearBtn = row.querySelector('.calendar-day-clear');

            if (viewBtn) {
                viewBtn.addEventListener('click', () => {
                    this.viewContact(id);
                });
            }

            if (changeBtn) {
                changeBtn.addEventListener('click', async () => {
                    const newDate = window.prompt('New follow-up date (YYYY-MM-DD):', dateKey);
                    if (!newDate) return;
                    const contact = this.contacts.find(c => c.id === id);
                    if (contact) {
                        contact.followUpDate = newDate;
                        await this.saveData();
                        this.renderCalendar();
                        this.openCalendarDayModal(newDate);
                    }
                });
            }

            if (clearBtn) {
                clearBtn.addEventListener('click', async () => {
                    const contact = this.contacts.find(c => c.id === id);
                    if (contact) {
                        contact.followUpDate = null;
                        await this.saveData();
                        this.renderCalendar();
                        this.openCalendarDayModal(dateKey);
                    }
                });
            }
        });

        // Wire task row buttons
        taskList.querySelectorAll('.calendar-day-row[data-task-id]').forEach(row => {
            const taskId = row.getAttribute('data-task-id');
            if (!taskId) return;

            const completeBtn = row.querySelector('.calendar-day-task-complete');
            const editBtn = row.querySelector('.calendar-day-task-edit');
            const deleteBtn = row.querySelector('.calendar-day-task-delete');

            if (completeBtn) {
                completeBtn.addEventListener('click', async () => {
                    const task = this.tasks.find(t => t.id === taskId);
                    if (!task) return;
                    const newStatus = task.status === 'completed' ? 'open' : 'completed';
                    await this.updateTask(taskId, { status: newStatus });
                    this.openCalendarDayModal(dateKey);
                });
            }

            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    const task = this.tasks.find(t => t.id === taskId);
                    if (!task) return;
                    this.openTaskModal(taskId);
                });
            }

            if (deleteBtn) {
                deleteBtn.addEventListener('click', async () => {
                    const confirmed = window.confirm('Delete this task? This cannot be undone.');
                    if (!confirmed) return;
                    await this.deleteTask(taskId);
                    this.openCalendarDayModal(dateKey);
                });
            }
        });

        // Build select options for adding follow-up / tasks
        const options = this.contacts.map(c => {
            const label = c.vendorName || c.companyName || c.contactName || '(No name)';
            return `<option value="${c.id}">${label}</option>`;
        }).join('');
        contactSelect.innerHTML = `<option value="">Select contact…</option>` + options;

        addFollowupBtn.onclick = async () => {
            const id = contactSelect.value;
            if (!id) return;
            const contact = this.contacts.find(c => c.id === id);
            if (contact) {
                contact.followUpDate = dateKey;
                await this.saveData();
                this.renderCalendar();
                this.openCalendarDayModal(dateKey);
            }
        };

        addTaskBtn.onclick = async () => {
            const titleVal = taskTitleInput.value.trim();
            if (!titleVal) return;
            const taskData = {
                title: titleVal,
                contactId: contactSelect.value || null,
                dueDate: dateKey,
                priority: 'Medium',
                notes: ''
            };
            await this.addTask(taskData);
            taskTitleInput.value = '';
            this.renderCalendar();
            this.openCalendarDayModal(dateKey);
        };

        modal.classList.add('active');
    }

    // Calendar
    renderCalendar() {
        if (!this._calendarDate) this._calendarDate = new Date();
        const grid = document.getElementById('calendar-grid');
        const listEl = document.getElementById('calendar-followup-list');
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

        // Map follow-ups for this month
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

        // Map tasks for this month
        const tasksByDay = {};
        (this.tasks || []).forEach(t => {
            if (!t.dueDate || t.status !== 'open') return;
            const td = new Date(t.dueDate);
            if (td.getMonth() === month && td.getFullYear() === year) {
                const key = byDateKey(td);
                (tasksByDay[key] = tasksByDay[key] || []).push(t);
            }
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const cellsHtml = cells.map(cellDate => {
            if (!cellDate) {
                return `<div class="calendar-cell"><div class="calendar-cell-header">&nbsp;</div><div class="calendar-cell-body"></div></div>`;
            }
            const key = byDateKey(cellDate);
            const items = itemsByDay[key] || [];
            const tasksForDay = tasksByDay[key] || [];
            const isToday =
                cellDate.getFullYear() === today.getFullYear() &&
                cellDate.getMonth() === today.getMonth() &&
                cellDate.getDate() === today.getDate();

            const classes = ['calendar-cell'];
            if (isToday) classes.push('today');
            if (items.length > 0 || tasksForDay.length > 0) classes.push('has-items');

            const maxItems = 3;
            const visibleItems = items.slice(0, maxItems);
            const remaining = items.length - visibleItems.length;

            const itemsHtml = visibleItems.map(c => `
                <div class="calendar-item" data-id="${c.id}">
                    ${c.vendorName}
                </div>
            `).join('') + (remaining > 0 ? `
                <div class="calendar-item">
                    +${remaining} more…
                </div>
            ` : '') + (tasksForDay.length ? `
                <div class="calendar-task-item">
                    ${tasksForDay.length} task${tasksForDay.length > 1 ? 's' : ''}
                </div>
            ` : '');

            return `
                <div class="${classes.join(' ')}" data-date="${key}">
                    <div class="calendar-cell-header">
                        <span>${cellDate.getDate()}</span>
                        ${items.length > 0 ? `<span class="calendar-count-badge">${items.length}</span>` : ''}
                    </div>
                    <div class="calendar-cell-body">
                        ${itemsHtml}
                    </div>
                </div>
            `;
        }).join('');

        grid.innerHTML = headerHtml + cellsHtml;

        // Cell-level click → open day modal
        const dayCells = grid.querySelectorAll('.calendar-cell[data-date]');
        dayCells.forEach(cell => {
            cell.addEventListener('click', () => {
                const dateKey = cell.getAttribute('data-date');
                if (dateKey) {
                    this.openCalendarDayModal(dateKey);
                }
            });
        });

        // Individual item click → view contact (preserve existing behavior)
        grid.querySelectorAll('.calendar-item[data-id]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = el.getAttribute('data-id');
                this.viewContact(id);
            });
        });

        // Build upcoming follow-ups list (next 30 days)
        if (listEl) {
            const upcoming = [];
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const horizon = new Date(now);
            horizon.setDate(horizon.getDate() + 30);

            this.contacts.forEach(c => {
                if (!c.followUpDate) return;
                const fd = new Date(c.followUpDate);
                fd.setHours(0, 0, 0, 0);
                if (fd >= now && fd <= horizon) {
                    upcoming.push({
                        date: fd,
                        contact: c
                    });
                }
            });

            upcoming.sort((a, b) => a.date - b.date);

            if (upcoming.length === 0) {
                listEl.innerHTML = '<p class="empty-state">No upcoming follow-ups</p>';
            } else {
                listEl.innerHTML = upcoming.map(entry => {
                    const c = entry.contact;
                    const metaParts = [];
                    if (c.status) metaParts.push(c.status);
                    if (c.category) metaParts.push(c.category);
                    const locationParts = [];
                    if (c.city) locationParts.push(c.city);
                    if (c.state) locationParts.push(c.state);
                    if (locationParts.length) metaParts.push(locationParts.join(', '));

                    const meta = metaParts.join(' • ');

                    return `
                        <div class="calendar-followup-row" data-id="${c.id}">
                            <div class="calendar-followup-main">
                                <div class="calendar-followup-name">${c.vendorName || '(No vendor name)'}</div>
                                <div class="calendar-followup-meta">${meta || 'Follow-up scheduled'}</div>
                            </div>
                            <div class="calendar-followup-date">${this.formatDate(entry.date.toISOString())}</div>
                        </div>
                    `;
                }).join('');

                listEl.querySelectorAll('.calendar-followup-row').forEach(row => {
                    row.addEventListener('click', () => {
                        const id = row.getAttribute('data-id');
                        this.viewContact(id);
                    });
                });
            }
        }
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
        const rolodex = document.getElementById('contacts-rolodex');
        const filteredContacts = this.getFilteredContacts();

        // Empty states for both desktop table and mobile rolodex
        if (filteredContacts.length === 0) {
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No contacts found</td></tr>';
            }
            if (rolodex) {
                rolodex.innerHTML = '<p class="empty-state">No contacts found</p>';
            }
            return;
        }

        const tableRowsHtml = filteredContacts.map(contact => {
            const tags = contact.tags ? contact.tags.map(tagId => {
                const tag = this.tags.find(t => t.id === tagId);
                return tag ? `<span class="tag-badge" style="background: ${tag.color}20; color: ${tag.color};">${tag.name}</span>` : '';
            }).join('') : '';

            const fullEmail = contact.email || '';
            const primaryEmail = fullEmail.split(/[;,]/)[0].trim();

            const primaryContactName =
                contact.contactName ||
                (primaryEmail
                    ? primaryEmail.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
                    : '') ||
                '';

            const fullPhone = contact.phone || '';
            const primaryPhone = fullPhone.split(/[;,]/)[0].trim();
            const telHref = primaryPhone ? primaryPhone.replace(/[^0-9+]/g, '') : '';

            const smsHref = telHref ? `sms:${telHref}` : '';
            const websiteHref = contact.website || '';

            const statusText = contact.status || 'Not Started';
            const statusSlug = this.slugify(statusText);
            const last = contact.lastContact ? this.formatDate(contact.lastContact) : 'Never';

            const channelsHtml = `
                <div class="contact-card-channels">
                    ${primaryPhone ? `<a href="tel:${telHref}" class="chip chip-channel">Call</a>` : ''}
                    ${primaryPhone ? `<a href="${smsHref}" class="chip chip-channel">SMS</a>` : ''}
                    ${primaryEmail ? `<a href="mailto:${primaryEmail}" class="chip chip-channel">Email</a>` : ''}
                    ${websiteHref ? `<a href="${websiteHref}" target="_blank" rel="noopener" class="chip chip-channel">Website</a>` : ''}
                    <button type="button" class="chip chip-primary" onclick="app.viewContact('${contact.id}')">Profile</button>
                </div>
            `;

            return `
            <tr class="contact-row" data-id="${contact.id}">
                <td data-col="vendor" data-label="Vendor">
                    <label class="row-select-wrap">
                        <input type="checkbox" class="row-select" data-id="${contact.id}" ${this.selectedContactIds.has(contact.id) ? 'checked' : ''}>
                        <div>
                            <span class="contact-name-link">${contact.vendorName}</span>
                    ${tags ? `<div class="tags-inline">${tags}</div>` : ''}
                        </div>
                    </label>
                </td>
                <td data-col="contact" data-label="Contact">${primaryContactName || '—'}</td>
                <td data-col="email" data-label="Email" title="${fullEmail}">
                    ${
                        primaryEmail
                            ? `<a href="mailto:${primaryEmail}" class="contact-link">${primaryEmail}</a>`
                            : '—'
                    }
                </td>
                <td data-col="phone" data-label="Phone" title="${fullPhone}">
                    ${
                        primaryPhone
                            ? `<a href="tel:${telHref}" class="contact-link">${primaryPhone}</a>`
                            : '—'
                    }
                </td>
                <td data-col="category" data-label="Category">${contact.category || '—'}</td>
                <td data-col="project" data-label="Project">${contact.project || '—'}</td>
                <td data-col="status" data-label="Status">
                    <span class="status-badge status-${statusSlug}">${statusText}</span>
                </td>
                <td data-col="lastContact" data-label="Last Contact">${last}</td>
                <td data-col="actions" data-label="Actions">
                    ${channelsHtml}
                    <div class="contact-card-actions">
                        <button class="btn btn-secondary action-btn" onclick="app.logActivity('${contact.id}')">Log Activity</button>
                        <button class="btn btn-secondary action-btn" onclick="app.openTaskForContact('${contact.id}')">Add Task</button>
                    </div>
                </td>
            </tr>
        `;
        }).join('');

        if (tbody) {
            tbody.innerHTML = tableRowsHtml;

            // Make entire row clickable on mobile (except checkbox, action buttons, and links)
            tbody.querySelectorAll('.contact-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (window.innerWidth > 768) return;

                    const target = e.target;
                    if (
                        target.closest('input.row-select') ||
                        target.closest('.action-btn') ||
                        target.closest('a')
                    ) {
                        return;
                    }
                    const id = row.getAttribute('data-id');
                    if (id) {
                        this.viewContact(id);
                    }
                });
            });

            // Explicitly make vendor name clickable without triggering checkbox
            tbody.querySelectorAll('.contact-name-link').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const row = el.closest('.contact-row');
                    const id = row ? row.getAttribute('data-id') : null;
                    if (id) {
                        this.viewContact(id);
                    }
                });
            });
        }

        // --- Mobile rolodex cards ---
        if (rolodex) {
            const rolodexHtml = filteredContacts.map(contact => {
                const tags = contact.tags ? contact.tags.map(tagId => {
                    const tag = this.tags.find(t => t.id === tagId);
                    return tag ? `<span class="tag-badge" style="background: ${tag.color}20; color: ${tag.color};">${tag.name}</span>` : '';
                }).join('') : '';

                const fullEmail = contact.email || '';
                const primaryEmail = fullEmail.split(/[;,]/)[0].trim();

                const fullPhone = contact.phone || '';
                const primaryPhone = fullPhone.split(/[;,]/)[0].trim();
                const telHref = primaryPhone ? primaryPhone.replace(/[^0-9+]/g, '') : '';

                const statusText = contact.status || 'Not Started';
                const statusSlug = this.slugify(statusText);

                // Organization / company name for primary heading
                const orgName = contact.vendorName || contact.companyName || '';

                // Contact label/person (e.g., "President", "Info", or a person's name)
                const emailLocal =
                    primaryEmail && primaryEmail.includes('@')
                        ? primaryEmail.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
                        : '';
                const label = contact.contactName || contact.title || emailLocal;

                // Segment / role / project (e.g., "Ski Expo")
                const segmentOrProject = contact.segment || contact.project || '';

                let secondaryLine = '';
                if (label && segmentOrProject) {
                    secondaryLine = `${label} · ${segmentOrProject}`;
                } else {
                    secondaryLine = label || segmentOrProject;
                }

                return `
                    <article class="contact-card" data-id="${contact.id}">
                        <div class="contact-card-main">
                            <div class="contact-card-header">
                                <div class="contact-card-name">${orgName || '(No organization)'}</div>
                                ${statusText ? `<span class="status-badge status-${statusSlug}">${statusText}</span>` : ''}
                            </div>
                            ${secondaryLine ? `<div class="contact-card-company">${secondaryLine}</div>` : ''}
                            ${tags ? `<div class="contact-card-tags tags-inline">${tags}</div>` : ''}
                        </div>
                        <div class="contact-card-footer">
                            <div class="contact-card-quick-actions">
                                ${primaryPhone ? `<a href="tel:${telHref}" class="chip chip-primary">Call</a>` : ''}
                                ${primaryEmail ? `<a href="mailto:${primaryEmail}" class="chip chip-channel">Email</a>` : ''}
                            </div>
                        </div>
                    </article>
                `;
            }).join('');

            rolodex.innerHTML = rolodexHtml;

            // Card tap → open prospect profile (but let quick action links work)
            rolodex.querySelectorAll('.contact-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    const target = e.target;
                    if (target.closest('a')) {
                        // Allow tel: / mailto: to work without opening profile
                        return;
                    }
                    const id = card.getAttribute('data-id');
                    if (id) {
                        this.viewContact(id);
                    }
                });
            });
        }
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

        const projectFilter = document.getElementById('project-filter');
        const project = projectFilter ? projectFilter.value : '';
        if (project) {
            filtered = filtered.filter(contact => contact.project === project);
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
        
        // Apply sorting
        const hasExplicitSort = !!this.sortBy;

        if (!hasExplicitSort) {
            // Default sort: by organization/company name A–Z (case-insensitive),
            // pushing contacts with no org name to the bottom. Stable-ish secondary
            // sort by createdAt, then contact label/person.
            const getOrgKey = (c) => ((c.vendorName || c.companyName || '') || '').trim().toLowerCase();

            filtered.sort((a, b) => {
                const aOrg = getOrgKey(a);
                const bOrg = getOrgKey(b);

                // Both have organization names
                if (aOrg && bOrg) {
                    if (aOrg !== bOrg) {
                        return aOrg < bOrg ? -1 : 1;
                    }
                } else if (!aOrg && !bOrg) {
                    // both missing org name → fall through to secondary
                } else {
                    // exactly one missing org name → push missing to bottom
                    if (!aOrg) return 1;
                    if (!bOrg) return -1;
                }

                // Secondary: createdAt (older first)
                const aCreated = a.createdAt || '';
                const bCreated = b.createdAt || '';
                if (aCreated !== bCreated) {
                    return aCreated < bCreated ? -1 : 1;
                }

                // Tertiary: contact label/person for stable ordering
                const aLabel = (a.contactName || '').toLowerCase();
                const bLabel = (b.contactName || '').toLowerCase();
                if (aLabel === bLabel) return 0;
                return aLabel < bLabel ? -1 : 1;
            });
        } else {
            const sortKey = this.sortBy;
            const dir = this.sortDir === 'desc' ? -1 : 1;

            filtered.sort((a, b) => {
                if (sortKey === 'lastContact') {
                    const aTime = a.lastContact ? new Date(a.lastContact).getTime() : 0;
                    const bTime = b.lastContact ? new Date(b.lastContact).getTime() : 0;
                    if (aTime === bTime) return 0;
                    return aTime < bTime ? -1 * dir : 1 * dir;
                }

                const getVal = (c) => {
                    switch (sortKey) {
                        case 'vendorName':
                            return (c.vendorName || '').toLowerCase();
                        case 'contactName':
                            return (c.contactName || '').toLowerCase();
                        case 'email':
                            return (c.email || '').toLowerCase();
                        case 'phone':
                            return (c.phone || '').toLowerCase();
                        case 'category':
                            return (c.category || '').toLowerCase();
                        case 'project':
                            return (c.project || '').toLowerCase();
                        case 'status':
                            return (c.status || '').toLowerCase();
                        default:
                            return '';
                    }
                };

                const av = getVal(a);
                const bv = getVal(b);
                if (av === bv) return 0;
                return av < bv ? -1 * dir : 1 * dir;
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

    setSort(sortKey) {
        if (!sortKey) return;
        if (this.sortBy === sortKey) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortBy = sortKey;
            this.sortDir = 'asc';
        }
        this.renderContacts();
        this.applyColumnVisibility();
        this.updateSortHeaderStates();
    }

    updateSortHeaderStates() {
        const table = document.querySelector('.contacts-table');
        if (!table) return;
        table.querySelectorAll('thead th[data-sort]').forEach(th => {
            const key = th.getAttribute('data-sort');
            th.classList.remove('sort-asc', 'sort-desc');
            if (key && key === this.sortBy) {
                th.classList.add(this.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
            }
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
        const categories = [
            'Vendor / Supplier',
            'Customer / Advertiser',
            'Partner',
            'Media / Press',
            'Prospect / Lead',
            'Other'
        ];
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

    async quickAddContact(data) {
        const now = new Date().toISOString();
        const contact = {
            id: this.generateId(),
            // Basic Info
            vendorName: data.vendorName || '',
            companyName: data.vendorName || '',
            contactName: data.contactName || '',
            title: '',
            email: data.email || '',
            phone: data.phone || '',
            website: '',

            // Business Info
            category: data.category || '',
            segment: '',
            status: 'Not Started',
            industryVertical: '',
            companySize: '',
            annualRevenue: '',

            // Contact Details
            linkedin: '',
            twitter: '',
            facebook: '',
            instagram: '',

            // Address
            address: '',
            city: '',
            state: '',
            zipCode: '',
            country: 'USA',

            // Deal Info
            dealStage: '',
            dealValue: '',
            dealProbability: '',
            expectedCloseDate: '',

            // Decision Making
            decisionMaker: false,
            budget: '',
            authority: '',

            // Notes & Tags
            notes: '',
            internalNotes: '',
            tags: [],

            // Tracking
            project: data.project || '',
            leadSource: 'Manual Add',
            referredBy: '',

            // Metadata
            createdAt: now,
            lastContact: null,
            followUpDate: null,
            nextSteps: '',

            // Custom fields
            customFields: {}
        };

        if (contact.project) {
            this.ensureProjectExists(contact.project);
        }

        this.contacts.push(contact);
        await this.saveData();
        this.renderContacts();
        this.applyColumnVisibility();
        this.updateStats();
        if (typeof this.renderProjectFilterOptions === 'function') {
            this.renderProjectFilterOptions();
        }
        this.showNotification('Contact added successfully.');
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

    async bulkUpdateStatus() {
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
        await this.saveData();
        this.renderContacts();
        this.applyColumnVisibility();
        this.updateStats();
        this.showNotification('Status updated for selected contacts');
    }

    async bulkUpdateProject() {
        if (this.selectedContactIds.size === 0) {
            return;
        }

        const projectSelect = document.getElementById('bulk-project');
        if (!projectSelect) return;

        let projectName = (projectSelect.value || '').trim();
        if (!projectName) {
            const input = window.prompt('Enter project name to apply to selected contacts:');
            if (!input) {
                return;
            }
            projectName = input.trim();
            if (!projectName) {
                return;
            }
        }

        // Ensure project exists in global projects list
        if (typeof this.ensureProjectExists === 'function') {
            this.ensureProjectExists(projectName);
        }

        // Apply project name to all selected contacts
        this.contacts.forEach(c => {
            if (this.selectedContactIds.has(c.id)) {
                c.project = projectName;
            }
        });

        await this.saveData();
        this.renderContacts();
        this.applyColumnVisibility();
        if (typeof this.renderProjectFilterOptions === 'function') {
            this.renderProjectFilterOptions();
        }
        if (typeof this.renderProjectsPage === 'function') {
            this.renderProjectsPage();
        }
        this.showNotification(`Project updated to "${projectName}" for selected contacts`);
    }

    async bulkAddTag() {
        const select = document.getElementById('bulk-tag');
        if (!select) return;

        let tagId = select.value;

        // If no tag selected in the dropdown, prompt the user to enter a new tag name
        if (!tagId) {
            let rawName = window.prompt('Enter a tag to add to the selected contacts (e.g., "Ski Expo"):');
            if (!rawName) {
                // User cancelled or left empty
                return;
            }

            const name = rawName.trim();
            if (!name) {
                alert('Tag name cannot be empty.');
                return;
            }

            // Ensure tags array exists
            if (!Array.isArray(this.tags)) {
                this.tags = [];
            }

            // Try to find an existing tag with the same name (case-insensitive)
            const existing = this.tags.find(t => (t.name || '').toLowerCase() === name.toLowerCase());

            if (existing) {
                tagId = existing.id;
            } else {
                // Create a new tag object and add it to state
                const newTag = {
                    id: this.generateId(),
                    name,
                    color: '#4b5563' // neutral gray by default
                };
                this.tags.push(newTag);
                tagId = newTag.id;

                // Refresh any UIs that depend on the tag list
                this.renderBulkTagOptions();
                this.renderAdvancedFiltersPanel();
                // Also refresh contact tag selector if the modal is open
                this.renderTagSelector();
            }

            // Reflect the chosen/created tag in the dropdown
            select.value = tagId;
        }

        if (!tagId) {
            alert('Choose or enter a tag to add.');
            return;
        }

        // Apply the tag ID to all selected contacts
        this.contacts.forEach(c => {
            if (this.selectedContactIds.has(c.id)) {
                if (!Array.isArray(c.tags)) c.tags = [];
                if (!c.tags.includes(tagId)) c.tags.push(tagId);
            }
        });

        await this.saveData();
        this.renderContacts();
        this.applyColumnVisibility();
        this.showNotification('Tag added to selected contacts');
    }

    async bulkRemoveTag() {
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
        await this.saveData();
        this.renderContacts();
        this.applyColumnVisibility();
        this.showNotification('Tag removed from selected contacts');
    }

    async bulkDelete() {
        if (this.selectedContactIds.size === 0) return;
        if (!confirm(`Delete ${this.selectedContactIds.size} selected contact(s)? This cannot be undone.`)) return;
        const selectedIds = new Set(this.selectedContactIds);
        this.contacts = this.contacts.filter(c => !selectedIds.has(c.id));
        this.activities = this.activities.filter(a => !selectedIds.has(a.contactId));
        this.selectedContactIds.clear();
        await this.saveData();
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

    async saveContact(form) {
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
            project: formData.get('project') || '',
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

        if (contact.project) {
            this.ensureProjectExists(contact.project);
        }

        if (this.editingContactId) {
            const index = this.contacts.findIndex(c => c.id === this.editingContactId);
            this.contacts[index] = contact;
        } else {
            this.contacts.push(contact);
        }

        await this.saveData();
        this.closeContactModal();
        this.renderContacts();
        this.updateStats();
        
        this.showNotification('Contact saved successfully!');
    }

    async enrichCurrentContactWithRocketReach() {
        if (!this.currentContact) {
            console.error("RocketReach enrich: no current contact set");
            return;
        }

        const contact = this.currentContact;
        if (!contact.contactName) {
            alert("Please add a contact name before using RocketReach.");
            console.error("RocketReach enrich: missing contactName");
            return;
        }

        const payload = {
            name: contact.contactName || "",
            company: contact.vendorName || contact.companyName || "",
            domain: contact.website || ""
        };

        console.log("RocketReach enrich started for", payload);

        try {
            const res = await fetch("https://adsell-openai-proxy.jgregorywalsh.workers.dev/rocketreach/enrich", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errText = await res.text();
                console.error("RocketReach enrich failed", res.status, errText);
                return;
            }

            const data = await res.json();
            console.log("RocketReach enrich response", data);

            if (!data || typeof data !== 'object') {
                console.error("RocketReach enrich: unexpected response shape", data);
                return;
            }

            // Merge only missing fields
            if (!contact.email && data.email) contact.email = data.email;
            if (!contact.phone && data.phone) contact.phone = data.phone;
            if (!contact.title && data.title) contact.title = data.title;
            // optional: linkedin/profile URL
            if (!contact.linkedin && data.linkedin) contact.linkedin = data.linkedin;

            // Update contact in main contacts array
            const idx = this.contacts.findIndex(c => c.id === contact.id);
            if (idx !== -1) {
                this.contacts[idx] = { ...this.contacts[idx], ...contact };
            }

            await this.saveData();

            // Re-render current contact detail
            this.viewContact(contact.id);
        } catch (err) {
            console.error("RocketReach enrich failed", err);
        }
    }

    async enrichCurrentCompanyWithRocketReach() {
        if (!this.currentContact) {
            console.error("RocketReach company enrich: no current contact set");
            return;
        }

        const contact = this.currentContact;
        const company = (contact.vendorName || contact.companyName || "").trim();
        const domain = (contact.website || "").trim();

        if (!company && !domain) {
            alert("Please add a company name or website before using company enrich.");
            console.error("RocketReach company enrich: missing company/domain");
            return;
        }

        const payload = { company, domain };
        console.log("RocketReach company enrich started", payload);

        try {
            const res = await fetch("https://adsell-openai-proxy.jgregorywalsh.workers.dev/rocketreach/company-enrich", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
            const errText = await res.text();
                console.error("RocketReach company enrich failed", res.status, errText);
                return;
            }

            const data = await res.json();
            console.log("RocketReach company enrich response", data);

            if (!data || typeof data !== "object") {
                console.error("RocketReach company enrich: unexpected response type", data);
                return;
            }

            // Map company-level fields if missing
            if (!contact.website && data.website) {
                contact.website = data.website;
            }

            // Update contact in this.contacts
            const idx = this.contacts.findIndex(c => c.id === contact.id);
            if (idx !== -1) {
                this.contacts[idx] = { ...contact };
            }

            await this.saveData();

            // Re-render contact detail
            this.viewContact(contact.id);
        } catch (error) {
            console.error("RocketReach company enrich error", error);
        }
    }

    viewContact(id) {
        this.currentContact = this.contacts.find(c => c.id === id);
        if (!this.currentContact) return;

        const emailString = this.currentContact.email || '';
        const emailParts = emailString
            ? emailString.split(/[;,]/).map(e => e.trim()).filter(Boolean)
            : [];

        const phoneString = this.currentContact.phone || '';
        const phoneParts = phoneString
            ? phoneString.split(/[;,]/).map(p => p.trim()).filter(Boolean)
            : [];
        const primaryPhoneDetail = phoneParts[0] || '';
        const telHrefDetail = primaryPhoneDetail ? primaryPhoneDetail.replace(/[^0-9+]/g, '') : '';

        // Populate contact detail header (company/person/pills/channels)
        const setHeaderText = (id, value) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = value || '';
            }
        };
        const setHeaderHTML = (id, value) => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = value || '';
            }
        };

        const companyText = this.currentContact.companyName || this.currentContact.vendorName || 'No Company Name';
        const contactName = this.currentContact.contactName || '';
        const contactTitle = this.currentContact.title || '';
        const personText = contactName
            ? (contactTitle ? `${contactName} — ${contactTitle}` : contactName)
            : '';

        setHeaderText('cdh-company', companyText);
        setHeaderText('cdh-person', personText);
        setHeaderText('cdh-category', this.currentContact.category || '');
        setHeaderText('cdh-project', this.currentContact.project || '');
        setHeaderText('cdh-status', this.currentContact.status || '');

        setHeaderHTML('cdh-email', emailParts.length ? `<a href="mailto:${emailParts[0]}">${emailParts[0]}</a>` : '');
        setHeaderHTML('cdh-phone', primaryPhoneDetail ? `<a href="tel:${telHrefDetail}">${primaryPhoneDetail}</a>` : '');
        setHeaderHTML('cdh-sms', telHrefDetail ? `<a href="sms:${telHrefDetail}">SMS</a>` : '');
        setHeaderHTML('cdh-website', this.currentContact.website ? `<a href="${this.currentContact.website}" target="_blank">Website</a>` : '');
        setHeaderHTML('cdh-linkedin', this.currentContact.linkedin ? `<a href="${this.currentContact.linkedin}" target="_blank">LinkedIn</a>` : '');
        setHeaderHTML('cdh-facebook', this.currentContact.facebook ? `<a href="${this.currentContact.facebook}" target="_blank">Facebook</a>` : '');
        setHeaderHTML('cdh-x', this.currentContact.twitter ? `<a href="${this.currentContact.twitter}" target="_blank">X (Twitter)</a>` : '');

        const addressParts = [
            this.currentContact.address,
            this.currentContact.city,
            this.currentContact.state,
            this.currentContact.zipCode
        ].filter(Boolean);
        if (addressParts.length) {
            const fullAddress = addressParts.join(', ');
            const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
            setHeaderHTML('cdh-maps', `<a href="${mapsHref}" target="_blank">Maps</a>`);
        } else {
            setHeaderHTML('cdh-maps', '');
        }

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
                <div class="contact-body">
                    <!-- Contact Information -->
                    <div class="detail-section">
                        <h3>Contact Information</h3>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <span class="detail-label">Email</span>
                                <span class="detail-value">
                                    ${
                                        emailParts.length
                                            ? emailParts.map(e => `<div><a href="mailto:${e}" class="contact-link">${e}</a></div>`).join('')
                                            : '—'
                                    }
                                </span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Phone</span>
                                <span class="detail-value">
                                    ${
                                        primaryPhoneDetail
                                            ? `<a href="tel:${telHrefDetail}" class="contact-link">${primaryPhoneDetail}</a>`
                                            : '—'
                                    }
                                </span>
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
                                <span class="detail-label">Project</span>
                                <span class="detail-value">${this.currentContact.project || '—'}</span>
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
                                    <select id="contact-status-select" class="status-select">
                                        ${['Not Started', 'In Progress', 'Responded', 'Signed Up'].map(s => `
                                            <option value="${s}" ${this.currentContact.status === s ? 'selected' : ''}>${s}</option>
                                        `).join('')}
                                    </select>
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

                    <!-- Tasks for this Contact -->
                    <div class="detail-section" id="contact-tasks-section">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <h3>Tasks</h3>
                            <button type="button" class="btn btn-primary contact-tasks-add">+ Add Task</button>
                        </div>
                        ${(() => {
                            const tasks = this.getTasksForContact(id);
                            if (!tasks.length) {
                                return '<p class="empty-state">No tasks for this contact.</p>';
                            }
                            return `
                                <div class="tasks-list">
                                    ${tasks.map(t => {
                                        const today = new Date();
                                        today.setHours(0,0,0,0);
                                        const todayKey = today.toISOString().slice(0,10);
                                        const isOverdue = t.status === 'open' && t.dueDate && t.dueDate < todayKey;
                                        const priorityClass = 'task-priority-' + (t.priority || 'Medium').toLowerCase();
                                        const classes = [
                                            'task-row',
                                            priorityClass,
                                            t.status === 'completed' ? 'task-completed' : '',
                                            isOverdue ? 'task-overdue' : ''
                                        ].filter(Boolean).join(' ');
                                        const dueLabel = t.dueDate ? this.formatDate(t.dueDate) : 'No due date';
                                        return `
                                            <div class="${classes}" data-task-id="${t.id}">
                                                <div class="task-main">
                                                    <div class="task-title">${t.title}</div>
                                                    <div class="task-meta">
                                                        ${(t.priority || 'Medium')} • ${dueLabel}
                                                    </div>
                                                </div>
                                                <div class="task-controls">
                                                    <button type="button" class="btn btn-secondary btn-sm task-complete-btn">${t.status === 'completed' ? 'Reopen' : 'Complete'}</button>
                                                    <button type="button" class="btn btn-secondary btn-sm task-edit-btn">Edit</button>
                                                    <button type="button" class="btn btn-danger btn-sm task-delete-btn">Delete</button>
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            `;
                        })()}
                    </div>

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
                                                <button
                                                    type="button"
                                                    class="btn btn-secondary btn-sm timeline-delete-btn action-btn"
                                                    data-id="${activity.id}"
                                                >
                                                    Delete
                                                </button>
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

        // Wire RocketReach enrich button for this contact
        const rrBtn = document.getElementById('rr-enrich-contact');
        if (rrBtn) {
            rrBtn.onclick = () => {
                this.enrichCurrentContactWithRocketReach();
            };
        }

        // Wire delete buttons for activities
        const timelineDeleteButtons = document.querySelectorAll('.timeline-delete-btn');
        timelineDeleteButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const activityId = btn.getAttribute('data-id');
                if (!activityId) return;
                const confirmed = window.confirm('Delete this activity? This cannot be undone.');
                if (!confirmed) return;
                await this.deleteActivity(activityId);
            });
        });

        // Wire tasks section buttons (if any)
        const contactTasksSection = document.getElementById('contact-tasks-section');
        if (contactTasksSection) {
            contactTasksSection.querySelectorAll('.task-row').forEach(row => {
                const taskId = row.getAttribute('data-task-id');
                if (!taskId) return;
                const completeBtn = row.querySelector('.task-complete-btn');
                const editBtn = row.querySelector('.task-edit-btn');
                const deleteBtn = row.querySelector('.task-delete-btn');

                if (completeBtn) {
                    completeBtn.addEventListener('click', async () => {
                        const task = this.tasks.find(t => t.id === taskId);
                        if (!task) return;
                        const newStatus = task.status === 'completed' ? 'open' : 'completed';
                        await this.updateTask(taskId, { status: newStatus });
                    });
                }

                if (editBtn) {
                    editBtn.addEventListener('click', () => {
                        this.openTaskModal(taskId);
                    });
                }

                if (deleteBtn) {
                    deleteBtn.addEventListener('click', async () => {
                        const confirmed = window.confirm('Delete this task? This cannot be undone.');
                        if (!confirmed) return;
                        await this.deleteTask(taskId);
                    });
                }
            });

            const contactTasksAddBtn = contactTasksSection.querySelector('.contact-tasks-add');
            if (contactTasksAddBtn) {
                contactTasksAddBtn.addEventListener('click', () => {
                    this.openTaskModal();
                });
            }
        }

        // Wire status dropdown change
        const statusSelect = document.getElementById('contact-status-select');
        if (statusSelect) {
            statusSelect.addEventListener('change', async () => {
                const newStatus = statusSelect.value || 'Not Started';

                // Update currentContact
                if (this.currentContact) {
                    this.currentContact.status = newStatus;
                }

                // Update the contact in the main contacts array
                const idx = this.contacts.findIndex(c => c.id === id);
                if (idx !== -1) {
                    this.contacts[idx].status = newStatus;
                }

                // Persist and refresh dependent views
                await this.saveData();
                this.updateStats();
                this.renderPipeline();
                this.showNotification(`Status updated to ${newStatus}`);
            });
        }

        this.showPage('contact-detail');

        // On mobile, ensure the contact detail view starts at the top so header and toolbar are visible
        if (window.innerWidth <= 768) {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }
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
        form.project.value = this.currentContact.project || '';
        form.referredBy.value = this.currentContact.referredBy || '';
        
        // Render tag selector with current selections
        this.renderTagSelector();
        
        document.getElementById('contact-modal').classList.add('active');
    }

    async deleteContact() {
        if (!this.currentContact) return;
        
        if (confirm(`Are you sure you want to delete ${this.currentContact.vendorName}?`)) {
            this.contacts = this.contacts.filter(c => c.id !== this.currentContact.id);
            this.activities = this.activities.filter(a => a.contactId !== this.currentContact.id);
            await this.saveData();
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

    async saveActivity(form) {
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

        await this.saveData();
        this.closeActivityModal();
        this.viewContact(this.currentContact.id);
        this.renderRecentActivity();
        this.updateStats();
        
        this.showNotification('Activity logged successfully!');
    }

    async deleteActivity(activityId) {
        const beforeCount = this.activities.length;
        this.activities = this.activities.filter(a => a.id !== activityId);

        if (this.activities.length === beforeCount) {
            return;
        }

        await this.saveData();

        if (this.currentContact && this.currentContact.id) {
            this.viewContact(this.currentContact.id);
        }
        this.renderRecentActivity();
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

    async saveScript(form) {
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

        await this.saveData();
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

    async deleteScript(id) {
        if (confirm('Are you sure you want to delete this script?')) {
            this.scripts = this.scripts.filter(s => s.id !== id);
            await this.saveData();
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

    // ===== Tasks Helpers =====
    getTasksForContact(contactId) {
        return (this.tasks || []).filter(t => t.contactId === contactId);
    }

    getTasksForDate(dateKey) {
        if (!dateKey) return [];
        return (this.tasks || []).filter(
            t => t.dueDate && t.dueDate.startsWith(dateKey) && t.status === 'open'
        );
    }

    afterTasksChanged() {
        // Re-render key views that depend on tasks
        if (typeof this.renderTasksPage === 'function') {
            this.renderTasksPage();
        }
        if (typeof this.renderDashboardTasks === 'function') {
            this.renderDashboardTasks();
        }
        if (typeof this.renderCalendar === 'function') {
            this.renderCalendar();
        }
        if (this.currentContact && this.currentContact.id) {
            this.viewContact(this.currentContact.id);
        }
    }

    async addTask(taskData) {
        const now = new Date().toISOString();
        const task = {
            id: this.generateId(),
            contactId: taskData.contactId || null,
            title: taskData.title || '',
            notes: taskData.notes || '',
            priority: taskData.priority || 'Medium',
            status: taskData.status || 'open',
            dueDate: taskData.dueDate || null,
            createdAt: now,
            completedAt: null,
            project: taskData.project || ''
        };
        if (task.project) {
            this.ensureProjectExists(task.project);
        }
        this.tasks.push(task);
        await this.saveData();
        this.afterTasksChanged();
        return task;
    }

    async updateTask(taskId, updates) {
        const idx = this.tasks.findIndex(t => t.id === taskId);
        if (idx === -1) return;
        const existing = this.tasks[idx];
        const next = { ...existing, ...updates };

        // Manage completedAt based on status
        if (existing.status !== 'completed' && next.status === 'completed' && !next.completedAt) {
            next.completedAt = new Date().toISOString();
        } else if (existing.status === 'completed' && next.status !== 'completed') {
            next.completedAt = null;
        }

        this.tasks[idx] = next;
        await this.saveData();
        this.afterTasksChanged();
    }

    async completeTask(taskId) {
        await this.updateTask(taskId, { status: 'completed', completedAt: new Date().toISOString() });
    }

    async deleteTask(taskId) {
        const before = this.tasks.length;
        this.tasks = this.tasks.filter(t => t.id !== taskId);
        if (this.tasks.length === before) return;
        await this.saveData();
        this.afterTasksChanged();
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

            // Build a set of keys for existing contacts to detect duplicates.
            // Key format: vendorName|email, both lowercased and trimmed.
            const existingKeys = new Set(
                (this.contacts || [])
                    .filter(c => c.vendorName && c.email)
                    .map(c => {
                        const vendor = c.vendorName.toLowerCase().trim();
                        const email = c.email.toLowerCase().trim();
                        return `${vendor}|${email}`;
                    })
            );

            // Also track keys within this import batch to avoid duplicates inside the CSV itself.
            const importKeys = new Set();

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
                    project: "",
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
                    // Project / campaign
                    else if (
                        hasAny(h, ["project", "campaign", "outreach_project"])
                    ) {
                        if (!contact.project) contact.project = value;
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

                if (!hasIdentifier) {
                    continue;
                }

                // Build dedupe key if we have both vendorName and email
                let dedupeKey = null;
                if (contact.vendorName && contact.email) {
                    const vendor = contact.vendorName.toLowerCase().trim();
                    const email = contact.email.toLowerCase().trim();
                    dedupeKey = `${vendor}|${email}`;
                }

                // If dedupeKey exists and is already present in existingKeys or importKeys, skip this contact
                if (dedupeKey && (existingKeys.has(dedupeKey) || importKeys.has(dedupeKey))) {
                    continue;
                }

                // If we have a dedupeKey that is new, add it to importKeys for this batch
                if (dedupeKey) {
                    importKeys.add(dedupeKey);
                }

                if (contact.project) {
                    this.ensureProjectExists(contact.project);
                }

                    contacts.push(contact);
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

    async confirmImport() {
        if (!this.pendingImport) return;

        const count = this.pendingImport.length;
        this.contacts.push(...this.pendingImport);
        this.pendingImport = null;
        
        await this.saveData();
        
        this.cancelImport();
        this.showPage('contacts');
        this.updateStats();
        this.renderContacts();
        this.applyColumnVisibility();
        
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
            'notes','internalNotes','nextSteps','followUpDate','leadSource','project','createdAt','lastContact','tags'
        ];
        const rows = [headers].concat(contacts.map(c => [
            c.id, c.vendorName, c.companyName, c.contactName, c.title, c.email, c.phone, c.website,
            c.category, c.segment, c.status, c.companySize, c.annualRevenue,
            c.linkedin, c.twitter, c.facebook, c.instagram,
            c.address, c.city, c.state, c.zipCode,
            c.dealStage, c.dealValue, c.dealProbability, c.expectedCloseDate,
            c.decisionMaker, c.authority, c.budget,
            c.notes, c.internalNotes, c.nextSteps, c.followUpDate, c.leadSource, c.project, c.createdAt, c.lastContact,
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

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.app = new OutreachTracker();
    });
} else {
    // DOM is already ready
    window.app = new OutreachTracker();
}

// Class prototype AI helpers (delegating to callAI and modal)
OutreachTracker.prototype.showAIModal = function (html) {
    showAIModal(html);
};

OutreachTracker.prototype.aiOutreach = async function () {
    const c = this.currentContact || {};
    const businessName = c.vendorName || c.companyName || "";
    const category = c.category || "";
    const segment = c.segment || "";
    const location = (c.city || "") + " " + (c.state || "");
    const contactName = c.contactName || "";
    const status = c.status || "";
    const notes = c.notes || "";
    const nextSteps = c.nextSteps || "";
    const website = c.website || "";

    const prompt = `
You are an SDR for AdSell.ai.

AdSell.ai is an AI-powered platform that helps businesses buy PRINT ads directly in newspapers and magazines. It:
- recommends relevant print publications and sections,
- simplifies ad creation and submission,
- is usually cheaper than traditional agency/direct print buys,
- complements digital campaigns by reaching audiences they might miss.

You are writing outreach for this prospect:

- Business: ${businessName || "(unknown)"}
- Contact: ${contactName || "(unknown contact)"}
- Category: ${category || "(not specified)"}
- Segment / Region: ${segment || "(not specified)"}
- Location: ${location || "(not specified)"}
- Website: ${website || "(unknown)"}
- CRM Status: ${status || "(not set)"}
- CRM Notes: ${notes || "(none)"}
- CRM Next Steps: ${nextSteps || "(none)"}

TASK:
Write a complete outreach package in **Markdown** with the following sections and formatting:

## Email Subject

- Provide 2–3 subject line options tailored to ${businessName}.

## Initial Email

Write a short, friendly outreach email that:
- acknowledges who they are and what they likely care about,
- explains AdSell.ai in clear, practical language,
- connects PRINT advertising to their likely goals (more customers, bookings, leads, awareness),
- ends with a clear, low-friction CTA (short call or quick demo).

Use normal Markdown line breaks and paragraphs.

## Phone Call Script

Write a simple phone script using bullet points:

- **Opening:** one or two opening lines.
- **Discovery Questions:** 3–5 questions tailored to this type of business.
- **AdSell.ai Pitch:** 3–5 bullet points summarizing why AdSell.ai is a good fit (focused on print).
- **Objection Handling:** 2–3 common objections (budget, "we only do digital", "print doesn’t work") and short responses.
- **Close:** one call-to-action to move them to a next step.

## Follow-Up Email

Write a short follow-up email for when there has been no response yet. Keep it 4–6 sentences and refer back to the original outreach.

Formatting rules:
- Use Markdown headings exactly as above.
- Use bullet lists where appropriate.
- Do not add extra introductory text outside of these headings.
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
    const leadSource = c.leadSource || "";

    const prompt = `
You are an SDR strategist for AdSell.ai.

AdSell.ai is an AI-powered platform that helps businesses buy PRINT ads directly in newspapers and magazines. It:
- recommends relevant newspapers, magazines, and sections for a given business and audience,
- simplifies creative submission and campaign management,
- is typically more affordable than traditional agency/direct print buys,
- complements digital campaigns by reaching audiences that digital alone may not reach.

You have this CRM information:

- Business: ${businessName || "(not provided)"}
- Category: ${category || "(not provided)"}
- Segment / Region: ${segment || "(not provided)"}
- Location: ${location || "(not provided)"}
- Website: ${website || "(not provided)"}
- Lead Source: ${leadSource || "(not provided)"}
- CRM Notes: ${notes || "(none)"}

You have access to web search via the OpenAI tools. Use web search to:
- Look up the business (and its website if provided),
- Confirm what the business does and who it serves,
- Find a small amount of publicly available context (for example: description, services, location, audience).

Do not invent details you cannot confirm. If something is not clear from the CRM data or web search, keep it generic instead of guessing.

Also, if the business name/category/notes/website clearly indicate it is a ski resort, mountain destination, snow-sports shop, or outdoor recreation organization, then it is part of the ski/outdoor vertical and eligible for a special AdSell.ai ski/outdoor free-trial/pilot campaign. If not, do not mention ski/outdoor offers at all.

Return your findings in Markdown with this structure:

## Confirmed Company Summary
- Briefly state what this business is and does, based on its website and any clearly relevant search results.
- Mention the type of customers or audience it appears to serve.
- Include 1–2 direct URLs or citation-style references to pages you used (for example: home page, about page, or key listing).

## Marketing Context
- List 3–5 realistic marketing priorities for this kind of business, based on what you saw (e.g., drive bookings, increase event attendance, grow memberships, increase store traffic, generate leads).
- Phrase them as practical statements, not wild guesses.

## How AdSell.ai Can Help
- Provide 3–5 specific ways AdSell.ai's print advertising platform can help THIS business.
- Tie each bullet to what you saw on the site (events, products, services, locations, audiences).
- Emphasize: direct access to print, AI recommendations, lower cost, complement to digital.

## Ski / Outdoor Free-Trial (only if clearly applicable)
- Include this section ONLY if it is clearly a ski/outdoor business.
- In that case, add a short paragraph suggesting how to position a special ski/outdoor free-trial / pilot offer for this business (for example, seasonal campaigns, regional outdoor publications, etc.).
- If it is NOT ski/outdoor, skip this section entirely.

## Suggested Outreach Angles
- List 2–3 concise outreach angles or themes an SDR could use in emails or calls when talking to this account.
- Each angle should connect AdSell.ai's print capabilities to something concrete you observed about the business.
`;

    this.showAIModal('<p class="text-muted">Generating...</p>');
    // IMPORTANT: use research mode so the Worker turns web search on
    const result = await callAI(prompt, "research");
    this.showAIModal(result);
};

OutreachTracker.prototype.aiFollowupEmail = async function () {
    const notesEl = document.getElementById("activity-notes") ||
                    document.querySelector('#activity-form textarea[name="notes"]');
    const notes = notesEl ? notesEl.value : "";
    const c = this.currentContact || {};

    const prompt = `
You are writing a friendly but professional follow-up email for this sales scenario.

Contact:
Name: ${c.contactName || ""}
Business: ${c.vendorName || c.companyName || ""}
Stage: ${c.status || ""}

My rough notes / context:
${notes || "(no extra notes)"}

Keep the email concise, clear, and focused on how AdSell.ai's PRINT advertising platform can help this business.

Return a single follow-up email formatted in Markdown with this structure:

## Follow-Up Email

[Write the email body below this heading, using normal paragraphs and line breaks. Do not include any other sections or commentary.]
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
You are a sales assistant turning rough call notes into a clean, structured summary.

Notes:
${rawNotes}

Return your output in Markdown with these sections and content:

## Call Summary
- 3–5 sentences summarizing the overall call and key outcomes.

## Key Points
- Bullet list of the most important points discussed.

## Next Steps
- Bullet list of agreed next steps with as much specificity as possible.

## Qualification Score
- Score: NN/100
- Rationale: 1–3 short sentences explaining why you chose this score.

## Recommended Next Outreach
- A short recommendation for the next outreach touch (channel + timing).
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
