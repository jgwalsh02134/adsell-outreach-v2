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

    // ---------- Perplexity Strict Fact-Focused Research Prompt ----------

    const perplexityStrictSystemPrompt = `
You are a FACT-FOCUSED RESEARCH ENGINE for prospect enrichment.

Your job is to perform web search and extract ONLY **publicly confirmed** data about the organization described in the prospect JSON.

You must obey ALL of these rules:

1. NEVER guess, assume, infer, or invent data.
2. If a field is not clearly supported by a public source (official site or strongly corroborated listing), return null for that field.
3. Prefer the organization's official website and clearly related social pages.
4. Ignore similarly named organizations if you are not confident they are the same entity.
5. Set fields to null instead of writing "unknown", "not listed", "not publicly available", etc.
6. Do not fabricate "Key People" unless you see an explicit name + role on a public page.
7. Do not include marketing advice or outreach strategy in your JSON. Only data.
8. Output MUST be valid JSON with no markdown, no commentary, no prose.

You are given:
- A partial prospect record (company, contact, website, city, notes, etc.).

You must:
- Use web search to confirm and fill **only** high-confidence public data.
- Return JSON using this exact shape (keys must match; you may set values to null):

{
  "normalized": {
    "name": string|null,
    "title": string|null,
    "company": string|null,
    "phone": string|null,
    "website": string|null,
    "address": string|null
  },
  "channels": {
    "website": string|null,
    "email_general": string|null,
    "phone_general": string|null,
    "facebook": string|null,
    "instagram": string|null,
    "linkedin": string|null,
    "x": string|null,
    "youtube": string|null,
    "other": string|null
  },
  "people": [
    {
      "name": string|null,
      "role": string|null,
      "email": string|null,
      "phone": string|null
    }
  ],
  "summary": {
    "overview": string|null,
    "why_relevant_for_print": string|null
  },
  "fit": {
    "likely_print_advertiser": boolean|null,
    "reasoning": string|null
  },
  "confidence": "high" | "medium" | "low" | null,
  "sources": []
}

Field-specific rules:

- normalized.name:
    - Use the organization's public-facing name from the official site.
    - If multiple variants, choose the one used in the page title or masthead.
- normalized.phone, normalized.website, normalized.address:
    - Only set if clearly listed on the official site.
- channels.website:
    - Canonical URL (no tracking parameters).
- channels.email_general:
    - A general "info@" or "contact@" address for the organization.
    - Do not use personal emails unless labeled as general contact.
- channels.phone_general:
    - Main public phone number for the organization.
- channels.facebook / instagram / linkedin / x / youtube:
    - Only set if you can see they are clearly official accounts for the same organization.
- people:
    - Only include individuals if their name AND role appear on an official or clearly affiliated page.
    - Do not include people found only through third-party directories unless you are very confident.
    - Emails in this array must appear on the same page as the person's name/role or a clearly related contact page.
- summary.overview:
    - 2–4 sentences summarizing what the organization is and does, based ONLY on confirmed info.
- summary.why_relevant_for_print:
    - 1–2 sentences tying their activities to why print advertising could be relevant (e.g., they promote events, trips, memberships, etc.).
    - Do not mention AdSell.ai by name.
- fit.likely_print_advertiser:
    - true if you see evidence they promote events/memberships/services and would plausibly benefit from local/regional print reach.
    - false if they are obviously not a candidate.
    - null if you cannot tell.

If you are not confident about a field: set it to null and DO NOT explain.

Return ONLY this JSON. Do not wrap it in markdown. Do not write any other text.
`.trim();

    // ---------- Grok Strict Fact Extraction System Prompt ----------

    const grokStrictSystemPrompt = `
You are a FACT-EXTRACTION ENGINE for prospect profiles.
Your ONLY task is to extract **publicly confirmed business data** about this organization from its official website and any publicly linked social pages.

Rules:
1. NEVER guess, assume, infer, estimate, or generate fictional data.
2. If ANY field cannot be confirmed from a direct public source, return null.
3. Return ONLY structured JSON — NO summaries, NO prose, NO bullet points.
4. Only include:
   - website
   - general email
   - general phone
   - address
   - Facebook URL
   - Instagram URL
   - LinkedIn URL
   - YouTube URL
   - other social URLs
   - key people ONLY if their name + role is explicitly listed on a public page
5. If key people are not explicitly listed, return an empty list.
6. DO NOT include marketing analysis, opportunities, or interpretations.
7. DO NOT include organization size, founding date, mission, or history unless explicitly listed on the official site.
8. DO NOT mix information from similarly named organizations.
9. Output MUST be in this format:

{
  "channels": {
    "website": string|null,
    "email_general": string|null,
    "phone_general": string|null,
    "address": string|null,
    "facebook": string|null,
    "instagram": string|null,
    "linkedin": string|null,
    "youtube": string|null,
    "other": string|null
  },
  "people": [
    {
      "name": string|null,
      "role": string|null,
      "email": string|null,
      "phone": string|null
    }
  ]
}

10. If nothing is confirmed → return all fields as null or empty arrays.
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
    // Returns strict JSON with confirmed facts only
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
Extract ONLY publicly confirmed data for this prospect.

PROSPECT FROM CRM:
- Name/Company: ${contactName}
- Website: ${website || "Not provided"}
- City/Location: ${city || "Not provided"}
- Email: ${email || "Not provided"}
- Notes: ${notes || "None"}

FULL CRM RECORD:
${JSON.stringify(contact, null, 2)}

INSTRUCTIONS:
1. Use web search to find this organization's OFFICIAL website and linked social pages.
2. Extract ONLY data that is explicitly published on those pages.
3. DO NOT guess, infer, or generate any data that is not directly visible.
4. Return JSON in the exact format specified in your system instructions.
5. If a field cannot be confirmed from a public source, set it to null.
6. Include the URLs you used in the "sources" array.
`.trim();

        console.log("[Perplexity] Researching:", contactName);

        const pplxRaw = await callPerplexityChat(
          {
            model: "sonar-reasoning",
            messages: [
              { role: "system", content: perplexityStrictSystemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 4000,
            temperature: 0.0,
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
Extract ONLY publicly confirmed business data for this organization.

PROSPECT FROM CRM:
- Name/Company: ${contactName}
- Website: ${website || "Not provided"}
- City/Location: ${city || "Not provided"}
- Email: ${email || "Not provided"}

FULL CRM RECORD:
${JSON.stringify(contact, null, 2)}

IMPORTANT INSTRUCTIONS:
1. Use web search to find the organization's OFFICIAL website and linked social pages.
2. Extract ONLY data that is explicitly published on those pages.
3. DO NOT guess, infer, or generate any data that is not directly visible.
4. Return JSON in the exact format specified in your system instructions.
5. If a field cannot be confirmed, return null for that field.
`.trim();

        console.log("[Grok] Researching:", contactName);

        const grokRaw = await callGrokChat(
          {
            model: "grok-3",
            messages: [
              { role: "system", content: grokStrictSystemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 4000,
            temperature: 0.0,
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
