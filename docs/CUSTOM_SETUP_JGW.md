# 🚀 Setup for /Users/j-gregory-walsh/adsell-outreach-v2

## ⚡ Quick Setup - Copy & Paste

### Step 1: Create Directory Structure

```bash
# Create main directory and navigate to it
mkdir -p /Users/j-gregory-walsh/adsell-outreach-v2
cd /Users/j-gregory-walsh/adsell-outreach-v2

# Create all subdirectories at once
mkdir -p app docs campaign data/{imports,exports,backups} assets/images

# Create placeholder files
touch data/exports/.gitkeep data/backups/.gitkeep

echo "✅ Directory structure created!"
```

---

### Step 2: Move Downloaded Files

**Assuming files are in your Downloads folder:**

```bash
# Set source directory
DOWNLOADS="/Users/j-gregory-walsh/Downloads"

# Move app files
mv "$DOWNLOADS/index.html" app/
mv "$DOWNLOADS/index-enhanced.html" app/
mv "$DOWNLOADS/app.js" app/
mv "$DOWNLOADS/app-enhanced.js" app/
mv "$DOWNLOADS/styles.css" app/
mv "$DOWNLOADS/data-loader.html" app/

# Move documentation
mv "$DOWNLOADS/START_HERE.md" docs/
mv "$DOWNLOADS/QUICKSTART.md" docs/
mv "$DOWNLOADS/README.md" docs/
mv "$DOWNLOADS/DEPLOYMENT.md" docs/
mv "$DOWNLOADS/OVERVIEW.md" docs/
mv "$DOWNLOADS/ENHANCED_FEATURES.md" docs/
mv "$DOWNLOADS/VERSION_COMPARISON.md" docs/
mv "$DOWNLOADS/TERMINAL_SETUP.md" docs/
mv "$DOWNLOADS/QUICK_SETUP.md" docs/

# Move campaign materials
mv "$DOWNLOADS/CAMPAIGN_BRIEF.md" campaign/
mv "$DOWNLOADS/SALES_CHEAT_SHEET.md" campaign/

# Move data files
mv "$DOWNLOADS"/*.csv data/imports/ 2>/dev/null

# Move images
mv "$DOWNLOADS/adsell-ai-ski.png" assets/images/ 2>/dev/null

echo "✅ All files moved!"
```

---

### Step 3: Verify Structure

```bash
# Check the structure
tree -L 2 /Users/j-gregory-walsh/adsell-outreach-v2

# Or if tree not installed:
find /Users/j-gregory-walsh/adsell-outreach-v2 -maxdepth 2 -type d
```

---

### Step 4: Launch the App

```bash
# Open enhanced version
open /Users/j-gregory-walsh/adsell-outreach-v2/app/index-enhanced.html

# Or open data loader first to import CSV
open /Users/j-gregory-walsh/adsell-outreach-v2/app/data-loader.html
```

---

## 🎯 One-Command Setup

**If you want to do everything at once:**

```bash
# Navigate to home directory
cd /Users/j-gregory-walsh

# Create and setup everything
mkdir -p adsell-outreach-v2/{app,docs,campaign,data/{imports,exports,backups},assets/images} && \
cd adsell-outreach-v2 && \
touch data/exports/.gitkeep data/backups/.gitkeep && \
mv ~/Downloads/index*.html ~/Downloads/app*.js ~/Downloads/styles.css ~/Downloads/data-loader.html app/ 2>/dev/null && \
mv ~/Downloads/*BRIEF.md ~/Downloads/*SHEET.md campaign/ 2>/dev/null && \
mv ~/Downloads/START_HERE.md ~/Downloads/QUICKSTART.md ~/Downloads/README.md ~/Downloads/DEPLOYMENT.md ~/Downloads/OVERVIEW.md ~/Downloads/*FEATURES.md ~/Downloads/*COMPARISON.md ~/Downloads/*SETUP.md docs/ 2>/dev/null && \
mv ~/Downloads/*.csv data/imports/ 2>/dev/null && \
mv ~/Downloads/adsell-ai-ski.png assets/images/ 2>/dev/null && \
echo "✅ Setup complete!" && \
open app/index-enhanced.html
```

---

## 📂 Expected Final Structure

```
/Users/j-gregory-walsh/adsell-outreach-v2/
├── app/
│   ├── index.html
│   ├── index-enhanced.html        ⭐ Main app
│   ├── app.js
│   ├── app-enhanced.js
│   ├── styles.css
│   └── data-loader.html
├── docs/
│   ├── START_HERE.md
│   ├── CAMPAIGN_BRIEF.md          🎯 Important!
│   ├── QUICKSTART.md
│   ├── ENHANCED_FEATURES.md
│   └── [other docs]
├── campaign/
│   ├── CAMPAIGN_BRIEF.md
│   └── SALES_CHEAT_SHEET.md
├── data/
│   ├── imports/
│   │   ├── albany_ski_expo_vendor_contacts_UPDATED.csv
│   │   └── AdsellAI_Outreach_Tracker_Populated.csv
│   ├── exports/
│   └── backups/
└── assets/
    └── images/
        └── adsell-ai-ski.png
```

---

## 🔖 Create Handy Aliases

Add these to your `~/.zshrc` or `~/.bash_profile`:

```bash
# Open with text editor
nano ~/.zshrc

# Add these lines:
alias adsell='open /Users/j-gregory-walsh/adsell-outreach-v2/app/index-enhanced.html'
alias adsell-data='open /Users/j-gregory-walsh/adsell-outreach-v2/app/data-loader.html'
alias adsell-cd='cd /Users/j-gregory-walsh/adsell-outreach-v2'
alias adsell-docs='cd /Users/j-gregory-walsh/adsell-outreach-v2/docs'

# Save and reload
source ~/.zshrc

# Now you can just type:
# adsell           - Opens the app
# adsell-data      - Opens data loader
# adsell-cd        - Goes to project directory
# adsell-docs      - Goes to docs folder
```

---

## 📊 Quick Access Commands

### Launch the app:
```bash
open /Users/j-gregory-walsh/adsell-outreach-v2/app/index-enhanced.html
```

### Load CSV data:
```bash
open /Users/j-gregory-walsh/adsell-outreach-v2/app/data-loader.html
```

### View documentation:
```bash
cat /Users/j-gregory-walsh/adsell-outreach-v2/docs/CAMPAIGN_BRIEF.md
```

### Navigate to project:
```bash
cd /Users/j-gregory-walsh/adsell-outreach-v2
```

### List all contacts data:
```bash
ls -lh /Users/j-gregory-walsh/adsell-outreach-v2/data/imports/
```

### Backup data:
```bash
cp /Users/j-gregory-walsh/adsell-outreach-v2/data/exports/*.csv \
   /Users/j-gregory-walsh/adsell-outreach-v2/data/backups/
```

---

## 🎓 After Setup Steps

1. **Launch the app:**
   ```bash
   open /Users/j-gregory-walsh/adsell-outreach-v2/app/index-enhanced.html
   ```

2. **Or load data first:**
   ```bash
   open /Users/j-gregory-walsh/adsell-outreach-v2/app/data-loader.html
   ```
   - Choose CSV file
   - Select: `albany_ski_expo_vendor_contacts_UPDATED.csv`
   - Click "Load Data into App"
   - Click "Open Outreach Tracker"

3. **Read the campaign brief:**
   ```bash
   open /Users/j-gregory-walsh/adsell-outreach-v2/campaign/CAMPAIGN_BRIEF.md
   ```

---

## ✅ Verify Everything Works

```bash
# Check all files are in place
cd /Users/j-gregory-walsh/adsell-outreach-v2

# Count files in each directory
echo "App files: $(ls app/ | wc -l)"
echo "Docs: $(ls docs/ | wc -l)"
echo "Campaign materials: $(ls campaign/ | wc -l)"
echo "Data files: $(ls data/imports/ | wc -l)"

# Should show:
# App files: 6
# Docs: 8-9
# Campaign materials: 2
# Data files: 2
```

---

## 🔧 Troubleshooting

### Files not found?
```bash
# Check what's in Downloads
ls -la ~/Downloads/*.html ~/Downloads/*.js ~/Downloads/*.md

# If files are elsewhere, update DOWNLOADS variable:
DOWNLOADS="/path/to/your/files"
```

### Permission issues?
```bash
# Make sure you own the directory
sudo chown -R j-gregory-walsh:staff /Users/j-gregory-walsh/adsell-outreach-v2
```

### Want to start over?
```bash
# Remove and recreate (BE CAREFUL!)
rm -rf /Users/j-gregory-walsh/adsell-outreach-v2
# Then run setup commands again
```

---

## 🚀 You're All Set!

Once setup is complete, just type:
```bash
adsell
```

(after adding the alias)

Or:
```bash
open /Users/j-gregory-walsh/adsell-outreach-v2/app/index-enhanced.html
```

**Happy tracking! 🎉**
