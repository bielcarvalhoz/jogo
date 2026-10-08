/** Start only after the artwork is decoded. CSS animates compositor properties
 * so scene assembly cannot eat the whole entrance animation. */
export function startIntro() {
  const body = document.body, skip = document.getElementById('intro-skip');
  let timer, finished = false;
  body.classList.add('intro-pending');
  const finish = () => { finished = true; clearTimeout(timer); body.classList.remove('intro-playing','intro-pending'); skip.hidden = true; };
  skip.addEventListener('click',finish);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return finish; }
  const begin = () => {
    if (finished) return;
    body.classList.remove('intro-pending'); body.classList.add('intro-playing');
    timer = setTimeout(finish,6200);
  };
  if (typeof Image === 'undefined') begin();
  else {
    const artwork = new Image(); artwork.src = new URL('art/city-of-god-cover.webp',document.baseURI).href;
    Promise.all([artwork.decode(), document.fonts?.load('64px Logo')]).then(begin,begin);
  }
  return finish;
}
