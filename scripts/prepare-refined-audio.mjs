import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Offline editing of recordings, never synthesis. FFmpeg is only a preparation
// tool, not a runtime/build dependency. The source WAV comes from SnakeF8's pack.
const root = fileURLToPath(new URL('../public/audio/', import.meta.url));
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/prepare-refined-audio.mjs <9mm Single Isolated.wav>');
async function prepare(input, output, filters, peak) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', input, '-af', filters, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], { maxBuffer: 8e6 });
  let maximum = 0;
  for (let i = 0; i < pcm.length; i += 4) maximum = Math.max(maximum, Math.abs(pcm.readFloatLE(i)));
  if (!maximum) throw new Error(`Silent recording: ${input}`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ac', '1', '-ar', '48000', '-i', '-', '-af', `volume=${peak / maximum}`, '-c:a', 'pcm_s16le', output], { input: pcm });
}
await prepare(source, path.join(root, 'snakef8/pistol-clean.wav'), 'atrim=end=0.22,highpass=f=100,afftdn=nr=8:nf=-42,afade=t=in:d=0.001,afade=t=out:st=0.08:d=0.14', .8);
for (const [surface, lengths, peak] of [['concrete', [.18, .22, .18, .20], .7], ['dirt', [.32, .38, .30, .32], .55]]) {
  for (const [i, duration] of lengths.entries()) await prepare(path.join(root, `portal2/player/footsteps/${surface}${i + 1}.wav`), path.join(root, `foley/${surface}${i + 1}.wav`), `atrim=end=${duration},afftdn=nr=6:nf=-55,afade=t=in:d=0.0008,afade=t=out:st=${duration - .05}:d=0.05`, peak);
}
console.log('Prepared Glock and 8 footstep recordings; grass is unchanged.');
