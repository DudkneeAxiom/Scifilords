import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const warn=[];
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({viewport:{width:1100,height:760}});
p.on('console', m=>{ const t=m.text(); if(/context/i.test(t)) warn.push(t); });
p.on('pageerror', e=>warn.push('ERR '+e.message));
await p.goto('http://localhost:8124/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#title:not(.hidden)',{timeout:90000});
await p.click('button[data-act="new"]');
await p.waitForSelector('#modal .modal-title',{timeout:20000});
await p.click('#modal [data-x="close"]');
await p.waitForSelector('#modal [data-perk]',{timeout:20000});
await p.click('#modal [data-perk]');
await p.waitForTimeout(600);
await p.evaluate(()=>{document.getElementById('overlay').classList.add('hidden');window.KR.world.setPaused(false);});
await p.waitForTimeout(400);
// Open and close the character screen many times, as a player browsing kit does.
for (let i=0;i<24;i++){
  await p.keyboard.press('v'); await p.waitForTimeout(130);
  await p.keyboard.press('Escape'); await p.waitForTimeout(130);
}
await p.waitForTimeout(600);
const s = await p.evaluate(()=>{
  const W=window.KR.world; const i=W.renderer.info;
  return { calls:i.render.calls, tris:i.render.triangles, lost:W.renderer.getContext().isContextLost() };
});
console.log('after 24 visits to the character screen:', JSON.stringify(s));
const leak = warn.some(w=>/Too many active WebGL contexts/i.test(w));
console.log('context-limit warning seen:', leak);
warn.slice(0,4).forEach(w=>console.log('  ',w));
console.log(!leak && !s.lost && s.calls>0 ? 'OK — the map is still drawing' : 'FAIL — the map lost its context');
await b.close();
