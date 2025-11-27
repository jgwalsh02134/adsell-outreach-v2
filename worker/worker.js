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
  
      // ----------------------------------------------------
      // Shared contacts API (backed by KV: env.ADSELL_DATA)
      // ----------------------------------------------------
  
      // GET /contacts → return shared contacts JSON
      if (pathname === "/contacts" && method === "GET") {
        try {
          const raw = await env.ADSELL_DATA.get("shared_contacts");
  
          if (!raw) {
            // Nothing stored yet: return empty structure
            const empty = {
              contacts: [],
              activities: [],
              scripts: [],
              tags: [],
              customFields: [],
            };
  
            return new Response(JSON.stringify(empty), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
  
          return new Response(raw, {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("GET /contacts error:", err);
          return new Response(
            JSON.stringify({ error: "Failed to load shared contacts" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }
  
      // POST /contacts/import → save shared contacts JSON
      if (pathname === "/contacts/import" && method === "POST") {
        try {
          const bodyText = await request.text();
  
          let parsed;
          try {
            parsed = JSON.parse(bodyText);
          } catch (e) {
            return new Response(
              JSON.stringify({ error: "Invalid JSON body" }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }
  
          // Store as-is under a single key
          await env.ADSELL_DATA.put("shared_contacts", JSON.stringify(parsed));
  
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("POST /contacts/import error:", err);
          return new Response(
            JSON.stringify({ error: "Failed to save contacts" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }
  
      // ----------------------------------------------------
      // RocketReach enrich endpoint
      // ----------------------------------------------------
      if (pathname === "/rocketreach/enrich" && method === "POST") {
        try {
          let body;
          try {
            body = await request.json(); // expected: { name, company, domain }
          } catch (e) {
            return new Response(
              JSON.stringify({ error: "Invalid JSON body" }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }
  
          const apiKey = env.ROCKETREACH_API_KEY;
          if (!apiKey) {
            console.error("ROCKETREACH_API_KEY not configured");
            return new Response(
              JSON.stringify({ error: "ROCKETREACH_API_KEY not configured" }),
              {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }
  
          // Build RocketReach URL per docs: GET /api/v2/profile-company/lookup
          const rrUrl = new URL(
            "https://api.rocketreach.co/api/v2/profile-company/lookup"
          );
          rrUrl.searchParams.set("api_key", apiKey);
  
          if (body.name) {
            rrUrl.searchParams.set("name", body.name);
          }
          if (body.company) {
            rrUrl.searchParams.set("current_employer", body.company);
          }
          // Optional: include domain if you have it and your plan supports it
          if (body.domain) {
            rrUrl.searchParams.set("domain", body.domain);
          }
  
          const rrResponse = await fetch(rrUrl.toString(), { method: "GET" });
  
          if (!rrResponse.ok) {
            const errText = await rrResponse.text();
            console.error(
              "RocketReach error:",
              rrResponse.status,
              errText.slice(0, 500)
            );
            return new Response(
              JSON.stringify({
                error: "RocketReach request failed",
                status: rrResponse.status,
              }),
              {
                status: 502,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }
  
          const rrData = await rrResponse.json();
  
          // Shape the response to only what the frontend needs.
          // These mappings are defensive; if fields differ, `raw` always has the full payload.
          const result = {
            email:
              rrData.email ||
              rrData.email_address ||
              rrData.emails?.[0]?.email ||
              rrData.person?.email,
            phone:
              rrData.phone ||
              rrData.phones?.[0]?.number ||
              rrData.person?.phones?.[0]?.number,
            title:
              rrData.title ||
              rrData.current_title ||
              rrData.person?.current_title,
            linkedin:
              rrData.linkedin_url ||
              rrData.linkedin ||
              rrData.person?.linkedin_url,
            raw: rrData,
          };
  
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("POST /rocketreach/enrich error:", err);
          return new Response(
            JSON.stringify({ error: "Failed to call RocketReach" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }
  
      // ----------------------------------------------------
      // Existing AI proxy (Responses API + optional web search)
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
      } catch (e) {
        return new Response(
          JSON.stringify({ error: "Invalid JSON body" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
  
      const input = json.input ?? "";
      const mode = json.mode ?? "default";
  
      // Enable web search only for research mode
      const tools =
        mode === "research"
          ? [{ type: "web_search_preview" }]
          : [];
  
      const openaiBody = JSON.stringify({
        model: "gpt-4.1-mini",
        input,
        // Only include tools when needed
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