import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage();
p.on('pageerror', e=>console.log('ERR', e.message));
await p.goto('http://localhost:8124/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#title:not(.hidden)',{timeout:90000});
console.log(JSON.stringify(await p.evaluate(() => {
  const { State } = window.KR.dev;
  const band = (speed) => ({ id:'b', kind:'looters', name:'B', faction:'raider',
    x:0, z:0, speed, strength:6, quality:0.6, hostileToPlayer:true });
  const lean = State.newCampaign(4321);
  lean.pos.x = 0; lean.pos.z = 0;
  const laden = State.newCampaign(4321);
  laden.pos.x = 0; laden.pos.z = 0;
  laden.cargo = { salvage: 200 }; laden.rations = 0;
  for (let i=0;i<10;i++) laden.roster.push({...laden.roster[1], id:'x'+i});
  return {
    leanVsLooters: +State.escapeChance(lean, band(22)).toFixed(2),
    ladenVsLooters: +State.escapeChance(laden, band(22)).toFixed(2),
    leanVsFast: +State.escapeChance(lean, band(120)).toFixed(2),
    leanPace: Math.round(State.partySpeed(lean).speed),
    ladenPace: Math.round(State.partySpeed(laden).speed),
  };
}, null), null, 2));
await b.close();
