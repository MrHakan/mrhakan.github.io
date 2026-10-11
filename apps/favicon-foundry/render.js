'use strict';
const ICON=(()=>{const $=id=>document.getElementById(id);let source=null,objectUrl=null;
const snippet='<link rel="icon" href="/favicon.ico" sizes="any">\n<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">\n<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">';
$('snippet').textContent=snippet;
function path(ctx,n,r){ctx.beginPath();ctx.moveTo(r,0);ctx.arcTo(n,0,n,n,r);ctx.arcTo(n,n,0,n,r);ctx.arcTo(0,n,0,0,r);ctx.arcTo(0,0,n,0,r);ctx.closePath();}
function draw(canvas){const n=canvas.width,ctx=canvas.getContext('2d'),pad=n*Number($('pad').value)/100;ctx.clearRect(0,0,n,n);ctx.save();path(ctx,n,n*Number($('round').value)/100);ctx.fillStyle=$('bg').value;ctx.fill();ctx.clip();
if($('mode').value==='image'&&source){const w=source.naturalWidth,h=source.naturalHeight,s=Math.min((n-2*pad)/w,(n-2*pad)/h);ctx.drawImage(source,(n-w*s)/2,(n-h*s)/2,w*s,h*s);}
else if($('mode').value==='text'){const label=($('letters').value||'?').slice(0,3);ctx.fillStyle=$('fg').value;ctx.font='bold '+Math.round(n*(label.length===1?.66:label.length===2?.47:.34))+'px Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,n/2,n*.52,n-2*pad);}ctx.restore();}
function paint(){for(const n of [16,32,180,192])draw($('p'+n));$('roundValue').textContent=$('round').value+'%';$('padValue').textContent=$('pad').value+'%';}
function canvas(n){const c=document.createElement('canvas');c.width=c.height=n;draw(c);return c;}
function message(s){$('status').textContent=s;}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function png(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('PNG encoding failed')),'image/png'));}
$('mode').addEventListener('change',()=>{$('textfield').hidden=$('mode').value!=='text';$('filefield').hidden=$('mode').value!=='image';paint();});
$('file').addEventListener('change',()=>{const f=$('file').files[0];if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>8*1024*1024){$('file').value='';message('Choose a PNG, JPEG or WebP under 8 MB.');return;}const url=URL.createObjectURL(f),img=new Image();img.onload=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=url;source=img;paint();message('Loaded '+f.name+' locally.');};img.onerror=()=>{URL.revokeObjectURL(url);message('Could not decode image.');};img.src=url;});
['letters','fg','bg','round','pad'].forEach(id=>$(id).addEventListener('input',paint));window.addEventListener('pagehide',()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);});paint();
return{$,canvas,message,download,png,snippet};})();