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

    // Helper for consistent JSON responses
    const jsonResponse = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // ---------- Shared helpers ----------

    async function callGrokChat(body) {
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

    async function callPerplexityChat(body) {
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

    async function callOpenAIChat(body) {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
          `OpenAI chat error ${res.status}: ${text.slice(0, 500)}`
        );
      }

      return res.json();
    }

    const enrichmentSystemPrompt = `
You are the enrichment engine for a B2B sales desk that finds advertisers for a print media marketplace.

You receive partial prospect records (company, contact, website, city, notes, activity snapshot) and must:
1. Normalize and clean existing data (phone formats, URLs, capitalization).
2. Infer missing business attributes using general knowledge and web context, but NEVER hallucinate specifics.
3. Provide a short, neutral business summary and suggested next outreach step.

Rules:
- Only infer attributes that are highly plausible for this specific prospect.
- If you are not reasonably confident, return null for that field.
- Do not invent private emails, phone numbers, or personal data. You may suggest public company-level info only.
- Keep your output strictly as compact JSON, no explanations or comments.
`.trim();

    function buildEnrichmentUserPrompt(contact, mode) {
      return `
# Prospect

${JSON.stringify(contact, null, 2)}

# Task

Mode: ${mode}

Allowed modes:
- "quick-clean" – normalize existing fields only.
- "research" – suggest missing business attributes and summary.
- "next-step" – suggest one recommended next outreach action and reason.

# Output format

Return ONLY a JSON object with this shape:

{
  "normalized": {
    "name": string | null,
    "title": string | null,
    "company": string | null,
    "phone": string | null,
    "website": string | null,
    "address": string | null
  },
  "inferred": {
    "industry": string | null,
    "company_size": "1-10" | "11-50" | "51-200" | "201-1000" | "1001+" | null,
    "hq_city": string | null,
    "hq_country": string | null,
    "likely_print_advertiser": boolean | null,
    "reasoning": string | null
  },
  "summary": {
    "overview": string | null,
    "why_relevant_for_print": string | null
  },
  "next_action": {
    "label": string | null,
    "channel": "call" | "email" | "sms" | "linkedin" | "other" | null,
    "script": string | null
  }
}
`.trim();
    }

    const pipelineMergePrompt = `
You are the final enrichment formatter for a B2B sales desk that finds advertisers for a print media marketplace.

You receive:
- The original prospect record.
- A "facts" object from Perplexity (company details and context).
- An "actions" object from Grok (reasoning and suggested next steps).

Your job is to merge these into a single, concise JSON object with this schema:

{
  "normalized": {
    "name": string | null,
    "title": string | null,
    "company": string | null,
    "phone": string | null,
    "website": string | null,
    "address": string | null
  },
  "inferred": {
    "industry": string | null,
    "company_size": "1-10" | "11-50" | "51-200" | "201-1000" | "1001+" | null,
    "hq_city": string | null,
    "hq_country": string | null,
    "likely_print_advertiser": boolean | null,
    "reasoning": string | null
  },
  "summary": {
    "overview": string | null,
    "why_relevant_for_print": string | null
  },
  "next_action": {
    "label": string | null,
    "channel": "call" | "email" | "sms" | "linkedin" | "other" | null,
    "script": string | null
  }
}

Guidelines:
- Prefer factual fields from the Perplexity "facts" layer when available.
- Prefer reasoning and next-step suggestions from the Grok "actions" layer.
- Keep everything concise and scannable.
- summary.overview: 1–2 sentences, max ~35 words total.
- summary.why_relevant_for_print: 1 sentence, max ~25 words.
- inferred.reasoning: 1–2 sentences, max ~35 words.
- next_action.script: 2–3 short sentences, max ~60 words.
- Do not invent private emails or phone numbers; you may use public company websites only.
- If something is unknown or uncertain, set that field to null.
- Return strictly valid JSON only, with no markdown, no comments, no extra keys.
`.trim();

    // More robust JSON extractor (handles code fences, extra text, etc.)
    function extractJsonContentFromLLM(rawJson, label) {
      let content = rawJson?.choices?.[0]?.message?.content;
      // Some APIs return content as array-of-parts
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
        console.error(`Unexpected ${label} content:`, content);
        return { error: `Unexpected ${label} response format` };
      }
      let text = content.trim();
      // 1) Strip markdown code fences, e.g. ```json ... ```
      if (text.startsWith("```")) {
        text = text.replace(/^```[a-zA-Z0-9]*\s*/, "");
        const lastFence = text.lastIndexOf("```");
        if (lastFence !== -1) {
          text = text.slice(0, lastFence);
        }
        text = text.trim();
      }
      // 2) First attempt: parse whole string
      try {
        return JSON.parse(text);
      } catch (e) {
        console.warn(
          `${label} JSON parse failed on full text, trying substring…`
        );
      }
      // 3) Second attempt: from first '{' to last '}'
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const sub = text.slice(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(sub);
        } catch (e2) {
          console.error(
            `${label} JSON parse failed on substring:`,
            sub.slice(0, 400)
          );
        }
      }
      console.error(`${label} final JSON parse failure:`, text.slice(0, 400));
      // 👇 NEW BEHAVIOR HERE
      if (label === "Perplexity") {
        // Don't hard-fail Perplexity – just return raw text so the UI can show it.
        return { raw: text.slice(0, 500) };
      }
      return {
        error: `${label} did not return valid JSON`,
        raw: text.slice(0, 500),
      };
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
    // Grok enrichment endpoint: POST /grok/enrich
    // ----------------------------------------------------
    if (pathname === "/grok/enrich" && method === "POST") {
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

        const userPrompt = buildEnrichmentUserPrompt(contact, mode);

        const grokRaw = await callGrokChat({
          model: "grok-4",
          messages: [
            { role: "system", content: enrichmentSystemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 800,
          temperature: 0.2,
        });

        const parsed = extractJsonContentFromLLM(grokRaw, "Grok");
        if (parsed.error) return jsonResponse(parsed, 502);
        return jsonResponse(parsed, 200);
      } catch (err) {
        console.error("POST /grok/enrich error:", err);
        return jsonResponse(
          { error: "Failed to call Grok enrichment" },
          500
          );
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

        const userPrompt = buildEnrichmentUserPrompt(contact, mode);

        const pplxRaw = await callPerplexityChat({
          model: "sonar-reasoning",
          messages: [
            { role: "system", content: enrichmentSystemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 800,
          temperature: 0.2,
        });

        // Try to parse JSON, but fall back to raw text instead of throwing an error
        let content = pplxRaw?.choices?.[0]?.message?.content;
        if (Array.isArray(content)) {
          content = content
            .map((part) =>
              typeof part === "string" ? part : part?.text || JSON.stringify(part)
            )
            .join("");
        }
        let text = (content || "").trim();

        // First try: JSON as-is
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Second try: from first { to last }
          const firstBrace = text.indexOf("{");
          const lastBrace = text.lastIndexOf("}");
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            const sub = text.slice(firstBrace, lastBrace + 1);
            try {
              parsed = JSON.parse(sub);
            } catch {
              // Still no luck: just return raw
              parsed = { raw: text };
            }
          } else {
            parsed = { raw: text };
          }
        }

        return jsonResponse(parsed, 200);
      } catch (err) {
        console.error("POST /perplexity/enrich error:", err);
        return jsonResponse(
          { error: "Failed to call Perplexity enrichment" },
          500
        );
      }
    }

    // ----------------------------------------------------
    // Unified 3-layer enrichment pipeline: POST /enrich/pipeline
    // Perplexity -> Grok -> OpenAI
    // ----------------------------------------------------
    if (pathname === "/enrich/pipeline" && method === "POST") {
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

        // ---------- Layer 1: Perplexity facts ----------
        const factsPrompt = buildEnrichmentUserPrompt(contact, mode);

        let pplxRaw;
        try {
          pplxRaw = await callPerplexityChat({
            model: "sonar-reasoning",
            messages: [
              { role: "system", content: enrichmentSystemPrompt },
              { role: "user", content: factsPrompt },
            ],
            max_tokens: 800,
            temperature: 0.2,
          });
        } catch (e) {
          console.error("Pipeline Perplexity error:", e);
          // Continue with null facts so pipeline can still run
          pplxRaw = null;
        }

        let facts = null;
        if (pplxRaw) {
          const parsedFacts = extractJsonContentFromLLM(pplxRaw, "Perplexity");
          // If parsing fails, just keep raw text; no hard error
          if (parsedFacts && !parsedFacts.error) {
            facts = parsedFacts;
          } else if (parsedFacts && parsedFacts.raw) {
            facts = { raw: parsedFacts.raw };
          }
        }

        // ---------- Layer 2: Grok actions ----------
        const actionsPrompt = `
Use the original prospect and optional facts data below to propose a concise next outreach step and any missing inferences.

Prospect:
${JSON.stringify(contact, null, 2)}

Facts (may be null):
${JSON.stringify(facts, null, 2)}

Mode: ${mode}

Return JSON in the same schema as before; if a field is unknown, set it to null. You may reuse fields from the facts layer but focus on reasoning and next_action.
`.trim();

        let grokRaw;
        try {
          grokRaw = await callGrokChat({
            model: "grok-4",
            messages: [
              { role: "system", content: enrichmentSystemPrompt },
              { role: "user", content: actionsPrompt },
            ],
            max_tokens: 800,
            temperature: 0.2,
          });
        } catch (e) {
          console.error("Pipeline Grok error:", e);
          grokRaw = null;
        }

        let actions = null;
        if (grokRaw) {
          const parsedActions = extractJsonContentFromLLM(grokRaw, "Grok");
          if (parsedActions && !parsedActions.error) {
            actions = parsedActions;
          } else if (parsedActions && parsedActions.raw) {
            actions = { raw: parsedActions.raw };
          }
        }

        // ---------- Layer 3: OpenAI merge/normalize ----------
        const mergeUserPrompt = `
You are given three JSON blobs:

1) prospect: the raw prospect record.
2) facts: factual enrichment from Perplexity (may be null).
3) actions: reasoning + next steps from Grok (may be null).

Your job is to merge them into a single JSON object using the schema described earlier.

prospect JSON:
${JSON.stringify(contact, null, 2)}

facts JSON:
${JSON.stringify(facts, null, 2)}

actions JSON:
${JSON.stringify(actions, null, 2)}

Return ONLY the final JSON object, using all guidelines from the system prompt.
`.trim();

        let finalJson;
        try {
          const openaiRaw = await callOpenAIChat({
            model: "gpt-4.1-mini",
            messages: [
              { role: "system", content: pipelineMergePrompt },
              { role: "user", content: mergeUserPrompt },
            ],
            max_tokens: 800,
            temperature: 0.2,
          });

          finalJson = extractJsonContentFromLLM(openaiRaw, "OpenAI");
        } catch (e) {
          console.error("Pipeline OpenAI merge error:", e);
          // As a last resort, fall back to actions or facts
          finalJson = actions || facts || { error: "Pipeline merge failed" };
        }

        return jsonResponse(finalJson, 200);
        } catch (err) {
        console.error("POST /enrich/pipeline error:", err);
        return jsonResponse(
          { error: "Failed to run enrichment pipeline" },
          500
          );
        }
      }
  
      // ----------------------------------------------------
    // Existing OpenAI Responses API proxy (default POST)
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

    // For Responses API we allow input to be string OR array-of-input-items.
    // We just pass it through as-is.
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


