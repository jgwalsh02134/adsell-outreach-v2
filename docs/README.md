# AdSell Sales Desk

AdSell Sales Desk is a mobile-first, AI-assisted sales-outreach platform built to **source**, **qualify**, **enrich**, and **activate** new advertising prospects for the AdSell.ai print-media advertising marketplace.

This repository contains the browser-based application (SPA) that powers the sales workflow: contact discovery, enrichment, outreach execution, activity logging, pipeline progression, and campaign-level reporting.

──────────────────────────────────────────

## ▣ Official Links

| Resource            | Link                                                                 |
|---------------------|----------------------------------------------------------------------|
| Live App            | https://adsell-outreach-v2.pages.dev                                 |
| AdSell.ai           | https://adsell.ai                                                    |
| GitHub Repository   | https://github.com/jgwalsh02134/adsell-outreach-v2                  |
| Cloudflare Worker   | https://adsell-openai-proxy.jgregorywalsh.workers.dev               |

──────────────────────────────────────────

## ▣ Purpose

AdSell Sales Desk is **not** a general CRM.  
It is a focused **outreach cockpit** designed for:

- identifying new advertisers and publishers  
- qualifying prospect records  
- enriching missing data  
- organizing structured, campaign-based outreach  
- recording contact attempts and outcomes  
- executing multi-channel communication  
- routing prospects into the AdSell.ai advertising platform  

Success is measured by:

**new, high-quality prospects reached, enriched, and converted.**

──────────────────────────────────────────

## ▣ Design Philosophy

### ◆ Print-Heritage Craft  
Inspired by the visual language of print media:

- editorial-style typography  
- grid-aligned layout and spacing  
- low-glare, paper-toned surfaces  
- masthead-style headers  
- clean dividers and restrained visual hierarchy  

This aesthetic honors AdSell’s roots in traditional print advertising.

### ◆ Modern Mobile Interaction  
Optimized for speed and clarity:

- mobile-first interface  
- tap-driven actions (minimal required typing)  
- zero horizontal scrolling  
- card-based list and detail views  
- large, reliable touch targets  
- smooth transitions and predictable behavior  

The result: a tool that **looks editorial, but behaves like a fast, modern app.**

──────────────────────────────────────────

## ▣ Core Features

### ◆ Prospect Profiles  
A complete sales-outreach cockpit centered on a single organization or contact.

Includes:

- identity fields (company, person, title, segment, project, lead source)  
- social links (LinkedIn, Facebook, X)  
- website, phone, email, full address  
- device-native deep links (`tel:`, `sms:`, `mailto:`, maps)  
- AI enrichment panel  
- structured log of all activities  
- associated tasks (overdue, today, upcoming, completed)

### ◆ CSV Ingestion Pipeline  
A robust lead-intake system for large lists:

- flexible column mapping  
- deduplication  
- project assignment  
- enrichment queueing  
- data normalization and cleanup  

CSV import behaves as a **pipeline**, not a basic file dump.

### ◆ Projects & Campaigns  
Organize outreach by:

- expo  
- region  
- season  
- vertical  
- thematic push  

Each project aggregates performance based on its prospects.

### ◆ AI Outreach Tools  
Powered by OpenAI Responses API:

- outreach scripts  
- summaries and briefings  
- enrichment intelligence  
- field inference and cleanup  
- classification and prioritization  

### ◆ Multi-Provider Enrichment  
Current + future sources:

- RocketReach  
- Additional APIs (planned)  
- AI-based inference  
- public-data integrations  

Enrichment flows through the Worker and is merged into profiles safely.

──────────────────────────────────────────

## ▣ System Architecture (High-Level)

### ▪ Front-End SPA (Browser / Mobile)
- `app/index.html`  
- `app/styles.css`  
- `app/app-enhanced.js`  
Handles UI, state, navigation, contact rendering, CSV upload, enrichment triggers, and device-native actions.

### ▪ Cloudflare Worker (Backend API)
Provides endpoints for:

- contacts retrieval & updates  
- CSV validation and structured import  
- enrichment calls  
- OpenAI Responses API proxy  

### ▪ Cloudflare KV Storage  
Stores unified application state as a single structured snapshot:

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

### ▪ External Providers  
- RocketReach (current)  
- OpenAI Responses API  
- Additional enrichment APIs (future)  

### ▪ Device-Native Actions  
Executed on the client:

- `tel:`  
- `sms:`  
- `mailto:`  
- Maps links  

──────────────────────────────────────────

## ▣ File Structure

```
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
└── (Cloudflare Worker source to be added)
```

──────────────────────────────────────────

## ▣ Deployment

1. GitHub → Cloudflare Pages hosts the front-end SPA.  
2. Cloudflare Worker powers the backend API.  
3. Cloudflare KV stores persistent data.  
4. Deployments update automatically on each push to `main`.

Worker source will be added to this repository in a dedicated directory.

──────────────────────────────────────────

## ▣ Roadmap

### Immediate
- Contact list redesign  
- Prospect Profile header + channels bar  
- Social & location integration  
- Enrichment panel upgrades  
- Desktop header improvements  

### Near-Term
- Project analytics  
- Pipeline visualization  
- Task manager improvements  
- AI-guided prioritization  

### Long-Term
- “Contacts Near Me” (geo-based discovery)  
- Multi-user + permissions  
- Shared team workspaces  
- CRM export + optional two-way sync  

──────────────────────────────────────────

## ▣ Contribution Workflow

1. Clone the repository  
   `git clone https://github.com/jgwalsh02134/adsell-outreach-v2`

2. Open in **Cursor IDE**.  
3. Use **Codex** for surgical, single-file changes.  
4. Use **Cursor Chat** for multi-file or conceptual refactors.  
5. Test on both desktop and mobile breakpoints.  
6. Push to GitHub; Cloudflare handles deployment.

──────────────────────────────────────────

End of README.
