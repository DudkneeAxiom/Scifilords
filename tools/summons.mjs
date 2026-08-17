// Does a liege ever ask anything of you?
//
// Swearing to a faction used to mean taking its contracts off a board like
// anybody else's, which makes it an employer rather than a liege. Now when the
// side you are sworn to marches on a settlement, a siege contract appears with
// a deadline set by the column's arrival — and not turning up costs standing.
//
// What has to hold: the summons appears at all, it is cleaned up whether the
// column ARRIVES or is broken on the road (otherwise it sits on the board
// forever pointing at an army that no longer exists), and ignoring it is
// actually noticed.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage();
p.on('pageerror', e=>console.log('ERR', e.message));
await p.goto('http://localhost:8124/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#title:not(.hidden)',{timeout:90000});
const out = await p.evaluate(() => {
  const { State, Dip } = window.KR.dev;
  const S = State.newCampaign(31337);
  S.allegiance = 'trust';
  Dip.setRelation(S, 'trust', 'syndic', 'war', 100000);
  const repStart = S.rep.trust || 0;
  let sawSummons = null, colId = null;
  for (let i = 0; i < 2000 && !sawSummons; i++) {
    State.advanceTime(S, 2);
    const c = S.contracts.find(x => x.summons);
    if (c) { sawSummons = { title: c.title, site: c.site, type: c.type, pay: c.pay }; colId = c.summons; }
  }
  // Ignore it entirely and let the column arrive.
  for (let i = 0; i < 400; i++) State.advanceTime(S, 2);
  const lingering = S.contracts.some(x => x.summons === colId);
  return { sawSummons, lingering, repStart, repEnd: S.rep.trust || 0,
    logs: (S.log||[]).slice(-6).map(l => l.text || l) };
});
console.log(JSON.stringify(out, null, 2));
await b.close();
