// utils/parsePlanWithAI.js
require('dotenv').config();

const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Input: transcript (string with multiple lines: "Name: message")
 * Output (guaranteed JSON):
 * {
 *   title: string|null,
 *   venue: string|null,     // e.g., "Charlatan" or a city/area like "Brugge" if that's the destination
 *   city: string|null,      // optional extra city context
 *   date_iso: "YYYY-MM-DD"|null,
 *   start_time_iso: "HH:MM"|null, // 24h
 *   confidence: number      // 0..1; <=0.4 means not a real plan
 * }
 */
async function parsePlanWithAI(transcript, nowIso) {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string', nullable: true },
      venue: { type: 'string', nullable: true },
      city: { type: 'string', nullable: true },
      date_iso: { type: 'string', nullable: true },
      start_time_iso: { type: 'string', nullable: true },
      confidence: { type: 'number' },
    },
    required: ['title', 'venue', 'city', 'date_iso', 'start_time_iso', 'confidence'],
    additionalProperties: false,
  };

  const system = `
You read casual Dutch/Belgian group chat planning an outing.
You must infer a single most likely plan (1 event) from a short rolling transcript.
- Interpret date words like "vanavond", "morgen", "vrijdag", "zaterdag" in Europe/Brussels relative to NOW=${nowIso}.
- Interpret time formats like "22u", "half 10", "15u", "na 22u" (choose a plausible exact start time).
- If multiple days are mentioned, pick the first clear plan being coordinated unless the user later clarifies.
- venue may be a club/bar/place OR a destination city (e.g., "Brugge" when the plan is to go there).
- If it's not a concrete plan, set confidence <= 0.4.
Return ONLY JSON to the given schema.`;

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: transcript },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'UitgaanPlan', schema, strict: true },
    },
  });

  return JSON.parse(resp.choices[0].message.content);
}

module.exports = { parsePlanWithAI };
