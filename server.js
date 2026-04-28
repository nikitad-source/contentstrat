require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.1-pro-preview"; // Flagship Gemini model — best reasoning + content quality
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ─── Gemini API helper ──────────────────────────────────────────────────────
async function callGemini(systemPrompt, userPrompt, temperature = 0.7, schema = null) {
  const generationConfig = {
    temperature,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
  };

  if (schema) {
    generationConfig.responseSchema = schema;
  }

  const response = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || "Gemini API error");
  }

  if (
    !data.candidates ||
    !data.candidates[0] ||
    !data.candidates[0].content ||
    !data.candidates[0].content.parts
  ) {
    throw new Error("Empty response from Gemini");
  }

  return data.candidates[0].content.parts[0].text;
}

// ─── JSON parser with fallback ──────────────────────────────────────────────
function parseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    // ignore
  }

  const cleaned = raw
    .replace(/```json\s*\n?/g, "")
    .replace(/```\s*\n?/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // ignore
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const match = arrayMatch || objMatch;
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      // ignore
    }
  }

  throw new Error("Could not parse AI response as JSON. Raw: " + raw.slice(0, 200));
}

// ─── Platform format rules ──────────────────────────────────────────────────
const PLATFORM_FORMAT_RULES = {
  Instagram: `Instagram format rules:
- First line IS the hook. 
- Use line breaks aggressively. 
- End with ONE clear CTA.
- Optimal length: 100-200 words.`,
  Facebook: `Facebook format rules:
- Hook works in first 2 lines.
- Stories and personal angles perform best.
- Optimal length: 100-300 words.`,
  YouTube: `YouTube format rules:
- Shorts: 1-2 sentence hook upfront.
- Descriptions: keyword-rich first 2 lines.`,
  LinkedIn: `LinkedIn format rules:
- Punchy single opening line.
- Short paragraphs (1-2 lines max).
- Tone: Credible, opinionated.`,
};

// ─── Objective strategy context ─────────────────────────────────────────────
const OBJECTIVE_CONTEXT = {
  awareness: {
    label: "Brand Awareness",
    strategy: "Lead with the problem. Make them want to check the brand out.",
    cta_direction: "Soft CTAs: learn more, follow.",
    bucket_bias: "Problem-agitation, storytelling.",
  },
  leads: {
    label: "Lead Generation",
    strategy: "Build trust, then obvious low-friction next step.",
    cta_direction: "Direct CTAs: DM us, sign up.",
    bucket_bias: "Value-first, lead magnets.",
  },
  sales: {
    label: "Sales & Conversions",
    strategy: "Focus on proof, urgency, and removing objections.",
    cta_direction: "Hard CTAs: shop now, buy today.",
    bucket_bias: "Social proof, product demos.",
  },
  community: {
    label: "Community Building",
    strategy: "Invite participation, user stories.",
    cta_direction: "Engagement CTAs: what do you think?",
    bucket_bias: "UGC, polls, questions.",
  },
  thought_leadership: {
    label: "Thought Leadership",
    strategy: "Position as definitive voice. Industry trends.",
    cta_direction: "Soft CTAs: what's your take?",
    bucket_bias: "POV essays, industry analysis.",
  },
};

// ─── Input validation helper ────────────────────────────────────────────────
function validateRequired(body, fields) {
  const missing = fields.filter((f) => !body[f]);
  if (missing.length > 0) return `Missing required fields: ${missing.join(", ")}`;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/research", async (req, res) => {
  try {
    const error = validateRequired(req.body, ["brand", "description", "platforms", "objective"]);
    if (error) return res.status(400).json({ success: false, error });

    const { brand, description, platforms, objective } = req.body;
    const objContext = OBJECTIVE_CONTEXT[objective] || OBJECTIVE_CONTEXT["awareness"];

    const system = `You are a senior brand strategist. Analyze objectively and provide actionable insights. Respond ONLY with a valid JSON object.`;
    const user = `Brand: ${brand}\nWhat they do: ${description}\nPlatforms: ${platforms.join(", ")}\nObjective: ${objContext.label}\n\nReturn JSON: { "industry", "product_stage", "audience_summary", "core_pain_points": [], "competitive_landscape", "key_differentiators": [], "content_angles": [], "what_to_avoid", "brand_voice_suggestion", "tonality", "objective_insight" }`;

    const schema = {
      type: "OBJECT",
      properties: {
        industry: { type: "STRING" },
        product_stage: { type: "STRING" },
        audience_summary: { type: "STRING" },
        core_pain_points: { type: "ARRAY", items: { type: "STRING" } },
        competitive_landscape: { type: "STRING" },
        key_differentiators: { type: "ARRAY", items: { type: "STRING" } },
        content_angles: { type: "ARRAY", items: { type: "STRING" } },
        what_to_avoid: { type: "STRING" },
        brand_voice_suggestion: { type: "STRING" },
        tonality: { type: "STRING" },
        objective_insight: { type: "STRING" }
      },
      required: ["industry", "product_stage", "audience_summary", "core_pain_points", "competitive_landscape", "key_differentiators", "content_angles", "what_to_avoid", "brand_voice_suggestion", "tonality", "objective_insight"]
    };

    const raw = await callGemini(system, user, 0.6, schema);
    res.json({ success: true, research: parseJSON(raw) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/personas", async (req, res) => {
  try {
    const { brand, description, platforms, objective, research } = req.body;
    const system = `You are an audience strategist. Build detailed personas. Respond ONLY with a valid JSON array of 3 objects.`;
    const user = `Brand: ${brand}\nObjective: ${objective}\nResearch: ${JSON.stringify(research)}\n\nGenerate 3 personas: { name, who, current_behavior, goal, frustration, content_hook, decision_trigger, posting_implication }`;

    const schema = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          who: { type: "STRING" },
          current_behavior: { type: "STRING" },
          goal: { type: "STRING" },
          frustration: { type: "STRING" },
          content_hook: { type: "STRING" },
          decision_trigger: { type: "STRING" },
          posting_implication: { type: "STRING" }
        },
        required: ["name", "who", "current_behavior", "goal", "frustration", "content_hook", "decision_trigger", "posting_implication"]
      }
    };

    const raw = await callGemini(system, user, 0.7, schema);
    res.json({ success: true, personas: parseJSON(raw) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/buckets", async (req, res) => {
  try {
    const { brand, description, platforms, objective, research, personas, globalFeedback } = req.body;
    const system = `You are a content strategist. Design content bucket frameworks. Respond ONLY with a valid JSON array of 5 objects.`;
    const user = `Brand: ${brand}\nObjective: ${objective}\nResearch: ${JSON.stringify(research)}\nPersonas: ${JSON.stringify(personas)}\nGlobal Feedback: ${globalFeedback || "None"}\n\nGenerate 5 buckets: { name, function, purpose, description, content_formats: [], why_for_persona, cta }`;

    const schema = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          function: { type: "STRING" },
          purpose: { type: "STRING" },
          description: { type: "STRING" },
          content_formats: { type: "ARRAY", items: { type: "STRING" } },
          why_for_persona: { type: "STRING" },
          cta: { type: "STRING" }
        },
        required: ["name", "function", "purpose", "description", "content_formats", "why_for_persona", "cta"]
      }
    };

    const raw = await callGemini(system, user, 0.65, schema);
    res.json({ success: true, buckets: parseJSON(raw) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/posts", async (req, res) => {
  try {
    const { brand, platforms, objective, research, personas, bucket, globalFeedback, bucketFeedback } = req.body;
    const platformPosts = {};

    for (const platform of platforms) {
      const formatRules = PLATFORM_FORMAT_RULES[platform] || "";
      const system = `You are a social media copywriter. Write specific content for humans on ${platform}. Respond ONLY with a JSON array of 5 post objects.`;
      const user = `Brand: ${brand}\nPlatform: ${platform}\nObjective: ${objective}\nBucket: ${bucket.name}\n${formatRules}\n\nGlobal Feedback: ${globalFeedback || "None"}\nBucket Feedback: ${bucketFeedback || "None"}\n\nReturn 5 objects: { idea, visual_cue, inner_copy, caption }`;

      const schema = {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            idea: { type: "STRING" },
            visual_cue: { type: "STRING" },
            inner_copy: { type: "STRING" },
            caption: { type: "STRING" }
          },
          required: ["idea", "visual_cue", "inner_copy", "caption"]
        }
      };

      const raw = await callGemini(system, user, 0.8, schema);
      platformPosts[platform] = parseJSON(raw);
    }
    res.json({ success: true, posts: platformPosts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/regenerate-post", async (req, res) => {
  try {
    const { brand, platform, objective, currentPost, feedback } = req.body;
    const system = `You are an expert copywriter. Rewrite a single post based on feedback. Respond ONLY with a valid JSON object.`;
    const user = `Brand: ${brand}\nPlatform: ${platform}\nDraft: ${JSON.stringify(currentPost)}\nFeedback: ${feedback}\n\nReturn: { idea, visual_cue, inner_copy, caption }`;

    const schema = {
      type: "OBJECT",
      properties: {
        idea: { type: "STRING" },
        visual_cue: { type: "STRING" },
        inner_copy: { type: "STRING" },
        caption: { type: "STRING" }
      },
      required: ["idea", "visual_cue", "inner_copy", "caption"]
    };

    const raw = await callGemini(system, user, 0.7, schema);
    res.json({ success: true, post: parseJSON(raw) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

// For Vercel
module.exports = app;
