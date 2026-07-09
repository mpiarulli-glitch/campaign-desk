export type AiReviseInput = {
  html: string;
  feedback: string;
  authorName?: string;
  emailTitle?: string;
};

export type AiReviseResult = {
  html: string;
  summary: string;
  model: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function extractHtml(content: string): string {
  const fenced = content.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const doc = content.match(/<!DOCTYPE html[\s\S]*<\/html>/i);
  if (doc?.[0]) return doc[0].trim();

  const htmlTag = content.match(/<html[\s\S]*<\/html>/i);
  if (htmlTag?.[0]) return htmlTag[0].trim();

  return content.trim();
}

function getProviderConfig() {
  if (process.env.GROQ_API_KEY) {
    return {
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
      model: process.env.GROQ_MODEL || "llama-3.1-70b-versatile",
      label: "Groq",
    };
  }
  if (process.env.XAI_API_KEY) {
    return {
      apiKey: process.env.XAI_API_KEY,
      baseUrl: (process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, ""),
      model: process.env.XAI_MODEL || "grok-3",
      label: "xAI Grok",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      label: "OpenAI",
    };
  }
  throw new Error(
    "No AI API key set. Add GROQ_API_KEY (recommended, cheapest), XAI_API_KEY, or OPENAI_API_KEY."
  );
}

export async function reviseEmailWithGrok(
  input: AiReviseInput
): Promise<AiReviseResult> {
  const { apiKey, baseUrl, model, label } = getProviderConfig();

  const system = `You are an expert HTML email developer for Marketing Empire Group.

Revise the provided HTML email based on reviewer feedback.

Rules:
- Return ONLY the full revised HTML email document
- Keep table-based email layout and inline CSS
- Do not use em dashes
- Do not leave a single word alone on the last line of headlines or body copy
- Preserve tracking links, merge tags like {{...}}, and structure unless feedback requires change
- Keep Outlook/VML buttons if present
- Keep preheader and footer/CAN-SPAM address placeholders
- Make the smallest change that fully addresses the feedback
- Do not add markdown explanation outside the HTML`;

  const user = `Email title: ${input.emailTitle || "Untitled"}
Reviewer: ${input.authorName || "Reviewer"}

Feedback to apply:
${input.feedback}

Current HTML:
${input.html}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${label} request failed (${res.status}): ${text.slice(0, 300) || res.statusText}`
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };

  const content = data.choices?.[0]?.message?.content || "";
  if (!content.trim()) {
    throw new Error(`${label} returned an empty response.`);
  }

  const html = extractHtml(content);
  if (!html.includes("<") || html.length < 40) {
    throw new Error(`${label} response did not look like valid HTML.`);
  }

  return {
    html,
    summary: `Applied feedback from ${input.authorName || "reviewer"} with ${model}`,
    model: data.model || model,
  };
}

export async function continueRevisionWithGrok(
  originalHtml: string,
  emailTitle: string,
  history: ChatMessage[],
  newFeedback: string
): Promise<AiReviseResult> {
  const { apiKey, baseUrl, model, label } = getProviderConfig();

  const system = `You are an expert HTML email developer for Marketing Empire Group.

You are in an iterative revision session.

Rules:
- Always return ONLY the full revised HTML email document in your response.
- Keep table-based email layout and inline CSS.
- Do not use em dashes.
- Do not leave a single word alone on the last line of headlines or body copy.
- Preserve tracking links, merge tags like {{...}}, and structure unless feedback requires change.
- Keep Outlook/VML buttons if present.
- Keep preheader and footer/CAN-SPAM address placeholders.
- Respond to the latest feedback while improving on previous versions.
- Do not add markdown explanation outside the HTML.`;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: system },
    {
      role: "user",
      content: `Original email title: ${emailTitle || "Untitled"}

Original HTML (for reference):
${originalHtml}`,
    },
  ];

  // Add previous conversation
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add new feedback
  messages.push({
    role: "user",
    content: `New feedback: ${newFeedback}\n\nPlease provide the updated full HTML.`,
  });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${label} request failed (${res.status}): ${text.slice(0, 300) || res.statusText}`
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };

  const content = data.choices?.[0]?.message?.content || "";
  if (!content.trim()) {
    throw new Error(`${label} returned an empty response.`);
  }

  const html = extractHtml(content);
  if (!html.includes("<") || html.length < 40) {
    throw new Error(`${label} response did not look like valid HTML.`);
  }

  return {
    html,
    summary: `Continued revision with ${model}`,
    model: data.model || model,
  };
}
