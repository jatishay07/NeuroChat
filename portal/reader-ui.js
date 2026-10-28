// Reading page layout: the tutor's offer and answer appear right under the paragraph they're
// about, and the reading tools live in a dock at the bottom. eyes.js and tutor.js own the logic;
// this file only moves their elements and shows status.
(() => {
  const $ = id => document.getElementById(id);
  const paras = () => [...$('text').querySelectorAll('p:not(.eyebrow)')];
  let offerAt = null; // paragraph the offer sits under

  function under(el, i) {
    const p = paras()[i];
    if (!p) return;
    paras().forEach((q, j) => q.classList.toggle('asked', j === i));
    p.after(el);
  }

  function openTutor(i) {
    $('offer').hidden = true;
    offerAt = null;
    under($('tutor'), i);
    $('tutor').hidden = false;
    $('tutor').scrollIntoView({behavior: 'smooth', block: 'nearest'});
    toggleInsights(false);
  }

  // tutor.js shows the offer first (it registered its listener earlier); place it if it did.
  window.addEventListener('paragraph:slow', e => {
    if ($('offer').hidden || offerAt !== null) return;
    offerAt = e.detail.index;
    under($('offer'), offerAt);
  });
  window.addEventListener('paragraph:explain', e => openTutor(e.detail.index));
  $('offerYes').addEventListener(
    'click',
    () => offerAt !== null && openTutor(offerAt)
  );
  $('offerNo').addEventListener('click', () => {
    offerAt = null;
    paras().forEach(p => p.classList.remove('asked'));
  });
  $('doneBtn').onclick = () => {
    $('tutor').hidden = true;
    paras().forEach(p => p.classList.remove('asked'));
  };
  for (const b of document.querySelectorAll('#tutor .quick button')) {
    b.onclick = () => {
      $('askInput').value = b.dataset.ask;
      $('askForm').requestSubmit();
    };
  }

  function toggleInsights(open = $('insights').hidden) {
    $('insights').hidden = !open;
    $('insightsBtn').setAttribute('aria-expanded', String(open));
  }
  $('insightsBtn').onclick = () => toggleInsights();
  document.addEventListener(
    'keydown',
    e => e.key === 'Escape' && toggleInsights(false)
  );

  // Status dots: eyes follow the face chip eyes.js keeps up to date, the headset comes from the companion.
  const setStat = (id, state, label) => {
    $(id).dataset.state = state;
    $(id).title = label;
  };
  new MutationObserver(() => {
    const c = $('faceChip');
    setStat(
      'eyeStat',
      c.classList.contains('ok')
        ? 'on'
        : c.classList.contains('bad')
          ? 'bad'
          : 'off',
      c.textContent
    );
  }).observe($('faceChip'), {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  async function headset() {
    try {
      const s = await (await fetch('/api/device')).json();
      const on = s.state === 'streaming';
      setStat(
        'headStat',
        on ? 'on' : 'off',
        on ? 'Headset streaming' : 'No headset: eye tracking only'
      );
    } catch {
      setStat('headStat', 'off', "Can't reach the companion app");
    }
  }
  headset();
  setInterval(headset, 5000);

  // Recap: when you finish, how long each paragraph took and which one slowed you down.
  // Read from the bars eyes.js keeps up to date, so the numbers match Insights.
  let startedAt = null;
  new MutationObserver(() => {
    if (document.body.classList.contains('reading') && startedAt === null)
      startedAt = Date.now();
  }).observe(document.body, {attributes: true, attributeFilter: ['class']});

  function recap() {
    const rows = [...$('bars').children].map((li, i) => ({
      i,
      width: parseFloat(li.querySelector('.fill')?.style.width) || 0,
      slow: li.classList.contains('slow'),
    }));
    const mins = startedAt
      ? Math.max(1, Math.round((Date.now() - startedAt) / 60000))
      : null;
    $('recapSub').textContent =
      document.querySelector('#text h1')?.textContent.trim() || '';
    $('recapTitle').textContent = mins
      ? `You read it in ${mins} minute${mins === 1 ? '' : 's'}`
      : 'Your reading';
    $('recapBars').replaceChildren(
      ...rows.map(r => {
        const li = document.createElement('li');
        li.className = r.slow ? 'slow' : '';
        li.innerHTML = `<span class="bar"></span><span class="n"></span>`;
        li.querySelector('.bar').style.height = `${Math.max(6, r.width)}%`;
        li.querySelector('.n').textContent = r.i + 1;
        li.setAttribute(
          'aria-label',
          `Paragraph ${r.i + 1}${r.slow ? ', slow' : ''}`
        );
        return li;
      })
    );
    const worst = rows.filter(r => r.slow).sort((a, b) => b.width - a.width)[0];
    $('recapNote').hidden = !worst;
    if (worst) {
      $('recapNote').dataset.i = worst.i;
      $('recapNoteTitle').textContent =
        `Paragraph ${worst.i + 1} slowed you down.`;
      $('recapNoteText').textContent = 'Want it explained another way?';
    }
    toggleInsights(false);
    $('recap').hidden = false;
    $('recapClose').focus();
  }
  const closeRecap = () => {
    $('recap').hidden = true;
  };
  $('finishBtn').onclick = recap;
  $('recapClose').onclick = closeRecap;
  $('recap').onclick = e => e.target === $('recap') && closeRecap();
  document.addEventListener('keydown', e => e.key === 'Escape' && closeRecap());
  $('recapExplain').onclick = () => {
    const i = Number($('recapNote').dataset.i);
    closeRecap();
    window.dispatchEvent(
      new CustomEvent('paragraph:explain', {
        detail: {index: i, text: paras()[i].textContent.trim()},
      })
    );
  };
})();
