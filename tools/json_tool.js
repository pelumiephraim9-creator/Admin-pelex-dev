module.exports = {
  name: "json_tool",

  description:
    "Validate, format, and compact JSON data provided by the user.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "validate",
          "pretty",
          "compact"
        ],
        description: "Operation to perform"
      },

      json: {
        type: "string",
        description: "JSON text to process"
      }
    },

    required: ["action", "json"]
  },

  label: a => `JSON ${a.action}`,

  async run(a) {
    if (typeof a.json !== "string") {
      throw new Error(
        "Please provide JSON text."
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(a.json);
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        message:
          "The supplied text is not valid JSON."
      };
    }

    if (a.action === "pretty") {
      return {
        valid: true,
        result: JSON.stringify(
          parsed,
          null,
          2
        )
      };
    }

    if (a.action === "compact") {
      return {
        valid: true,
        result: JSON.stringify(parsed)
      };
    }

    return {
      valid: true,
      message: "The JSON is valid."
    };
  }
};
