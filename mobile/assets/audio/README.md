# Hotel Route launch sound

`hotel-route-launch.wav` is an original locally synthesized FleetOps sound. No recordings, downloaded samples, external music, voices or generative-audio service were used.

Exact source: `scripts/generate-launch-audio.mjs`. Rebuild from the repository root with `node scripts/generate-launch-audio.mjs`. The fixed seed `0x464c4545` and additive synthesis reproduce identical PCM bytes.

- Format: 44.1 kHz stereo, 16-bit PCM WAV, 1.88 seconds, 331,676 bytes.
- Opening: a softly filtered air sweep from 0 to 0.62 seconds.
- Letter landings: eight rounded wooden/mallet tones at 0.780, 0.855, 0.930, 1.005, 1.080, 1.155, 1.230 and 1.305 seconds, 180 ms after each letter starts falling. The sixth landing, O, has a deeper body.
- Finish: a restrained harmonic shimmer from 1.40 to 1.75 seconds and a smooth fading tail.
- Level: peak normalized to 0.43 full scale (about -7.3 dBFS) with a further player volume of 0.55. Smooth attacks and ending avoid hard clicks. Physical-device loudness still needs listening acceptance.

The launch hook preloads while the motion preference and composition resolve. Playback is eligible only while active and the animation is playing with motion enabled, with a 180 ms opening readiness limit. It seeks to elapsed animation time before playing; a seek taking over 40 ms is skipped to avoid late letter accents. Audio never extends launch, loops, replays on foreground, requests microphone access or plays through iOS silent mode. Older development clients without the native audio module remain silent. Installing the native dependency requires rebuilding the development/release binary.

The installed API is Expo SDK 54's `expo-audio` 1.1.1. Reference: [official SDK 54 source documentation](https://github.com/expo/expo/blob/sdk-54/docs/pages/versions/v54.0.0/sdk/audio.mdx) and the installed package's source/types. The versioned public documentation URL currently redirects to a newer API; no SDK upgrade is included.
