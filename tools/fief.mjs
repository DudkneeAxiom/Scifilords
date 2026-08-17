import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const errs=[];
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({viewport:{width:1440,height:900}});
p.on('pageerror', e=>errs.push('ERR '+e.message));
p.on('console', m=>{if(m.type()==='error')errs.push('C '+m.text());});
await p.goto('http://localhost:8124/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#title:not(.hidden)',{timeout:90000});
await p.click('button[data-act="new"]');
await p.waitForSelector('#modal .modal-title',{timeout:20000});
await p.click('#modal [data-x="close"]');
await p.waitForSelector('#modal [data-perk]',{timeout:20000});
await p.click('#modal [data-perk]');
await p.waitForTimeout(600);
await p.evaluate(()=>{document.getElementById('overlay').classList.add('hidden');window.KR.world.setPaused(false);});
await p.waitForTimeout(300);
// Hold a few places, one garrisoned, one under pressure.
await p.evaluate(()=>{
  const S=window.KR.campaign, St=window.KR.dev.State;
  for (const id of ['grellan','perran','rampart']) St.seizeLocation(S,id);
  while (S.roster.length < 9) S.roster.push({...S.roster[1], id:'x'+S.roster.length, garrison:null});
  const spare = St.ready(S).filter(s=>!s.isCommander);
  St.stationSoldier(S,'grellan',spare[0].id);
  St.stationSoldier(S,'grellan',spare[1].id);
  S.holdings.perran.threat = 0.8;
});
await p.keyboard.press('k'); await p.waitForTimeout(700);
await p.screenshot({path:'qa/fief.png'});
const info = await p.evaluate(()=>({
  rows: document.querySelectorAll('#modal .realm-row').length,
  summary: document.querySelector('#modal .stat-row')?.textContent.replace(/\s+/g,' ').trim().slice(0,120),
  warn: document.querySelector('#modal .outnumbered')?.textContent.replace(/\s+/g,' ').trim(),
  tabKeys: document.querySelectorAll('#modal .mtab-key').length,
}));
console.log(JSON.stringify(info,null,2));
// Q/E must step between screens, once per press.
const before = await p.evaluate(()=>document.querySelector('#modal .mtab.on')?.dataset.tab);
await p.keyboard.press('e'); await p.waitForTimeout(400);
const after = await p.evaluate(()=>document.querySelector('#modal .mtab.on')?.dataset.tab);
await p.keyboard.press('q'); await p.waitForTimeout(400);
const back = await p.evaluate(()=>document.querySelector('#modal .mtab.on')?.dataset.tab);
console.log('tab step:', before, '->', after, '->', back);
console.log('errors', errs.length); errs.slice(0,4).forEach(e=>console.log(' ',e));
await b.close();
