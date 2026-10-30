import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const DURATION = 1.88;
const TAU = 2 * Math.PI;
const smooth = (value) => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };

// Original synthesis only: seeded filtered air, damped wooden partials and a soft chord.
export function synthesizeLaunchAudio() {
  const frames = Math.round(SAMPLE_RATE * DURATION);
  const dry = new Float64Array(frames);
  const stereo = new Float64Array(frames * 2);
  const notes = [349.228, 440, 523.251, 440, 349.228, 261.626, 587.33, 523.251];
  let seed = 0x464c4545, low = 0, lower = 0;
  for (let i = 0; i < frames; i += 1) {
    const t = i / SAMPLE_RATE;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    low += 0.12 * (noise - low);
    lower += 0.022 * (low - lower);
    const roadPhase = Math.max(0, Math.min(1, t / 0.62));
    let sample = (low - lower) * Math.sin(Math.PI * roadPhase) ** 2 * 0.045;
    // Soft mallet arrivals: F l e e t O p s; O has a deeper, rounder body.
    for (let letter = 0; letter < notes.length; letter += 1) {
      const age = t - (0.78 + letter * 0.075);
      if (age < 0 || age > 0.53) continue;
      const fundamental = notes[letter];
      const attack = smooth(age / 0.007);
      const tail = 1 - smooth((age - 0.35) / 0.18);
      const body = Math.sin(TAU * fundamental * age) * Math.exp(-age / 0.135);
      const wood = 0.19 * Math.sin(TAU * fundamental * 2.01 * age) * Math.exp(-age / 0.055)
        + 0.035 * Math.sin(TAU * fundamental * 4.18 * age) * Math.exp(-age / 0.025);
      sample += (body + wood) * attack * tail * (letter === 5 ? 0.102 : 0.085);
    }
    const finish = t - 1.40;
    if (finish >= 0 && finish <= 0.35) {
      const envelope = Math.sin(Math.PI * finish / 0.35) ** 2;
      sample += envelope * (0.007 * Math.sin(TAU * 1046.502 * finish)
        + 0.004 * Math.sin(TAU * 1567.982 * finish)
        + 0.003 * (low - lower));
    }
    dry[i] = sample;
  }

  let peak = 0;
  for (let i = 0; i < frames; i += 1) {
    const fade = smooth(i / (0.016 * SAMPLE_RATE))
      * smooth((frames - 1 - i) / (0.12 * SAMPLE_RATE));
    for (let channel = 0; channel < 2; channel += 1) {
      let sample = dry[i];
      for (const [delay, gain] of [[0.031, 0.10], [0.057, 0.065], [0.091, 0.035]]) {
        const earlier = i - Math.round((delay + channel * 0.004) * SAMPLE_RATE);
        if (earlier >= 0) sample += dry[earlier] * gain;
      }
      stereo[i * 2 + channel] = sample * fade;
      peak = Math.max(peak, Math.abs(sample * fade));
    }
  }
  assert(peak > 0 && Number.isFinite(peak));
  const gain = 0.43 / peak;
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < stereo.length; i += 1) {
    const pcm = Math.round(stereo[i] * gain * 32767);
    assert(Math.abs(pcm) < 32767, 'The launch sound must retain headroom.');
    wav.writeInt16LE(pcm, 44 + i * 2);
  }
  assert.equal(wav.readInt16LE(44), 0);
  assert.equal(wav.readInt16LE(wav.length - 2), 0);
  assert(DURATION <= 1.9);
  return wav;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = fileURLToPath(new URL('../mobile/assets/audio/hotel-route-launch.wav', import.meta.url));
  mkdirSync(dirname(target), { recursive: true });
  const wav = synthesizeLaunchAudio();
  writeFileSync(target, wav);
  console.log(`Generated ${DURATION}s original launch sound (${wav.length} bytes, stereo PCM).`);
}
