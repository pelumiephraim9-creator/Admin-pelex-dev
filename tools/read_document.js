'use strict';
const E=process.env;
const zlib=require('node:zlib');
const clip=(v,n)=>String(v==null?'':v).slice(0,n);
function decode(s){return String(s||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))}
function strip(s){return decode(String(s||'').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim()}
function zip(b){
 const e=b.lastIndexOf(Buffer.from([80,75,5,6]));if(e<0)throw Error('Office file archive is damaged.');
 const count=b.readUInt16LE(e+10),offset=b.readUInt32LE(e+16);if(count>500)throw Error('Office document has too many archive entries.');
 const files={};let p=offset,total=0;
 for(let i=0;i<count;i++){
  if(b.readUInt32LE(p)!==0x02014b50)throw Error('Office archive directory is damaged.');
  const flags=b.readUInt16LE(p+8),method=b.readUInt16LE(p+10),cs=b.readUInt32LE(p+20),size=b.readUInt32LE(p+24),nl=b.readUInt16LE(p+28),el=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32),off=b.readUInt32LE(p+42),name=b.toString('utf8',p+46,p+46+nl);p+=46+nl+el+cl;
  if(!name||name.endsWith('/'))continue;if(flags&1)throw Error('This Office document is password-protected.');if(size>30000000||total+size>30000000)throw Error('Expanded Office document exceeds the 30 MB safety limit.');
  if(b.readUInt32LE(off)!==0x04034b50)throw Error('Office file entry is damaged.');
  const pos=off+30+b.readUInt16LE(off+26)+b.readUInt16LE(off+28);if(pos+cs>b.length)throw Error('Office file is truncated.');
  const raw=b.subarray(pos,pos+cs);let data=null;if(method===0)data=Buffer.from(raw);else if(method===8)data=zlib.inflateRawSync(raw,{maxOutputLength:30000000});if(!data)continue;
  total+=data.length;files[name]=data.toString('utf8');
 }
 return files;
}
function col(ref){const m=String(ref||'').match(/[A-Z]+/i);if(!m)return 0;let n=0;for(const c of m[0].toUpperCase())n=n*26+c.charCodeAt(0)-64;return n-1}
function office(ext,b){
 const f=zip(b);
 if(ext==='docx'){const x=f['word/document.xml'];if(!x)throw Error('Word document body is missing.');return {text:[...x.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map(m=>strip(m[1])).filter(Boolean).join('\n'),sections:['Word document']}}
 if(ext==='pptx'){const k=Object.keys(f).filter(x=>/^ppt\/slides\/slide\d+\.xml$/.test(x)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));if(!k.length)throw Error('No readable presentation slides found.');return {text:k.map((x,i)=>'SLIDE '+(i+1)+'\n'+strip(f[x])).join('\n\n'),sections:k.map((x,i)=>'Slide '+(i+1))}}
 if(ext==='odt'||ext==='ods'||ext==='odp'){
  if(!f['content.xml'])throw Error('OpenDocument content is missing.');
  const source=f['content.xml'];
  if(ext==='ods'){
   const tables=[];
   for(const table of source.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)){
    const name=(table[1].match(/\btable:name="([^"]+)"/)||[])[1]||'Worksheet';
    const rows=[];
    for(const row of table[2].matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)){
     const cells=[];
     for(const cell of row[1].matchAll(/<table:table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g)){
      const attrs=cell[1]||'',inside=cell[2]||'';
      const value=(attrs.match(/\boffice:(?:value|date-value|string-value)="([^"]+)"/)||[])[1]||'';
      cells.push(strip(inside)||value);
     }
     rows.push(cells.join('\t'));
    }
    if(rows.length)tables.push('WORKSHEET: '+decode(name)+'\n'+rows.join('\n'));
   }
   if(tables.length)return {text:tables.join('\n\n'),sections:tables.map((x,i)=>'Worksheet '+(i+1))};
  }
  const paragraphs=[...source.matchAll(/<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/g)].map(m=>strip(m[1])).filter(Boolean);
  return {text:paragraphs.length?paragraphs.join('\n'):strip(source),sections:[ext.toUpperCase()]};
 }
 if(ext==='xlsx'||ext==='xlsm'){
  const shared=[];for(const m of (f['xl/sharedStrings.xml']||'').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g))shared.push(strip(m[1]));
  const rels=f['xl/_rels/workbook.xml.rels']||'',map={};for(const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)){const id=(m[1].match(/\bId="([^"]+)"/)||[])[1],t=(m[1].match(/\bTarget="([^"]+)"/)||[])[1];if(id&&t)map[id]=t.replace(/^\//,'').startsWith('xl/')?t.replace(/^\//,''):'xl/'+t.replace(/^\//,'').replace(/^(\.\.\/)+/,'')}
  const out=[];for(const s of (f['xl/workbook.xml']||'').matchAll(/<sheet\b([^>]*)\/?>/g)){const name=(s[1].match(/\bname="([^"]+)"/)||[])[1]||'Sheet',rid=(s[1].match(/\br:id="([^"]+)"/)||[])[1],path=map[rid];if(!path||!f[path])continue;const rows=[];for(const r of f[path].matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){const cells=[];for(const x of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){const a=x[1]||'',inside=x[2]||'',ref=(a.match(/\br="([A-Z]+)\d+"/i)||[])[1],type=(a.match(/\bt="([^"]+)"/)||[])[1]||'',v=(inside.match(/<v>([\s\S]*?)<\/v>/)||[])[1];cells[col(ref)]=type==='s'&&v!=null?shared[Number(v)]||'':v!=null?decode(v):strip(inside)}rows.push(cells.map(v=>v==null?'':v).join('\t'))}out.push('WORKSHEET: '+decode(name)+'\n'+rows.join('\n'))}
  if(!out.length)throw Error('No readable Excel worksheets found.');return {text:out.join('\n\n'),sections:out.map((x,i)=>'Worksheet '+(i+1))}
 }
 throw Error('Unsupported Office format.');
}
function attachment(v){const m=/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(v||''));if(!m)throw Error('The file did not reach the document reader correctly.');const b=Buffer.from(m[2],'base64');if(!b.length)throw Error('The selected file is empty.');if(b.length>10*1024*1024)throw Error('The file exceeds the 10 MB limit.');return {mime:m[1].toLowerCase(),bytes:b}}
function jsonModel(s){const t=String(s||'').trim();try{return JSON.parse(t)}catch(e){}const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1))}catch(e){}}return null}
async function ocrImage(bytes, mime) {
 const {createWorker}=require('tesseract.js');
 const {loadImage,createCanvas}=require('@napi-rs/canvas');
 const image=await loadImage(bytes);
 const maxSide=2400,scale=Math.min(1,maxSide/Math.max(image.width,image.height));
 const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
 const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height);
 const worker=await createWorker('eng');
 try { const result=await worker.recognize(canvas.toBuffer('image/png'));return String(result&&result.data&&result.data.text||'').trim(); }
 finally { await worker.terminate(); }
}
async function readPdf(bytes, injectedOcr) {
 const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');
 const {createCanvas}=require('@napi-rs/canvas');
 const path=require('node:path');
 const standardFontDataUrl=path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts')+path.sep;
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),disableWorker:true,useSystemFonts:true,standardFontDataUrl});
 const doc=await task.promise;
 try {
  const pageCount=Number(doc.numPages||0);
  if(!pageCount)throw Error('The PDF contains no readable pages.');
  if(pageCount>12)throw Error('This PDF has '+pageCount+' pages. Please split it into files of 12 pages or fewer.');
  const textPages=[];
  for(let n=1;n<=pageCount;n++){
   const page=await doc.getPage(n),content=await page.getTextContent();
   const text=(content.items||[]).map(item=>item.str||'').filter(Boolean).join(' ').replace(/[ \t]+/g,' ').trim();
   textPages.push(text);
  }
  const digital=textPages.filter(Boolean).join('\n\n');
  if(digital.length>0)return {text:digital,method:'local PDF text extraction',pages:pageCount,ocrPages:0};
  const scanned=[];
  for(let n=1;n<=pageCount;n++){
   const page=await doc.getPage(n),viewport=page.getViewport({scale:1.6});
   const width=Math.max(1,Math.ceil(viewport.width)),height=Math.max(1,Math.ceil(viewport.height));
   if(width*height>18000000)throw Error('A PDF page is too large to process safely.');
   const canvas=createCanvas(width,height),context=canvas.getContext('2d');
   await page.render({canvasContext:context,viewport}).promise;
   const png=canvas.toBuffer('image/png');
   const text=injectedOcr?await injectedOcr(png,'image/png'):await ocrImage(png,'image/png');
   scanned.push(text);
  }
  const readable=scanned.map(v=>String(v||'').trim()).filter(Boolean);
  if(!readable.length)throw Error('Local OCR could not find readable text in this PDF. Try a clearer scan or photo.');
  const text=scanned.map((v,i)=>String(v||'').trim()?'PAGE '+(i+1)+'\n'+String(v).trim():'').filter(Boolean).join('\n\n');
  return {text,method:'local PDF rendering + OCR',pages:pageCount,ocrPages:pageCount};
 } finally { await doc.destroy().catch(()=>{}); }
}
async function readImage(bytes,mime,injectedOcr) {
 const text=injectedOcr?await injectedOcr(bytes,mime):await ocrImage(bytes,mime);
 if(!text)throw Error('Local OCR could not find readable text in this image. Try a clearer, well-lit image.');
 return {text,method:'local image OCR',pages:1,ocrPages:1};
}
module.exports={
 name:'read_document',
 description:'Read business documents locally, including PDF text, scanned PDFs and images. Extracted text is returned for review; nothing is imported or saved.',
 parameters:{type:'object',properties:{prompt:{type:'string',description:'File name and optional reading instructions.'}},required:[]},
 label:()=> 'Reading the document locally',
 run:async(args,ctx)=>{
  const fail=m=>JSON.stringify({error:clip(m,500),document_type:'unknown',currency:null,summary:'',text:'',rows:[],notes:clip(m,500)});
  try{
   const imgs=Array.isArray(ctx&&ctx.images)?ctx.images:[];
   if(!imgs.length)return fail('No document attachment was received.');
   const a=attachment(imgs[0]),name=(String(args&&args.prompt||'').match(/(?:file name|filename)\s*:\s*([^\r\n]+)/i)||[])[1]||'';
   const ext=(name.split('.').pop()||'').toLowerCase(),mime=a.mime==='image/jpg'?'image/jpeg':a.mime;
   let extracted=null;
   const officeExt=['docm','dotx','dotm'].includes(ext)?'docx':['pptm','ppsx'].includes(ext)?'pptx':ext;
   if(['docx','pptx','xlsx','xlsm','odt','ods','odp'].includes(officeExt))extracted=office(officeExt,a.bytes);
   else if(['csv','tsv','txt','md','json','xml','html','htm','rtf','log'].includes(ext)){
    let t=a.bytes.toString('utf8').replace(/^\uFEFF/,'');
    if(ext==='html'||ext==='htm'||ext==='xml')t=strip(t);
    else if(ext==='rtf')t=t.replace(/\\par[d]?/g,'\n').replace(/\\[a-zA-Z]+-?\d* ?/g,'').replace(/[{}]/g,'');
    extracted={text:t,sections:[ext.toUpperCase()+' document'],method:'local text extraction'};
   }else if(mime==='application/pdf'){
    extracted=await readPdf(a.bytes,ctx&&ctx.localOcr);
   }else if(mime.startsWith('image/')){
    if(!['image/png','image/jpeg','image/webp','image/heic','image/heif','image/tiff'].includes(mime))return fail('Unsupported image type: '+mime);
    extracted=await readImage(a.bytes,mime,ctx&&ctx.localOcr);
   }else if(['doc','ppt','xls'].includes(ext))return fail('Legacy Office files must be saved as DOCX, PPTX, XLSX or PDF before reading.');
   else return fail('Unsupported file type. Try PDF, DOCX, XLSX, PPTX, ODT, ODS, CSV, TSV, TXT, RTF, HTML, XML, JSON, PNG, JPG, WebP, HEIC or TIFF.');
   const localText=clip(extracted&&extracted.text,24000);
   if(!localText.trim())return fail('The file opened, but no readable text was found.');
   return JSON.stringify({
    document_type:ext|| (mime==='application/pdf'?'pdf':'image'),currency:null,
    summary:'Content extracted locally. No AI model or external vision API was used.',
    text:localText,rows:[],
    notes:(extracted.method||'local extraction')+'; '+(extracted.pages||1)+' page(s) processed. Review extracted content before using it.',
    source:{file_name:name,extension:ext,bytes:a.bytes.length,sections:extracted.sections||[],extraction_method:extracted.method||'local',pages:extracted.pages||1,ocr_pages:extracted.ocrPages||0}
   });
  }catch(e){return fail(e&&e.message||'The document could not be read locally.');}
 }
};
