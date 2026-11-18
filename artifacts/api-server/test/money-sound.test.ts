import { describe, expect, it, vi } from "vitest";
import { playMoneySound } from "../../up-dash/src/lib/money-sound";

describe("money notification sound", () => {
  it("schedules a short audible chime after browser audio is resumed", async () => {
    const tones: Array<{
      frequency: { value: number };
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    const context = {
      resume: vi.fn().mockResolvedValue(undefined),
      state: "running",
      currentTime: 10,
      destination: {},
      createOscillator: () => {
        const tone = {
          frequency: { value: 0 },
          start: vi.fn(),
          stop: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        tones.push(tone);
        return tone;
      },
      createGain: () => ({
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
    };
    await playMoneySound(context as unknown as AudioContext);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(tones.length).toBeGreaterThan(1);
    expect(
      tones.every((t) => t.frequency.value > 100 && t.frequency.value < 16000),
    ).toBe(true);
    expect(
      tones.every(
        (t) => t.start.mock.calls[0][0] >= 10 && t.stop.mock.calls[0][0] < 11,
      ),
    ).toBe(true);
  });
  it("reports browser audio blocking without starting any tones", async () => {
    const createOscillator = vi.fn();
    await expect(
      playMoneySound({
        resume: vi.fn().mockResolvedValue(undefined),
        state: "suspended",
        createOscillator,
      } as unknown as AudioContext),
    ).rejects.toThrow("Audio unavailable");
    expect(createOscillator).not.toHaveBeenCalled();
  });
});
