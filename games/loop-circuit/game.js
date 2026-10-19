(() => {'use strict';
const $=id=>document.getElementById(id),size=5,day=new Date().toISOString().slice(0,10);
$('day').textContent=day;
const levels=window.LOOP98_LEVELS,seed=Number(day.replace(/-/g,'')),level=levels[seed%levels.length],sol=level.solution;
const key='loop-circuit-98-'+day,bestKey=key+'-best';
const h=(y,x)=>y*size+x,v=(y,x)=>30+y*6+x;
const cells=[],vertices=[],ends=[];
for(let y=0;y<5;y++)for(let x=0;x<5;x++)cells.push([h(y,x),v(y,x+1),h(y+1,x),v(y,x)]);
for(let y=0;y<=5;y++)for(let x=0;x<=5;x++){
 const a=[];if(x>0)a.push(h(y,x-1));if(x<5)a.push(h(y,x));if(y>0)a.push(v(y-1,x));if(y<5)a.push(v(y,x));vertices.push(a);
}
for(let y=0;y<=5;y++)for(let x=0;x<5;x++)ends[h(y,x)]=[y*6+x,y*6+x+1];
for(let y=0;y<5;y++)for(let x=0;x<=5;x++)ends[v(y,x)]=[y*6+x,(y+1)*6+x];
let state=Array(60).fill(0),history=[],moves=0,hints=0,elapsed=0,started=0,won=false,best=null;
try{best=JSON.parse(localStorage.getItem(bestKey)||'null');const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&Array.isArray(saved.state)&&saved.state.length===60&&saved.state.every(s=>[0,1,2].includes(s))){state=saved.state;moves=Number(saved.moves)||0;hints=Number(saved.hints)||0;elapsed=Number(saved.elapsed)||0;won=!!saved.won;}}catch{}
const fmt=s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
const seconds=()=>started?Math.floor((Date.now()-started)/1000):elapsed;
const persist=()=>{try{localStorage.setItem(key,JSON.stringify({state,moves,hints,elapsed:seconds(),won}))}catch{}};
const say=s=>{$('status').textContent=s};
function analyze(){
 let bad=false,lines=state.filter(x=>x===1).length,allSatisfied=true;
 for(let k=0;k<25;k++){
  const need=level.clues[k];if(need===null)continue;
  const on=cells[k].filter(i=>state[i]===1).length,free=cells[k].filter(i=>state[i]===0).length;
  const conflict=on>need||on+free<need;bad||=conflict;
  allSatisfied&&=on===need;
  document.querySelectorAll('.clue')[k].classList.toggle('conflict',conflict);
 }
 const degrees=vertices.map(edges=>edges.filter(i=>state[i]===1).length);
 if(degrees.some(n=>n>2)){bad=true;}
 if(!lines||!allSatisfied||degrees.some(n=>n!==0&&n!==2))return {bad,success:false,lines};
 const adjacency=Array.from({length:36},()=>[]);
 for(let i=0;i<60;i++)if(state[i]===1){let [a,b]=ends[i];adjacency[a].push(b);adjacency[b].push(a);}
 const first=adjacency.findIndex(a=>a.length),seen=new Set([first]),q=[first];
 for(let n=0;n<q.length;n++)for(let other of adjacency[q[n]])if(!seen.has(other)){seen.add(other);q.push(other);}
 const active=adjacency.filter(a=>a.length).length;
 return {bad,success:seen.size===active,lines};
}
function checkWin(){const result=analyze();if(!won&&result.success){won=true;elapsed=seconds();started=0;if(hints===0&&(!best||elapsed<best.time)){best={time:Math.max(1,elapsed),moves};try{localStorage.setItem(bestKey,JSON.stringify(best))}catch{}}say('LOOP COMPLETE! '+fmt(elapsed)+' · '+moves+' moves'+(hints?' · '+hints+' hints':' · hint-free')+'.');}else if(!won)say(result.bad?'Some numbered squares or junctions conflict.':'Keep going: make a single closed loop.');return result;}
const board=$('board'),buttons=[];
for(let y=0;y<5;y++)for(let x=0;x<5;x++){const c=document.createElement('span');c.className='clue';c.style.left=x*20+'%';c.style.top=y*20+'%';c.textContent=level.clues[y*5+x]??'';board.append(c);}
for(let i=0;i<60;i++){
 const hor=i<30,p=hor?i:i-30,x=hor?p%5:p%6,y=hor?Math.floor(p/5):Math.floor(p/6);
 const b=document.createElement('button');b.type='button';b.className='edge '+(hor?'horizontal':'vertical');b.style.left=x*20+'%';b.style.top=y*20+'%';b.style.width=hor?'20%':'';b.style.height=hor?'':'20%';
 b.setAttribute('aria-label',(hor?'Horizontal':'Vertical')+' edge, row '+(y+1)+', column '+(x+1));b.addEventListener('click',()=>change(i,(state[i]+1)%3));
 b.addEventListener('contextmenu',e=>{e.preventDefault();change(i,state[i]===2?0:2)});
 board.append(b);buttons[i]=b;
}
function render(){buttons.forEach((b,i)=>{b.classList.toggle('line',state[i]===1);b.classList.toggle('cross',state[i]===2);b.disabled=won;b.setAttribute('aria-pressed',String(state[i]===1));b.title=state[i]===1?'Loop edge':state[i]===2?'Excluded edge':'Unknown edge'});
 $('lines').textContent=state.filter(x=>x===1).length;$('moves').textContent=moves;$('hints').textContent=hints;$('time').textContent=fmt(seconds());$('best').textContent=best?fmt(best.time):'—';$('undo').disabled=!history.length||won;$('hint').disabled=won;$('share').disabled=!won;analyze();}
function snapshot(){history.push({state:state.slice(),moves,hints});if(history.length>120)history.shift();}
function change(i,next){if(won||state[i]===next)return;snapshot();state[i]=next;moves++;if(!started)started=Date.now()-elapsed*1000;checkWin();persist();render();}
$('undo').onclick=()=>{if(won||!history.length)return;const last=history.pop();state=last.state;moves=last.moves;hints=last.hints;say('Undone.');persist();render();};
$('hint').onclick=()=>{if(won)return;const differences=state.map((s,i)=>s!==(sol[i]==='1'?1:2)?i:-1).filter(i=>i>=0);if(!differences.length)return;const i=differences.find(i=>sol[i]==='1')??differences[0];snapshot();state[i]=sol[i]==='1'?1:2;hints++;moves++;if(!started)started=Date.now()-elapsed*1000;checkWin();if(!won)say('One correct edge was revealed.');persist();render();buttons[i].focus();};
$('reset').onclick=()=>{state=Array(60).fill(0);history=[];moves=0;hints=0;won=false;elapsed=0;started=0;say('Puzzle restarted.');persist();render();};
$('share').onclick=async()=>{try{await navigator.clipboard.writeText('Loop Circuit 98 '+day+' · '+fmt(elapsed)+' · '+moves+' moves · '+hints+' hints\nhttps://mrhakan.github.io/games/loop-circuit/');say('Result copied.')}catch{say('Clipboard unavailable.')}};
document.addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey||['INPUT','TEXTAREA'].includes(e.target.tagName))return;const k=e.key.toLowerCase();if(k==='u')$('undo').click();else if(k==='h')$('hint').click();else if(k==='r')$('reset').click();});
if(won)say('Already completed today. Restart to play again.');
setInterval(()=>{if(started&&!won){$('time').textContent=fmt(seconds());if(seconds()%5===0)persist();}},1000);
render();
})();
