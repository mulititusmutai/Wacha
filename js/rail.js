/* ====================================================================
   BEADAZZLE — control-rail deck (build page, right column)
   The rail is a mini deck of .rail-section panels in DOM order. Sections
   marked .adv-off are excluded (Advanced settings toggle).

   Wheel behavior: if the active section's content overflows, the wheel
   scrolls it natively first; at the top/bottom edge, scroll accumulates
   and a section swap fires only after a deliberate amount (~160px),
   so a stray tick never flips pages back and forth.
   ==================================================================== */
(() => {
    const rail = document.querySelector('.control-rail');
    if (!rail) return;

    const allSections = [...rail.querySelectorAll('.rail-section')];
    const title = rail.querySelector('.rail-title');
    const step = rail.querySelector('.rail-step');
    const dotsWrap = rail.querySelector('.rail-dots');
    if (allSections.length === 0) return;

    let currentIdx = 0;      // index within the visible list
    let locked = false;
    let dots = [];

    const visible = () => allSections.filter(s => !s.classList.contains('adv-off'));

    /* build the dots for the current visible list */
    function buildDots() {
        const secs = visible();
        dotsWrap.innerHTML = '';
        dots = secs.map(s => {
            const d = document.createElement('button');
            d.className = 'rail-dot';
            d.title = s.dataset.name || 'Panel';
            d.addEventListener('click', () => go(secs.indexOf(s)));
            dotsWrap.appendChild(d);
            return d;
        });
    }

    function paint() {
        const secs = visible();
        allSections.forEach(s => {
            if (s.classList.contains('adv-off')) return;
            s.classList.toggle('is-active', secs.indexOf(s) === currentIdx);
            if (secs.indexOf(s) !== currentIdx) s.classList.remove('is-exit');
        });
        dots.forEach((d, i) => d.classList.toggle('active', i === currentIdx));
        const active = secs[currentIdx];
        if (active) {
            title.textContent = active.dataset.name || 'Panel';
            step.textContent = `${currentIdx + 1} / ${secs.length}`;
        }
    }

    function go(i) {
        const secs = visible();
        const next = Math.max(0, Math.min(secs.length - 1, i));
        if (next === currentIdx || locked) return;
        locked = true;
        const outgoing = secs[currentIdx];
        outgoing.classList.add('is-exit');
        currentIdx = next;
        paint();
        setTimeout(() => { outgoing.classList.remove('is-exit'); locked = false; }, 340);
    }

    /* advanced toggle: show/hide telemetry; land on a sane section */
    const advToggle = document.getElementById('adv-toggle');
    if (advToggle) {
        advToggle.addEventListener('change', () => {
            const telemetry = allSections.find(s => s.dataset.section === '3');
            if (telemetry) telemetry.classList.toggle('adv-off', !advToggle.checked);
            const secs = visible();
            if (currentIdx >= secs.length) currentIdx = secs.length - 1;
            buildDots();
            paint();
        });
    }

    /* wheel: native scroll inside the section until it hits an edge,
       then accumulate — a swap needs a deliberate scroll (~160px) */
    let acc = 0;
    let accTimer = null;
    rail.addEventListener('wheel', e => {
        const secs = visible();
        const active = secs[currentIdx];
        if (!active) return;
        if (locked) { e.preventDefault(); return; }

        const canScroll = active.scrollHeight > active.clientHeight + 2;
        if (canScroll) {
            const atTop = active.scrollTop <= 1;
            const atBottom = active.scrollTop + active.clientHeight >= active.scrollHeight - 1;
            const goingUp = e.deltaY < 0;
            if ((goingUp && !atTop) || (!goingUp && !atBottom)) { acc = 0; return; }
        }
        e.preventDefault();
        acc += e.deltaY;
        clearTimeout(accTimer);
        accTimer = setTimeout(() => { acc = 0; }, 450);
        if (Math.abs(acc) >= 160) {
            const dir = acc > 0 ? 1 : -1;
            acc = 0;
            go(currentIdx + dir);
        }
    }, { passive: false });

    /* touch swipe on the rail */
    let ty = null;
    rail.addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
    rail.addEventListener('touchend', e => {
        if (ty === null) return;
        const dy = ty - e.changedTouches[0].clientY;
        if (Math.abs(dy) > 60) go(currentIdx + (dy > 0 ? 1 : -1));
        ty = null;
    }, { passive: true });

    buildDots();
    paint();
})();
