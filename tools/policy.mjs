import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage();
p.on('pageerror', e=>console.log('ERR', e.message));
await p.goto('http://localhost:8124/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#title:not(.hidden)',{timeout:90000});
console.log(JSON.stringify(await p.evaluate(() => {
  const { State } = window.KR.dev;
  const mk = () => { const S = State.newCampaign(1212);
    State.seizeLocation(S,'grellan'); State.seizeLocation(S,'perran');
    return S; };
  // Policies need a flag of your own.
  const noFlag = State.setPolicy(mk(),'levy',true);
  const income = (policies) => {
    const S = mk(); S.ownFaction = { id:'bracket', name:'Bracket', colour:0xc08d3f };
    for (const id of policies) State.setPolicy(S, id, true);
    // Drawn down first: manpower regen is skipped at cap, so a town sitting full
    // shows no conscription cost at all and the probe proves nothing.
    State.manpowerAt(S,'grellan'); S.manpower.grellan = 1;
    const before = S.credits;
    const rel0 = State.relationOf(S,'grellan');
    for (let d=0; d<10; d++) State.advanceTime(S,24);
    return { gained: S.credits - before, rel: +(State.relationOf(S,'grellan')-rel0).toFixed(1),
      men: Math.floor(State.manpowerAt(S,'grellan')),
      def: +State.garrisonStrength(S,'grellan').toFixed(1) };
  };
  const plain = income([]);
  const levy = income(['levy']);
  const tolls = income(['tolls']);
  const consc = income(['conscription']);
  return { noFlag, plain, levy, tolls, consc };
}, null), null, 2));
await b.close();
