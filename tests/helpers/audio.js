// アプリのオーディオグラフはIIFEの中に閉じているので、外からノードを掴めない。
// AudioNode.prototype.connect をラップして、destination へ繋がる信号を
// AnalyserNode にも分岐させ、テストから波形を読めるようにする。

export async function installAudioProbe(page) {
  await page.addInitScript(() => {
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...rest) {
      if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
        const probe = dest.context.createAnalyser();
        probe.fftSize = 2048;
        origConnect.call(this, probe);
        window.__audioProbe = probe;
      }
      return origConnect.call(this, dest, ...rest);
    };
  });
}

/** プローブから現在の波形レベルを取る。プローブ未設置なら null */
export function readLevel(page) {
  return page.evaluate(() => {
    const probe = window.__audioProbe;
    if (!probe) return null;
    const buf = new Float32Array(probe.fftSize);
    probe.getFloatTimeDomainData(buf);
    let peak = 0;
    let sum = 0;
    for (const v of buf) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / buf.length), state: probe.context.state };
  });
}

/** 一定時間ポーリングして観測できた最大のピークを返す */
export async function maxPeakOver(page, ms, intervalMs = 250) {
  const deadline = Date.now() + ms;
  let peak = 0;
  let last = null;
  while (Date.now() < deadline) {
    last = await readLevel(page);
    if (last && last.peak > peak) peak = last.peak;
    await page.waitForTimeout(intervalMs);
  }
  return { peak, last };
}
