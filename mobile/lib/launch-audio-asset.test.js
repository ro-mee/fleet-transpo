import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const generatorUrl = new URL('../../scripts/generate-launch-audio.mjs', import.meta.url);
const audioUrl = new URL('../assets/audio/hotel-route-launch.wav', import.meta.url);

describe('original launch sound', () => {
  it('reproduces the shipped short PCM sound with quiet headroom and smooth silent edges', async () => {
    expect(existsSync(generatorUrl), 'the reproducible sound generator must exist').toBe(true);
    const { synthesizeLaunchAudio } = await import(generatorUrl.href);
    const wav = synthesizeLaunchAudio();
    expect(wav.equals(synthesizeLaunchAudio())).toBe(true);
    expect(wav.equals(readFileSync(audioUrl))).toBe(true);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1);
    const channels = wav.readUInt16LE(22), sampleRate = wav.readUInt32LE(24);
    expect(channels).toBe(2); expect(sampleRate).toBe(44100); expect(wav.readUInt16LE(34)).toBe(16);
    const frames = (wav.length - 44) / 4;
    expect(frames / sampleRate).toBeGreaterThanOrEqual(1.75);
    expect(frames / sampleRate).toBeLessThanOrEqual(1.9);
    let peak = 0, energy = 0, jump = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const at = 44 + frame * 4 + channel * 2, sample = wav.readInt16LE(at) / 32768;
        peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;
        if (frame) jump = Math.max(jump, Math.abs(sample - wav.readInt16LE(at - 4) / 32768));
        if (frame === 0 || frame === frames - 1) expect(sample).toBe(0);
      }
    }
    expect(peak).toBeGreaterThan(0.2); expect(peak).toBeLessThanOrEqual(0.45);
    expect(Math.sqrt(energy / (frames * channels))).toBeLessThan(0.1);
    expect(jump).toBeLessThan(0.1);
    const windowRms = (start, end) => {
      let squares = 0, count = 0;
      for (let frame = Math.round(start * sampleRate); frame < Math.round(end * sampleRate); frame += 1) {
        const sample = wav.readInt16LE(44 + frame * 4) / 32768;
        squares += sample * sample; count += 1;
      }
      return Math.sqrt(squares / count);
    };
    // The first letter falls from 600 to 780 ms: its accent belongs at the landing.
    expect(windowRms(0.73, 0.775)).toBeLessThan(0.0001);
    expect(windowRms(0.79, 0.82)).toBeGreaterThan(0.005);
  });
});
