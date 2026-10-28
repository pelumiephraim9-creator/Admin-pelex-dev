const fs = require("node:fs/promises");
const path = require("node:path");

const OUTPUT_DIR = path.resolve(
  process.env.PELEX_OUTPUT_DIR || "./generated"
);

module.exports = {
  name: "document_tool",

  description:
    "Create text, Markdown, JSON, and CSV files from user-provided content.",

  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "Filename without a file extension"
      },

      content: {
        type: "string",
        description: "Content to save in the document"
      },

      format: {
        type: "string",
        enum: ["txt", "md", "json", "csv"]
      }
    },

    required: ["filename", "content", "format"]
  },

  label: () => "Create document",

  async run(a) {
    const allowedFormats = [
      "txt",
      "md",
      "json",
      "csv"
    ];

    if (!allowedFormats.includes(a.format)) {
      throw new Error(
        "Unsupported document format."
      );
    }

    const filename = String(a.filename || "")
      .replace(/\.[^.]+$/, "");

    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(
        filename
      )
    ) {
      throw new Error(
        "Please provide a valid filename using letters, numbers, dots, underscores, or hyphens."
      );
    }

    let content = String(a.content ?? "");

    if (a.format === "json") {
      try {
        content = JSON.stringify(
          JSON.parse(content),
          null,
          2
        );
      } catch {
        throw new Error(
          "The content must be valid JSON."
        );
      }
    }

    await fs.mkdir(OUTPUT_DIR, {
      recursive: true
    });

    const outputPath = path.join(
      OUTPUT_DIR,
      `${filename}.${a.format}`
    );

    await fs.writeFile(
      outputPath,
      content,
      "utf8"
    );

    return {
      ok: true,
      filename: `${filename}.${a.format}`,
      bytes: Buffer.byteLength(content),
      message:
        "The document was saved on the server. A secure download route is still required before customers can download it."
    };
  }
};
