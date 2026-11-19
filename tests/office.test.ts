import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { inferTable } from '../src/core/parse';
import { readFile } from '../src/ingest';

/** All records below are invented. */
const noProgress = () => {};
const file = (data: BlobPart, name: string) => new File([data], name);

async function wordReport(): Promise<ArrayBuffer> {
  const cell = (text: string, extra = '') => `<w:tc><w:tcPr>${extra}</w:tcPr><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
  const row = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;
  const body = `<w:p><w:r><w:t>Quarterly statistical report</w:t></w:r></w:p><w:tbl><w:tblPr/><w:tblGrid/>`
    + row(cell('Region'), cell('Quarter'), cell('Patients'), cell('Share'))
    + row(cell('Iloilo', '<w:vMerge w:val="restart"/>'), cell('Q1'), cell('1,240'), cell('41.5%'))
    + row(cell('', '<w:vMerge/>'), cell('Q2'), cell('1,310'), cell('43.0%'))
    + row(cell('Capiz'), cell('Q1'), cell('520'), cell('17.4%'))
    + row(cell('Total &amp; all regions', '<w:gridSpan w:val="2"/>'), cell('3,070'), cell('100%'))
    + '</w:tbl>';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('reading tables from statistical reports', () => {
  it('reads a table from a Word report, repeating merged cells', async () => {
    const [t] = await readFile(file(await wordReport(), 'report.docx'), noProgress);
    expect(t.headers).toEqual(['Region', 'Quarter', 'Patients', 'Share']);
    expect(t.rows.map((r) => r[0])).toEqual(['Iloilo', 'Iloilo', 'Capiz', 'Total & all regions']);
    expect(t.rows[3]).toEqual(['Total & all regions', 'Total & all regions', '3,070', '100%']);
    // Numbers written as text become numbers when the table is read.
    const { table } = inferTable(t);
    expect(table.columns.find((c) => c.name === 'Patients')!.values.slice(0, 3)).toEqual([1240, 1310, 520]);
  });

  it('reads tables from PowerPoint slides', async () => {
    const p = new PptxGenJS();
    p.addSlide().addText('Summary', { x: 1, y: 1, w: 4, h: 1 });
    p.addSlide().addTable([[{ text: 'Month' }, { text: 'Cases' }], [{ text: 'January' }, { text: '45' }], [{ text: 'February' }, { text: '52' }]], { x: 1, y: 1, w: 6 });
    const buf = await p.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
    const tables = await readFile(file(buf, 'briefing.pptx'), noProgress);
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ name: 'Slide 2', headers: ['Month', 'Cases'], rows: [['January', '45'], ['February', '52']] });
  });

  it('reads OpenDocument spreadsheets and saved web pages', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Branch', 'Sales'], ['North', 120], ['South', 95]]), 'Data');
    const ods = XLSX.write(wb, { bookType: 'ods', type: 'array' }) as ArrayBuffer;
    expect((await readFile(file(ods, 'sales.ods'), noProgress))[0]).toMatchObject({ headers: ['Branch', 'Sales'], rows: [['North', 120], ['South', 95]] });
    const html = '<html><body><h1>Report</h1><table><tr><th>Month</th><th>Cases</th></tr><tr><td>Jan</td><td>5</td></tr><tr><td>Feb</td><td>7</td></tr></table></body></html>';
    const [t] = await readFile(file(html, 'report.html'), noProgress);
    expect(t.headers).toEqual(['Month', 'Cases']);
    expect(t.rows).toHaveLength(2);
  });

  it('explains when a Word report has no tables', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Only text</w:t></w:r></w:p></w:body></w:document>');
    await expect(readFile(file(await zip.generateAsync({ type: 'arraybuffer' }), 'notes.docx'), noProgress)).rejects.toThrow('No tables were found in notes.docx');
  });
});
