"use client";

/**
 * Records microphone audio to WAV (16-bit PCM, mono, 16 kHz). WAV has no codec
 * dependency, so it plays inline in every browser's <audio> element — unlike
 * MediaRecorder's WebM/Opus, which some mobile browsers can record but not play.
 */

export type WavRecorder = {
  stop: () => Promise<{ blob: Blob; mime: string; duration: number }>;
  cancel: () => void;
};

const TARGET_RATE = 16000;

export async function startWavRecording(): Promise<WavRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AC();
  if (ctx.state === "suspended") await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  // Must connect to a destination for onaudioprocess to fire; output is silent
  // (we never write to the output buffer), so there's no speaker feedback.
  processor.connect(ctx.destination);

  const cleanup = () => {
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
      source.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    cancel() {
      cleanup();
      void ctx.close();
    },
    async stop() {
      const sampleRate = ctx.sampleRate;
      cleanup();
      await ctx.close();
      const merged = merge(chunks);
      const rate = sampleRate > TARGET_RATE ? TARGET_RATE : sampleRate;
      const samples =
        sampleRate > TARGET_RATE
          ? downsample(merged, sampleRate, TARGET_RATE)
          : merged;
      const blob = encodeWav(samples, rate);
      return { blob, mime: "audio/wav", duration: samples.length / rate };
    },
  };
}

function merge(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function downsample(buffer: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let iResult = 0;
  let iBuffer = 0;
  while (iResult < newLen) {
    const next = Math.round((iResult + 1) * ratio);
    let acc = 0;
    let count = 0;
    for (let i = iBuffer; i < next && i < buffer.length; i++) {
      acc += buffer[i];
      count++;
    }
    result[iResult] = count ? acc / count : 0;
    iResult++;
    iBuffer = next;
  }
  return result;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}
