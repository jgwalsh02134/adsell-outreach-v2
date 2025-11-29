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

    // ---------- Prompt ----------

    const enrichmentSystemPrompt = `
You are the prospect research assistant for a B2B sales desk that finds advertisers for a print media marketplace.

You receive partial prospect records (company, contact, website, city, notes) and must produce a short, human-readable enrichment summary.

Your job:

1) Normalize and clean existing data (phone formats, URLs, capitalization).
2) Use web search to collect only high-confidence, public company information:
   - Canonical website URL
   - General contact email and phone
   - Public social links (LinkedIn, Facebook, Instagram, X/Twitter, YouTube, TikTok)
   - 1–3 people who are good outreach contacts for advertising/marketing/partnerships
3) Provide a very short business summary and whether they are a plausible print advertising prospect.

STRICT RULES:
- Use only public, company-level data (from the website, official social pages, or widely corroborated sources).
- Do NOT guess or fabricate emails, phone numbers, or names. If you are not confident, omit that item.
- Do NOT output chain-of-thought, "<think>", step-by-step reasoning, or any explanation of your process.
- Do NOT use code fences or JSON. Output only readable text.
- Keep all text short and scannable.

Format your output as a compact report with clearly labeled sections, for example:

Channels:
- Website: ...
- Email: ...
- Phone: ...
- LinkedIn: ...
- ...

Key People:
- Name (Role) — email / phone
- ...

Summary:
- One or two short sentences about what the business does and who they serve.

Fit for Print:
- Brief sentence about whether they are likely to benefit from print advertising and why.
`.trim();

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
    // Perplexity enrichment endpoint: POST /perplexity/enrich
    // ----------------------------------------------------

    if (pathname === "/perplexity/enrich" && method === "POST") {
      try {
        let body;
        try {
          body = await request.json(); // { contact, mode }
        } catch {
          return jsonResponse({ error: "Invalid JSON body" }, 400);
        }

        const contact = body.contact || null;
        const mode = body.mode || "research";
        if (!contact) {
          return jsonResponse(
            { error: "Missing 'contact' in request body" },
            400
          );
        }

        // Build a user prompt that includes the prospect JSON and mode
        const userPrompt = `
Prospect JSON:
${JSON.stringify(contact, null, 2)}

Mode: ${mode}

Using the instructions from the system prompt, produce a concise enrichment report for this prospect as readable text only (NO JSON, NO code fences, NO "<think>"). Use headings like "Channels:", "Key People:", "Summary:", and "Fit for Print:".
`.trim();

        // Call Perplexity (sonar) for enrichment
        const pplxRaw = await callPerplexityChat(
          {
            model: "sonar",
            messages: [
              { role: "system", content: enrichmentSystemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 800,
            temperature: 0.2,
          },
          env
        );

        // Extract text content from Perplexity response
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

        if (typeof content !== "string") {
          return new Response(
            "No enrichment details are available for this prospect.",
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "text/plain" },
            }
          );
        }

        let text = content.trim();

        // Strip any <think>...</think> blocks if Perplexity includes them
        const thinkStart = text.indexOf("<think>");
        const thinkEnd = text.lastIndexOf("</think>");
        if (thinkStart !== -1 && thinkEnd !== -1 && thinkEnd > thinkStart) {
          const afterThink = text.slice(thinkEnd + "</think>".length).trim();
          if (afterThink.length > 0) {
            text = afterThink;
          }
        }

        if (!text) {
          text = "No enrichment details are available for this prospect.";
        }

        // Return plain text so the frontend can display it directly
        return new Response(text, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      } catch (err) {
        console.error("POST /perplexity/enrich error:", err);
        return jsonResponse(
          { error: "Failed to call Perplexity enrichment" },
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


