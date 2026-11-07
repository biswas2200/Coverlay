// A small Word (.docx) writer with no library: the page has no build step, and a resume or a cover
// letter only needs paragraphs, bullets, tabs, links, colour and tables. A .docx is a zip of XML
// files, so this file has two parts: zipStore() writes a zip (stored, not compressed: a letter is a
// few KB) and buildDocx() writes the WordprocessingML. DOM-free, so tests/docx-writer.test.js runs it
// in Node and the page hands the bytes to a download.
//
// The blocks it takes (all lengths in points unless the name says otherwise):
//   { type: 'p', runs, align?, before?, after?, line?, indent?, hanging?, bullet?, tabRight?, rule?,
//     keepNext?, columnBreakBefore?, endsSection? }
//   { type: 'table', rows: [[{ blocks, span?, rowspan? }]], look: { borders, width, style, padding, gap }, width? }
//   (a table's own `width` is its width in points; it defaults to the text width)
// and a run is { text?, tab?, bold?, italic?, underline?, color?, size?, caps?, spacing?, href? }.

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TWIPS_PER_MM = 1440 / 25.4;

// ---------- the zip ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of some bytes, as a zip stores it. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 1 Jan 2026, fixed so the same document is the same bytes
const DOS_TIME = 0;

/** A zip file of `[{ name, data }]` (data is a string or bytes), stored without compression. */
export function zipStore(files) {
  const entries = files.map(({ name, data }) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    return { name: encoder.encode(name), bytes, crc: crc32(bytes) };
  });
  let size = 22;
  for (const { name, bytes } of entries) {
    size += 30 + name.length + bytes.length + 46 + name.length;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets = [];
  const u16 = (value) => { view.setUint16(at, value, true); at += 2; };
  const u32 = (value) => { view.setUint32(at, value, true); at += 4; };
  const put = (bytes) => { out.set(bytes, at); at += bytes.length; };

  for (const { name, bytes, crc } of entries) {
    offsets.push(at);
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(DOS_TIME); u16(DOS_DATE);
    u32(crc); u32(bytes.length); u32(bytes.length); u16(name.length); u16(0);
    put(name); put(bytes);
  }
  const directoryAt = at;
  entries.forEach(({ name, bytes, crc }, index) => {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(DOS_TIME); u16(DOS_DATE);
    u32(crc); u32(bytes.length); u32(bytes.length); u16(name.length); u16(0); u16(0);
    u16(0); u16(0); u32(0); u32(offsets[index]);
    put(name);
  });
  const directorySize = at - directoryAt;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(directorySize); u32(directoryAt); u16(0);
  return out;
}

// ---------- the XML ----------

/** Text safe inside XML: the five special characters, and no control characters XML cannot hold. */
export function xmlEscape(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const num = (value) => String(Math.round(value));
const twips = (points) => Math.round(points * 20);
const hexOf = (color) => (/^#[0-9a-fA-F]{6}$/.test(color ?? '') ? color.slice(1).toUpperCase() : null);

/** One table's borders, as the attributes of a Word border element (sz is in eighths of a point). */
function borderXml(tag, look, colorOf) {
  const width = Number(look.width) || 0;
  if (width <= 0) {
    return `<w:${tag} w:val="nil"/>`;
  }
  const val = { solid: 'single', dashed: 'dashed', dotted: 'dotted' }[look.style] ?? 'single';
  const size = Math.min(96, Math.max(2, Math.round(width * 8)));
  return `<w:${tag} w:val="${val}" w:sz="${size}" w:space="0" w:color="${colorOf}"/>`;
}

const BORDER_COLOR = { all: '111111', light: 'BDBDBD', rows: '8A8A8A' };

/** The borders of a table: every line, the lines under each row, or none. */
function tableBordersXml(look) {
  const color = BORDER_COLOR[look.borders] ?? BORDER_COLOR.all;
  const grid = look.borders !== 'rows';
  return '<w:tblBorders>'
    + `${grid ? borderXml('top', look, color) : '<w:top w:val="nil"/>'}`
    + `${grid ? borderXml('left', look, color) : '<w:left w:val="nil"/>'}`
    + `${borderXml('bottom', look, color)}`
    + `${grid ? borderXml('right', look, color) : '<w:right w:val="nil"/>'}`
    + `${borderXml('insideH', look, color)}`
    + `${grid ? borderXml('insideV', look, color) : '<w:insideV w:val="nil"/>'}`
    + '</w:tblBorders>';
}

function runXml(run, links) {
  if (run.tab) {
    return '<w:r><w:tab/></w:r>';
  }
  const props = [];
  if (run.bold) { props.push('<w:b/>'); }
  if (run.italic) { props.push('<w:i/>'); }
  if (run.caps) { props.push('<w:caps/>'); }
  const color = hexOf(run.color) ?? (run.href ? '0563C1' : null);
  if (color) { props.push(`<w:color w:val="${color}"/>`); }
  if (run.spacing) { props.push(`<w:spacing w:val="${twips(run.spacing)}"/>`); }
  if (run.size) { props.push(`<w:sz w:val="${num(run.size * 2)}"/><w:szCs w:val="${num(run.size * 2)}"/>`); }
  if (run.underline || run.href) { props.push('<w:u w:val="single"/>'); }
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  const text = String(run.text ?? '').split('\n');
  const body = text.map((line, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`).join('');
  const xml = `<w:r>${rPr}${body}</w:r>`;
  if (run.href) {
    const id = `rId${links.length + 10}`;
    links.push({ id, href: run.href });
    return `<w:hyperlink r:id="${id}" w:history="1">${xml}</w:hyperlink>`;
  }
  return xml;
}

function sectPrXml(page, { columns = 1, continuous = false } = {}) {
  const width = Math.round(page.widthMm * TWIPS_PER_MM);
  const height = Math.round(page.heightMm * TWIPS_PER_MM);
  const m = page.marginsMm;
  return '<w:sectPr>'
    + `${continuous ? '<w:type w:val="continuous"/>' : ''}`
    + `<w:pgSz w:w="${width}" w:h="${height}"/>`
    + `<w:pgMar w:top="${Math.round(m.top * TWIPS_PER_MM)}" w:right="${Math.round(m.right * TWIPS_PER_MM)}" w:bottom="${Math.round(m.bottom * TWIPS_PER_MM)}" w:left="${Math.round(m.left * TWIPS_PER_MM)}" w:header="708" w:footer="708" w:gutter="0"/>`
    + `${columns > 1 ? `<w:cols w:num="${columns}" w:space="${Math.round(10 * TWIPS_PER_MM)}"/>` : ''}`
    + '</w:sectPr>';
}

function paragraphXml(block, context) {
  const pPr = [];
  if (block.keepNext) { pPr.push('<w:keepNext/>'); }
  if (block.bullet) { pPr.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'); }
  if (block.rule) {
    pPr.push(`<w:pBdr><w:bottom w:val="single" w:sz="${num(block.rule.size ?? 6)}" w:space="2" w:color="${hexOf(block.rule.color) ?? '1B1F27'}"/></w:pBdr>`);
  }
  if (block.tabRight) { pPr.push(`<w:tabs><w:tab w:val="right" w:pos="${twips(block.tabRight)}"/></w:tabs>`); }
  const spacing = [];
  if (block.before !== undefined) { spacing.push(`w:before="${twips(block.before)}"`); }
  if (block.after !== undefined) { spacing.push(`w:after="${twips(block.after)}"`); }
  if (block.line) { spacing.push(`w:line="${num(block.line * 240)}" w:lineRule="auto"`); }
  if (spacing.length) { pPr.push(`<w:spacing ${spacing.join(' ')}/>`); }
  if (block.indent || block.hanging) {
    pPr.push(`<w:ind w:left="${twips(block.indent ?? 0)}"${block.hanging ? ` w:hanging="${twips(block.hanging)}"` : ''}/>`);
  }
  if (block.align && block.align !== 'left') { pPr.push(`<w:jc w:val="${block.align}"/>`); }
  if (block.endsSection) {
    pPr.push(sectPrXml(context.page, { columns: block.endsSection.columns ?? 1 }));
  }
  const runs = [];
  if (block.columnBreakBefore) {
    runs.push('<w:r><w:br w:type="column"/></w:r>');
  }
  runs.push(...(block.runs ?? []).map((run) => runXml(run, context.links)));
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${runs.join('')}</w:p>`;
}

function tableXml(block, context) {
  const look = { borders: 'all', width: 1, style: 'solid', padding: 4, gap: 0, ...(block.look ?? {}) };
  const rows = block.rows ?? [];
  const columns = Math.max(1, ...rows.map((row) => row.reduce((total, cell) => total + (cell.span ?? 1), 0)));
  const totalWidth = twips(block.width ?? context.width); // a table in a column is as wide as the column
  const gridWidth = Math.floor(totalWidth / columns);
  const boxed = look.gap > 0; // spaced cells carry their own lines
  const pad = twips(look.padding);
  const cellBorders = boxed
    ? `<w:tcBorders>${['top', 'left', 'bottom', 'right'].map((side) => borderXml(side, look, BORDER_COLOR[look.borders] ?? BORDER_COLOR.all)).join('')}</w:tcBorders>`
    : '';

  const pending = []; // how many more rows each column is covered by an earlier cell that spans rows
  const rowXml = rows.map((cells) => {
    const parts = [];
    let column = 0;
    const fillCovered = () => {
      while (pending[column] > 0) {
        pending[column] -= 1;
        parts.push(`<w:tc><w:tcPr><w:tcW w:w="${gridWidth}" w:type="dxa"/><w:vMerge/>${cellBorders}</w:tcPr><w:p/></w:tc>`);
        column += 1;
      }
    };
    for (const cell of cells) {
      fillCovered();
      const span = Math.max(1, cell.span ?? 1);
      const rowspan = Math.max(1, cell.rowspan ?? 1);
      const inner = (cell.blocks?.length ? cell.blocks : [{ type: 'p', runs: [] }])
        .map((child) => blockXml(child, { ...context, width: (gridWidth * span - pad * 2) / 20 })).join('');
      parts.push(`<w:tc><w:tcPr><w:tcW w:w="${gridWidth * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${rowspan > 1 ? '<w:vMerge w:val="restart"/>' : ''}${cellBorders}</w:tcPr>${inner}</w:tc>`);
      for (let k = 0; k < span; k += 1) {
        pending[column + k] = rowspan > 1 ? rowspan - 1 : 0;
      }
      column += span;
    }
    fillCovered();
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${parts.join('')}</w:tr>`;
  }).join('');

  return '<w:tbl><w:tblPr>'
    + `<w:tblW w:w="${totalWidth}" w:type="dxa"/>`
    + `${boxed ? `<w:tblCellSpacing w:w="${twips(look.gap)}" w:type="dxa"/>` : ''}`
    + `${boxed ? '' : tableBordersXml(look)}`
    + '<w:tblLayout w:type="fixed"/>'
    + `<w:tblCellMar><w:top w:w="${pad}" w:type="dxa"/><w:left w:w="${pad}" w:type="dxa"/><w:bottom w:w="${pad}" w:type="dxa"/><w:right w:w="${pad}" w:type="dxa"/></w:tblCellMar>`
    + `</w:tblPr><w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${gridWidth}"/>`).join('')}</w:tblGrid>${rowXml}</w:tbl>`
    // A table must be followed by a paragraph in its cell or at the end of the body; a thin one keeps the layout.
    + '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>';
}

function blockXml(block, context) {
  return block.type === 'table' ? tableXml(block, context) : paragraphXml(block, context);
}

/**
 * A .docx as bytes.
 * `blocks` as described at the top; `page` is `{ widthMm, heightMm, marginsMm: { top, right, bottom, left } }`;
 * `font`, `fontSize` and `lineSpacing` (a multiple of the line) are the document's defaults; `columns` 2 puts everything after the block that
 * has `endsSection` into two real section columns.
 */
export function buildDocx({ blocks, page, font = 'Calibri', fontSize = 11, lineSpacing = 1.15, columns = 1, title = '' }) {
  const links = [];
  const textWidthPt = ((page.widthMm - page.marginsMm.left - page.marginsMm.right) * TWIPS_PER_MM) / 20;
  const context = { page, links, width: textWidthPt };
  const body = blocks.map((block) => blockXml(block, context)).join('');
  const finalSection = sectPrXml(page, { columns, continuous: columns > 1 });

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${body}${finalSection}</w:body></w:document>`;
  const fontName = xmlEscape(font);
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="${NS_W}">`
    + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${fontName}" w:hAnsi="${fontName}" w:cs="${fontName}" w:eastAsia="${fontName}"/><w:sz w:val="${num(fontSize * 2)}"/><w:szCs w:val="${num(fontSize * 2)}"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>`
    + `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${num(lineSpacing * 240)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '</w:styles>';
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${NS_W}">`
    + '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>'
    + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="260"/></w:pPr></w:lvl>'
    + '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>`
    + links.map((link) => `<Relationship Id="${link.id}" Type="${REL}/hyperlink" Target="${xmlEscape(link.href)}" TargetMode="External"/>`).join('')
    + '</Relationships>';
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '</Relationships>';
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '</Types>';
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${xmlEscape(title)}</dc:title><dc:creator>Coverlay</dc:creator></cp:coreProperties>`;

  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: document },
    { name: 'word/_rels/document.xml.rels', data: documentRels },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/numbering.xml', data: numbering },
    { name: 'docProps/core.xml', data: core },
  ]);
}

/** A file name that is safe on every system: letters, digits and dashes, then the extension. */
export function safeFileName(parts, extension) {
  const base = parts.map((part) => String(part ?? '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')).filter(Boolean).join('-');
  return `${base || 'document'}.${extension}`;
}
