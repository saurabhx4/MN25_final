// Small dependency-free PDF renderer. It intentionally renders the validated
// structured report snapshot rather than inventing charts/images. If a map or
// chart image is supplied by a future renderer it can be added as an asset.
function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ');
}

function wrap(text: string, width = 88): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) {
      if (line) out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
}

type Section = { title: string; paragraphs?: string[]; rows?: Array<[string, string]>; bullets?: string[] };

export async function renderReportPdf(report: { title: string; region: string; reportId: string; generatedAt: string; modelVersion?: string | null }, sections: Section[]): Promise<Buffer> {
  const pages: string[][] = [[]];
  const page = () => pages[pages.length - 1];
  const add = (line: string, size = 10, bold = false) => {
    if (page().length > 50) pages.push([]);
    page().push(`${size}|${bold ? 1 : 0}|${line}`);
  };

  add('MN25', 22, true);
  add('MANGANESE EXPLORATION INTELLIGENCE', 9);
  add(report.title, 20, true);
  add(report.region, 12);
  add(`Report ID: ${report.reportId}`, 8);
  add(`Generated: ${report.generatedAt}`, 8);
  add(`Model: ${report.modelVersion ?? 'Unavailable'}`, 8);
  add('');

  for (const s of sections) {
    add(s.title.toUpperCase(), 13, true);
    for (const p of s.paragraphs ?? []) for (const line of wrap(p)) add(line, 9);
    for (const row of s.rows ?? []) add(`${row[0]}: ${row[1]}`, 9);
    for (const b of s.bullets ?? []) for (const line of wrap(`- ${b}`)) add(line, 9);
    add('');
  }

  const bodies: string[] = [];
  bodies.push('<< /Type /Catalog /Pages 2 0 R >>');
  bodies.push(''); // Pages, filled after page ids are known.
  bodies.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const contentIds: number[] = [];
  for (const lines of pages) {
    const content: string[] = ['BT', '45 790 Td'];
    for (const raw of lines) {
      const [sizeRaw, boldRaw, ...parts] = raw.split('|');
      const size = Number(sizeRaw) || 10;
      const text = parts.join('|');
      if (!text) { content.push('0 -8 Td'); continue; }
      content.push(`/F1 ${size} Tf`);
      content.push(`0 -${Math.max(13, size + 5)} Td`);
      content.push(`(${esc(text)}) Tj`);
      void boldRaw;
    }
    content.push('ET');
    content.push('BT');
    content.push('/F1 7 Tf');
    content.push('45 24 Td');
    content.push(`(MN25 | Page ${pages.indexOf(lines) + 1} of ${pages.length}) Tj`);
    content.push('ET');
    const stream = content.join('\n');
    contentIds.push(bodies.length + 1);
    bodies.push(`<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`);
  }

  const pageIds: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    pageIds.push(bodies.length + 1);
    bodies.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIds[i]} 0 R >>`);
  }
  bodies[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  bodies.forEach((body, idx) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}
