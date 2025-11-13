// AdSell.ai Outreach Tracker Application
class OutreachTracker {
    constructor() {
        this.contacts = [];
        this.activities = [];
        this.scripts = [];
        this.currentContact = null;
        this.editingContactId = null;
        this.editingScriptId = null;
        this.pendingImport = null;
        
        this.init();
    }

    init() {
        // Load data from localStorage
        this.loadData();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Render initial page
        this.showPage('dashboard');
        this.updateStats();
        this.renderRecentActivity();
        
        // Add default scripts if none exist
        if (this.scripts.length === 0) {
            this.addDefaultScripts();
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
    }

    saveData() {
        localStorage.setItem('adsell_contacts', JSON.stringify(this.contacts));
        localStorage.setItem('adsell_activities', JSON.stringify(this.activities));
        localStorage.setItem('adsell_scripts', JSON.stringify(this.scripts));
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
                break;
            case 'scripts':
                this.renderScripts();
                break;
            case 'analytics':
                this.renderAnalytics();
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
                    <p class="activity-notes">${activity.notes}</p>
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

        tbody.innerHTML = filteredContacts.map(contact => `
            <tr>
                <td><strong>${contact.vendorName}</strong></td>
                <td>${contact.contactName || '—'}</td>
                <td>${contact.email}</td>
                <td>${contact.phone || '—'}</td>
                <td>${contact.category || '—'}</td>
                <td><span class="status-badge status-${this.slugify(contact.status)}">${contact.status}</span></td>
                <td>${contact.lastContact ? this.formatDate(contact.lastContact) : '—'}</td>
                <td>
                    <button class="btn btn-secondary action-btn" onclick="app.viewContact('${contact.id}')">View</button>
                    <button class="btn btn-secondary action-btn" onclick="app.logActivity('${contact.id}')">Log Activity</button>
                </td>
            </tr>
        `).join('');
    }

    getFilteredContacts() {
        let filtered = [...this.contacts];
        
        const search = document.getElementById('search-input').value.toLowerCase();
        if (search) {
            filtered = filtered.filter(contact => 
                contact.vendorName.toLowerCase().includes(search) ||
                (contact.contactName && contact.contactName.toLowerCase().includes(search)) ||
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

        return filtered;
    }

    filterContacts() {
        this.renderContacts();
    }

    showAddContactModal() {
        this.editingContactId = null;
        document.getElementById('modal-title').textContent = 'Add Contact';
        document.getElementById('contact-form').reset();
        document.getElementById('contact-modal').classList.add('active');
    }

    closeContactModal() {
        document.getElementById('contact-modal').classList.remove('active');
        this.editingContactId = null;
    }

    saveContact(form) {
        const formData = new FormData(form);
        const contact = {
            id: this.editingContactId || this.generateId(),
            vendorName: formData.get('vendorName'),
            contactName: formData.get('contactName'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            website: formData.get('website'),
            category: formData.get('category'),
            segment: formData.get('segment'),
            status: formData.get('status'),
            notes: formData.get('notes'),
            createdAt: this.editingContactId ? 
                this.contacts.find(c => c.id === this.editingContactId).createdAt : 
                new Date().toISOString(),
            lastContact: null,
            followUpDate: null
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

        const content = `
            <div class="contact-detail">
                <div class="contact-header">
                    <h2 class="contact-name">${this.currentContact.contactName || 'No Contact Name'}</h2>
                    <p class="contact-company">${this.currentContact.vendorName}</p>
                </div>
                <div class="contact-body">
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
                                <span class="detail-label">Category</span>
                                <span class="detail-value">${this.currentContact.category || '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Segment</span>
                                <span class="detail-value">${this.currentContact.segment || '—'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Status</span>
                                <span class="detail-value">
                                    <span class="status-badge status-${this.slugify(this.currentContact.status)}">
                                        ${this.currentContact.status}
                                    </span>
                                </span>
                            </div>
                        </div>
                    </div>

                    ${this.currentContact.notes ? `
                        <div class="detail-section">
                            <h3>Notes</h3>
                            <p>${this.currentContact.notes}</p>
                        </div>
                    ` : ''}

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
        document.getElementById('modal-title').textContent = 'Edit Contact';
        
        const form = document.getElementById('contact-form');
        form.vendorName.value = this.currentContact.vendorName;
        form.contactName.value = this.currentContact.contactName || '';
        form.email.value = this.currentContact.email;
        form.phone.value = this.currentContact.phone || '';
        form.website.value = this.currentContact.website || '';
        form.category.value = this.currentContact.category || '';
        form.segment.value = this.currentContact.segment || '';
        form.status.value = this.currentContact.status;
        form.notes.value = this.currentContact.notes || '';
        
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

    // Scripts Management
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

    // CSV Import
    handleCSVUpload(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const csv = e.target.result;
            const lines = csv.split('\n');
            const headers = lines[0].split(',').map(h => h.trim());
            
            const contacts = [];
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                
                const values = this.parseCSVLine(lines[i]);
                const contact = {
                    id: this.generateId(),
                    vendorName: '',
                    contactName: '',
                    email: '',
                    phone: '',
                    website: '',
                    category: '',
                    segment: '',
                    status: 'Not Started',
                    notes: '',
                    createdAt: new Date().toISOString(),
                    lastContact: null,
                    followUpDate: null
                };

                headers.forEach((header, index) => {
                    const value = values[index] ? values[index].trim() : '';
                    const headerLower = header.toLowerCase();
                    
                    if (headerLower.includes('vendor')) contact.vendorName = value;
                    else if (headerLower.includes('contact') && headerLower.includes('name')) contact.contactName = value;
                    else if (headerLower.includes('email')) contact.email = value;
                    else if (headerLower.includes('phone')) contact.phone = value;
                    else if (headerLower.includes('website')) contact.website = value;
                    else if (headerLower.includes('category')) contact.category = value;
                    else if (headerLower.includes('segment')) contact.segment = value;
                    else if (headerLower.includes('status')) contact.status = value || 'Not Started';
                    else if (headerLower.includes('note')) contact.notes = value;
                });

                if (contact.vendorName && contact.email) {
                    contacts.push(contact);
                }
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
                <strong>${contact.vendorName}</strong> - ${contact.email} - ${contact.status}
            </div>
        `).join('');

        document.getElementById('preview-content').innerHTML = preview;
        document.getElementById('upload-preview').style.display = 'block';
    }

    confirmImport() {
        if (!this.pendingImport) return;

        this.contacts.push(...this.pendingImport);
        this.saveData();
        this.pendingImport = null;
        
        this.cancelImport();
        this.showPage('contacts');
        this.updateStats();
        
        this.showNotification(`${this.pendingImport.length} contacts imported successfully!`);
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

    showNotification(message) {
        // Simple alert for now - could be enhanced with a toast notification
        console.log(message);
    }
}

// Initialize app
const app = new OutreachTracker();
