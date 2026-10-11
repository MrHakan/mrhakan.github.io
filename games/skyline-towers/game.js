'use strict';
(()=>{const $=id=>document.getElementById(id),P=SKY,board=$('board');
$('day').textContent=P.day%10000;let cells=P.initial.slice(),selected=cells.findIndex(v=>!v),moves=0,hints=0,done=false,history=[];
function edge(n,ids,reverse){const el=document.createElement('span'),a=P.line(cells,ids);el.className='clue';if(a.every(Boolean))el.classList.add(P.visible(reverse?P.rev(a):a)===n?'good':'bad');el.textContent=n;return el;}
function render(){board.replaceChildren();$('moves').textContent=moves;$('hints').textContent=hints;
for(let r=-1;r<=4;r++)for(let c=-1;c<=4;c++){
if((r===-1||r===4)&&(c===-1||c===4)){const el=document.createElement('span');el.className='corner';board.appendChild(el);continue;}
if(r===-1){board.appendChild(edge(P.top[c],P.cols[c],false));continue;}
if(r===4){board.appendChild(edge(P.bottom[c],P.cols[c],true));continue;}
if(c===-1){board.appendChild(edge(P.left[r],P.rows[r],false));continue;}
if(c===4){board.appendChild(edge(P.right[r],P.rows[r],true));continue;}
const i=r*4+c,b=document.createElement('button');b.type='button';b.className='cell'+(P.givens.has(i)?' given':'')+(selected===i?' chosen':'')+(P.duplicate(cells,i)?' error':'');b.textContent=cells[i]||'·';b.disabled=P.givens.has(i)||done;b.setAttribute('aria-label','Row '+(r+1)+' column '+(c+1)+', '+(cells[i]||'empty')+(P.givens.has(i)?', fixed':''));b.addEventListener('click',()=>{selected=i;set((cells[i]%4)+1);});board.appendChild(b);
}}
function set(n,help=false){if(done||selected<0||P.givens.has(selected)||cells[selected]===n)return;history.push({cells:cells.slice(),moves,hints});cells[selected]=n;moves++;if(help)hints++;render();if(P.complete(cells)){done=true;$('status').textContent='SKYLINE COMPLETE in '+moves+' moves!'+(hints?' Hints used.':' No hints used.');render();}
else $('status').textContent=P.duplicate(cells,selected)?'Duplicate height in row or column.':'Keep going. Check the edge visibility clues.';}
document.querySelectorAll('[data-n]').forEach(b=>b.addEventListener('click',()=>set(Number(b.dataset.n))));
document.addEventListener('keydown',e=>{if(done||e.altKey||e.ctrlKey||e.metaKey||!/^([0-4]|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(e.key))return;if(e.target instanceof HTMLElement&&['INPUT','TEXTAREA'].includes(e.target.tagName))return;e.preventDefault();
if(e.key.startsWith('Arrow')){let r=Math.floor(Math.max(selected,0)/4),c=Math.max(selected,0)%4;for(let i=0;i<16;i++){r=(r+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?3:0))%4;c=(c+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?3:0))%4;if(!P.givens.has(r*4+c)){selected=r*4+c;render();const b=board.querySelectorAll('.cell')[selected];if(b)b.focus();break;}}}else set(e.key==='Backspace'||e.key==='Delete'?0:Number(e.key));});
$('undo').addEventListener('click',()=>{if(done)return;const h=history.pop();if(!h){$('status').textContent='Nothing to undo.';return;}cells=h.cells;moves=h.moves;hints=h.hints;render();$('status').textContent='Move undone.';});
$('hint').addEventListener('click',()=>{if(done)return;const i=cells.findIndex((v,j)=>!P.givens.has(j)&&v!==P.solution[j]);if(i<0)return;selected=i;set(P.solution[i],true);});
$('reset').addEventListener('click',()=>{cells=P.initial.slice();selected=cells.findIndex(v=>!v);moves=0;hints=0;done=false;history=[];render();$('status').textContent='Daily board restarted.';});
render();})();