// Writes the small sample PDFs the real PDF extractor is checked against.
// Run: node test/fixtures/pdf/make-samples.mjs   (output is committed; no network needed)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));

/** Build a minimal PDF: one Helvetica text page per entry, plus an optional outline. */
function buildPdf({ title, pages, outline }) {
  const objects = []; // index i holds object number i + 1
  const add = (body) => objects.push(body) && objects.length;
  const reserve = () => objects.push(null) && objects.length;

  const catalog = reserve();
  const pagesObj = reserve();
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageObjs = pages.map((lines) => {
    const ops = ["BT", "/F1 12 Tf", "14 TL", "72 720 Td"];
    for (const line of lines) ops.push(`(${line.replace(/[()\\]/g, "\\$&")}) Tj T*`);
    ops.push("ET");
    const stream = ops.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
    );
  });
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageObjs.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageObjs.length} >>`;

  let outlines = null;
  if (outline) {
    outlines = reserve();
    // Each item: { title, page (1-based), children? }. Written as a linked list per level.
    const writeLevel = (items, parent) => {
      const nums = items.map(() => reserve());
      items.forEach((item, i) => {
        const kids = item.children?.length ? writeLevel(item.children, nums[i]) : null;
        const parts = [
          `/Title (${item.title})`,
          `/Parent ${parent} 0 R`,
          `/Dest [${pageObjs[item.page - 1]} 0 R /XYZ 0 792 0]`,
        ];
        if (i > 0) parts.push(`/Prev ${nums[i - 1]} 0 R`);
        if (i < items.length - 1) parts.push(`/Next ${nums[i + 1]} 0 R`);
        if (kids) parts.push(`/First ${kids.first} 0 R /Last ${kids.last} 0 R /Count ${kids.count}`);
        objects[nums[i] - 1] = `<< ${parts.join(" ")} >>`;
      });
      return { first: nums[0], last: nums[nums.length - 1], count: items.length };
    };
    const top = writeLevel(outline, outlines);
    objects[outlines - 1] = `<< /Type /Outlines /First ${top.first} 0 R /Last ${top.last} 0 R /Count ${top.count} >>`;
  }
  objects[catalog - 1] =
    `<< /Type /Catalog /Pages ${pagesObj} 0 R` + (outlines ? ` /Outlines ${outlines} 0 R /PageMode /UseOutlines` : "") + " >>";
  const info = add(`<< /Title (${title}) >>`);

  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

writeFileSync(
  `${dir}/book-with-outline.pdf`,
  buildPdf({
    title: "Streams in Practice",
    pages: [
      ["Streams in Practice", "A short sample book."],
      ["Chapter 1: Logs", "A log is an append-only sequence of records."],
      ["Each record gets an offset.", "Consumers read records in offset order."],
      ["Chapter 2: Partitions", "A topic is split into partitions."],
      ["Partitions let consumers share the work."],
      ["Chapter 3: Consumer groups", "Members of a group share the partitions."],
    ],
    outline: [
      { title: "Chapter 1: Logs", page: 2, children: [{ title: "Offsets", page: 3 }] },
      { title: "Chapter 2: Partitions", page: 4 },
      { title: "Chapter 3: Consumer groups", page: 6 },
    ],
  }),
);

writeFileSync(
  `${dir}/paper-no-outline.pdf`,
  buildPdf({
    title: "A Note on Retries",
    pages: [["Retries need backoff."], ["Jitter spreads retries out."], ["Idempotency makes retries safe."]],
  }),
);
