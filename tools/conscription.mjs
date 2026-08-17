import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage();
await p.goto('http://localhost:8124/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#title:not(.hidden)',{timeout:90000});
console.log(JSON.stringify(await p.evaluate(() => {
  const { State } = window.KR.dev;
  const run = (on) => {
    const S = State.newCampaign(1212);
    S.ownFaction = { id:'bracket', name:'Bracket', colour:0xc08d3f };
    State.seizeLocation(S,'perran');            // a settlement: cap 14
    if (on) State.setPolicy(S,'conscription',true);
    State.manpowerAt(S,'perran'); S.manpower.perran = 2;
    const trace=[];
    for (let d=0; d<8; d++){ State.advanceTime(S,24); trace.push(Math.floor(State.manpowerAt(S,'perran'))); }
    return { trace, def:+State.garrisonStrength(S,'perran').toFixed(1) };
  };
  return { off: run(false), on: run(true) };
}, null), null, 2));
await b.close();
