const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, PDFName } = require('pdf-lib');
const { Document, Paragraph, TextRun, FootnoteReferenceRun, Packer } = require('docx');
const { schema, textDoc, validateDoc } = require('../../shared/document-schema');
const { annotatedCopy } = require('../../server/services/export-annotations');
const output = path.join(__dirname,'../../docs/v2/samples');
test('P2: editor JSON and Unicode preserve semantic quote and paragraph', () => {
  const json = textDoc('宋体分析\n第二段');
  json.content.push({ type:'quote_block', attrs:{citationId:'stable-uuid'},content:[{type:'text',text:'楷体引文'}] });
  const doc = validateDoc(json); assert.equal(doc.lastChild.attrs.citationId,'stable-uuid');
  assert.deepEqual(schema.nodeFromJSON(doc.toJSON()).toJSON(),doc.toJSON());
});
test('P2: PDF copy retains Chinese standard annotations and original bytes', async () => {
  fs.mkdirSync(output,{recursive:true});
  const pdf=await PDFDocument.create(); const font=await pdf.embedFont(StandardFonts.Helvetica);
  const p=pdf.addPage([595,842]); p.drawText('Historical sources and research notes',{x:60,y:740,size:18,font});
  const bytes=await pdf.save(); const original=Buffer.from(bytes);
  const copy=await annotatedCopy(bytes,[{id:'sample-highlight',kind:'highlight',note:'高亮中文笔记',geometry:{page:1,rects:[[60,735,360,760]]}},{id:'sample-area',kind:'area',note:'框选中文笔记',geometry:{page:1,rect:[55,620,400,700]}}]);
  assert.deepEqual(Buffer.from(bytes),original);
  const read=await PDFDocument.load(copy); const annots=read.getPage(0).node.Annots(); assert.equal(annots.size(),2);
  const first=read.context.lookup(annots.get(0)); assert.equal(first.get(PDFName.of('Contents')).decodeText(),'高亮中文笔记'); assert.ok(first.get(PDFName.of('AP')));
  fs.writeFileSync(path.join(output,'source.pdf'),bytes); fs.writeFileSync(path.join(output,'annotated.pdf'),copy);
});
test('P2: real DOCX footnotes, East Asian fonts and 21 references are emitted', async () => {
  fs.mkdirSync(output,{recursive:true});
  const children=[new Paragraph({text:'札记与脚注技术样件',heading:'Title'})]; const footnotes={};
  for(let n=1;n<=21;n++) { children.push(new Paragraph({children:[new TextRun({text:'宋体分析正文，用于检查中文段落。'.repeat(5),font:'SimSun',size:24})]})); children.push(new Paragraph({children:[new TextRun({text:'楷体独立引文，出处通过实际脚注回查。',font:'KaiTi',size:24}),new FootnoteReferenceRun(n)]})); footnotes[n]={children:[new Paragraph({children:[new TextRun({text:`第 ${n} 条出处，卷三，第八页。`,font:'SimSun',size:21})]})]}; }
  const bytes=await Packer.toBuffer(new Document({footnotes,sections:[{children}]}));
  fs.writeFileSync(path.join(output,'footnotes.docx'),bytes);
  const zip=new (require('adm-zip'))(bytes); assert.ok(zip.readAsText('word/footnotes.xml').includes('第 21 条出处')); assert.ok(zip.readAsText('word/document.xml').includes('KaiTi')); assert.equal((zip.readAsText('word/document.xml').match(/<w:footnoteReference /g)||[]).length,21);
});
