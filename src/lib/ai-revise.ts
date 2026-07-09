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

function extractHtml(content: string): string {
  const fenced = content.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const doc = content.match(/<!DOCTYPE html[\s\S]*<\/html>/i);
  if (doc?.[0]) return doc[0].trim();

  const htmlTag = content.match(/<html[\s\S]*<\/html>/i);
  if (htmlTag?.[0]) return htmlTag[0].trim();

  return content.trim();
}

export async function reviseEmailWithGrok(
  input: AiReviseInput
): Promise<AiReviseResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "XAI_API_KEY is not set. Add your xAI/Grok API key to use AI revisions."
    );
  }

  const model = process.env.XAI_MODEL || "grok-3";
  const baseUrl = (process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(
    /\/$/,
    ""
  );

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
      `Grok request failed (${res.status}): ${text.slice(0, 300) || res.statusText}`
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };

  const content = data.choices?.[0]?.message?.content || "";
  if (!content.trim()) {
    throw new Error("Grok returned an empty response.");
  }

  const html = extractHtml(content);
  if (!html.includes("<") || html.length < 40) {
    throw new Error("Grok response did not look like valid HTML.");
  }

  return {
    html,
    summary: `Applied feedback from ${input.authorName || "reviewer"} with ${model}`,
    model: data.model || model,
  };
}
