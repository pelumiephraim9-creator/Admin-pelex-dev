if (!response.ok) {
  const errorBody = await response.text();

  throw new Error(
    `OpenRouter request failed (${response.status}): ${errorBody}`,
  );
}

const data = (await response.json()) as {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  model?: string;
};

const text = data.choices?.[0]?.message?.content;

if (typeof text !== "string" || !text.trim()) {
  throw new Error("OpenRouter returned an empty response.");
}

return {
  text,
  model: data.model || FREE_ROUTER,
};