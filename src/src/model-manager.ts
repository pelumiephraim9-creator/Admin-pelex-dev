if (isTemporarilyUnavailable(model)) {
  break;
}

const controller = new AbortController();
const timeout = setTimeout(
  () => controller.abort(),
  REQUEST_TIMEOUT_MS,
);

try {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.FRONTEND_URL || "https://unclepelex.netlify.app",
      "X-Title": "Pelex AI",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: Math.min(
        Math.max(options.maxTokens ?? 500, 1),
        1000,
      ),
      temperature: 0.7,
    }),
    signal: controller.signal,
  });

  if (response.ok) {
    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null };
      }>;
      model?: string;
    };

    const text = data.choices?.[0]?.message?.content;

    if (typeof text !== "string" || !text.trim()) {
      throw new Error("The model returned an empty response.");
    }

    return {
      text,
      model: data.model || FREE_ROUTER,
    };
  }

  const errorBody = await response.text();

  // Authentication or malformed requests should not be retried.
  if (response.status === 400 || response.status === 401 ||
      response.status === 403) {
    throw new Error(
      `OpenRouter rejected the request (${response.status}): ${errorBody}`,
    );
  }

  // Account-wide quota exhaustion cannot reliably be fixed by
  // repeating the same request.
  if (response.status === 402 || response.status === 429) {
    throw new Error(
      `OpenRouter usage limit or rate limit reached (${response.status}): ${errorBody}`,
    );
  }

  lastError = new Error(
    `OpenRouter request failed (${response.status}): ${errorBody}`,
  );

  markUnavailable(model);
} catch (error) {
  lastError = error;

  if (
    error instanceof Error &&
    /OpenRouter rejected the request|usage limit or rate limit reached/.test(
      error.message,
    )
  ) {
    throw error;
  }
} finally {
  clearTimeout(timeout);
}