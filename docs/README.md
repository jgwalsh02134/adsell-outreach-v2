# AdSell Sales Desk

AdSell Sales Desk is a mobile-first, AI-assisted sales-outreach platform built to **source**, **qualify**, **enrich**, and **activate** new advertising prospects for the AdSell.ai print-media advertising marketplace.

This repository contains the browser-based application (SPA) that powers the sales workflow: contact discovery, enrichment, outreach execution, activity logging, pipeline progression, and campaign-level reporting.

──────────────────────────────────────────

## ▣ Official Links

| Resource            | Link                                                                 |
|---------------------|----------------------------------------------------------------------|
| Live App            | https://adsell-outreach-v2.pages.dev                                 |
# AdSell Sales Desk

AdSell Sales Desk is a mobile-first, AI-assisted sales-outreach platform built to **source**, **qualify**, **enrich**, and **activate** new advertising prospects for the [AdSell.ai](https://adsell.ai) print-media marketplace.

This repository contains the browser-based single-page application (SPA) and Cloudflare Worker backend that together power the sales workflow: contact discovery, enrichment, AI research, outreach execution, activity logging, pipeline progression, and campaign-level reporting.

---

## Official Links

| Resource              | Link                                                                 |
|-----------------------|----------------------------------------------------------------------|
| Live App              | https://adsell-outreach-v2.pages.dev                                 |
| AdSell.ai             | https://adsell.ai                                                    |
| GitHub Repository     | https://github.com/jgwalsh02134/adsell-outreach-v2                  |
| Cloudflare Worker API | https://adsell-openai-proxy.jgregorywalsh.workers.dev               |

---

## Purpose

AdSell Sales Desk is **not** a general-purpose CRM.  
It is a focused **outreach cockpit** designed for:

- discovering and onboarding new advertisers  
- qualifying prospect records  
- enriching missing contact and company data via AI  
- organizing structured, project-based outreach  
- recording calls, emails, messages, and social touches  
- executing multi-channel communication (phone, SMS, email, maps)  
- routing prospects into the AdSell.ai advertising platform  

### Success Metric  
**→ New, high-quality prospects reached, enriched, and converted.**

---

## Design Philosophy

### Print-Heritage Craft  
Inspired by traditional print-media design:

- editorial-style typography  
- grid-aligned spacing  
- parchment background (`#F7F5EF`)  
- masthead-style headers  
- subtle dividers and restrained hierarchy  

### Modern Mobile Interaction  
Optimized for speed and clarity:

- mobile-first design (iPhone-first)  
- tap-driven actions (minimal typing)  
- zero horizontal scrolling  
- card-based list + profile views  
- large touch targets  
- predictable, smooth behavior  

**A tool that looks editorial, but behaves like a fast modern app.**

---

## Core Features

### Prospect Profiles

A complete outreach cockpit for each organization.

Includes:

- identity fields (company, contact, title, category, segment, project, lead source)  
- communication channels: **Call, Message, Email, Website**  
- social icons: **LinkedIn, Facebook, Instagram, X, YouTube, WhatsApp, Messenger**  
- device-native links (`tel:`, `sms:`, `mailto:`, maps)  
- AI enrichment panel (Perplexity + Grok)  
- activity timeline (calls, emails, notes, enrichment events)  
- tasks (overdue, today, upcoming, completed)

### CSV Ingestion Pipeline

- flexible column mapping  
- deduplication  
- project assignment  
- normalization + cleanup  
- optional enrichment queue  

### Projects & Campaigns

Organize outreach by:

- expo  
- region  
- season  
- vertical  
- campaign  

Each project aggregates performance across its prospects.

### AI Tools

Powered by:

#### OpenAI Responses API (`gpt-4.1-mini`)
- outreach script generation  
- company research  
- detail cleanup and classification  

#### Perplexity (Prospect Insight)
- strict, fact-based research  
- returns structured JSON only  

#### Grok (Full Insight)
- official-site extraction  
- never invents people or emails  
- returns verified channels + people  

**The Worker enforces strict rules (no guessing, no invented emails, no auto-overwrite).**

---

## System Architecture (High-Level)

### Front-End SPA

Files:

- `app/index.html`  
- `app/styles.css`  
- `app/app-enhanced.js`

Responsibilities:

- UI, navigation, and state management  
- Prospect List + Profile rendering  
- device-native actions (call / sms / mail / maps)  
- enrichment + AI triggers  
- CSV upload and mapping  

### Cloudflare Worker API

Location: `worker/worker.js`

Endpoints:

- `GET /contacts`  
- `POST /contacts/import`  
- `POST /perplexity/enrich`  
- `POST /grok/enrich`  
- `POST /openai`  

Worker responsibilities:

- maintain unified KV snapshot document  
- orchestrate enrichment calls (Perplexity + Grok)  
- clean AI output (strip `<think>`, enforce JSON)  
- provide CORS for SPA  

### Cloudflare KV Storage

Stores entire application state in one JSON document:

```json
{
  "contacts": [],
  "activities": [],
  "tasks": [],
  "projects": [],
  "tags": [],
  "customFields": [],
  "version": 1
}
```

### **External Providers**

- Perplexity (sonar-reasoning)
- Grok (grok-3)
- OpenAI Responses API
- Additional enrichment APIs (future)

  

### **Device-Native Actions**

- tel:
- sms:
- mailto:
- Apple Maps / Google Maps / Browser links
* * *

## **File Structure**
    
    
    adsell-outreach-v2/
    │
    ├── app/
    │   ├── icons/
    │   ├── images/
    │   ├── app-enhanced.js
    │   ├── data-loader.html
    │   ├── favicon.png
    │   ├── favicon.svg
    │   ├── index.html
    │   └── styles.css
    │
    ├── worker/
    │   ├── worker.js
    │   └── wrangler.toml
    │
    ├── assets/
    │
    ├── campaign/
    │   ├── CAMPAIGN_BRIEF.md
    │   └── SALES_CHEAT_SHEET.md
    │
    ├── data/
    │   ├── backups/
    │   ├── exports/
    │   └── imports/
    │
    ├── docs/
    │   ├── CUSTOM_SETUP_JGW.md
    │   ├── ENHANCED_FEATURES.md
    │   ├── QUICKSTART.md
    │   ├── README.md
    │   └── START_HERE.md
    │
    └── (additional config files)

* * *

## **Deployment**

1. Push to GitHub → Cloudflare Pages builds and deploys the SPA.

2. Cloudflare Worker deployed via Wrangler.

3. Cloudflare KV stores persistent state.

4. Deployments update automatically on every push to main.

* * *

## **Roadmap**

  

### **Immediate**

- contact edit UX overhaul
- multi-person editing
- Prospect Profile polish (channels, spacing, social icons)
- enrichment reliability improvements

  

### **Near-Term**

- project analytics
- pipeline visualizations
- task manager enhancements
- AI-guided prioritization

  

### **Long-Term**

- geo-based prospect discovery
- multi-user support
- team workspaces
- CRM sync integrations
* * *

## **Contribution Workflow**
    
    
    git clone https://github.com/jgwalsh02134/adsell-outreach-v2

Steps:

1. Clone the repo.

2. Open in Cursor or VS Code.

3. Make focused, single-scope changes.

4. Test on both mobile and desktop.

5. Commit and push.

6. Verify Cloudflare deployment.

* * *

End of README.
    
    
---
