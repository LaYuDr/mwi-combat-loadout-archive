"use strict";
const assert = require('node:assert/strict'), fixture = require('./action_fixture.cjs');
module.exports = async function checkActionMemory(browser, script, pass) {
  const context = await browser.newContext(), errors = [], requests = [];
  const base = 'https://www.milkywayidlecn.com/game';
  await context.route('**/*', route => { requests.push(route.request().url()); return route.fulfill({ contentType: 'text/html', body: fixture }); });
  await context.addInitScript({ content: script });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  const select = page.getByLabel('配装');
  const expected = value => page.waitForFunction(v => document.querySelector('select').value === String(v), value);
  const make = (name, type = 'woodcutting', reuse = false) => page.evaluate(([n,t,r]) => makePanel(n,t,r), [name,type,reuse]);
  // Selecting the current default in MUI produces no onChange at all.
  // A portal must be associated by aria-controls, not merely by option text.
  for (const keyboard of [false, true]) {
    await make(keyboard ? 'same_keyboard' : 'same_pointer');
    await page.evaluate(() => {
      const control = document.querySelector('select'); control.setAttribute('aria-controls', 'loadout-options');
      const menu = document.createElement('ul'); menu.id = 'loadout-options'; menu.setAttribute('role', 'listbox');
      menu.innerHTML = '<li role="option" data-value="1" tabindex="0">所有行动</li>';
      document.body.append(menu);
    });
    const option = page.getByRole('option', { name: '所有行动', exact: true }).last();
    if (keyboard) await option.press('Enter'); else await option.click();
    await page.evaluate(() => {
      document.querySelector('#loadout-options').remove();
      makePanel('redwood');
    });
    await make(keyboard ? 'same_keyboard' : 'same_pointer');
    const remembered = await page.evaluate(() => {
      const p = actionController.props;
      return JSON.parse(localStorage.getItem('mwi-layu:action-loadouts:v1:' + JSON.stringify([location.origin, currentCharacter, p.actionDetail.type, p.actionDetail.hrid])));
    });
    assert.equal(remembered?.loadoutId, 1);
  }
  await make('redwood');
  await select.selectOption('2');
  await page.getByRole('button', {name:'关闭',exact:true}).click();
  await make('redwood'); await expected(2);
  await page.reload(); await expected(2);
  await make('pine', 'woodcutting', true); await expected(1);
  await select.selectOption('0');
  await make('redwood', 'woodcutting', true); await expected(2);
  await make('pine', 'woodcutting', true); await expected(0);
  await make('wizard_tower', 'combat'); await select.selectOption('3');
  await make('other_zone', 'combat', true); await expected(1);
  await make('wizard_tower', 'combat', true); await expected(3);
  assert.deepEqual(await page.evaluate(() => startedActions), []);
  await page.getByRole('button',{name:'立即开始'}).click();
  assert.deepEqual(await page.evaluate(() => startedActions), [{action:'/actions/wizard_tower',loadout:3}]);
  pass('action memory: life/combat selections including no-loadout survive reopen, reused components and reload; manual start receives restored ID, with no automatic start');
  // All other life categories share the same native detail component.
  for (const type of ['milking','foraging','cheesesmithing','crafting','tailoring','cooking','brewing','alchemy','enhancing']) {
    await make(type, type); await select.selectOption('0'); await make('other_'+type,type); await make(type,type); await expected(0);
  }
  await make('redwood'); await expected(2);
  await page.evaluate(() => { currentCharacter=72; makePanel('redwood','woodcutting',true); }); await expected(1);
  await page.evaluate(() => { currentCharacter=71; makePanel('redwood','woodcutting',true); }); await expected(2);
  const tab = await context.newPage(); await tab.goto(base);
  await tab.waitForFunction(() => document.querySelector('select').value === '2');
  await tab.getByLabel('配装').selectOption('0');
  // Another tab must not replace an in-progress selection; next opening reads it.
  assert.equal(await select.inputValue(), '2');
  await make('pine'); await make('redwood'); await expected(0);
  await tab.close();
  await select.selectOption('2');
  await page.evaluate(() => { loadouts[2].name='新名字'; makePanel(); }); await expected(2);
  assert.equal(await select.locator('option:checked').textContent(), '新名字');
  await page.evaluate(() => { delete loadouts[2]; makePanel(); }); await expected(1);
  await page.getByRole('status').filter({hasText:'上次选择的配装已不可用'}).waitFor();
  pass('all life categories, character isolation, cross-tab next-open behavior, renamed and deleted loadouts pass');
  // MUI hides background accessibility nodes while its portal menu is open.
  await page.evaluate(() => document.querySelector('section').setAttribute('aria-hidden','true'));
  await select.selectOption('0');
  await page.evaluate(() => document.querySelector('section').removeAttribute('aria-hidden'));
  await make('redwood'); await expected(0);
  await page.evaluate(() => { localStorage.setItem('Edible_Tools','keep'); localStorage.setItem('mwi-layu:partitions:v1','keep'); });
  await page.evaluate(() => { Storage.prototype.setItem=function(){throw new DOMException('quota','QuotaExceededError')}; });
  await select.selectOption('1'); await expected(1);
  await page.getByRole('status').filter({hasText:'没能记住'}).waitFor();
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('Edible_Tools'),localStorage.getItem('mwi-layu:partitions:v1')]), ['keep','keep']);
  assert.deepEqual(errors, []); assert.ok(requests.every(url => url === base));
  await context.close();
  pass('portal aria-hidden does not disable capture; storage failure keeps native selection usable, preserves unrelated data and makes no game requests');
};
