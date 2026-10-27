if (!message) {
  return reply.code(400).send({
    error: "Please provide a message.",
  });
}

const history = Array.isArray(request.body.history)
  ? request.body.history
      .filter(
        (item) =>
          item &&
          ["user", "assistant"].includes(item.role) &&
          typeof item.content === "string",
      )
      .slice(-10)
      .map((item) => ({
        role: item.role,
        content: item.content.slice(0, 4000),
      }))
  : [];

const messages: ChatMessage[] = [
  {
    role: "system",
    content:
      "You are Uncle Pelex AI, a friendly, professional AI assistant. Give useful, clear, and honest answers.",
  },
  ...history,
  {
    role: "user",
    content: message.slice(0, 4000),
  },
];

try {
  const result = await chatWithFreeModel(messages, {
    maxTokens: 700,
  });

  return {
    reply: result.text,
    model: result.model,
  };
} catch (error) {
  request.log.error(error, "Chat request failed");

  return reply.code(503).send({
    error:
      "Pelex AI is temporarily unable to respond. Please try again shortly.",
  });
}