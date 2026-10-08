/** The opening owns the main thread until its final frame has been painted.
 * Downloads may run concurrently; JSON parsing/WebGL/world building must wait
 * for finished. Compositor animations alone cannot protect text from long tasks. */
export function startIntro() {
  const body = document.body, skip = document.getElementById('intro-skip');
  let resolveFinished;
  const finished = new Promise(resolve => { resolveFinished = resolve; });
  const nextFrame = globalThis.requestAnimationFrame ?? (callback => setTimeout(callback, 0));
  let timer, ended = false;
  body.classList.add('intro-pending');
  const finish = () => {
    if (ended) return;
    ended = true; clearTimeout(timer);
    body.classList.remove('intro-playing','intro-pending'); skip.hidden = true;
    // Promise microtasks run before paint. Two frames give the browser a chance
    // to present the settled cover before CPU/GPU-heavy scene construction.
    nextFrame(() => nextFrame(resolveFinished));
  };
  skip.addEventListener('click',finish);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return { finish, finished }; }
  const begin = () => {
    if (ended) return;
    body.classList.remove('intro-pending'); body.classList.add('intro-playing');
    timer = setTimeout(finish,6200);
  };
  if (typeof Image === 'undefined') begin();
  else {
    const artwork = new Image(); artwork.src = new URL('art/city-of-god-cover.webp',document.baseURI).href;
    // Raster the decoded panels before starting their timeline. Starting the
    // clock in this promise's microtask still makes the first moving frames pay
    // for six image surfaces, particularly on software/older GPUs.
    const prepared = () => nextFrame(() => nextFrame(begin));
    Promise.all([artwork.decode(), document.fonts?.load('64px Logo'), document.fonts?.load('32px Cover')]).then(prepared,prepared);
  }
  return { finish, finished };
}
