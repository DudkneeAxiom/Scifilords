import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage();
p.on('pageerror', e=>console.log('ERR', e.message));
await p.goto('http://localhost:8124/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#title:not(.hidden)',{timeout:90000});
console.log(JSON.stringify(await p.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const { State } = window.KR.dev;
  const S = State.newCampaign(777); window.KR.campaign = S;
  const m = new Mission({ campaign:S, spec:{type:'skirmish',site:'grellan',layout:'array'},
    squad: State.ready(S).slice(0,4), container: document.getElementById('viewport'),
    onHud(){},onToast(){},onIntro(){},onWheel(){},onEnd(){} });
  await m.start(); m.paused=false; m.hadLock=true;
  if(m.intro){m.intro.active=false;m.time=m.intro.graceUntil+0.1;}
  m.syncVisuals(0.016);
  const friendly = m.entities.filter(e=>e.side==='player' && !e.isPlayer);
  const enemies = m.entities.filter(e=>e.side==='enemy');
  return {
    friendlies: friendly.length,
    ringed: friendly.filter(e=>e.friendRing && e.friendRing.visible).length,
    enemyRings: enemies.filter(e=>e.friendRing).length,
    playerRing: !!m.player.friendRing,
    onGround: friendly.slice(0,2).map(e=>({
      dy:+(e.friendRing.position.y - e.char.group.position.y).toFixed(2),
      dx:+(e.friendRing.position.x - e.x).toFixed(2) })),
  };
}, null), null, 2));
await b.close();
