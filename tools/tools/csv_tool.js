const {
  parseCsv,
  stringifyCsv,
  cleanRows
} = require("./lib/csv");

module.exports = {
  name: "csv_tool",

  description:
    "Read, clean, summarize, sort, filter, deduplicate, or export CSV data.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "read",
          "clean",
          "summary",
          "sort",
          "filter",
          "deduplicate",
          "export"
        ]
      },
      csv: {
        type: "string",
        description: "CSV text to process"
      },
      column: {
        type: "string",
        description: "Column name for sorting or filtering"
      },
      value: {
        type: "string",
        description: "Value to match when filtering"
      },
      direction: {
        type: "string",
        enum: ["asc", "desc"]
      }
    },
    required: ["action", "csv"]
  },

  label: a => `CSV ${a.action}`,

  async run(a) {
    const rows = parseCsv(a.csv);

    if (!rows.length) {
      return {
        rows: [],
        rowCount: 0,
        message: "No CSV data was provided."
      };
    }

    let result = rows;

    if (a.action === "clean") {
      result = cleanRows(rows).rows;
    }

    if (a.action === "deduplicate") {
      const seen = new Set();

      result = rows.filter(row => {
        const key = JSON.stringify(row);

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      });
    }

    if (a.action === "sort") {
      if (!a.column || !(a.column in rows[0])) {
        throw new Error(
          "The requested column does not exist."
        );
      }

      const direction =
        a.direction === "desc" ? -1 : 1;

      result = [...rows].sort((x, y) =>
        direction *
        String(x[a.column] ?? "").localeCompare(
          String(y[a.column] ?? ""),
          undefined,
          { numeric: true }
        )
      );
    }

    if (a.action === "filter") {
      if (!a.column || !(a.column in rows[0])) {
        throw new Error(
          "The requested column does not exist."
        );
      }

      const searchValue = String(
        a.value ?? ""
      ).toLowerCase();

      result = rows.filter(row =>
        String(row[a.column] ?? "")
          .toLowerCase()
          .includes(searchValue)
      );
    }

    if (a.action === "summary") {
      const columns = Object.keys(rows[0]);

      return {
        rowCount: rows.length,
        columns,
        missingByColumn: Object.fromEntries(
          columns.map(column => [
            column,
            rows.filter(
              row =>
                !String(row[column] ?? "").trim()
            ).length
          ])
        ),
        duplicateRows:
          rows.length -
          new Set(rows.map(row =>
            JSON.stringify(row)
          )).size
      };
    }

    if (a.action === "export") {
      return {
        csv: stringifyCsv(rows),
        rowCount: rows.length
      };
    }

    return {
      action: a.action,
      rows: result,
      rowCount: result.length,
      csv: stringifyCsv(result)
    };
  }
};