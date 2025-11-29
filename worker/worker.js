export default {
    async fetch(request, env) {
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };
  
      // CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }
  
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method.toUpperCase();

    const jsonResponse = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const textResponse = (text, status = 200) =>
      new Response(text, {
        status,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });

    // ---------- Helper: Perplexity chat ----------

    async function callPerplexityChat(body, env) {
      const apiKey = env.PERPLEXITY_KEY;
      if (!apiKey) throw new Error("PERPLEXITY_KEY not configured");

      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Perplexity error ${res.status}: ${text.slice(0, 500)}`
        );
      }
      return res.json();
    }

    // ---------- Helper: Grok chat ----------

    async function callGrokChat(body, env) {
      const apiKey = env.GROK_API_KEY;
      if (!apiKey) throw new Error("GROK_API_KEY not configured");

      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Grok error ${res.status}: ${text.slice(0, 500)}`);
      }

      return res.json();
    }

    // ---------- Deep Research System Prompt (Text-based, no JSON) ----------

    const deepResearchSystemPrompt = `
You are an expert OSINT research assistant for AdSell.ai.

AdSell.ai sells AI-powered PRINT advertising campaigns in newspapers and magazines.
Your job is to deeply research a specific prospect (company, club, organization, nonprofit, association, etc.) and provide comprehensive, actionable intelligence for sales outreach.

RESEARCH PRIORITIES:
1. KEY PEOPLE - Find specific individuals responsible for:
   - Marketing / Advertising / Brand
   - Communications / PR / Media Relations
   - Sponsorships / Partnerships / Business Development
   - Membership Growth / Customer Acquisition
   - Events / Programs / Trips
   - Development / Fundraising (for nonprofits)
   For each person, include their name, title, and any public contact info (email, phone, LinkedIn).

2. CONTACT CHANNELS - Find and verify:
   - Official website URL
   - General email address
   - Phone number(s)
   - Physical address
   - Social media profiles (LinkedIn, Facebook, Instagram, X/Twitter, YouTube)

3. ORGANIZATION DETAILS:
   - What they do (mission, services, products)
   - Who they serve (target audience, members, customers)
   - Geographic focus
   - Size indicators (membership count, employees, revenue if public)

4. MARKETING SIGNALS:
   - Current advertising/marketing activities
   - Sponsorship programs or partners
   - Events, conferences, trips they run
   - Publications or newsletters they produce
   - Evidence of print advertising usage
   - Digital marketing sophistication

5. OPPORTUNITIES FOR ADSELL.AI:
   - Why they might benefit from print advertising
   - Upcoming events or campaigns
   - Growth signals
   - Budget indicators

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:

## Summary
[2-3 sentence overview of the organization]

## Key People
[List each person with their role and contact info. If no public contact info, note that.]
- Name: [name]
  Role: [title/position]
  Email: [email if public, or "Not publicly available"]
  Phone: [phone if public, or "Not publicly available"]
  LinkedIn: [URL if found]

## Contact Channels
- Website: [URL]
- Email: [general email]
- Phone: [main phone]
- Address: [physical address]
- LinkedIn: [company page URL]
- Facebook: [page URL]
- Instagram: [@handle or URL]
- X/Twitter: [@handle or URL]
- YouTube: [channel URL]

## Organization Details
- Type: [nonprofit, association, business, club, etc.]
- Founded: [year if known]
- Size: [membership count, employees, or other size indicator]
- Geographic Focus: [local, regional, national, international]
- Mission: [brief description]

## Marketing Signals
[Bullet points about their marketing activities, sponsorships, events, publications]

## Opportunities for AdSell.ai
[Bullet points about why print advertising could help them, upcoming opportunities]

## Sources
[List the URLs you used for research with brief labels]

IMPORTANT RULES:
- Be thorough and detailed
- Include citations/sources for key facts
- If you cannot find information, say "Not found" rather than guessing
- Focus on publicly available information only
- Prioritize finding marketing/advertising decision-makers
`.trim();

    // ---------- Helper: Clean raw model text ----------

    function cleanModelText(raw) {
      if (typeof raw !== "string") return "";
      let text = raw.trim();

      // Strip <think>...</think>
      while (true) {
        const start = text.indexOf("<think>");
        if (start === -1) break;
        const end = text.indexOf("</think>", start);
        if (end === -1) break;
        text = (text.slice(0, start) + text.slice(end + "</think>".length)).trim();
      }

      return text.trim();
    }
  
      // ----------------------------------------------------
    // Shared contacts API (KV: env.ADSELL_DATA)
      // ----------------------------------------------------
  
      if (pathname === "/contacts" && method === "GET") {
        try {
          const raw = await env.ADSELL_DATA.get("shared_contacts");
  
          if (!raw) {
            const empty = {
              contacts: [],
              activities: [],
              scripts: [],
              tags: [],
              customFields: [],
            };
          return jsonResponse(empty, 200);
          }
  
          return new Response(raw, {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("GET /contacts error:", err);
        return jsonResponse({ error: "Failed to load shared contacts" }, 500);
      }
    }

      if (pathname === "/contacts/import" && method === "POST") {
        try {
          const bodyText = await request.text();
  
          let parsed;
          try {
            parsed = JSON.parse(bodyText);
        } catch {
          return jsonResponse({ error: "Invalid JSON body" }, 400);
        }

          await env.ADSELL_DATA.put("shared_contacts", JSON.stringify(parsed));
        return jsonResponse({ ok: true }, 200);
        } catch (err) {
          console.error("POST /contacts/import error:", err);
        return jsonResponse({ error: "Failed to save contacts" }, 500);
      }
      }
  
      // ----------------------------------------------------
    // Perplexity Research endpoint: POST /perplexity/enrich
    // Returns plain text, not JSON
      // ----------------------------------------------------

    if (pathname === "/perplexity/enrich" && method === "POST") {
        try {
          let body;
          try {
          body = await request.json(); // { contact }
        } catch {
          return jsonResponse({ error: "Invalid JSON body" }, 400);
        }

        const contact = body.contact || null;
        if (!contact) {
          return jsonResponse(
            { error: "Missing 'contact' in request body" },
            400
          );
        }

        // Build a rich context from the contact
        const contactName = contact.vendorName || contact.companyName || contact.company || contact.name || "Unknown";
        const website = contact.website || contact.url || "";
        const city = contact.city || contact.location || "";
        const email = contact.email || "";
        const notes = contact.notes || "";

        const userPrompt = `
Research this prospect for AdSell.ai sales outreach:

PROSPECT INFORMATION FROM CRM:
- Name/Company: ${contactName}
- Website: ${website || "Not provided"}
- City/Location: ${city || "Not provided"}
- Email: ${email || "Not provided"}
- Notes: ${notes || "None"}

FULL CRM RECORD:
${JSON.stringify(contact, null, 2)}

Please conduct a deep web search to find:
1. All missing contact information (website, email, phone, address, social media)
2. Key people responsible for marketing, advertising, sponsorships, communications, events
3. Organization details (what they do, who they serve, size)
4. Marketing signals and advertising behavior
5. Opportunities for AdSell.ai to help them with print advertising

Be thorough and include sources for your findings.
`.trim();

        console.log("[Perplexity] Researching:", contactName);

        const pplxRaw = await callPerplexityChat(
          {
            model: "sonar-reasoning",
            messages: [
              { role: "system", content: deepResearchSystemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 4000,
            temperature: 0.1,
          },
          env
        );

        let content = pplxRaw?.choices?.[0]?.message?.content;
        
        if (Array.isArray(content)) {
          content = content
            .map((part) =>
              typeof part === "string"
                ? part
                : part?.text || JSON.stringify(part)
            )
            .join("");
        }

        content = cleanModelText(content || "No research results available.");

        console.log("[Perplexity] Response length:", content.length);

        return textResponse(content, 200);
      } catch (err) {
        console.error("POST /perplexity/enrich error:", err);
        return textResponse(
          `## Error\n\nFailed to complete Perplexity research: ${err.message}`,
          500
        );
      }
    }

    // ----------------------------------------------------
    // Grok Research endpoint: POST /grok/enrich
    // Returns plain text, not JSON
    // Uses web search tools
    // ----------------------------------------------------

    if (pathname === "/grok/enrich" && method === "POST") {
      try {
        let body;
        try {
          body = await request.json(); // { contact }
        } catch {
          return jsonResponse({ error: "Invalid JSON body" }, 400);
        }

        const contact = body.contact || null;
        if (!contact) {
          return jsonResponse(
            { error: "Missing 'contact' in request body" },
            400
          );
        }

        // Build a rich context from the contact
        const contactName = contact.vendorName || contact.companyName || contact.company || contact.name || "Unknown";
        const website = contact.website || contact.url || "";
        const city = contact.city || contact.location || "";
        const email = contact.email || "";
        const notes = contact.notes || "";

        const userPrompt = `
Research this prospect for AdSell.ai sales outreach:

PROSPECT INFORMATION FROM CRM:
- Name/Company: ${contactName}
- Website: ${website || "Not provided"}
- City/Location: ${city || "Not provided"}
- Email: ${email || "Not provided"}
- Notes: ${notes || "None"}

FULL CRM RECORD:
${JSON.stringify(contact, null, 2)}

IMPORTANT: Use your web search capabilities to find comprehensive information about this organization.

Please search for and find:
1. All missing contact information (website, email, phone, address, social media profiles)
2. Key people responsible for marketing, advertising, sponsorships, communications, membership, events
3. Organization details (what they do, who they serve, geographic focus, size)
4. Marketing signals and current advertising activities
5. Opportunities for AdSell.ai to help them with print advertising campaigns

Be thorough, cite your sources, and focus on actionable sales intelligence.
`.trim();

        console.log("[Grok] Researching:", contactName);

        const grokRaw = await callGrokChat(
          {
            model: "grok-3",
            messages: [
              { role: "system", content: deepResearchSystemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 4000,
            temperature: 0.1,
            // Enable Grok's built-in web search
            search: {
              mode: "auto"
            }
          },
          env
        );

        let content = grokRaw?.choices?.[0]?.message?.content;

        if (Array.isArray(content)) {
          content = content
            .map((part) =>
              typeof part === "string"
                ? part
                : part?.text || JSON.stringify(part)
            )
            .join("");
        }

        content = cleanModelText(content || "No research results available.");

        console.log("[Grok] Response length:", content.length);

        return textResponse(content, 200);
      } catch (err) {
        console.error("POST /grok/enrich error:", err);
        return textResponse(
          `## Error\n\nFailed to complete Grok research: ${err.message}`,
          500
        );
        }
      }
  
      // ----------------------------------------------------
    // Existing OpenAI Responses API proxy (leave for other features)
      // ----------------------------------------------------
  
      if (request.method !== "POST") {
        return new Response("Use POST", {
          status: 405,
          headers: { ...corsHeaders, Allow: "POST" },
        });
      }
  
      let json;
      try {
        json = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
      }
  
      const input = json.input ?? "";
    const modeForTools = json.mode ?? "default";
  
      const tools =
      modeForTools === "research" ? [{ type: "web_search_preview" }] : [];
  
      const openaiBody = JSON.stringify({
        model: "gpt-4.1-mini",
        input,
        ...(tools.length > 0 ? { tools } : {}),
      });
  
      const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: openaiBody,
      });
  
      const text = await openaiResponse.text();
  
      return new Response(text, {
        status: openaiResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    },
  };
