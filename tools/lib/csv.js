function parseCsv(s) {
  if (!s || !s.trim()) return [];

  let lines = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < s.length; i++) {
    let c = s[i];

    if (c === '"' && quoted && s[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && s[i + 1] === "\n") i++;

      row.push(cell);

      if (row.some(x => x !== "")) {
        lines.push(row);
      }

      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }

  row.push(cell);

  if (row.some(x => x !== "")) {
    lines.push(row);
  }

  if (!lines.length) return [];

  const headers = lines.shift().map(
    (x, i) => x.trim() || `column_${i + 1}`
  );

  return lines.map(values =>
    Object.fromEntries(
      headers.map((key, i) => [
        key,
        (values[i] || "").trim()
      ])
    )
  );
}

function stringifyCsv(rows) {
  if (!rows.length) return "";

  const headers = [
    ...new Set(rows.flatMap(Object.keys))
  ];

  const encode = value => {
    value = String(value ?? "");

    return /[",\r\n]/.test(value)
      ? `"${value.replace(/"/g, '""')}"`
      : value;
  };

  return [
    headers.map(encode).join(","),
    ...rows.map(row =>
      headers.map(key => encode(row[key])).join(",")
    )
  ].join("\r\n");
}

function cleanRows(rows) {
  const cleaned = rows.map(row =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "string"
          ? value.trim()
          : value
      ])
    )
  );

  const seen = new Set();

  const uniqueRows = cleaned.filter(row => {
    const key = JSON.stringify(row);

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });

  return {
    rows: uniqueRows
  };
}

module.exports = {
  parseCsv,
  stringifyCsv,
  cleanRows
};
