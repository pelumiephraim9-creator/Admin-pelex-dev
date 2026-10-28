function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;"
    })[character]
  );
}

module.exports = {
  name: "chart_tool",

  description:
    "Generate SVG bar charts and line charts from labeled numerical data.",

  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["bar", "line"]
      },

      title: {
        type: "string"
      },

      labels: {
        type: "array",
        items: {
          type: "string"
        }
      },

      values: {
        type: "array",
        items: {
          type: "number"
        }
      }
    },

    required: [
      "type",
      "labels",
      "values"
    ]
  },

  label: a => `${a.type} chart`,

  async run(a) {
    if (
      !Array.isArray(a.labels) ||
      !Array.isArray(a.values) ||
      a.labels.length === 0 ||
      a.labels.length !== a.values.length ||
      a.labels.length > 40
    ) {
      throw new Error(
        "Provide between 1 and 40 matching labels and values."
      );
    }

    const values = a.values.map(Number);

    if (
      values.some(value =>
        !Number.isFinite(value)
      )
    ) {
      throw new Error(
        "All chart values must be valid numbers."
      );
    }

    const width = 800;
    const height = 420;
    const left = 60;
    const top = 55;
    const bottom = 90;
    const plotWidth = width - left - 25;
    const plotHeight = height - top - bottom;

    const max = Math.max(
      1,
      ...values.map(value => Math.abs(value))
    );

    const step = plotWidth / values.length;

    const y = value =>
      top +
      ((max - value) / (2 * max)) *
        plotHeight;

    let marks = "";

    if (a.type === "line") {
      const points = values
        .map((value, index) => {
          const x =
            left + step * (index + 0.5);

          return `${x},${y(value)}`;
        })
        .join(" ");

      marks = `
        <polyline
          points="${points}"
          fill="none"
          stroke="#2563eb"
          stroke-width="3"
        />
      `;

      marks += values
        .map((value, index) => `
          <circle
            cx="${left + step * (index + 0.5)}"
            cy="${y(value)}"
            r="4"
            fill="#2563eb"
          />
        `)
        .join("");
    } else if (a.type === "bar") {
      marks = values
        .map((value, index) => {
          const x =
            left + step * index + step * 0.2;

          const zeroY = y(0);
          const valueY = y(value);

          return `
            <rect
              x="${x}"
              y="${Math.min(zeroY, valueY)}"
              width="${step * 0.6}"
              height="${Math.max(
                1,
                Math.abs(zeroY - valueY)
              )}"
              fill="#60a5fa"
            />
            <text
              x="${x + step * 0.3}"
              y="${valueY - 7}"
              text-anchor="middle"
              font-size="12"
            >${escapeXml(value)}</text>
          `;
        })
        .join("");
    } else {
      throw new Error(
        "Chart type must be bar or line."
      );
    }

    const labels = a.labels
      .map((label, index) => `
        <text
          x="${left + step * (index + 0.5)}"
          y="${height - bottom + 25}"
          text-anchor="middle"
          font-size="12"
        >${escapeXml(label.slice(0, 30))}</text>
      `)
      .join("");

    const svg = `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="${width}"
        height="${height}"
        viewBox="0 0 ${width} ${height}"
      >
        <rect
          width="100%"
          height="100%"
          fill="white"
        />

        <text
          x="${width / 2}"
          y="30"
          text-anchor="middle"
          font-size="20"
        >${escapeXml(a.title || "Chart")}</text>

        <line
          x1="${left}"
          y1="${top}"
          x2="${left}"
          y2="${height - bottom}"
          stroke="#64748b"
        />

        ${marks}
        ${labels}
      </svg>
    `;

    return {
      ok: true,
      type: a.type,
      title: a.title || "Chart",
      svg,
      message:
        "Chart generated. The SVG can be displayed in a compatible frontend or saved as an SVG file."
    };
  }
};
