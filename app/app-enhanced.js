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
        this.activeContactId = null;
        this._prospectDetailsExpanded = false;
        this.contactsSearchTerm = '';
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
        
        // Enrichment cache: { [contactId]: { perplexity?: string, grok?: string, activeProvider?: "perplexity"|"grok" } }
        this.enrichmentCache = {};
        
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
        // Contact sheet advanced toggle
        const advancedToggle = document.getElementById('contact-advanced-toggle');
        const advancedSection = document.getElementById('contact-advanced-section');
        if (advancedToggle && advancedSection) {
            advancedToggle.addEventListener('click', () => {
                const isCollapsed = advancedSection.classList.contains('collapsed');
                if (isCollapsed) {
                    advancedSection.classList.remove('collapsed');
                    advancedSection.hidden = false;
                    advancedToggle.textContent = 'Hide advanced fields';
                    advancedToggle.setAttribute('aria-expanded', 'true');
                } else {
                    advancedSection.classList.add('collapsed');
                    advancedSection.hidden = true;
                    advancedToggle.textContent = 'Show advanced fields';
                    advancedToggle.setAttribute('aria-expanded', 'false');
                }
            });
        }
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
            });
        });

        // Mobile nav toggle (hamburger)
        if (navToggle && navContainer) {
            navToggle.addEventListener('click', () => {
                navContainer.classList.toggle('nav-open');
            });
        }

        // Bottom mobile nav (mobile primary tabs)
        const tabLinks = document.querySelectorAll('.mobile-nav.bottom-nav .bottom-nav-item');
        tabLinks.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const page = btn.dataset.page;
                if (!page) return;

                this.showPage(page);

                // Update active state for bottom nav immediately
                tabLinks.forEach(t => t.classList.remove('is-active'));
                btn.classList.add('is-active');

                // Also close the hamburger menu if it's open
                if (navContainer && navContainer.classList.contains('nav-open')) {
                    navContainer.classList.remove('nav-open');
                }
            });
        });

        // Set initial active state for bottom nav based on default page
        const defaultTab = document.querySelector('.mobile-nav.bottom-nav .bottom-nav-item[data-page="dashboard"]');
        if (defaultTab) {
            defaultTab.classList.add('is-active');
        }

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

        // Export / Advanced Filters dropdown behavior and advanced filter actions
        const exportDetails = document.getElementById('export-menu');
        const advDetails = document.getElementById('advanced-filters');

        // Advanced filters actions (delegation within details)
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

        // Ensure only one of Export / Advanced Filters is open at a time
        if (exportDetails && advDetails) {
            exportDetails.addEventListener('toggle', () => {
                if (exportDetails.open && advDetails.open) {
                    advDetails.open = false;
                }
            });
            advDetails.addEventListener('toggle', () => {
                if (advDetails.open && exportDetails.open) {
                    exportDetails.open = false;
                }
            });
        }

        // Close panels when clicking outside (desktop only)
        if (exportDetails || advDetails) {
            document.addEventListener('click', (e) => {
                const target = e.target;
                if (!(target instanceof HTMLElement)) return;

                // Ignore clicks inside export/advanced filter areas
                if (target.closest('#export-menu') || target.closest('#advanced-filters')) {
                    return;
                }

                // On desktop, clicking outside closes both panels
                if (window.innerWidth >= 769) {
                    if (exportDetails) exportDetails.open = false;
                    if (advDetails) advDetails.open = false;
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

        // Contact delete button (in Edit modal)
        const contactDeleteBtn = document.getElementById('contact-delete-btn');
        if (contactDeleteBtn) {
            contactDeleteBtn.addEventListener('click', () => {
                if (!this.editingContactId) return;
                this.deleteContactById(this.editingContactId);
        });
        }

        // Extra contact add button (in Edit modal)
        const addExtraBtn = document.getElementById('extra-contact-add-btn');
        if (addExtraBtn) {
            addExtraBtn.addEventListener('click', () => {
                const listEl = document.getElementById('extra-contacts-list');
                if (!listEl) return;
                const card = this.createExtraContactCard({});
                listEl.appendChild(card);
            });
        }

        // Multi-field add buttons
        const primaryEmailAddBtn = document.getElementById('primary-email-add-btn');
        if (primaryEmailAddBtn) {
            primaryEmailAddBtn.addEventListener('click', () => {
                const list = document.getElementById('primary-email-list');
                if (list) list.appendChild(this.createMultiFieldRow('', 'Email', 'email'));
            });
        }

        const primaryPhoneAddBtn = document.getElementById('primary-phone-add-btn');
        if (primaryPhoneAddBtn) {
            primaryPhoneAddBtn.addEventListener('click', () => {
                const list = document.getElementById('primary-phone-list');
                if (list) list.appendChild(this.createMultiFieldRow('', 'Phone', 'tel'));
            });
        }

        const orgEmailAddBtn = document.getElementById('org-email-add-btn');
        if (orgEmailAddBtn) {
            orgEmailAddBtn.addEventListener('click', () => {
                const list = document.getElementById('org-email-list');
                if (list) list.appendChild(this.createMultiFieldRow('', 'Email (e.g., info@...)', 'email'));
            });
        }

        const orgPhoneAddBtn = document.getElementById('org-phone-add-btn');
        if (orgPhoneAddBtn) {
            orgPhoneAddBtn.addEventListener('click', () => {
                const list = document.getElementById('org-phone-list');
                if (list) list.appendChild(this.createMultiFieldRow('', 'Phone', 'tel'));
            });
        }

        // Project "+ New" button
        const projectAddBtn = document.getElementById('project-add-btn');
        const projectNewWrapper = document.getElementById('project-new-wrapper');
        const projectNewInput = document.getElementById('project-new-input');
        if (projectAddBtn && projectNewWrapper && projectNewInput) {
            projectAddBtn.addEventListener('click', () => {
                projectNewWrapper.style.display = 'block';
                projectNewInput.focus();
            });
        }

        // Contact modal close/cancel buttons
        const contactModalClose = document.getElementById('contact-modal-close');
        if (contactModalClose) {
            contactModalClose.addEventListener('click', () => this.closeContactModal());
        }

        const contactCancelBtn = document.getElementById('contact-cancel-btn');
        if (contactCancelBtn) {
            contactCancelBtn.addEventListener('click', () => this.closeContactModal());
        }
        
        // Close modal when clicking backdrop
        const contactModalBackdrop = document.getElementById('contact-modal-backdrop');
        if (contactModalBackdrop) {
            contactModalBackdrop.addEventListener('click', () => this.closeContactModal());
        }

        // Advanced toggle (new structure)
        const advToggle = document.getElementById('contact-advanced-toggle');
        const advBody = document.getElementById('contact-advanced-body');
        if (advToggle && advBody) {
            advToggle.addEventListener('click', () => {
                const collapsed = advBody.classList.contains('collapsed');
                if (collapsed) {
                    advBody.classList.remove('collapsed');
                    advToggle.textContent = 'Hide advanced fields';
                    advToggle.setAttribute('aria-expanded', 'true');
                } else {
                    advBody.classList.add('collapsed');
                    advToggle.textContent = 'Show advanced fields';
                    advToggle.setAttribute('aria-expanded', 'false');
                }
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
            searchInput.addEventListener('input', () => {
                this.contactsSearchTerm = (searchInput.value || '').toString();
                this.filterContacts();
            });
        }
        const statusFilter = document.getElementById('status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => this.filterContacts());
        }
        const categoryFilter = document.getElementById('category-filter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', () => this.filterContacts());
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
                const businessName = (formData.get('vendorName') || '').trim();
                if (!businessName) {
                    alert('Please enter a business / organization name.');
                    return;
                }
                const contactData = {
                    vendorName: businessName,
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
        
        // Normalize contacts to ensure array fields exist
        (this.contacts || []).forEach(c => {
            if (!Array.isArray(c.people)) c.people = [];
            if (!Array.isArray(c.companyEmails)) c.companyEmails = [];
            if (!Array.isArray(c.companyPhones)) c.companyPhones = [];
            if (!Array.isArray(c.primaryEmails)) c.primaryEmails = [];
            if (!Array.isArray(c.primaryPhones)) c.primaryPhones = [];
        });
        
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

        // Normalize contacts: ensure arrays exist
        (this.contacts || []).forEach(c => {
            if (c) {
                c.people = Array.isArray(c.people) ? c.people : [];
                c.primaryEmails = Array.isArray(c.primaryEmails) ? c.primaryEmails : [];
                c.primaryPhones = Array.isArray(c.primaryPhones) ? c.primaryPhones : [];
                c.companyEmails = Array.isArray(c.companyEmails) ? c.companyEmails : [];
                c.companyPhones = Array.isArray(c.companyPhones) ? c.companyPhones : [];
            }
        });

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

        // Leaving prospect profile view when navigating away from Contacts
        // (keep profile state intact when we stay on 'contacts', e.g. showProspectProfile)
        if (pageName !== 'contacts') {
            const profileView = document.getElementById('prospect-profile-view');
            if (profileView) {
                profileView.classList.add('hidden');
            }
            this.activeContactId = null;
        }

        // Update nav links
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.dataset.page === pageName) {
                link.classList.add('active');
            }
        });

        // Sync bottom mobile tab bar active state
        const bottomTabs = document.querySelectorAll('.mobile-nav.bottom-nav .bottom-nav-item');
        bottomTabs.forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.page === pageName);
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

    /**
     * Render project options in the Edit Prospect modal dropdown
     */
    renderProjectOptions(currentValue = '') {
        const select = document.getElementById('project-select');
        if (!select) return;

        const projects = this.getProjectNames();

        select.innerHTML = '<option value="">Select project</option>';

        projects.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });

        // Set current value if it exists
        if (currentValue) {
            // Check if current value is in the list, if not add it
            if (!projects.includes(currentValue)) {
                const opt = document.createElement('option');
                opt.value = currentValue;
                opt.textContent = currentValue;
                select.appendChild(opt);
            }
            select.value = currentValue;
        }

        // Reset the new project input
        const projectNewWrapper = document.getElementById('project-new-wrapper');
        const projectNewInput = document.getElementById('project-new-input');
        if (projectNewWrapper) projectNewWrapper.style.display = 'none';
        if (projectNewInput) projectNewInput.value = '';
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
                                <div class="calendar-followup-name">${c.vendorName || '(No business name)'}</div>
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
            const businessName = contact ? contact.vendorName : 'Unknown';
            
            return `
                <div class="activity-item">
                    <div class="activity-header">
                        <span class="activity-type">${activity.type}</span>
                        <span class="activity-date">${this.formatDate(activity.date)}</span>
                    </div>
                    <div class="activity-vendor">${businessName}</div>
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
                <td data-col="vendor" data-label="Business">
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

        // Explicitly make business name clickable without triggering checkbox
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

        // --- Mobile rolodex cards (iOS-style list cells) ---
        if (rolodex) {
            const rolodexHtml = filteredContacts.map(contact => {
                const fullEmail = contact.email || '';
                const primaryEmail = fullEmail.split(/[;,]/)[0].trim();

                const fullPhone = contact.phone || '';
                const primaryPhone = fullPhone.split(/[;,]/)[0].trim();
                const telHref = primaryPhone ? primaryPhone.replace(/[^0-9+]/g, '') : '';

                const statusText = contact.status || 'Not Started';
                const statusSlug = this.slugify(statusText);

                // Organization / company name for primary heading
                const companyName = contact.vendorName || contact.companyName || '(No organization)';

                // Build contact line: "Person · Title" or "Person" or "Category" or empty
                const contactPerson = contact.contactName || '';
                const contactTitle = contact.title || '';
                const category = contact.category || '';
                let contactLine = '';
                if (contactPerson && contactTitle) {
                    contactLine = `${contactPerson} · ${contactTitle}`;
                } else if (contactPerson) {
                    contactLine = contactPerson;
                } else if (contactTitle) {
                    contactLine = contactTitle;
                } else if (category) {
                    contactLine = category;
                }

                // Project tag - only ONE, no duplicates
                const projectName = contact.project || '';
                const projectTagHtml = projectName ? `<span class="contact-tag">${projectName}</span>` : '';

                // Action chips
                const callChip = primaryPhone ? `<a href="tel:${telHref}" class="contact-action-chip">Call</a>` : '';
                const emailChip = primaryEmail ? `<a href="mailto:${primaryEmail}" class="contact-action-chip">Email</a>` : '';
                const profileChip = `<button type="button" class="contact-action-chip" onclick="event.stopPropagation(); app.viewContact('${contact.id}')">Profile</button>`;

                return `
                    <div class="contact-cell" data-id="${contact.id}">
                        <div class="contact-cell-header">
                            <div class="contact-cell-title">${companyName}</div>
                            <div class="contact-cell-status contact-status-${statusSlug}">${statusText}</div>
                        </div>
                        ${contactLine ? `<div class="contact-cell-meta">${contactLine}</div>` : ''}
                        <div class="contact-cell-footer">
                            <div class="contact-cell-tags">
                                ${projectTagHtml}
                            </div>
                            <div class="contact-cell-actions">
                                ${callChip}
                                ${emailChip}
                                ${profileChip}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            rolodex.innerHTML = rolodexHtml;

            // Cell tap → open prospect profile (but let action links/buttons work)
            rolodex.querySelectorAll('.contact-cell').forEach(cell => {
                cell.addEventListener('click', (e) => {
                    const target = e.target;
                    if (target.closest('a') || target.closest('button')) {
                        // Allow tel: / mailto: / buttons to work without opening profile
                        return;
                    }
                    const id = cell.getAttribute('data-id');
                    if (id) {
                        this.viewContact(id);
                    }
                });
            });
        }
    }

    getFilteredContacts() {
        let filtered = [...this.contacts];
        
        const search = (this.contactsSearchTerm || '').toString().toLowerCase();
        if (search) {
            filtered = filtered.filter(contact => 
                contact.vendorName.toLowerCase().includes(search) ||
                (contact.contactName && contact.contactName.toLowerCase().includes(search)) ||
                (contact.companyName && contact.companyName.toLowerCase().includes(search)) ||
                (contact.email && contact.email.toLowerCase().includes(search)) ||
                (contact.phone && contact.phone.toLowerCase().includes(search)) ||
                (contact.category && contact.category.toLowerCase().includes(search)) ||
                (contact.project && contact.project.toLowerCase().includes(search))
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

    // Prospect profile helpers
    getActiveContact() {
        if (!this.activeContactId) return null;
        const targetId = String(this.activeContactId);
        const contact = (this.contacts || []).find(c => String(c.id) === targetId) || null;
        return contact;
    }

    /**
     * Get the currently active enrichment provider for the active contact.
     * Returns "perplexity" or "grok" based on cache, defaulting to "perplexity".
     */
    getActiveEnrichProvider() {
        const contact = this.getActiveContact();
        if (!contact) return 'perplexity';

        this.enrichmentCache = this.enrichmentCache || {};
        const entry = this.enrichmentCache[contact.id];
        if (entry && entry.activeProvider) {
            return entry.activeProvider;
        }
        return 'perplexity';
    }

    getActivitiesForContact(contactId) {
        if (!contactId) return [];
        return (this.activities || [])
            .filter(a => a.contactId === contactId)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    filterContacts() {
        this.renderContacts();
        this.applyColumnVisibility();
    }

    applyColumnVisibility() {
        // Business/Organization column always visible
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

    /**
     * Open the shared contact sheet in add or edit mode.
     * mode: "add" | "edit"
     * contactIdOrData: optional contact id or contact object to edit
     */
    openContactSheet(mode = 'add', contactIdOrData = null) {
        const form = document.getElementById('contact-form');
        const modal = document.getElementById('contact-modal');
        // Support both old and new title element IDs
        const titleEl = document.getElementById('contact-modal-title') || document.getElementById('modal-title');
        if (!form || !modal) return;

        let contact = null;
        if (mode === 'edit') {
            if (contactIdOrData && typeof contactIdOrData === 'object') {
                contact = contactIdOrData;
            } else if (contactIdOrData) {
                contact = this.contacts.find(c => c.id === contactIdOrData) || null;
            } else if (this.currentContact) {
                contact = this.currentContact;
            }
        }

        if (mode === 'add' || !contact) {
        this.editingContactId = null;
            if (titleEl) titleEl.textContent = 'Add Prospect';
            form.reset();
            
            // Initialize project dropdown for add mode
            this.renderProjectOptions('');
            
            // Initialize empty multi-field lists for add mode
            this.populateMultiFieldList('primary-email-list', [], 'Email', 'email');
            this.populateMultiFieldList('primary-phone-list', [], 'Phone', 'tel');
            this.populateMultiFieldList('org-email-list', [], 'Email (e.g., info@...)', 'email');
            this.populateMultiFieldList('org-phone-list', [], 'Phone', 'tel');
            this.populateExtraContacts(null);
        } else {
            this.editingContactId = contact.id;
            if (titleEl) titleEl.textContent = 'Edit Prospect';

            // Organization section
            if (form.vendorName) form.vendorName.value = contact.vendorName || '';
            if (form.website) form.website.value = contact.website || '';
            
            // Project dropdown
            this.renderProjectOptions(contact.project || '');
            
            if (form.segment) form.segment.value = contact.segment || '';
            if (form.category) form.category.value = contact.category || '';
            if (form.status) form.status.value = contact.status || 'Not Started';

            // Primary contact section
            if (form.contactName) form.contactName.value = contact.contactName || '';
            if (form.title) form.title.value = contact.title || '';

            // Multi-field lists for primary contact
            const primaryEmails = contact.primaryEmails || (contact.email ? [contact.email] : []);
            const primaryPhones = contact.primaryPhones || (contact.phone ? [contact.phone] : []);
            this.populateMultiFieldList('primary-email-list', primaryEmails, 'Email', 'email');
            this.populateMultiFieldList('primary-phone-list', primaryPhones, 'Phone', 'tel');

            // Org contact info
            const orgEmails = contact.companyEmails || [];
            const orgPhones = contact.companyPhones || [];
            this.populateMultiFieldList('org-email-list', orgEmails, 'Email (e.g., info@...)', 'email');
            this.populateMultiFieldList('org-phone-list', orgPhones, 'Phone', 'tel');

            // Social links
            if (form.linkedin) form.linkedin.value = contact.linkedin || '';
            if (form.facebook) form.facebook.value = contact.facebook || '';
            if (form.instagram) form.instagram.value = contact.instagram || '';
            if (form.twitter) form.twitter.value = contact.twitter || '';
            if (form.youtube) form.youtube.value = contact.youtube || '';

            // Address
            if (form.address) form.address.value = contact.address || '';
            if (form.city) form.city.value = contact.city || '';
            if (form.state) form.state.value = contact.state || '';
            if (form.zipCode) form.zipCode.value = contact.zipCode || '';
            if (form.country) form.country.value = contact.country || 'USA';

            // Advanced fields
            if (form.companyName) form.companyName.value = contact.companyName || '';
            if (form.leadSource) form.leadSource.value = contact.leadSource || '';
            if (form.companySize) form.companySize.value = contact.companySize || '';
            if (form.annualRevenue) form.annualRevenue.value = contact.annualRevenue || '';
            if (form.referredBy) form.referredBy.value = contact.referredBy || '';
            if (form.dealStage) form.dealStage.value = contact.dealStage || '';
            if (form.dealValue) form.dealValue.value = contact.dealValue || '';
            if (form.dealProbability) form.dealProbability.value = contact.dealProbability || '';
            if (form.expectedCloseDate) form.expectedCloseDate.value = contact.expectedCloseDate || '';
            if (form.decisionMaker) form.decisionMaker.value = contact.decisionMaker ? 'true' : 'false';
            if (form.budget) form.budget.value = contact.budget || '';
            if (form.authority) form.authority.value = contact.authority || '';
            if (form.notes) form.notes.value = contact.notes || '';
            if (form.internalNotes) form.internalNotes.value = contact.internalNotes || '';
            if (form.nextSteps) form.nextSteps.value = contact.nextSteps || '';
            if (form.followUpDate) form.followUpDate.value = contact.followUpDate || '';

            // Other contacts (people array)
            this.populateExtraContacts(contact);
        }

        // Render tag selector with current selections
        this.renderTagSelector();

        // Ensure advanced section is collapsed by default when opening
        const advancedBody = document.getElementById('contact-advanced-body');
        const advancedToggle = document.getElementById('contact-advanced-toggle');
        if (advancedBody && advancedToggle) {
            advancedBody.classList.add('collapsed');
            advancedToggle.textContent = 'Show advanced fields';
            advancedToggle.setAttribute('aria-expanded', 'false');
        }
        // Also handle old structure if present
        const advancedSection = document.getElementById('contact-advanced-section');
        if (advancedSection && advancedToggle) {
            advancedSection.classList.add('collapsed');
            advancedSection.hidden = true;
        }

        // Show Delete button only when editing an existing contact
        const deleteBtn = document.getElementById('contact-delete-btn');
        if (deleteBtn) {
            deleteBtn.style.display = this.editingContactId ? 'inline-flex' : 'none';
        }

        // Clear any previous validation errors
        this.clearContactFormErrors(form);

        // Prevent body scroll when modal is open
        document.body.classList.add('modal-open');
        modal.classList.add('active');
    }

    // Backwards-compatible wrappers
    showAddContactModal() {
        this.openContactSheet('add');
    }

    closeContactModal() {
        const modal = document.getElementById('contact-modal');
        if (modal) modal.classList.remove('active');
        // Restore body scroll
        document.body.classList.remove('modal-open');
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

    // ─────────────────────────────────────────────────────────────────────────
    // Multi-Field Helpers (emails, phones, people)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Create a simple multi-field row (email or phone)
     */
    createMultiFieldRow(value, placeholder, inputType = 'text') {
        const row = document.createElement('div');
        row.className = 'multi-field-row';

        const input = document.createElement('input');
        input.type = inputType;
        input.placeholder = placeholder;
        input.value = value || '';
        input.className = 'form-input multi-field-input';

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'multi-field-remove-btn';
        removeBtn.textContent = '−';
        removeBtn.title = 'Remove';
        removeBtn.addEventListener('click', () => row.remove());

        row.appendChild(input);
        row.appendChild(removeBtn);

        return row;
    }

    /**
     * Read all values from a multi-field list
     */
    readMultiFieldValues(listId) {
        const listEl = document.getElementById(listId);
        if (!listEl) return [];
        return Array.from(listEl.querySelectorAll('.multi-field-row input'))
            .map(input => input.value.trim())
            .filter(Boolean);
    }

    /**
     * Populate a multi-field list with values
     */
    populateMultiFieldList(listId, values, placeholder, inputType = 'text') {
        const listEl = document.getElementById(listId);
        if (!listEl) return;

        listEl.innerHTML = '';
        const arr = Array.isArray(values) ? values : (values ? [values] : []);
        
        // Always have at least one empty row for convenience
        if (arr.length === 0) {
            listEl.appendChild(this.createMultiFieldRow('', placeholder, inputType));
        } else {
            arr.forEach(val => {
                listEl.appendChild(this.createMultiFieldRow(val, placeholder, inputType));
            });
        }
    }

    /**
     * Create an extra contact card (other person at org)
     */
    createExtraContactCard(person) {
        const card = document.createElement('div');
        card.className = 'extra-contact-card';

        const nameRow = this.createMultiFieldRow(person?.name || '', 'Name');
        const roleRow = this.createMultiFieldRow(person?.role || '', 'Role / Title');
        const emailRow = this.createMultiFieldRow(person?.email || '', 'Email', 'email');
        const phoneRow = this.createMultiFieldRow(person?.phone || '', 'Phone', 'tel');

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'extra-contact-remove-person';
        removeBtn.textContent = 'Remove person';
        removeBtn.addEventListener('click', () => card.remove());

        card.appendChild(nameRow);
        card.appendChild(roleRow);
        card.appendChild(emailRow);
        card.appendChild(phoneRow);
        card.appendChild(removeBtn);

        return card;
    }

    /**
     * Populate extra contacts list when opening the edit modal
     */
    populateExtraContacts(contact) {
        const listEl = document.getElementById('extra-contacts-list');
        if (!listEl) return;

        listEl.innerHTML = '';
        const people = Array.isArray(contact?.people) ? contact.people : [];
        people.forEach(person => {
            const card = this.createExtraContactCard(person);
            listEl.appendChild(card);
        });
    }

    /**
     * Read extra contacts from the form
     */
    readExtraContactsFromForm() {
        const extraList = document.getElementById('extra-contacts-list');
        if (!extraList) return [];

        const cards = Array.from(extraList.querySelectorAll('.extra-contact-card'));
        const people = [];

        cards.forEach(card => {
            const inputs = card.querySelectorAll('.multi-field-row input');
            let name = '';
            let role = '';
            let email = '';
            let phone = '';

            inputs.forEach(input => {
                const ph = (input.placeholder || '').toLowerCase();
                const val = input.value.trim();
                if (!val) return;

                if (ph.includes('name')) name = val;
                else if (ph.includes('role')) role = val;
                else if (ph.includes('email')) email = val;
                else if (ph.includes('phone')) phone = val;
            });

            if (name || email || phone || role) {
                people.push({ name, role, email, phone });
            }
        });

        return people;
    }

    // Legacy alias for backward compatibility
    buildExtraContactsFromForm() {
        return this.readExtraContactsFromForm();
    }

    // Legacy alias
    createExtraContactRow(person) {
        return this.createExtraContactCard(person);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Contact Form Validation Helpers
    // ─────────────────────────────────────────────────────────────────────────

    setContactFieldError(inputEl, message) {
        if (!inputEl) return;
        inputEl.classList.add('contact-input-error');
        // Find or create error message element
        let msg = inputEl.parentElement.querySelector('.contact-error-msg');
        if (!msg) {
            msg = document.createElement('div');
            msg.className = 'contact-error-msg';
            inputEl.parentElement.appendChild(msg);
        }
        msg.textContent = message;
    }

    clearContactFormErrors(form) {
        if (!form) return;
        form.querySelectorAll('.contact-input-error').forEach(el => el.classList.remove('contact-input-error'));
        form.querySelectorAll('.contact-error-msg').forEach(el => el.remove());
    }

    validateContactForm(form) {
        this.clearContactFormErrors(form);
        
        const vendorName = (form.vendorName?.value || '').trim();
        let hasError = false;

        // Validate Business/Organization Name (required)
        if (!vendorName) {
            this.setContactFieldError(form.vendorName, 'Business / Organization Name is required.');
            hasError = true;
        }

        // Email is optional - no validation required

        return !hasError;
    }

    async saveContact(form) {
        const formData = new FormData(form);
        const submitBtn = form.querySelector('button[type="submit"]');
        const errorEl = form.querySelector('.contact-modal-error');
        
        // Clear previous general errors
        if (errorEl) {
            errorEl.remove();
        }

        // Read multi-field values
        const primaryEmails = this.readMultiFieldValues('primary-email-list');
        const primaryPhones = this.readMultiFieldValues('primary-phone-list');
        const orgEmails = this.readMultiFieldValues('org-email-list');
        const orgPhones = this.readMultiFieldValues('org-phone-list');

        // Validate: only vendorName is required
        this.clearContactFormErrors(form);
        const vendorName = (formData.get('vendorName') || '').trim();
        let hasError = false;

        if (!vendorName) {
            this.setContactFieldError(form.vendorName, 'Business / Organization Name is required.');
            hasError = true;
        }

        // Email is optional - no validation required

        if (hasError) return;
        
        // Show loading state
        const originalBtnText = submitBtn?.textContent || 'Save';
        if (submitBtn) {
            submitBtn.textContent = 'Saving…';
            submitBtn.classList.add('btn-saving');
            submitBtn.disabled = true;
        }
        
        try {
        // Get selected tags
        const selectedTags = Array.from(document.querySelectorAll('#tag-selector input[type="checkbox"]:checked'))
            .map(cb => cb.value);

            // Get existing contact data to preserve metadata
            const existingContact = this.editingContactId 
                ? this.contacts.find(c => c.id === this.editingContactId) 
                : null;

            // Normalize social URLs
            const normalizeUrl = (val, domain) => {
                if (!val) return '';
                val = val.trim();
                if (val.startsWith('@')) {
                    return `https://${domain}/${val.slice(1)}`;
                }
                if (val && !val.startsWith('http')) {
                    return `https://${val}`;
                }
                return val;
            };

            // Get project from dropdown or new input
            const projectSelect = document.getElementById('project-select');
            const projectNewInput = document.getElementById('project-new-input');
            let projectName = projectSelect ? projectSelect.value.trim() : '';
            
            // If user typed a new project name, use that instead
            if (projectNewInput && projectNewInput.value.trim()) {
                projectName = projectNewInput.value.trim();
                // Ensure it exists in the projects list
                this.ensureProjectExists(projectName);
            }

            // Safe value helper - ensures no undefined/null breaks serialization
            const safe = (v) => (v === undefined || v === null ? '' : v);

        const contact = {
            id: this.editingContactId || this.generateId(),
                
                // Organization info
                vendorName: safe(formData.get('vendorName')),
                companyName: safe(formData.get('companyName')) || safe(formData.get('vendorName')),
                website: safe(formData.get('website')),
                
                // Primary contact
                contactName: safe(formData.get('contactName')),
                title: safe(formData.get('title')),
                email: primaryEmails[0] || '',  // First email for backward compatibility
                phone: primaryPhones[0] || '',  // First phone for backward compatibility
                primaryEmails: primaryEmails,
                primaryPhones: primaryPhones,
                
                // Org-level contact info
                companyEmails: orgEmails,
                companyPhones: orgPhones,
            
            // Business Info
                category: safe(formData.get('category')),
                segment: safe(formData.get('segment')),
                status: safe(formData.get('status')),
                industryVertical: safe(formData.get('industryVertical')),
                companySize: safe(formData.get('companySize')),
                annualRevenue: safe(formData.get('annualRevenue')),
                
                // Social Links (with URL normalization)
                linkedin: normalizeUrl(formData.get('linkedin'), 'linkedin.com'),
                twitter: normalizeUrl(formData.get('twitter'), 'x.com'),
                facebook: normalizeUrl(formData.get('facebook'), 'facebook.com'),
                instagram: normalizeUrl(formData.get('instagram'), 'instagram.com'),
                youtube: safe(formData.get('youtube')),
            
            // Address
                address: safe(formData.get('address')),
                city: safe(formData.get('city')),
                state: safe(formData.get('state')),
                zipCode: safe(formData.get('zipCode')),
                country: safe(formData.get('country')) || 'USA',
            
            // Deal Info
                dealStage: safe(formData.get('dealStage')),
                dealValue: safe(formData.get('dealValue')),
                dealProbability: safe(formData.get('dealProbability')),
                expectedCloseDate: safe(formData.get('expectedCloseDate')),
            
            // Decision Making
            decisionMaker: formData.get('decisionMaker') === 'true',
                budget: safe(formData.get('budget')),
                authority: safe(formData.get('authority')),
            
            // Notes & Tags
                notes: safe(formData.get('notes')),
                internalNotes: safe(formData.get('internalNotes')),
            tags: selectedTags,
            
            // Tracking
                project: projectName,
                leadSource: safe(formData.get('leadSource')) || 'Albany Ski Expo',
                referredBy: safe(formData.get('referredBy')),
                
                // Metadata - preserve from existing or create new
                createdAt: existingContact?.createdAt || new Date().toISOString(),
                lastContact: existingContact?.lastContact || null,
                followUpDate: safe(formData.get('followUpDate')) || null,
                nextSteps: safe(formData.get('nextSteps')),
            
            // Custom fields
                customFields: existingContact?.customFields || {},
                
                // Additional contacts (people array)
                people: this.readExtraContactsFromForm()
        };

        if (contact.project) {
            this.ensureProjectExists(contact.project);
        }

        if (this.editingContactId) {
            const index = this.contacts.findIndex(c => c.id === this.editingContactId);
                if (index !== -1) {
            this.contacts[index] = contact;
                }
        } else {
            this.contacts.push(contact);
        }

        await this.saveData();
        this.closeContactModal();
        this.renderContacts();
        this.updateStats();
        
        this.showNotification('Contact saved successfully!');

            // If we are currently viewing this contact in the prospect profile, refresh it
            if (this.activeContactId === contact.id) {
                this.currentContact = contact;
                this.renderProspectProfileView();
            }
        } catch (err) {
            console.error('Failed to save contact:', err);
            
            // Show error message in modal
            const errorDiv = document.createElement('div');
            errorDiv.className = 'contact-modal-error';
            errorDiv.textContent = 'Failed to save contact. Please try again.';
            
            const actionsRow = form.querySelector('.contact-modal-actions') || form.querySelector('.form-actions');
            if (actionsRow) {
                actionsRow.parentNode.insertBefore(errorDiv, actionsRow);
            } else {
                form.appendChild(errorDiv);
            }
        } finally {
            // Reset button state
            if (submitBtn) {
                submitBtn.textContent = originalBtnText;
                submitBtn.classList.remove('btn-saving');
                submitBtn.disabled = false;
            }
        }
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

            // Re-render prospect profile view if open
            if (this.activeContactId === contact.id) {
                this.renderProspectProfileView();
            } else {
                this.renderContacts();
            }
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
        // Backwards-compatible wrapper: route to the new prospect profile view
        this.showProspectProfile(id);
    }

    editContact() {
        if (!this.currentContact) return;
        this.openContactSheet('edit', this.currentContact.id);
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

    /**
     * Delete a contact by ID (used from the Edit Contact modal).
     */
    async deleteContactById(contactId) {
        if (!contactId) return;

        const contact = this.contacts.find(c => c.id === contactId);
        const contactName = contact?.vendorName || contact?.companyName || 'this contact';

        const confirmed = window.confirm(`Delete ${contactName}? This cannot be undone.`);
                if (!confirmed) return;

        this.contacts = (this.contacts || []).filter(c => c.id !== contactId);
        this.activities = (this.activities || []).filter(a => a.contactId !== contactId);
                await this.saveData();
        this.closeContactModal();
        this.renderContacts();
                this.updateStats();
        
        // If we were viewing this contact in the profile, go back to contacts list
        if (this.activeContactId === contactId) {
            this.showPage('contacts');
        }
        
            this.showNotification('Contact deleted successfully!');
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

        // Refresh prospect profile view if open
        if (this.activeContactId === this.currentContact.id) {
            this.renderProspectProfileView();
        }
    }

    async deleteActivity(activityId) {
        const beforeCount = this.activities.length;
        this.activities = this.activities.filter(a => a.id !== activityId);

        if (this.activities.length === beforeCount) {
            return;
        }

        await this.saveData();

        if (this.currentContact && this.currentContact.id && this.activeContactId === this.currentContact.id) {
            this.renderProspectProfileView();
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
                subject: 'Reach more customers for {Business Name} with print advertising',
                content: `Hi {Contact Name},

My name is {Your Name} from AdSell.ai. I saw {Business Name} at the Albany Ski Expo and wanted to reach out about an opportunity that could help you reach more customers this ski season.

AdSell.ai is an AI-powered platform that makes print advertising incredibly easy and affordable. Instead of going through expensive agencies, you can place ads directly in top newspapers and magazines with just a few clicks.

Here's what makes us different:

✓ Direct access to hundreds of publications - no agency fees
✓ AI helps you target the right publications for your audience
✓ Create and submit ads in minutes, not weeks
✓ Track real ROI and engagement (yes, even for print!)
✓ Better rates than traditional agency pricing

Perfect for {Category} like yours looking to reach local ski enthusiasts and families planning their winter trips.

**Special offer for ski industry businesses:** Use code 2104 to get started with preferred pricing.

Would you be open to a quick 10-minute call this week? I can show you exactly how {Business Name} could use print advertising to fill more lift lines/increase foot traffic/boost bookings this season.

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
                subject: 'Still interested in reaching more customers? {Business Name}',
                content: `Hi {Contact Name},

Following up on my email about AdSell.ai - wanted to make sure this didn't get buried in your inbox.

Quick refresher: We help ski businesses like {Business Name} place print ads in newspapers and magazines without the hassle (or cost!) of traditional agencies.

Why this matters for ski season:
• Families plan ski trips by reading local weekend guides and outdoor magazines
• Print reaches a demographic you're missing with digital-only advertising  
• It's WAY cheaper than you think (no agency fees = 50-70% cost reduction)
• Our AI helps you target the exact publications your customers read

Takes literally 5 minutes to create and submit your first ad.

**Ski industry special:** Use code 2104 at www.adsell.ai for preferred access.

Quick question: Are you actively advertising right now, or still figuring out your marketing strategy for the season?

Would love to show you how {Business Name} could use this. 10-minute call or I can send you a quick demo video - your choice.

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

Quick question: Does {Business Name} do any print advertising?

Most ski businesses tell us they wish they could, but it's too expensive/complicated/time-consuming through traditional agencies.

That's exactly what we built AdSell.ai to solve:

→ Place ads in hundreds of newspapers & magazines yourself (no agency!)
→ Takes minutes, not weeks
→ Pay 50-70% less than traditional rates  
→ AI targets the right publications for your customers
→ Track actual ROI

Perfect for reaching families planning ski trips who aren't on Instagram all day.

Worth a 10-minute conversation? I can show you exactly how it works and what it would cost for {Business Name}.

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

We connected at the Albany Ski Expo (or saw {Business Name} was an exhibitor) and wanted to follow up about something that could help you get more value from events like this.

The challenge with expos: you meet hundreds of potential customers, but then what? How do you stay top-of-mind when they're actually ready to book/buy?

That's where print advertising comes in - and why we built AdSell.ai.

Here's how ski businesses are using it:
→ Run ads in local newspapers/magazines right after events
→ Reach the same audience (families, ski enthusiasts) when they're planning trips
→ Reinforce your brand while it's fresh from the expo
→ Do it yourself in minutes, without expensive agencies

**Example:** A ski shop runs an ad in regional outdoor magazines post-expo offering 15% off gear. Cost: $300. Result: 47 customers, $8,200 in sales. That's 27x ROI.

Want to see how this could work for {Business Name}? I can show you exactly which publications your expo attendees read.

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

    renderPhoneNumbers(rawPhone) {
        const value = (rawPhone || '').toString().trim();
        if (!value) return '—';

        try {
            const parts = value.split(/[\/,]/).map(p => p.trim()).filter(Boolean);
            if (!parts.length) return value;

            const itemsHtml = parts.map((chunk, idx) => {
                const m = chunk.match(/^(.*?)(?:\s*(?:x|ext\.?)\s*(\d+))?\s*$/i);
                const base = (m && m[1] ? m[1] : chunk).trim();
                const ext = m && m[2] ? m[2] : '';
                const digits = base.replace(/[^0-9+]/g, '');
                const display = ext ? `${base} x${ext}` : base;
                const label = idx === 0 ? '' : 'Alt';

                if (!digits) {
                    return `
                        <div class="prospect-phone-item">
                            <span class="prospect-phone-text">${display}</span>
                            ${label ? `<span class="prospect-phone-meta">${label}</span>` : ''}
                        </div>
                    `;
                }

                return `
                    <div class="prospect-phone-item">
                        <a href="tel:${digits}" class="prospect-phone-text">${display}</a>
                        ${label ? `<span class="prospect-phone-meta">${label}</span>` : ''}
                    </div>
                `;
            }).join('');

            return `<div class="prospect-phone-list">${itemsHtml}</div>`;
        } catch {
            return value;
        }
    }

    /**
     * Render the Details card with grouped layout (Organization, People & Contact, Web & Location)
     */
    /**
     * Normalize all phone numbers from a contact (org-level + people)
     * Returns array of { number, label, source }
     */
    normalizeContactPhones(contact) {
        const phones = [];
        
        // Primary phone (from contact.phone - could be semicolon-separated)
        const phoneString = contact.phone || '';
        if (phoneString) {
            phoneString.split(/[;,]/).map(p => p.trim()).filter(Boolean).forEach((num, idx) => {
                phones.push({
                    number: num,
                    label: idx === 0 ? 'Main' : `Phone ${idx + 1}`,
                    source: 'org'
                });
            });
        }
        
        // Company phones array
        const companyPhones = Array.isArray(contact.companyPhones) ? contact.companyPhones : [];
        companyPhones.filter(Boolean).forEach((num, idx) => {
            if (!phones.find(p => p.number === num)) {
                phones.push({
                    number: num,
                    label: `Office ${idx + 1}`,
                    source: 'org'
                });
            }
        });
        
        // Primary contact phones
        const primaryPhones = Array.isArray(contact.primaryPhones) ? contact.primaryPhones : [];
        const primaryName = contact.contactName || 'Primary Contact';
        primaryPhones.filter(Boolean).forEach((num, idx) => {
            if (!phones.find(p => p.number === num)) {
                phones.push({
                    number: num,
                    label: `${primaryName}${idx > 0 ? ` (${idx + 1})` : ''}`,
                    source: 'primary'
                });
            }
        });
        
        // People phones
        const people = Array.isArray(contact.people) ? contact.people : [];
        people.forEach((person) => {
            const personPhones = Array.isArray(person.phones) ? person.phones : (person.phone ? [person.phone] : []);
            personPhones.filter(Boolean).forEach((num, idx) => {
                if (!phones.find(p => p.number === num)) {
                    phones.push({
                        number: num,
                        label: `${person.name || 'Contact'}${idx > 0 ? ` (${idx + 1})` : ''}`,
                        source: 'person'
                    });
                }
            });
        });
        
        return phones;
    }
    
    /**
     * Normalize all emails from a contact (org-level + people)
     * Returns array of { email, label, source }
     */
    normalizeContactEmails(contact) {
        const emails = [];
        
        // Primary email (from contact.email - could be semicolon-separated)
        const emailString = contact.email || '';
        if (emailString) {
            emailString.split(/[;,]/).map(e => e.trim()).filter(Boolean).forEach((addr, idx) => {
                emails.push({
                    email: addr,
                    label: idx === 0 ? 'Main' : `Email ${idx + 1}`,
                    source: 'org'
                });
            });
        }
        
        // Company emails array
        const companyEmails = Array.isArray(contact.companyEmails) ? contact.companyEmails : [];
        companyEmails.filter(Boolean).forEach((addr, idx) => {
            if (!emails.find(e => e.email.toLowerCase() === addr.toLowerCase())) {
                emails.push({
                    email: addr,
                    label: `General ${idx + 1}`,
                    source: 'org'
                });
            }
        });
        
        // Primary contact emails
        const primaryEmails = Array.isArray(contact.primaryEmails) ? contact.primaryEmails : [];
        const primaryName = contact.contactName || 'Primary Contact';
        primaryEmails.filter(Boolean).forEach((addr, idx) => {
            if (!emails.find(e => e.email.toLowerCase() === addr.toLowerCase())) {
                emails.push({
                    email: addr,
                    label: `${primaryName}${idx > 0 ? ` (${idx + 1})` : ''}`,
                    source: 'primary'
                });
            }
        });
        
        // People emails
        const people = Array.isArray(contact.people) ? contact.people : [];
        people.forEach((person) => {
            const personEmails = Array.isArray(person.emails) ? person.emails : (person.email ? [person.email] : []);
            personEmails.filter(Boolean).forEach((addr, idx) => {
                if (!emails.find(e => e.email.toLowerCase() === addr.toLowerCase())) {
                    emails.push({
                        email: addr,
                        label: `${person.name || 'Contact'}${idx > 0 ? ` (${idx + 1})` : ''}`,
                        source: 'person'
                    });
                }
            });
        });
        
        return emails;
    }
    
    /**
     * Show bottom sheet selector for multiple options
     * @param {string} title - Sheet title
     * @param {Array} options - Array of { value, label, icon? }
     * @param {Function} onSelect - Callback when option selected
     */
    /**
     * Open the static channel sheet with options
     * Uses the HTML component in index.html
     */
    openChannelSheet(options, title, onSelect) {
        const overlay = document.getElementById('channel-sheet-overlay');
        const titleEl = document.getElementById('channel-sheet-title');
        const listEl = document.getElementById('channel-sheet-list');
        const closeBtn = document.getElementById('channel-sheet-close');

        if (!overlay || !titleEl || !listEl) return;

        titleEl.textContent = title || 'Choose contact';
        listEl.innerHTML = '';

        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'channel-sheet-option';

            const labels = document.createElement('div');
            labels.className = 'channel-sheet-option-labels';

            const main = document.createElement('div');
            main.className = 'channel-sheet-option-main';
            main.textContent = opt.value;

            const sub = document.createElement('div');
            sub.className = 'channel-sheet-option-sub';
            sub.textContent = opt.label || '';

            labels.appendChild(main);
            if (opt.label) labels.appendChild(sub);

            btn.appendChild(labels);

            // Add chevron
            const chevron = document.createElement('span');
            chevron.className = 'channel-sheet-option-chevron';
            chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
            btn.appendChild(chevron);

            btn.addEventListener('click', () => {
                this.closeChannelSheet();
                if (typeof onSelect === 'function') {
                    onSelect(opt);
                }
            });

            listEl.appendChild(btn);
        });

        overlay.hidden = false;
        document.body.classList.add('sheet-open');

        // Close handlers
        const close = () => this.closeChannelSheet();

        closeBtn.onclick = close;
        overlay.onclick = (evt) => {
            if (evt.target === overlay) {
                close();
            }
        };
    }

    closeChannelSheet() {
        const overlay = document.getElementById('channel-sheet-overlay');
        if (overlay) {
            overlay.hidden = true;
        }
        document.body.classList.remove('sheet-open');
    }

    /**
     * Legacy showBottomSheet - now uses openChannelSheet
     */
    showBottomSheet(title, options, onSelect) {
        // Transform options for openChannelSheet format
        const transformedOptions = options.map(opt => ({
            value: opt.value,
            label: opt.label
        }));
        this.openChannelSheet(transformedOptions, title, onSelect);
    }
    
    closeBottomSheet() {
        this.closeChannelSheet();
    }

    /**
     * Get all phone options for the active prospect
     * Returns array of { value, label, source }
     */
    getAllPhoneOptionsForActiveProspect() {
        const contact = this.getActiveContact?.() || this.currentContact;
        if (!contact) return [];

        const options = [];

        // 1) Org-level phone(s)
        if (contact.phone) {
            const raw = String(contact.phone);
            const parts = raw.split(/[\/,|;]/).map(p => p.trim()).filter(Boolean);
            parts.forEach((num, index) => {
                options.push({
                    value: num,
                    label: index === 0 ? 'Main line (prospect)' : 'Phone ' + (index + 1),
                    source: 'prospect'
                });
            });
        }

        // Company phones array
        const companyPhones = Array.isArray(contact.companyPhones) ? contact.companyPhones : [];
        companyPhones.filter(Boolean).forEach((num, idx) => {
            if (!options.find(p => p.value === num)) {
                options.push({
                    value: num,
                    label: `Office ${idx + 1}`,
                    source: 'prospect'
                });
            }
        });

        // Primary contact phones
        const primaryPhones = Array.isArray(contact.primaryPhones) ? contact.primaryPhones : [];
        const primaryName = contact.contactName || 'Primary Contact';
        primaryPhones.filter(Boolean).forEach((num, idx) => {
            if (!options.find(p => p.value === num)) {
                options.push({
                    value: num,
                    label: `${primaryName}${idx > 0 ? ' (' + (idx + 1) + ')' : ''}`,
                    source: 'primary'
                });
            }
        });

        // 2) People-level phone(s)
        if (Array.isArray(contact.people)) {
            contact.people.forEach(person => {
                if (!person) return;
                const personPhones = Array.isArray(person.phones) ? person.phones : (person.phone ? [person.phone] : []);
                personPhones.filter(Boolean).forEach((num, index) => {
                    if (!options.find(p => p.value === num)) {
                        options.push({
                            value: num,
                            label: (person.name || person.contactName || 'Contact') +
                                (personPhones.length > 1 ? ' (' + (index + 1) + ')' : ''),
                            source: 'person'
                        });
                    }
                });
            });
        }

        // Remove duplicates (same value)
        const seen = new Set();
        return options.filter(opt => {
            const k = opt.value.replace(/\s+/g, '');
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    /**
     * Get all email options for the active prospect
     * Returns array of { value, label, source }
     */
    getAllEmailOptionsForActiveProspect() {
        const contact = this.getActiveContact?.() || this.currentContact;
        if (!contact) return [];

        const options = [];

        // 1) Org-level email(s)
        if (contact.email) {
            const raw = String(contact.email);
            const parts = raw.split(/[;,\s]/).map(p => p.trim()).filter(Boolean);
            parts.forEach((addr, index) => {
                options.push({
                    value: addr,
                    label: index === 0 ? 'General email (prospect)' : 'Email ' + (index + 1),
                    source: 'prospect'
                });
            });
        }

        // Company emails array
        const companyEmails = Array.isArray(contact.companyEmails) ? contact.companyEmails : [];
        companyEmails.filter(Boolean).forEach((addr, idx) => {
            if (!options.find(e => e.value.toLowerCase() === addr.toLowerCase())) {
                options.push({
                    value: addr,
                    label: `General ${idx + 1}`,
                    source: 'prospect'
                });
            }
        });

        // Primary contact emails
        const primaryEmails = Array.isArray(contact.primaryEmails) ? contact.primaryEmails : [];
        const primaryName = contact.contactName || 'Primary Contact';
        primaryEmails.filter(Boolean).forEach((addr, idx) => {
            if (!options.find(e => e.value.toLowerCase() === addr.toLowerCase())) {
                options.push({
                    value: addr,
                    label: `${primaryName}${idx > 0 ? ' (' + (idx + 1) + ')' : ''}`,
                    source: 'primary'
                });
            }
        });

        // 2) People-level email(s)
        if (Array.isArray(contact.people)) {
            contact.people.forEach(person => {
                if (!person) return;
                const personEmails = Array.isArray(person.emails) ? person.emails : (person.email ? [person.email] : []);
                personEmails.filter(Boolean).forEach((addr, index) => {
                    if (!options.find(e => e.value.toLowerCase() === addr.toLowerCase())) {
                        options.push({
                            value: addr,
                            label: (person.name || person.contactName || 'Contact') +
                                (personEmails.length > 1 ? ' (' + (index + 1) + ')' : ''),
                            source: 'person'
                        });
                    }
                });
            });
        }

        // Remove duplicates
        const seen = new Set();
        return options.filter(opt => {
            const k = opt.value.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    /**
     * Get the primary website URL for the active prospect
     */
    getPrimaryWebsiteForActiveProspect() {
        const contact = this.getActiveContact?.() || this.currentContact;
        if (!contact || !contact.website) return null;
        let url = String(contact.website).trim();
        if (!/^https?:\/\//i.test(url)) {
            url = 'https://' + url;
        }
        return url;
    }

    /**
     * Handle Call channel button
     */
    handleCallChannel() {
        const options = this.getAllPhoneOptionsForActiveProspect();
        if (!options.length) {
            console.warn('No phone numbers for this prospect.');
            return;
        }
        if (options.length === 1) {
            const num = options[0].value;
            window.location.href = 'tel:' + num.replace(/\s+/g, '');
            return;
        }
        this.openChannelSheet(options, 'Choose number', (opt) => {
            const num = opt.value;
            window.location.href = 'tel:' + num.replace(/\s+/g, '');
        });
    }

    /**
     * Handle Message channel button
     */
    handleMessageChannel() {
        const options = this.getAllPhoneOptionsForActiveProspect();
        if (!options.length) {
            console.warn('No phone numbers for this prospect.');
            return;
        }
        if (options.length === 1) {
            const num = options[0].value;
            window.location.href = 'sms:' + num.replace(/\s+/g, '');
            return;
        }
        this.openChannelSheet(options, 'Choose number', (opt) => {
            const num = opt.value;
            window.location.href = 'sms:' + num.replace(/\s+/g, '');
        });
    }

    /**
     * Handle Email channel button
     */
    handleEmailChannel() {
        const options = this.getAllEmailOptionsForActiveProspect();
        if (!options.length) {
            console.warn('No emails for this prospect.');
            return;
        }
        if (options.length === 1) {
            const addr = options[0].value;
            window.location.href = 'mailto:' + addr;
            return;
        }
        this.openChannelSheet(options, 'Choose email', (opt) => {
            const addr = opt.value;
            window.location.href = 'mailto:' + addr;
        });
    }

    /**
     * Handle Website channel button
     */
    handleWebsiteChannel() {
        const url = this.getPrimaryWebsiteForActiveProspect();
        if (!url) {
            console.warn('No website for this prospect.');
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    /**
     * Bind channel buttons to their handlers
     * Called after rendering prospect profile
     */
    bindChannelButtons() {
        const callBtn = document.getElementById('channel-call');
        const msgBtn = document.getElementById('channel-message');
        const emailBtn = document.getElementById('channel-email');
        const webBtn = document.getElementById('channel-website');

        if (callBtn) {
            callBtn.onclick = () => this.handleCallChannel();
        }
        if (msgBtn) {
            msgBtn.onclick = () => this.handleMessageChannel();
        }
        if (emailBtn) {
            emailBtn.onclick = () => this.handleEmailChannel();
        }
        if (webBtn) {
            webBtn.onclick = () => this.handleWebsiteChannel();
        }
    }

    /**
     * Handle channel click with multi-option support (legacy)
     */
    handleChannelClick(type, contact) {
        if (type === 'call') {
            this.handleCallChannel();
        } else if (type === 'message') {
            this.handleMessageChannel();
        } else if (type === 'email') {
            this.handleEmailChannel();
        } else if (type === 'website') {
            this.handleWebsiteChannel();
        }
    }

    renderDetailsGroups(contact, helpers) {
        const { displayCompany, displayContact, displayTitle, primaryEmail, websiteHref, fullAddress } = helpers;

        // Helper to render a single detail row
        const renderRow = (label, value, options = {}) => {
            const { isLink = false, href = '', isCore = false } = options;
            const hasValue = value && value.trim() && value.trim() !== '—';
            
            // Hide non-core empty fields
            if (!hasValue && !isCore) return '';
            
            let valueHtml;
            if (hasValue) {
                if (isLink && href) {
                    valueHtml = `<a href="${href}" ${options.external ? 'target="_blank" rel="noopener noreferrer"' : ''}>${value}</a>`;
                } else {
                    valueHtml = value;
                }
                valueHtml = `<div class="details-value">${valueHtml}</div>`;
            } else {
                valueHtml = `<div class="details-value-muted">Not set</div>`;
            }

            return `
                <div class="details-row">
                    <div class="details-label">${label}</div>
                    ${valueHtml}
                </div>
            `;
        };

        // Organization group
        const orgRows = [
            renderRow('Company', displayCompany || '', { isCore: true }),
            renderRow('Segment', contact.segment || ''),
            renderRow('Project', contact.project || '', { isCore: true }),
            renderRow('Lead Source', contact.leadSource || '')
        ].filter(Boolean).join('');

        // People & Contact group
        const phoneHtml = this.renderPhoneNumbers(contact.phone);
        const hasPhone = phoneHtml && phoneHtml !== '—';
        
        const peopleRows = [
            renderRow('Contact', displayContact || ''),
            renderRow('Title', displayTitle || ''),
            primaryEmail 
                ? `<div class="details-row">
                    <div class="details-label">Email</div>
                    <div class="details-value"><a href="mailto:${primaryEmail}">${primaryEmail}</a></div>
                   </div>`
                : '',
            hasPhone 
                ? `<div class="details-row">
                    <div class="details-label">Phone</div>
                    <div class="details-value">${phoneHtml}</div>
                   </div>`
                : ''
        ].filter(Boolean).join('');

        // Additional contacts (people array)
        const people = Array.isArray(contact.people) ? contact.people : [];
        let extraPeopleHtml = '';
        if (people.length > 0) {
            extraPeopleHtml += `
                <div class="prospect-subsection-header">Other Contacts</div>
                <div class="prospect-people-list">
            `;
            people.forEach((p) => {
                const name = p.name || '';
                const role = p.role || '';
                const email = p.email || '';
                const phone = p.phone || '';

                extraPeopleHtml += `
                    <div class="prospect-person-row">
                        <div class="prospect-person-main">
                            ${name ? `<div class="prospect-person-name">${this.escapeHtml(name)}</div>` : ''}
                            ${role ? `<div class="prospect-person-role">${this.escapeHtml(role)}</div>` : ''}
                            ${email ? `<div class="prospect-person-email"><a href="mailto:${this.escapeHtml(email)}">${this.escapeHtml(email)}</a></div>` : ''}
                            ${phone ? `<div class="prospect-person-phone"><a href="tel:${phone.replace(/[^0-9+]/g, '')}">${this.escapeHtml(phone)}</a></div>` : ''}
                        </div>
                    </div>
                `;
            });
            extraPeopleHtml += `</div>`;
        }

        // Web & Location group
        const webRows = [
            websiteHref 
                ? `<div class="details-row">
                    <div class="details-label">Website</div>
                    <div class="details-value"><a href="${websiteHref}" target="_blank" rel="noopener noreferrer">${websiteHref}</a></div>
                   </div>`
                : '',
            fullAddress 
                ? `<div class="details-row">
                    <div class="details-label">Address</div>
                    <div class="details-value">${fullAddress}</div>
                   </div>`
                : ''
        ].filter(Boolean).join('');

        // Build groups HTML, hiding empty groups
        let groupsHtml = '';

        if (orgRows) {
            groupsHtml += `
                <div class="details-group">
                    <div class="details-group-title">Organization</div>
                    <div class="details-rows-grid">${orgRows}</div>
                </div>
            `;
        }

        if (peopleRows || extraPeopleHtml) {
            groupsHtml += `
                <div class="details-group">
                    <div class="details-group-title">People & Contact</div>
                    ${peopleRows ? `<div class="details-rows-grid">${peopleRows}</div>` : ''}
                    ${extraPeopleHtml}
                </div>
            `;
        }

        if (webRows) {
            groupsHtml += `
                <div class="details-group">
                    <div class="details-group-title">Web & Location</div>
                    <div class="details-rows-grid">${webRows}</div>
                </div>
            `;
        }

        return groupsHtml || '<p class="details-value-muted">No details available.</p>';
    }

    showProspectProfile(contactId) {
        if (!contactId) return;
        this.activeContactId = contactId;
        this.currentContact = this.contacts.find(c => c.id === contactId) || null;

        const profileView = document.getElementById('prospect-profile-view');
        if (!profileView) return;

        // Conceptually treat prospect profile as part of Contacts
        this.showPage('contacts');
        const contactsPage = document.getElementById('contacts-page');
        if (contactsPage) {
            contactsPage.classList.remove('active');
        }
        profileView.classList.remove('hidden');

        this.renderProspectProfileView();
    }

    exitProspectProfile() {
        this.activeContactId = null;
        const profileView = document.getElementById('prospect-profile-view');
        if (profileView) {
            profileView.classList.add('hidden');
            profileView.innerHTML = '';
        }
        this.showPage('contacts');
    }

    renderProspectProfileView() {
        const container = document.getElementById('prospect-profile-view');
        if (!container) return;

        const contact = this.getActiveContact();
        if (!contact) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        // Expose the active prospect globally so enrichment can use it
        window.appState = window.appState || {};
        window.appState.selectedContact = contact;

        container.classList.remove('hidden');

        const displayCompany = (contact.vendorName || contact.companyName || '').trim();
        const displayContact = (contact.contactName || '').trim();
        const displayTitle = (contact.title || '').trim();

        const primaryName = displayCompany || displayContact || '(No name)';
        const secondaryLine = displayContact && displayTitle
            ? `${displayContact} · ${displayTitle}`
            : (displayContact || displayTitle || '');

        const metaParts = [];
        if (contact.category) metaParts.push(contact.category);
        if (contact.segment) metaParts.push(contact.segment);
        const metaLine = metaParts.join(' • ');

        // Normalize all contact data
        const allPhones = this.normalizeContactPhones(contact);
        const allEmails = this.normalizeContactEmails(contact);
        
        const primaryEmail = allEmails[0]?.email || '';
        const primaryPhone = allPhones[0]?.number || '';
        const telHref = primaryPhone ? primaryPhone.replace(/[^0-9+]/g, '') : '';

        const addressParts = [
            contact.address,
            contact.city,
            contact.state,
            contact.zipCode
        ].filter(Boolean);
        const fullAddress = addressParts.join(', ');
        const mapsHref = fullAddress
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`
            : '';

        const normalizeWebUrl = (raw) => {
            if (!raw) return '';
            const trimmed = String(raw).trim();
            if (!trimmed) return '';
            if (/^https?:\/\//i.test(trimmed)) return trimmed;
            return `https://${trimmed}`;
        };

        const websiteHref = normalizeWebUrl(contact.website || '');

        const activities = this.getActivitiesForContact(contact.id);
        const tasks = this.getTasksForContact(contact.id);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayKey = today.toISOString().slice(0, 10);

        const overdueTasks = tasks.filter(t => t.dueDate && t.dueDate < todayKey && t.status !== 'completed');
        const todayTasks = tasks.filter(t => t.dueDate === todayKey && t.status !== 'completed');
        const upcomingTasks = tasks.filter(t => t.dueDate && t.dueDate > todayKey && t.status !== 'completed');

        const renderTaskGroup = (label, group, colorClass = '') => {
            if (!group.length) return '';
            return `
                <div class="prospect-task-group ${colorClass}">
                    <div class="prospect-task-group-label">${label}</div>
                    <div class="prospect-tasks-list">
                        ${group.map(t => {
                            const dueLabel = t.dueDate ? this.formatDate(t.dueDate) : 'No due date';
                            return `
                                <div class="prospect-task-item">
                                    <div class="prospect-task-checkbox">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <circle cx="12" cy="12" r="9"/>
                                        </svg>
                                    </div>
                                    <div class="prospect-task-main">
                                        <div class="prospect-task-title">${this.escapeHtml(t.title)}</div>
                                        <div class="prospect-task-due">${dueLabel}</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        };

        const linkedinHref = normalizeWebUrl(contact.linkedin || '');
        const facebookHref = normalizeWebUrl(contact.facebook || '');

        const twitterHref = (() => {
            const raw = contact.twitter || '';
            if (!raw) return '';
            const trimmed = raw.trim();
            if (!trimmed) return '';
            if (/^https?:\/\//i.test(trimmed)) return trimmed;
            const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
            return `https://x.com/${handle}`;
        })();

        // Check if we have any channels to show
        const hasChannels = allPhones.length > 0 || allEmails.length > 0 || websiteHref;

        // Build Channels card HTML with multi-select buttons
        const channelsHtml = `
            <div class="prospect-channels-grid">
                <button type="button" class="prospect-channel-btn ${allPhones.length === 0 ? 'disabled' : ''}" id="channel-call" ${allPhones.length === 0 ? 'disabled' : ''}>
                    <svg class="prospect-channel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M2.25 6.75c0 8.284 6.716 15 15 15h1.5a2.25 2.25 0 0 0 2.25-2.25v-1.086c0-.516-.351-.966-.852-1.091l-3.423-.856a1.125 1.125 0 0 0-1.173.417l-.97 1.293a1.125 1.125 0 0 1-1.21.38 12.035 12.035 0 0 1-7.143-7.143 1.125 1.125 0 0 1 .38-1.21l1.293-.97a1.125 1.125 0 0 0 .417-1.173L7.677 3.102A1.125 1.125 0 0 0 6.586 2.25H5.25A3 3 0 0 0 2.25 5.25v1.5Z"/>
                    </svg>
                    <span class="prospect-channel-label">Call</span>
                </button>
                <button type="button" class="prospect-channel-btn ${allPhones.length === 0 ? 'disabled' : ''}" id="channel-message" ${allPhones.length === 0 ? 'disabled' : ''}>
                    <svg class="prospect-channel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 21c5.523 0 10-4.03 10-9s-4.477-9-10-9S2 7.03 2 12c0 2.14.832 4.1 2.217 5.6L3 21l4.163-1.325A10.68 10.68 0 0 0 12 21Z"/>
                    </svg>
                    <span class="prospect-channel-label">Message</span>
                </button>
                <button type="button" class="prospect-channel-btn ${allEmails.length === 0 ? 'disabled' : ''}" id="channel-email" ${allEmails.length === 0 ? 'disabled' : ''}>
                    <svg class="prospect-channel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21.75 6.75v10.5A2.25 2.25 0 0 1 19.5 19.5h-15A2.25 2.25 0 0 1 2.25 17.25V6.75A2.25 2.25 0 0 1 4.5 4.5h15A2.25 2.25 0 0 1 21.75 6.75Z"/>
                        <path d="M5.25 6.75 12 12l6.75-5.25"/>
                    </svg>
                    <span class="prospect-channel-label">Email</span>
                </button>
                <button type="button" class="prospect-channel-btn ${!websiteHref ? 'disabled' : ''}" id="channel-website" ${!websiteHref ? 'disabled' : ''}>
                    <svg class="prospect-channel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/>
                        <path d="M3.6 9h16.8M3.6 15h16.8M12 3a15.3 15.3 0 0 1 4.5 9A15.3 15.3 0 0 1 12 21a15.3 15.3 0 0 1-4.5-9A15.3 15.3 0 0 1 12 3Z"/>
                    </svg>
                    <span class="prospect-channel-label">Website</span>
                </button>
            </div>
        `;

        // Build Prospect Info card
        const prospectInfoHtml = `
            <div class="info-rows">
                ${contact.category ? `
                    <div class="info-row">
                        <div class="info-label">Category</div>
                        <div class="info-value">${this.escapeHtml(contact.category)}</div>
                    </div>
                ` : ''}
                ${contact.segment ? `
                    <div class="info-row">
                        <div class="info-label">Segment</div>
                        <div class="info-value">${this.escapeHtml(contact.segment)}</div>
                    </div>
                ` : ''}
                ${contact.project ? `
                    <div class="info-row">
                        <div class="info-label">Project</div>
                        <div class="info-value">${this.escapeHtml(contact.project)}</div>
                    </div>
                ` : ''}
                ${contact.leadSource ? `
                    <div class="info-row">
                        <div class="info-label">Lead Source</div>
                        <div class="info-value">${this.escapeHtml(contact.leadSource)}</div>
                    </div>
                ` : ''}
            </div>
        `;

        // Build Contact Information card (org-level)
        const orgEmails = allEmails.filter(e => e.source === 'org');
        const orgPhones = allPhones.filter(p => p.source === 'org');
        
        let contactInfoHtml = '<div class="contact-info-sections">';
        
        // Emails section
        if (orgEmails.length > 0) {
            contactInfoHtml += `
                <div class="contact-info-section">
                    <div class="contact-info-section-label">Emails</div>
                    ${orgEmails.map(e => `
                        <a href="mailto:${this.escapeHtml(e.email)}" class="contact-info-row clickable">
                            <svg class="contact-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M21.75 6.75v10.5A2.25 2.25 0 0 1 19.5 19.5h-15A2.25 2.25 0 0 1 2.25 17.25V6.75A2.25 2.25 0 0 1 4.5 4.5h15A2.25 2.25 0 0 1 21.75 6.75Z"/>
                                <path d="M5.25 6.75 12 12l6.75-5.25"/>
                            </svg>
                            <span class="contact-info-text">${this.escapeHtml(e.email)}</span>
                            <svg class="contact-info-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="m9 18 6-6-6-6"/>
                            </svg>
                        </a>
                    `).join('')}
                </div>
            `;
        }
        
        // Phone Numbers section
        if (orgPhones.length > 0) {
            contactInfoHtml += `
                <div class="contact-info-section">
                    <div class="contact-info-section-label">Phone Numbers</div>
                    ${orgPhones.map(p => `
                        <a href="tel:${p.number.replace(/[^0-9+]/g, '')}" class="contact-info-row clickable">
                            <svg class="contact-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M2.25 6.75c0 8.284 6.716 15 15 15h1.5a2.25 2.25 0 0 0 2.25-2.25v-1.086c0-.516-.351-.966-.852-1.091l-3.423-.856a1.125 1.125 0 0 0-1.173.417l-.97 1.293a1.125 1.125 0 0 1-1.21.38 12.035 12.035 0 0 1-7.143-7.143 1.125 1.125 0 0 1 .38-1.21l1.293-.97a1.125 1.125 0 0 0 .417-1.173L7.677 3.102A1.125 1.125 0 0 0 6.586 2.25H5.25A3 3 0 0 0 2.25 5.25v1.5Z"/>
                            </svg>
                            <div class="contact-info-text-group">
                                <span class="contact-info-text">${this.escapeHtml(p.number)}</span>
                                ${p.label !== 'Main' ? `<span class="contact-info-sublabel">${this.escapeHtml(p.label)}</span>` : ''}
                            </div>
                            <svg class="contact-info-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="m9 18 6-6-6-6"/>
                            </svg>
                        </a>
                    `).join('')}
                </div>
            `;
        }
        
        // Location section
        if (fullAddress) {
            contactInfoHtml += `
                <div class="contact-info-section">
                    <div class="contact-info-section-label">Location</div>
                    <div class="contact-info-row">
                        <svg class="contact-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M12 21.75s-6.75-4.5-6.75-10.125A6.75 6.75 0 0 1 12 4.125a6.75 6.75 0 0 1 6.75 7.5C18.75 17.25 12 21.75 12 21.75Z"/>
                            <path d="M12 13.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"/>
                        </svg>
                        <span class="contact-info-text">${this.escapeHtml(fullAddress)}</span>
                    </div>
                    ${mapsHref ? `
                        <a href="${mapsHref}" target="_blank" rel="noopener noreferrer" class="contact-info-link">
                            Open in Maps →
                        </a>
                    ` : ''}
                </div>
            `;
        }
        
        // Website section
        if (websiteHref) {
            const displayUrl = websiteHref.replace(/^https?:\/\//, '').replace(/\/$/, '');
            contactInfoHtml += `
                <div class="contact-info-section">
                    <div class="contact-info-section-label">Website</div>
                    <a href="${websiteHref}" target="_blank" rel="noopener noreferrer" class="contact-info-row clickable">
                        <svg class="contact-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/>
                            <path d="M3.6 9h16.8M3.6 15h16.8M12 3a15.3 15.3 0 0 1 4.5 9A15.3 15.3 0 0 1 12 21a15.3 15.3 0 0 1-4.5-9A15.3 15.3 0 0 1 12 3Z"/>
                        </svg>
                        <span class="contact-info-text">${this.escapeHtml(displayUrl)}</span>
                        <svg class="contact-info-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="m9 18 6-6-6-6"/>
                        </svg>
                    </a>
                </div>
            `;
        }
        
        // Social links
        const socialLinks = [];
        if (linkedinHref) socialLinks.push({ href: linkedinHref, label: 'LinkedIn', icon: 'icons/linkedin-icon.svg' });
        if (facebookHref) socialLinks.push({ href: facebookHref, label: 'Facebook', icon: 'icons/facebook-icon.svg' });
        if (twitterHref) socialLinks.push({ href: twitterHref, label: 'X (Twitter)', icon: 'icons/x-icon.svg' });
        
        if (socialLinks.length > 0) {
            contactInfoHtml += `
                <div class="contact-info-section">
                    <div class="contact-info-section-label">Social</div>
                    <div class="contact-info-social-row">
                        ${socialLinks.map(s => `
                            <a href="${s.href}" target="_blank" rel="noopener noreferrer" class="contact-info-social-btn" aria-label="${s.label}">
                                <img src="${s.icon}" alt="" class="contact-info-social-icon" />
                            </a>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        contactInfoHtml += '</div>';
        
        const hasContactInfo = orgEmails.length > 0 || orgPhones.length > 0 || fullAddress || websiteHref || socialLinks.length > 0;

        // Build People card
        const people = Array.isArray(contact.people) ? contact.people : [];
        // Also include primary contact as a "person" if they have name
        const allPeople = [];
        if (displayContact) {
            const primaryEmails = allEmails.filter(e => e.source === 'primary').map(e => e.email);
            const primaryPhones = allPhones.filter(p => p.source === 'primary').map(p => p.number);
            allPeople.push({
                name: displayContact,
                role: displayTitle,
                emails: primaryEmails.length > 0 ? primaryEmails : (primaryEmail && !orgEmails.find(e => e.email === primaryEmail) ? [primaryEmail] : []),
                phones: primaryPhones,
                linkedin: contact.linkedin || '',
                isPrimary: true
            });
        }
        people.forEach(p => {
            allPeople.push({
                name: p.name || '',
                role: p.role || '',
                emails: Array.isArray(p.emails) ? p.emails : (p.email ? [p.email] : []),
                phones: Array.isArray(p.phones) ? p.phones : (p.phone ? [p.phone] : []),
                linkedin: p.linkedin || '',
                isPrimary: false
            });
        });

        let peopleHtml = '';
        if (allPeople.length > 0) {
            peopleHtml = `
                <div class="people-list">
                    ${allPeople.map(person => `
                        <div class="person-card ${person.isPrimary ? 'person-card-primary' : ''}">
                            <div class="person-header">
                                <div class="person-avatar">
                                    ${(person.name || '?').charAt(0).toUpperCase()}
                                </div>
                                <div class="person-info">
                                    <div class="person-name">${this.escapeHtml(person.name || 'Unknown')}</div>
                                    ${person.role ? `<div class="person-role">${this.escapeHtml(person.role)}</div>` : ''}
                                    ${person.isPrimary ? `<span class="person-badge">Primary</span>` : ''}
                                </div>
                            </div>
                            ${person.emails.length > 0 || person.phones.length > 0 || person.linkedin ? `
                                <div class="person-contact-list">
                                    ${person.emails.map(email => `
                                        <a href="mailto:${this.escapeHtml(email)}" class="person-contact-row">
                                            <svg class="person-contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                                <path d="M21.75 6.75v10.5A2.25 2.25 0 0 1 19.5 19.5h-15A2.25 2.25 0 0 1 2.25 17.25V6.75A2.25 2.25 0 0 1 4.5 4.5h15A2.25 2.25 0 0 1 21.75 6.75Z"/>
                                                <path d="M5.25 6.75 12 12l6.75-5.25"/>
                                            </svg>
                                            <span>${this.escapeHtml(email)}</span>
                                        </a>
                                    `).join('')}
                                    ${person.phones.map(phone => `
                                        <a href="tel:${phone.replace(/[^0-9+]/g, '')}" class="person-contact-row">
                                            <svg class="person-contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                                <path d="M2.25 6.75c0 8.284 6.716 15 15 15h1.5a2.25 2.25 0 0 0 2.25-2.25v-1.086c0-.516-.351-.966-.852-1.091l-3.423-.856a1.125 1.125 0 0 0-1.173.417l-.97 1.293a1.125 1.125 0 0 1-1.21.38 12.035 12.035 0 0 1-7.143-7.143 1.125 1.125 0 0 1 .38-1.21l1.293-.97a1.125 1.125 0 0 0 .417-1.173L7.677 3.102A1.125 1.125 0 0 0 6.586 2.25H5.25A3 3 0 0 0 2.25 5.25v1.5Z"/>
                                            </svg>
                                            <span>${this.escapeHtml(phone)}</span>
                                        </a>
                                    `).join('')}
                                    ${person.linkedin ? `
                                        <a href="${normalizeWebUrl(person.linkedin)}" target="_blank" rel="noopener noreferrer" class="person-contact-row">
                                            <img src="icons/linkedin-icon.svg" alt="" class="person-contact-icon-img" />
                                            <span>LinkedIn Profile</span>
                                        </a>
                                    ` : ''}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            peopleHtml = `<p class="empty-state">No people added yet.</p>`;
        }

        const activitiesHtml = activities.length
            ? `
                <div class="prospect-activity-list">
                    ${activities.map(a => {
                        const icon = (() => {
                            const type = (a.type || '').toLowerCase();
                            if (type.includes('email')) return `
                                <svg class="prospect-activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21.75 6.75v10.5A2.25 2.25 0 0 1 19.5 19.5h-15A2.25 2.25 0 0 1 2.25 17.25V6.75A2.25 2.25 0 0 1 4.5 4.5h15A2.25 2.25 0 0 1 21.75 6.75Z"/>
                                    <path d="M5.25 6.75 12 12l6.75-5.25"/>
                                </svg>`;
                            if (type.includes('phone') || type.includes('call')) return `
                                <svg class="prospect-activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M2.25 6.75c0 8.284 6.716 15 15 15h1.5a2.25 2.25 0 0 0 2.25-2.25v-1.086c0-.516-.351-.966-.852-1.091l-3.423-.856a1.125 1.125 0 0 0-1.173.417l-.97 1.293a1.125 1.125 0 0 1-1.21.38 12.035 12.035 0 0 1-7.143-7.143 1.125 1.125 0 0 1 .38-1.21l1.293-.97a1.125 1.125 0 0 0 .417-1.173L7.677 3.102A1.125 1.125 0 0 0 6.586 2.25H5.25A3 3 0 0 0 2.25 5.25v1.5Z"/>
                                </svg>`;
                            return `
                                <svg class="prospect-activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M16.862 3.487a2.25 2.25 0 0 1 3.182 3.182L8.999 17.714 5.25 18.75l1.036-3.75 10.576-11.513Z"/>
                                </svg>`;
                        })();
                        return `
                            <div class="prospect-activity-item">
                                <div class="prospect-activity-icon-wrap">
                                    ${icon}
                                </div>
                                <div class="prospect-activity-main">
                                    <div class="prospect-activity-title">${this.escapeHtml(a.type || 'Activity')}</div>
                                    <div class="prospect-activity-meta">${this.formatDate(a.date)}</div>
                                    ${a.notes ? `<div class="prospect-activity-notes">${this.escapeHtml(this.truncateText(a.notes, 140))}</div>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `
            : `<p class="empty-state"><span class="prospect-empty-title">No activity yet.</span><br/><span class="prospect-empty-sub">Log a call, email, or note when you touch this prospect.</span></p>`;

        const tasksHtml = (overdueTasks.length || todayTasks.length || upcomingTasks.length)
            ? `
                ${renderTaskGroup('Overdue', overdueTasks, 'task-group-overdue')}
                ${renderTaskGroup('Today', todayTasks, 'task-group-today')}
                ${renderTaskGroup('Upcoming', upcomingTasks, 'task-group-upcoming')}
            `
            : `<p class="empty-state"><span class="prospect-empty-title">No tasks yet.</span><br/><span class="prospect-empty-sub">Add a follow-up so you don't lose this lead.</span></p>`;

        container.innerHTML = `
            <!-- Header card -->
            <article class="card prospect-card prospect-profile-header-card">
                <div class="prospect-header-top">
                    <button type="button" class="prospect-back-link" data-role="back-to-contacts">
                        ← Contacts
                    </button>
                    <button type="button" class="icon-button" data-role="edit-prospect" aria-label="Edit prospect">
                        <svg class="icon-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M16.862 3.487a2.25 2.25 0 0 1 3.182 3.182L8.999 17.714 5.25 18.75l1.036-3.75 10.576-11.513Z"/>
                            <path d="M19.5 10.5v9.75A1.75 1.75 0 0 1 17.75 22H4.75A1.75 1.75 0 0 1 3 20.25V7.25A1.75 1.75 0 0 1 4.75 5.5h9.75"/>
                        </svg>
                    </button>
                </div>
                <div class="overline-label">PROSPECT</div>
                <h2 class="heading-h2 prospect-title">${this.escapeHtml(primaryName)}</h2>
                ${secondaryLine ? `<p class="prospect-subtitle">${this.escapeHtml(secondaryLine)}</p>` : ''}
                <div class="prospect-chips">
                    ${contact.status ? `<span class="chip chip-status">${this.escapeHtml(contact.status)}</span>` : ''}
                    ${contact.category ? `<span class="chip chip-category">${this.escapeHtml(contact.category)}</span>` : ''}
                </div>
            </article>

            <!-- Channels card -->
            <article class="card prospect-card">
                <div class="prospect-section-header">
                    <div class="overline-label">CHANNELS</div>
                </div>
                ${channelsHtml}
            </article>

            <!-- Prospect Info card -->
            <article class="card prospect-card">
                <div class="prospect-section-header">
                    <div class="overline-label">PROSPECT INFO</div>
                </div>
                ${prospectInfoHtml}
            </article>

            <!-- Contact Information card -->
            ${hasContactInfo ? `
                <article class="card prospect-card">
                    <div class="prospect-section-header">
                        <div class="overline-label">CONTACT INFORMATION</div>
                    </div>
                    ${contactInfoHtml}
                </article>
            ` : ''}

            <!-- People card -->
            <article class="card prospect-card">
                <div class="prospect-section-header">
                    <div class="overline-label">PEOPLE</div>
                    <button type="button" class="btn btn-sm btn-secondary" data-role="add-person">
                        + Add Person
                    </button>
                </div>
                ${peopleHtml}
            </article>

            <!-- AI Tools card -->
            <article class="card prospect-card ai-tools-card" id="prospect-enrichment-card">
                <div class="prospect-section-header">
                    <div class="overline-label">AI TOOLS</div>
                </div>

                <!-- OpenAI Actions row -->
                <div class="ai-subsection">
                    <div class="ai-subtitle ai-openai-subtitle">
                        <span class="ai-subtitle-icon">
                            <img src="icons/head-chatgpt-icon.svg" alt="" class="ai-subtitle-icon-img" aria-hidden="true" />
                        </span>
                        <span class="ai-subtitle-text">OpenAI Actions</span>
                    </div>
                    <div class="ai-actions-row">
                        <button type="button" class="btn btn-ai btn-ai-secondary" id="btn-ai-company-research" data-action="ai-company-research" aria-label="Company Research">
                            <span class="btn-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l3.2 3.2a1 1 0 0 1-1.4 1.4l-3.2-3.2A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z" fill="currentColor"/>
                                </svg>
                            </span>
                            <span class="btn-label">Company Research</span>
                        </button>
                        <button type="button" class="btn btn-ai btn-ai-primary" id="btn-ai-outreach" data-action="ai-outreach" aria-label="Outreach">
                            <span class="btn-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M4 5.75A2.75 2.75 0 0 1 6.75 3h10.5A2.75 2.75 0 0 1 20 5.75v6.5A2.75 2.75 0 0 1 17.25 15H9.5l-2.7 2.7A1 1 0 0 1 5 17v-2.25A2.75 2.75 0 0 1 4 12.25v-6.5z" fill="currentColor"/>
                                </svg>
                            </span>
                            <span class="btn-label">Outreach</span>
                        </button>
                    </div>
                </div>

                <!-- Prospect Intelligence row -->
                <div class="ai-subsection ai-intel">
                    <div class="ai-intel-header">
                        <div class="ai-subtitle">Prospect Intelligence</div>
                        <button type="button" class="ai-intel-refresh-btn" id="enrich-refresh-btn" title="Refresh intelligence" aria-label="Refresh prospect intelligence">
                            <img src="icons/20-refresh.svg" alt="" class="ai-refresh-icon" aria-hidden="true" />
                        </button>
                    </div>
                    <div class="ai-intel-button-row">
                        <button type="button" class="btn btn-intel btn-intel-primary" id="btn-enrich-perplexity" data-provider="perplexity" title="Use AI to complete missing fields and surface key contacts" aria-label="Prospect Insight">
                            <img src="icons/white-perplexity-icon.svg" alt="" class="ai-intel-icon" aria-hidden="true" />
                            <span class="btn-label">Prospect Insight</span>
                        </button>
                        <button type="button" class="btn btn-intel btn-intel-secondary" id="btn-enrich-grok" data-provider="grok" title="Use AI to deliver deeper organizational insight" aria-label="Full Insight">
                            <img src="icons/Grok-icon.svg" alt="" class="ai-intel-icon" aria-hidden="true" />
                            <span class="btn-label">Full Insight</span>
                        </button>
                    </div>
                    <div class="ai-intel-description">
                        Use AI to complete missing profile fields, surface key contacts, and deliver deeper organizational insight.
                    </div>
                </div>

                <!-- Result panel -->
                <div id="ai-enrich-result" class="ai-enrich-result"></div>
            </article>

            <!-- Activity card -->
            <article class="card prospect-card">
                <div class="prospect-section-header">
                    <div class="overline-label">ACTIVITY</div>
                    <button type="button" class="btn btn-secondary btn-sm" data-role="log-activity">
                        + Log Activity
                    </button>
                </div>
                ${activitiesHtml}
            </article>

            <!-- Tasks card -->
            <article class="card prospect-card">
                <div class="prospect-section-header">
                    <div class="overline-label">TASKS</div>
                    <button type="button" class="btn btn-secondary btn-sm" data-role="add-task">
                        + Add Task
                    </button>
                </div>
                ${tasksHtml}
            </article>
        `;

        // Scroll to top on mobile so header and channels are visible
        if (window.innerWidth <= 768) {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }

        // Back navigation
        const backBtn = container.querySelector('[data-role="back-to-contacts"]');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.exitProspectProfile());
        }

        // Edit profile (header pencil + Edit details)
        container.querySelectorAll('[data-role="edit-prospect"]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openContactSheet('edit', contact.id);
            });
        });

        // Details expand/collapse
        const detailsToggle = container.querySelector('.prospect-details-toggle');
        if (detailsToggle) {
            detailsToggle.addEventListener('click', () => {
                this._prospectDetailsExpanded = !this._prospectDetailsExpanded;
                this.renderProspectProfileView();
            });
        }

        // Channel buttons with multi-select support
        this.bindChannelButtons();

        // Activity / tasks actions
        const logActivityBtn = container.querySelector('[data-role="log-activity"]');
        if (logActivityBtn) {
            logActivityBtn.addEventListener('click', () => this.logActivity(contact.id));
        }
        const addTaskBtn = container.querySelector('[data-role="add-task"]');
        if (addTaskBtn) {
            addTaskBtn.addEventListener('click', () => this.openTaskForContact(contact.id));
        }

        // Add Person button (open edit modal for now)
        const addPersonBtn = container.querySelector('[data-role="add-person"]');
        if (addPersonBtn) {
            addPersonBtn.addEventListener('click', () => {
                this.openContactSheet('edit', contact.id);
            });
        }

        // AI & enrichment actions
        container.querySelectorAll('[data-action]').forEach(btn => {
            const action = btn.getAttribute('data-action');
            if (!action) return;
            if (action === 'ai-outreach') {
                btn.addEventListener('click', () => this.aiOutreach());
            } else if (action === 'ai-company-research') {
                btn.addEventListener('click', () => this.aiCompanyResearch());
            }
        });

        // Wire AI enrichment card within the prospect profile
        this.setupAIEnrichment();
    }

    /**
     * Set up AI enrichment actions for the current prospect (Perplexity + Grok).
     * Now uses text-based responses with rich formatting.
     * Results are cached in this.enrichmentCache so they persist across Edit modal open/close.
     */
    setupAIEnrichment() {
        const resultEl = document.getElementById('ai-enrich-result');
        const btnPerplexity = document.getElementById('btn-enrich-perplexity');
        const btnGrok = document.getElementById('btn-enrich-grok');
        if (!resultEl || !btnPerplexity || !btnGrok) return;

        const self = this;

        function getCurrentProspect() {
            if (window.appState && window.appState.selectedContact) {
                return window.appState.selectedContact;
            }
            return null;
        }

        // Helper to detect and make URLs clickable
        function linkifyText(text) {
            const urlPattern = /(https?:\/\/[^\s<>\[\]()]+)/gi;
            let result = text;
            result = result.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer" class="ai-link">$1</a>');
            result = result.replace(/(?<!href=")([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi, 
                '<a href="mailto:$1" class="ai-link ai-email">$1</a>');
            return result;
        }

        // ─────────────────────────────────────────────────────────────────────────
        // Quick Copy - Missing field-aware chips with emojis and SVG icons
        // ─────────────────────────────────────────────────────────────────────────

        const QUICK_COPY_FIELDS = [
            {
                key: 'name',
                label: 'Name',
                emoji: '👤',
                getOriginal: (c) => c.contactName || '',
                extractFromText: (text) => {
                    const nameMatch = text.match(/(?:contact|person|name)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i);
                    return nameMatch ? nameMatch[1].trim() : '';
                }
            },
            {
                key: 'email',
                label: 'Email',
                emoji: '✉️',
                getOriginal: (c) => c.email || '',
                extractFromText: (text) => {
                    const emailMatches = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi);
                    return emailMatches && emailMatches.length > 0 ? emailMatches[0] : '';
                }
            },
            {
                key: 'phone',
                label: 'Phone',
                emoji: '☎️',
                getOriginal: (c) => c.phone || '',
                extractFromText: (text) => {
                    const phoneMatches = text.match(/(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g);
                    if (phoneMatches) {
                        for (const phone of phoneMatches) {
                            const cleaned = phone.replace(/[^\d+]/g, '');
                            if (cleaned.length >= 10) return phone;
                        }
                    }
                    return '';
                }
            },
            {
                key: 'website',
                label: 'Website',
                emoji: '🌐',
                getOriginal: (c) => c.website || '',
                extractFromText: (text) => {
                    const urlMatches = text.match(/(https?:\/\/[^\s<>\[\]()]+)/gi) || [];
                    const nonSocial = urlMatches.find(u => 
                        !u.includes('linkedin.com') && 
                        !u.includes('facebook.com') && 
                        !u.includes('twitter.com') && 
                        !u.includes('x.com')
                    );
                    return nonSocial || '';
                }
            },
            {
                key: 'linkedin',
                label: 'LinkedIn',
                iconPath: 'icons/qc-linkedin.svg',
                getOriginal: (c) => c.linkedin || '',
                extractFromText: (text) => {
                    const match = text.match(/(https?:\/\/(?:www\.)?linkedin\.com\/[^\s<>\[\]()]+)/i);
                    return match ? match[1] : '';
                }
            },
            {
                key: 'facebook',
                label: 'Facebook',
                iconPath: 'icons/qc-facebook.svg',
                getOriginal: (c) => c.facebook || '',
                extractFromText: (text) => {
                    const match = text.match(/(https?:\/\/(?:www\.)?facebook\.com\/[^\s<>\[\]()]+)/i);
                    return match ? match[1] : '';
                }
            },
            {
                key: 'x',
                label: 'X',
                iconPath: 'icons/qc-x.svg',
                getOriginal: (c) => c.x || c.twitter || '',
                extractFromText: (text) => {
                    const xMatch = text.match(/(https?:\/\/(?:www\.)?x\.com\/[^\s<>\[\]()]+)/i);
                    if (xMatch) return xMatch[1];
                    const twitterMatch = text.match(/(https?:\/\/(?:www\.)?twitter\.com\/[^\s<>\[\]()]+)/i);
                    return twitterMatch ? twitterMatch[1] : '';
                }
            },
            {
                key: 'instagram',
                label: 'Instagram',
                iconPath: 'icons/qc-instagram.svg',
                getOriginal: (c) => c.instagram || '',
                extractFromText: (text) => {
                    const match = text.match(/(https?:\/\/(?:www\.)?instagram\.com\/[^\s<>\[\]()]+)/i);
                    return match ? match[1] : '';
                }
            },
            {
                key: 'youtube',
                label: 'YouTube',
                iconPath: 'icons/qc-youtube.svg',
                getOriginal: (c) => c.youtube || '',
                extractFromText: (text) => {
                    // Match youtube.com or youtu.be URLs
                    const match = text.match(/(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s<>\[\]()]+)/i);
                    return match ? match[1] : '';
                }
            },
            {
                key: 'location',
                label: 'Location',
                iconPath: 'icons/qc-location.svg',
                getOriginal: (c) => {
                    // Combine address fields from the contact
                    const parts = [];
                    if (c.address) parts.push(c.address);
                    if (c.city) parts.push(c.city);
                    if (c.state) parts.push(c.state);
                    if (c.zipCode) parts.push(c.zipCode);
                    return parts.join(', ');
                },
                extractFromText: (text) => {
                    // Look for address patterns in text
                    // Try to find "Address:" or "Location:" followed by text
                    const addressMatch = text.match(/(?:address|location|headquarters)[:\s]+([^,\n]+(?:,\s*[^,\n]+){0,3})/i);
                    if (addressMatch) return addressMatch[1].trim();
                    // Try city, state pattern
                    const cityStateMatch = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2}\s*\d{5})/);
                    if (cityStateMatch) return cityStateMatch[1];
                    return '';
                }
            }
        ];

        // Render quick copy row for missing fields
        function renderQuickCopyRow(contact, text, containerEl) {
            if (!contact || !text) return;

            const row = document.createElement('div');
            row.className = 'quick-copy-row';

            QUICK_COPY_FIELDS.forEach(field => {
                const originalVal = (field.getOriginal(contact) || '').trim();
                const enrichedVal = (field.extractFromText(text) || '').trim();

                if (!enrichedVal || originalVal) return;

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'quick-copy-chip';
                btn.title = `Copy ${field.label}: ${enrichedVal}`;
                btn.setAttribute('aria-label', `Copy ${field.label}`);

                if (field.iconPath) {
                    const img = document.createElement('img');
                    img.src = field.iconPath;
                    img.className = 'quick-copy-icon';
                    img.alt = field.label;
                    btn.appendChild(img);
                } else if (field.emoji) {
                    btn.textContent = field.emoji;
                } else {
                    btn.textContent = field.label;
                }

                btn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        await navigator.clipboard.writeText(enrichedVal);
                        btn.classList.add('copied');
                        const originalContent = btn.innerHTML;
                        btn.textContent = '✓';
                        setTimeout(() => {
                            btn.innerHTML = originalContent;
                            btn.classList.remove('copied');
                        }, 1500);
                    } catch (err) {
                        console.error('Clipboard copy failed', err);
                    }
                });

                row.appendChild(btn);
            });

            if (row.childNodes.length > 0) {
                const label = document.createElement('div');
                label.className = 'quick-copy-label';
                label.textContent = 'Quick copy (missing fields):';
                containerEl.appendChild(label);
                containerEl.appendChild(row);
            }
        }

        // Render text-based research results
        function renderResearchText(text, engine) {
            resultEl.innerHTML = '';

            if (!text || text.trim() === '') {
                const p = document.createElement('p');
                p.className = 'ai-muted';
                p.textContent = 'No research results available.';
                resultEl.appendChild(p);
                return;
            }

            const container = document.createElement('div');
            container.className = 'ai-research-container';

            const engineLabel = document.createElement('div');
            engineLabel.className = 'ai-engine-badge';
            engineLabel.innerHTML = `<span class="ai-engine-icon">${engine === 'perplexity' ? '🔍' : '⚡'}</span> ${engine === 'perplexity' ? 'Perplexity' : 'Grok'} Research`;
            container.appendChild(engineLabel);

            const contact = getCurrentProspect();
            renderQuickCopyRow(contact, text, container);

            const textContainer = document.createElement('div');
            textContainer.className = 'ai-research-text';

            let processedText = text
                .replace(/^## (.+)$/gm, '<h3 class="ai-research-heading">$1</h3>')
                .replace(/^### (.+)$/gm, '<h4 class="ai-research-subheading">$1</h4>')
                .replace(/^- (.+)$/gm, '<div class="ai-research-bullet">• $1</div>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n\n/g, '</p><p class="ai-research-para">')
                .replace(/\n/g, '<br>');

            processedText = linkifyText(processedText);
            textContainer.innerHTML = `<p class="ai-research-para">${processedText}</p>`;
            container.appendChild(textContainer);

            const copyAllBtn = document.createElement('button');
            copyAllBtn.type = 'button';
            copyAllBtn.className = 'btn btn-ghost ai-copy-all-btn';
            copyAllBtn.textContent = '📋 Copy Full Report';
            copyAllBtn.addEventListener('click', () => {
                navigator.clipboard?.writeText(text).then(() => {
                    copyAllBtn.textContent = '✓ Copied!';
                    setTimeout(() => { copyAllBtn.textContent = '📋 Copy Full Report'; }, 2000);
                });
            });
            container.appendChild(copyAllBtn);

            resultEl.appendChild(container);
        }

        function showLoading(engine) {
            resultEl.innerHTML = '';
            const loader = document.createElement('div');
            loader.className = 'ai-research-loading';
            loader.innerHTML = `
                <div class="ai-loading-spinner"></div>
                <p>Running ${engine === 'perplexity' ? 'Perplexity' : 'Grok'} deep research...</p>
                <p class="ai-muted">This may take 15-30 seconds for thorough results.</p>
            `;
            resultEl.appendChild(loader);
        }

        function showError(message) {
            resultEl.innerHTML = '';
            const errorEl = document.createElement('div');
            errorEl.className = 'ai-research-error';
            errorEl.innerHTML = `
                <p class="ai-error-icon">⚠️</p>
                <p>${message}</p>
            `;
            resultEl.appendChild(errorEl);
        }

        function updateButtonStates(activeBtn) {
            btnPerplexity.classList.toggle('is-active', activeBtn === 'perplexity');
            btnGrok.classList.toggle('is-active', activeBtn === 'grok');
        }

        // ─────────────────────────────────────────────────────────────────────────
        // Cache-aware enrichment functions
        // ─────────────────────────────────────────────────────────────────────────

        // Store result in cache
        function cacheResult(contactId, provider, text) {
            if (!contactId) return;
            self.enrichmentCache = self.enrichmentCache || {};
            const entry = self.enrichmentCache[contactId] || {};
            entry[provider] = text;
            entry.activeProvider = provider;
            self.enrichmentCache[contactId] = entry;
        }

        // Get cached result
        function getCachedResult(contactId, provider) {
            if (!contactId) return null;
            const entry = self.enrichmentCache?.[contactId];
            return entry?.[provider] || null;
        }

        // Handle provider button click - use cache if available, else fetch
        const handleProviderClick = async (provider) => {
            const contact = getCurrentProspect();
            if (!contact) {
                showError('No prospect selected. Please select a contact first.');
                return;
            }

            // Check cache first
            const cachedText = getCachedResult(contact.id, provider);
            if (cachedText) {
                // Render from cache without API call
                updateButtonStates(provider);
                renderResearchText(cachedText, provider);
                // Update active provider in cache
                const entry = self.enrichmentCache[contact.id] || {};
                entry.activeProvider = provider;
                self.enrichmentCache[contact.id] = entry;
                return;
            }

            // No cache, run API call
            updateButtonStates(provider);
            showLoading(provider);

            const endpoint = provider === 'perplexity' 
                ? 'https://adsell-openai-proxy.jgregorywalsh.workers.dev/perplexity/enrich'
                : 'https://adsell-openai-proxy.jgregorywalsh.workers.dev/grok/enrich';

            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contact })
                });

                const text = await res.text();
                
                if (!res.ok) {
                    showError(`${provider === 'perplexity' ? 'Perplexity' : 'Grok'} research failed: ${text}`);
                    return;
                }

                // Cache the result
                cacheResult(contact.id, provider, text);
                renderResearchText(text, provider);
            } catch (err) {
                console.error(`${provider} research error:`, err);
                showError(`Failed to complete research: ${err.message}`);
            }
        };

        // Wire button click handlers
        btnPerplexity.addEventListener('click', () => handleProviderClick('perplexity'));
        btnGrok.addEventListener('click', () => handleProviderClick('grok'));

        // ─────────────────────────────────────────────────────────────────────────
        // Refresh button - force re-run enrichment (clear cache for active provider)
        // ─────────────────────────────────────────────────────────────────────────

        const runEnrichFresh = async (provider) => {
            const contact = getCurrentProspect();
            if (!contact) {
                showError('No prospect selected. Please select a contact first.');
                return;
            }

            // Clear cached result for this provider
            if (self.enrichmentCache && self.enrichmentCache[contact.id]) {
                delete self.enrichmentCache[contact.id][provider];
            }

            // Force API call (bypass cache check)
            updateButtonStates(provider);
            showLoading(provider);

            const endpoint = provider === 'perplexity' 
                ? 'https://adsell-openai-proxy.jgregorywalsh.workers.dev/perplexity/enrich'
                : 'https://adsell-openai-proxy.jgregorywalsh.workers.dev/grok/enrich';

            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contact })
                });

                const text = await res.text();
                
                if (!res.ok) {
                    showError(`${provider === 'perplexity' ? 'Perplexity' : 'Grok'} research failed: ${text}`);
                    return;
                }

                cacheResult(contact.id, provider, text);
                renderResearchText(text, provider);
            } catch (err) {
                console.error(`${provider} research error:`, err);
                showError(`Failed to complete research: ${err.message}`);
            }
        };

        // Wire refresh button
        const refreshBtn = document.getElementById('enrich-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                const provider = self.getActiveEnrichProvider();
                runEnrichFresh(provider);
            });
        }

        // ─────────────────────────────────────────────────────────────────────────
        // Restore from cache if available (called when profile re-renders)
        // ─────────────────────────────────────────────────────────────────────────

        const contact = getCurrentProspect();
        if (contact) {
            const cache = self.enrichmentCache?.[contact.id];
            if (cache && cache.activeProvider) {
                const provider = cache.activeProvider;
                const cachedText = cache[provider];
                if (cachedText) {
                    updateButtonStates(provider);
                    renderResearchText(cachedText, provider);
                }
            }
        }
    }

    async updateContactStatusInline(contactId, newStatus) {
        const targetId = String(contactId);
        const idx = this.contacts.findIndex(c => String(c.id) === targetId);
        if (idx === -1) return;
        this.contacts[idx].status = newStatus;
        if (this.currentContact && String(this.currentContact.id) === targetId) {
            this.currentContact.status = newStatus;
        }
        await this.saveData();
        this.updateStats();
        this.renderContacts();
        this.renderProspectProfileView();
        this.showNotification(`Status updated to ${newStatus}`);
    }

    async updateContactProjectInline(contactId, projectName) {
        const targetId = String(contactId);
        const idx = this.contacts.findIndex(c => String(c.id) === targetId);
        if (idx === -1) return;
        const normalized = (projectName || '').trim();
        this.contacts[idx].project = normalized;
        if (this.currentContact && String(this.currentContact.id) === targetId) {
            this.currentContact.project = normalized;
        }
        if (normalized && typeof this.ensureProjectExists === 'function') {
            this.ensureProjectExists(normalized);
        }
        await this.saveData();
        this.renderContacts();
        if (typeof this.renderProjectFilterOptions === 'function') {
            this.renderProjectFilterOptions();
        }
        if (typeof this.renderProjectsPage === 'function') {
            this.renderProjectsPage();
        }
        this.renderProspectProfileView();
        this.showNotification('Project updated.');
    }

    aiEnrichContactPlaceholder() {
        const contact = this.getActiveContact();
        if (!contact) {
            console.warn('AI Enrich Contact: no active contact selected.');
            return;
        }
        this.showNotification('AI enrichment coming soon.');
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

        // If a prospect profile is open for this contact, refresh it
        if (task.contactId && this.activeContactId === task.contactId) {
            this.renderProspectProfileView();
        }
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

        if (next.contactId && this.activeContactId === next.contactId) {
            this.renderProspectProfileView();
        }
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

        // Refresh prospect profile if it was showing this contact's tasks
        const contactId = this.currentContact ? this.currentContact.id : null;
        if (contactId && this.activeContactId === contactId) {
            this.renderProspectProfileView();
        }
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
            // Key format: businessName|email, both lowercased and trimmed.
            const existingKeys = new Set(
                (this.contacts || [])
                    .filter(c => c.vendorName && c.email)
                    .map(c => {
                        const business = c.vendorName.toLowerCase().trim();
                        const email = c.email.toLowerCase().trim();
                        return `${business}|${email}`;
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

                    // Business / Company / Organization name
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

                // Fallbacks for business/company names
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

                // Build dedupe key if we have both business name and email
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

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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

    // ─────────────────────────────────────────────────────────────────────────
    // Channel Link Helpers (iMessage, SMS, WhatsApp, Facebook Message)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Normalize a phone number to E.164-ish format for URL schemes.
     * Returns null if no valid phone can be extracted.
     */
    normalizePhone(rawPhone) {
        if (!rawPhone) return null;
        const digits = String(rawPhone).replace(/[^\d+]/g, "");
        // Basic heuristic: if it doesn't start with + and looks like US number, prepend +1
        if (!digits.startsWith("+") && digits.length === 10) {
            return "+1" + digits;
        }
        return digits || null;
    }

    /**
     * Check if the current device is likely an Apple device (for iMessage).
     */
    isAppleDevice() {
        const ua = navigator.userAgent || "";
        return /iPhone|iPad|iPod|Mac/i.test(ua);
    }

    /**
     * Get unified Message link.
     * On Apple devices → iMessage scheme.
     * On other devices → SMS scheme.
     */
    getMessageLink(contact) {
        const phone = this.normalizePhone(contact?.phone);
        if (!phone) return null;

        if (this.isAppleDevice()) {
            // Use iMessage scheme on Apple platforms
            return `imessage:${phone}`;
        } else {
            // Use SMS scheme elsewhere
            return `sms:${phone}`;
        }
    }

    /**
     * Get WhatsApp link (wa.me format, digits only without +).
     * Only returns a link if the contact is explicitly marked as WhatsApp-enabled.
     */
    getWhatsAppLink(contact) {
        // Only show WhatsApp if explicitly flagged
        if (!contact || !contact.hasWhatsApp) return null;
        const phone = this.normalizePhone(contact?.phone);
        if (!phone) return null;
        const digitsOnly = phone.replace(/[^\d]/g, "");
        if (!digitsOnly) return null;
        return `https://wa.me/${digitsOnly}`;
    }

    /**
     * Get Facebook Messenger link from contact.facebook URL.
     * Attempts to extract the page/profile handle and build an m.me link.
     */
    getFacebookMessageLink(contact) {
        const url = contact?.facebook || contact?.facebookPage || "";
        if (!url) return null;

        try {
            const u = new URL(url);
            // Expect path like /PageName or /groups/Something
            const parts = u.pathname.split("/").filter(Boolean);
            if (parts.length >= 1) {
                // Use the last non-empty segment as the handle
                const handle = parts[parts.length - 1];
                return `https://m.me/${handle}`;
            }
            // Fallback: just open the original URL
            return url;
        } catch {
            return null;
        }
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
