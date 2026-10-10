const { PDFDocument, PDFName, PDFHexString } = require('pdf-lib');
async function annotatedCopy(bytes, annotations) {
  const pdf = await PDFDocument.load(bytes);
  for (const annotation of annotations) {
    const geometry = annotation.geometry || JSON.parse(annotation.geometry_json);
    const page = pdf.getPages()[geometry.page - 1];
    if (!page) throw new Error('批注页码超出文件范围');
    const rects = geometry.rects || [geometry.rect];
    const points = rects.flatMap(r => [r[0],r[3],r[2],r[3],r[0],r[1],r[2],r[1]]);
    const rect = [Math.min(...rects.map(r=>r[0])),Math.min(...rects.map(r=>r[1])),Math.max(...rects.map(r=>r[2])),Math.max(...rects.map(r=>r[3]))];
    const highlight = annotation.kind === 'highlight';
    const color = annotation.color || '#ffdb58';
    const rgb = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255);
    const drawing = rects.map(raw => {const r=highlight?raw:[raw[0]+0.5,raw[1]+0.5,raw[2]-0.5,raw[3]-0.5];return `${rgb.join(' ')} ${highlight ? 'rg' : 'RG'} ${r[0]} ${r[1]} ${r[2]-r[0]} ${r[3]-r[1]} re ${highlight ? 'f' : 'S'}`;}).join('\n');
    const gs = pdf.context.obj({ Type: 'ExtGState', ca: highlight ? 0.32 : 1, CA: 1, BM: 'Multiply' });
    const appearance = pdf.context.flateStream('/GS gs\n' + drawing, { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: { ExtGState: { GS: pdf.context.register(gs) } } });
    const object = pdf.context.obj({ Type: 'Annot', Subtype: highlight ? 'Highlight' : 'Square', Rect: rect, C: rgb, Contents: PDFHexString.fromText(annotation.note || ''), T: PDFHexString.fromText('LESP·辑微'), NM: PDFHexString.fromText(annotation.id || require('node:crypto').randomUUID()), F: 4, AP: { N: pdf.context.register(appearance) }, ...(highlight ? { QuadPoints: points } : {}) });
    let annots = page.node.Annots();
    if (!annots) { annots = pdf.context.obj([]); page.node.set(PDFName.of('Annots'), annots); }
    annots.push(pdf.context.register(object));
  }
  return Buffer.from(await pdf.save());
}
module.exports = { annotatedCopy };
