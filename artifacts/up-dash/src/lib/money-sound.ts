// A short register/coin chime, synthesized locally without a downloaded asset.
export async function playMoneySound(context: AudioContext): Promise<void> {
  await context.resume();
  if (context.state !== "running") throw new Error("Audio unavailable");
  const start = context.currentTime;
  for (const [offset, frequency] of [
    [0, 1568],
    [0.09, 2093],
    [0.19, 2637],
    [0.29, 3136],
  ]) {
    for (const [harmonic, volume] of [
      [1, 0.055],
      [2.76, 0.018],
    ]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * harmonic;
      gain.gain.setValueAtTime(0.001, start + offset);
      gain.gain.exponentialRampToValueAtTime(volume, start + offset + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + offset + 0.35);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.36);
    }
  }
}
