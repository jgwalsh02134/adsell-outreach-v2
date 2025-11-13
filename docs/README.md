# AdSell.ai Outreach Tracker

A comprehensive web application for managing sales outreach and tracking customer engagement for AdSell.ai's ski magazine campaign.

## Features

✅ **Contact Management**
- Add, edit, and delete contacts
- Import contacts from CSV files
- Filter and search contacts
- Track contact status (Not Started, In Progress, Responded, Signed Up)

✅ **Activity Tracking**
- Log emails sent, phone calls, meetings, and notes
- View activity timeline for each contact
- Track follow-up dates
- Recent activity dashboard

✅ **Scripts Library**
- Pre-written email and call scripts
- Copy scripts to clipboard
- Add custom scripts
- Organize by type (Email, Phone Call, LinkedIn)

✅ **Analytics & Reporting**
- Status breakdown charts
- Category distribution
- Follow-up queue
- Key performance metrics

✅ **CSV Import**
- Upload contacts from spreadsheets
- Preview before importing
- Automatic field mapping

## Getting Started

### Quick Start

1. Open `index.html` in your web browser
2. The app runs entirely in your browser - no server needed!
3. All data is stored locally in your browser's localStorage

### Importing Your Existing Contacts

1. Navigate to the "Import CSV" page
2. Click "Choose CSV File"
3. Select either:
   - `AdsellAI_Outreach_Tracker_Populated.csv`
   - `albany_ski_expo_vendor_contacts_UPDATED.csv`
4. Preview the contacts
5. Click "Import Contacts"

### CSV Format

Your CSV should include these columns:
- Vendor Name (required)
- Contact Name
- Email (required)
- Phone
- Website
- Category
- Segment
- Status
- Notes

## Usage Guide

### Dashboard
- View key metrics (total contacts, status breakdown)
- See recent activity at a glance
- Quick access to add new contacts

### Contacts Page
- View all contacts in a sortable table
- Search by name, email, or phone
- Filter by status, category, or segment
- Click "View" to see full contact details
- Click "Log Activity" to record interactions

### Contact Detail Page
- Complete contact information
- Full activity timeline
- Log new activities
- Edit or delete contact

### Scripts Page
- Browse email and call scripts
- Copy scripts to use in outreach
- Add custom scripts for your team
- Edit existing scripts

### Analytics Page
- Status breakdown showing conversion funnel
- Category distribution of your contacts
- Follow-up queue showing upcoming tasks
- Track outreach performance

## Tips for Success

### Email Outreach
1. Use the provided email templates in the Scripts page
2. Personalize the {Vendor Name} and {Contact Name} placeholders
3. Log activity after sending each email
4. Set follow-up dates (typically 3-5 days)

### Phone Calls
1. Review the call script before dialing
2. Have the contact's details open
3. Log the call immediately after
4. Note any objections or next steps

### Status Management
- **Not Started**: Contact hasn't been reached yet
- **In Progress**: Initial outreach sent, awaiting response
- **Responded**: Contact has replied/engaged
- **Signed Up**: Successfully converted to customer

### Follow-up Best Practices
- Set follow-up dates for every interaction
- Check the Follow-up Queue daily
- Aim for 2-3 touchpoints before marking as unresponsive
- Use different channels (email, then phone, then LinkedIn)

## Data Management

### Backup Your Data
Your data is stored in browser localStorage. To backup:
1. Export contacts regularly by copying from the browser
2. Consider using browser sync features
3. Keep CSV backups of your contact lists

### Clear Data
To reset the application:
```javascript
// Open browser console (F12) and run:
localStorage.clear()
```

## Promo Code Information

All contacts should use promo code **2104** when signing up at www.adsell.ai

**What AdSell.ai Provides:**
- AI-powered platform for print advertising
- Direct access to newspapers and magazines
- Self-service ad creation and placement
- 50-70% cost savings vs traditional agencies
- Analytics and ROI tracking

**Your Role:**
Help ski industry businesses understand how they can use AdSell.ai to advertise their own resorts, shops, and clubs in print publications to reach more customers.

## Technical Notes

### Browser Compatibility
- Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- Requires JavaScript enabled
- localStorage must be available

### File Structure
```
index.html   - Main HTML structure
styles.css   - All styling and layout
app.js       - Application logic and functionality
```

### Customization
- Colors can be adjusted in `styles.css` CSS variables
- Default scripts can be modified in `app.js` `addDefaultScripts()`
- Contact fields can be extended in the data model

## Support

For questions or issues with the AdSell.ai platform, contact:
- Email: support@adsell.ai
- Website: www.adsell.ai

## License

Internal use only - AdSell.ai Sales Team
