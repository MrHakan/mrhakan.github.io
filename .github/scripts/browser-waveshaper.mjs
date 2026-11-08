import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { mockGiscus } from './mock-giscus.mjs';
const base=(process.env.SITE_URL||'http://127.0.0.1:8095').replace(/\/$/,'');
const browser=await chromium.launch({headless:true,...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{})});
const errors=[];
await fs.mkdir('.ci-shots',{recursive:true});
async function setup(mobile=false,pad=false){
 const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},hasTouch:mobile,reducedMotion:'reduce'});
 await mockGiscus(ctx);
 await ctx.route('**/*',r=>/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(r.request().url())?r.continue():r.abort());
 await ctx.addInitScript(({pad})=>{
  Date.now=()=>42;sessionStorage.setItem('welcomed','1');
  const fill=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(text==='HIT NOW'||text==='WAIT FOR THE TARGET')window.testCanHit=text==='HIT NOW';return fill.call(this,text,...args);};
  if(pad){window.testPad={index:0,connected:true,mapping:'standard',buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>window.testPad.connected?[window.testPad]:[]});}
 },{pad});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 return {ctx,page};
}
async function desktopReady(page,path='/'){
 await page.goto(base+path,{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>document.querySelector('#boot-screen')?.remove());
}
async function gameReady(page){
 await page.locator('.waveshaper-frame').waitFor();
 const frame=page.frameLocator('.waveshaper-frame');await frame.locator('#start').waitFor();
 return {frame,game:page.frames().find(f=>f.url().includes('waveshaper/?embed=1'))};
}
try{
 for(const mobile of [false,true]){
  const {ctx,page}=await setup(mobile);
  await desktopReady(page);
  await page.locator('#start-button').click();
  const gamesMenu=page.locator('#start-menu .has-sub').filter({hasText:'games'});
  if(mobile)await gamesMenu.click();else await gamesMenu.hover();
  await page.locator('#start-menu [onclick="startMenuAction(\'waveshaper\')"]').click();
  const {frame,game}=await gameReady(page);
  assert.equal(ctx.pages().length,1,'Start menu must not open a new tab');
  assert.equal(new URL(page.url()).searchParams.get('app'),'waveshaper');
  assert.equal(await frame.locator('#mode').count(),0,'no difficulty selector');
  await frame.locator('#start').click();
  if(mobile)await frame.locator('[data-action="2"]').tap();else await frame.locator('#wave').press('ArrowUp');
  assert.equal(await frame.locator('#score').textContent(),'0','early matching input must not score');
  assert.equal(await frame.locator('#lives').textContent(),'3 / 4','early input costs a life');
  await game.waitForFunction(()=>window.testCanHit===true,{},{timeout:7000}).catch(async error=>{console.log(await game.evaluate(()=>({status:document.querySelector('#status').textContent,overlay:document.querySelector('#overlay').hidden,focus:document.hasFocus(),timing:window.testCanHit})));throw error;});
  if(mobile)await frame.locator('[data-action="2"]').tap();else await frame.locator('#wave').press('ArrowUp');
  assert.equal(await frame.locator('#score').textContent(),'1','hit at receiver scores');
  await page.locator('.waveshaper-window [title="minimize"]').click();
  const win=page.locator('.waveshaper-window'),id=await win.getAttribute('id');
  assert.equal(await win.isVisible(),false);
  await page.locator('#'+id+'-tb').click();
  assert.equal(await frame.locator('#start').textContent(),'RESUME RUN');
  await frame.locator('#start').click();
  await frame.locator('#pause').click();
  if(!mobile){await page.locator('.waveshaper-window .fs-btn').click();assert.ok(await win.evaluate(el=>el.classList.contains('fs-active')));await page.locator('.waveshaper-window .fs-btn').click();}
  await page.screenshot({path:'.ci-shots/waveshaper-desktop-'+(mobile?'mobile':'wide')+'.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('.waveshaper-window [title="close"]').click();
  await page.locator('.waveshaper-frame').waitFor({state:'detached'});
  assert.equal(await page.locator('#'+id+'-tb').count(),0);
  await page.locator('#desk-sidebar').getByRole('button',{name:/playground/}).click();
  await page.locator('#playground-search').fill('waveshaper');
  await page.locator('[data-playground-app="waveshaper"]').click();await gameReady(page);
  assert.equal(ctx.pages().length,1,'Playground must open inside the desktop');
  await page.locator('.waveshaper-window [title="close"]').click();await page.locator('.waveshaper-frame').waitFor({state:'detached'});
  await page.locator('[onclick="launchRandomPlayground()"]').click();await gameReady(page);assert.equal(ctx.pages().length,1,'Random launch stays inside the desktop too');
  await ctx.close();
 }
 const {ctx,page}=await setup(false,true);
 await desktopReady(page,'/games/waveshaper/');
 assert.equal(new URL(page.url()).pathname,'/','old game URL redirects into the desktop');
 const {frame,game}=await gameReady(page);
 await game.waitForFunction(()=>document.querySelector('#pad').textContent.includes('CONNECTED'));
 await game.evaluate(()=>{window.testPad.buttons[9].pressed=true;});
 await frame.locator('#overlay').waitFor({state:'hidden'});
 await game.evaluate(()=>{window.testPad.buttons[9].pressed=false;});
 await page.waitForTimeout(50);
 await game.evaluate(()=>{window.testPad.buttons[5].pressed=true;});
 await game.waitForFunction(()=>document.querySelector('#lives').textContent==='3 / 4');
 await page.waitForTimeout(250);assert.equal(await frame.locator('#lives').textContent(),'3 / 4','held shoulder fires once');
 await game.evaluate(()=>{window.testPad.buttons[5].pressed=false;});
 await game.waitForFunction(()=>window.testCanHit===true);
 await game.evaluate(()=>{window.testPad.buttons[5].pressed=true;});
 await game.waitForFunction(()=>document.querySelector('#score').textContent==='1');
 await game.evaluate(()=>{window.testPad.connected=false;});
 await game.waitForFunction(()=>document.querySelector('#status').textContent.includes('disconnected'));
 assert.equal(await frame.locator('#start').textContent(),'RESUME RUN');
 await ctx.close();assert.deepEqual(errors,[]);
 console.log('WAVESHAPER browser OK: in-site menu/Playground/deep link, no new tabs, desktop/touch timed hits, early penalty, minimize/resume/close and gamepad timing/disconnect.');
}finally{await browser.close();}
