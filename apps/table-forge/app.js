(() => {'use strict';
const $=id=>document.getElementById(id),key='table-forge-98-v1';
const demo=[['Feature','Category','Status'],['Loop Circuit','Game','Ready'],['Table Forge','Application','Editing'],['Playground','Catalog','Local']];
let rows=demo.map(r=>r.slice()),align=['left','left','left'],picked={r:0,c:0};
const say=(msg,error=false)=>{$('status').textContent=msg;$('status').classList.toggle('error',error)},colLabel=i=>String.fromCharCode(65+i);
function normalize(data){if(!Array.isArray(data)||!data.length||!Array.isArray(data[0]))throw Error('Expected a table with a header row.');const width=Math.max(1,...data.map(r=>Array.isArray(r)?r.length:0));if(width>12||data.length>101)throw Error('Maximum 12 columns and 100 data rows.');return data.map(r=>Array.from({length:width},(_,i)=>String(r?.[i]??'').slice(0,500)));}
try{const old=JSON.parse(localStorage.getItem(key)||'null');if(old){rows=normalize(old.rows);align=Array.from({length:rows[0].length},(_,i)=>['left','center','right'].includes(old.align?.[i])?old.align[i]:'left');}}catch{}
const save=()=>{try{localStorage.setItem(key,JSON.stringify({rows,align}))}catch{}};
const clean=s=>String(s).replace(/\r\n?/g,'\n').replace(/\n+/g,' ').replace(/\\/g,'\\\\').replace(/\|/g,'\\|').trim();
const code=()=>{
 const line=row=>'| '+row.map(clean).join(' | ')+' |';
 const rule='| '+align.map(a=>a==='center'?':---:':a==='right'?'---:':':---').join(' | ')+' |';
 return [line(rows[0]),rule,...rows.slice(1).map(line)].join('\n');
};
function renderPreview(){const dst=$('preview');dst.replaceChildren();const head=document.createElement('thead'),tr=document.createElement('tr');rows[0].forEach((v,i)=>{const th=document.createElement('th');th.textContent=v;th.style.textAlign=align[i];tr.append(th)});head.append(tr);dst.append(head);const body=document.createElement('tbody');for(const row of rows.slice(1)){const tr=document.createElement('tr');row.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;td.style.textAlign=align[i];tr.append(td)});body.append(tr);}dst.append(body);$('markdown').value=code();$('dimensions').textContent=rows[0].length+' columns / '+Math.max(0,rows.length-1)+' data rows';$('selected').textContent=colLabel(picked.c)+(picked.r+1);$('alignment').value=align[picked.c];}
function markSelection(r,c){picked={r,c};$('selected').textContent=colLabel(c)+(r+1);$('alignment').value=align[c];document.querySelectorAll('#editor input').forEach(inp=>inp.classList.toggle('chosen',Number(inp.dataset.r)===r&&Number(inp.dataset.c)===c));}
function renderEditor(focus=false){const dst=$('editor');dst.replaceChildren();const tbody=document.createElement('tbody');
 rows.forEach((row,r)=>{const tr=document.createElement('tr');const label=document.createElement(r?'td':'th');label.textContent=r?String(r):'↘';tr.append(label);
 row.forEach((value,c)=>{const td=document.createElement(r?'td':'th');const input=document.createElement('input');input.value=value;input.dataset.r=r;input.dataset.c=c;input.maxLength=500;input.setAttribute('aria-label',(r===0?'Header':'Row '+r)+', column '+colLabel(c));input.addEventListener('focus',()=>markSelection(r,c));input.addEventListener('input',()=>{rows[r][c]=input.value;save();renderPreview();});td.append(input);tr.append(td);});tbody.append(tr);});dst.append(tbody);renderPreview();markSelection(Math.min(picked.r,rows.length-1),Math.min(picked.c,rows[0].length-1));if(focus)dst.querySelector(`input[data-r="${picked.r}"][data-c="${picked.c}"]`)?.focus({preventScroll:true});}
function modify(fn,msg){fn();save();renderEditor(true);say(msg);}
$('addRow').onclick=()=>{if(rows.length>=101)return say('Maximum 100 data rows.',true);modify(()=>{rows.push(Array(rows[0].length).fill(''));picked.r=rows.length-1},'Row added.');};
$('delRow').onclick=()=>{if(rows.length<=1)return say('The header row cannot be removed.',true);if(picked.r===0)return say('Choose a data row first.',true);modify(()=>{rows.splice(picked.r,1);picked.r=Math.min(picked.r,rows.length-1)},'Row removed.');};
$('addCol').onclick=()=>{if(rows[0].length>=12)return say('Maximum 12 columns.',true);modify(()=>{rows.forEach((r,i)=>r.push(i===0?'Header '+(rows[0].length+1):''));align.push('left');picked.c=rows[0].length-1},'Column added.');};
$('delCol').onclick=()=>{if(rows[0].length<=1)return say('Keep at least one column.',true);modify(()=>{rows.forEach(r=>r.splice(picked.c,1));align.splice(picked.c,1);picked.c=Math.min(picked.c,rows[0].length-1)},'Column removed.');};
$('transpose').onclick=()=>{if(rows.length>12||rows[0].length>101)return say('Transpose exceeds 12-column or 100-row limit.',true);modify(()=>{const before=rows;rows=Array.from({length:before[0].length},(_,c)=>before.map(r=>r[c]));align=Array(rows[0].length).fill('left');picked={r:0,c:0};},'Table transposed; the new first row is the header.');};
$('sample').onclick=()=>modify(()=>{rows=demo.map(r=>r.slice());align=Array(3).fill('left');picked={r:0,c:0}},'Sample loaded.');
$('alignment').onchange=e=>{align[picked.c]=e.target.value;save();renderPreview();say('Column alignment updated.');};
// RFC-4180-style quoted fields, escaped quotes and embedded newlines.
function parseDelimited(raw,delimiter){const out=[],row=[];let cell='',quoted=false;
 for(let i=0;i<raw.length;i++){const c=raw[i];if(quoted){if(c==='"'&&raw[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
 else if(c==='"'&&!cell)quoted=true;else if(c===delimiter){row.push(cell);cell='';}else if(c==='\r'||c==='\n'){row.push(cell);out.push(row.slice());row.length=0;cell='';if(c==='\r'&&raw[i+1]==='\n')i++;}else cell+=c;
 }
 if(quoted)throw Error('Unclosed quoted field.');if(cell||row.length)out.push([...row,cell]);if(!out.length)throw Error('No rows found.');return normalize(out);
}
function infer(raw){const option=$('delimiter').value;if(option==='tab')return '\t';if(option!=='auto')return option;
 const first=raw.split(/\r?\n/,1)[0],tabs=(first.match(/\t/g)||[]).length,semis=(first.match(/;/g)||[]).length,commas=(first.match(/,/g)||[]).length;
 if(tabs>=semis&&tabs>=commas&&tabs)return '\t';return semis>commas?';':',';
}
function importText(raw){if(!raw.trim())return say('Paste data first.',true);try{const data=parseDelimited(raw,infer(raw));rows=data;align=Array(data[0].length).fill('left');picked={r:0,c:0};save();renderEditor();say('Imported '+rows.length+' rows × '+rows[0].length+' columns.');}catch(e){say('Import failed: '+e.message,true);}}
$('parse').onclick=()=>importText($('raw').value);
$('raw').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();importText($('raw').value)}});
$('file').addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>1000000)return say('File is too large (1 MB maximum).',true);try{const input=await file.text();$('raw').value=input;importText(input);}catch(err){say('Cannot open file: '+err.message,true)}});
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(code());say('Markdown copied.');}catch{say('Clipboard blocked. Select and copy the generated text.',true);$('markdown').focus();$('markdown').select();}};
function download(filename,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);say(filename+' downloaded.');}
$('download').onclick=()=>download('table-forge.md',code()+'\n','text/markdown;charset=utf-8');
$('csv').onclick=()=>{const esc=s=>{s=String(s);return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};download('table-forge.csv',rows.map(r=>r.map(esc).join(',')).join('\r\n')+'\r\n','text/csv;charset=utf-8');};
renderEditor();
})();
