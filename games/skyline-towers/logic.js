'use strict';
const SKY=(()=>{const day=Math.floor(Date.now()/86400000);let seed=day^0x45a3e1;
function rand(){seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const ro=shuffle([0,1,2,3]),co=shuffle([0,1,2,3]),digits=shuffle([1,2,3,4]);
const solution=Array.from({length:16},(_,i)=>digits[(ro[Math.floor(i/4)]+co[i%4])%4]);
const rows=Array.from({length:4},(_,r)=>[0,1,2,3].map(c=>r*4+c)),cols=Array.from({length:4},(_,c)=>[0,1,2,3].map(r=>r*4+c));
const line=(a,ids)=>ids.map(i=>a[i]),rev=a=>a.slice().reverse();
function visible(a){let max=0,count=0;for(const x of a)if(x>max){max=x;count++;}return count;}
const left=rows.map(ids=>visible(line(solution,ids))),right=rows.map(ids=>visible(rev(line(solution,ids))));
const top=cols.map(ids=>visible(line(solution,ids))),bottom=cols.map(ids=>visible(rev(line(solution,ids))));
const permutations=[];function perm(a,rest){if(!rest.length){permutations.push(a);return;}for(const x of rest)perm([...a,x],rest.filter(v=>v!==x));}perm([],[1,2,3,4]);
const givens=new Set();
function countSolutions(){const options=rows.map((ids,r)=>permutations.filter(p=>visible(p)===left[r]&&visible(rev(p))===right[r]&&ids.every((id,c)=>!givens.has(id)||p[c]===solution[id])));
let count=0,grid=[];function go(r){if(count>1)return;if(r===4){if(cols.every((ids,c)=>{const a=grid.map(row=>row[c]);return visible(a)===top[c]&&visible(rev(a))===bottom[c];}))count++;return;}
for(const p of options[r]){if(p.some((v,c)=>grid.some(row=>row[c]===v)))continue;grid.push(p);go(r+1);grid.pop();if(count>1)return;}}go(0);return count;}
const order=shuffle(Array.from({length:16},(_,i)=>i));let k=0;while(countSolutions()!==1&&k<16)givens.add(order[k++]);
const initial=solution.map((v,i)=>givens.has(i)?v:0);
function duplicate(a,i){const v=a[i];return !!v&&(rows[Math.floor(i/4)].some(j=>j!==i&&a[j]===v)||cols[i%4].some(j=>j!==i&&a[j]===v));}
function complete(a){return a.every(Boolean)&&a.every((_,i)=>!duplicate(a,i))&&rows.every((ids,r)=>visible(line(a,ids))===left[r]&&visible(rev(line(a,ids)))===right[r])&&cols.every((ids,c)=>visible(line(a,ids))===top[c]&&visible(rev(line(a,ids)))===bottom[c]);}
return{day,solution,rows,cols,left,right,top,bottom,givens,initial,duplicate,complete,line,rev,visible};})();