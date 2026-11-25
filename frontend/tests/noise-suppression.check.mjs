/**
 * RNNoise 실동작 검사: 실제 Chrome에서 VoiceAudioEngine에 소리를 흘려 출력을 측정한다.
 *   npm run check:noise [-- <speech.wav (48kHz mono 16bit)>]
 * 음성 파일을 주면 말소리에 섞인 잡음이 실제로 줄어드는지(SI-SDR)도 확인한다.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const RATE = 48000
const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } })
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}/`
const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] })

/** 앱 화면 없이 같은 출처의 빈 페이지만 연다 */
async function open(page) {
  await page.route(origin + 'blank', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html>' }))
  await page.goto(origin + 'blank')
}

/** 신호를 엔진에 넣고 출력을 녹음한다. 앞 1초는 예열(잡음만)이며 결과에서 호출자가 잘라 쓴다. */
async function run(page, samples, on) {
  const b64 = Buffer.from(samples.buffer).toString('base64')
  const r = await page.evaluate(
    async ({ b64, on, RATE }) => {
      const { VoiceAudioEngineImpl } = await import('/src/lib/voiceAudioEngine.ts')
      const input = new Float32Array(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer)
      const ctx = new AudioContext({ sampleRate: RATE })
      const src = ctx.createBufferSource()
      src.buffer = ctx.createBuffer(1, input.length, RATE)
      src.buffer.copyToChannel(input, 0)
      const feed = ctx.createMediaStreamDestination()
      feed.channelCount = 1
      src.connect(feed)
      const engine = new VoiceAudioEngineImpl()
      const out = engine.initializeInput(feed.stream)
      await engine.resume()
      const applied = on ? await engine.setNoiseSuppression(true) : null
      const code = `registerProcessor('rec', class extends AudioWorkletProcessor { process(i) { if (i[0][0]) this.port.postMessage(i[0][0].slice()); return true } })`
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
      const rec = new AudioWorkletNode(ctx, 'rec')
      const chunks = []
      rec.port.onmessage = (e) => chunks.push(e.data)
      ctx.createMediaStreamSource(out).connect(rec)
      await new Promise((res) => setTimeout(res, 300))
      chunks.length = 0
      src.start()
      await new Promise((res) => (src.onended = res))
      await new Promise((res) => setTimeout(res, 200))
      const pcm = new Float32Array(chunks.length * 128)
      chunks.forEach((c, i) => pcm.set(c, i * 128))
      engine.destroy()
      await ctx.close()
      const bytes = new Uint8Array(pcm.buffer)
      let s = ''
      for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768))
      return { pcm: btoa(s), applied }
    },
    { b64, on, RATE },
  )
  const buf = Buffer.from(r.pcm, 'base64')
  return { applied: r.applied, pcm: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)) }
}

const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9))

/** 출력을 기준 신호에 맞춰 정렬한 뒤의 SI-SDR(dB). 클수록 원래 목소리에 가깝다. */
function siSdr(ref, out) {
  let best = -Infinity
  let lag = 0
  const step = 4
  for (let l = 0; l < RATE * 0.6; l += 1) {
    let c = 0
    for (let i = 0; i < ref.length; i += step) c += ref[i] * (out[i + l] ?? 0)
    if (c > best) [best, lag] = [c, l]
  }
  let dot = 0
  let energy = 0
  for (let i = 0; i < ref.length; i++) {
    dot += ref[i] * (out[i + lag] ?? 0)
    energy += ref[i] * ref[i]
  }
  const a = dot / energy
  let err = 0
  for (let i = 0; i < ref.length; i++) err += ((out[i + lag] ?? 0) - a * ref[i]) ** 2
  return 10 * Math.log10((a * a * energy) / err)
}

// 재현 가능한 난수
let seed = 1
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
const fan = (n, amp) => {
  let lp = 0
  return Float32Array.from({ length: n }, () => (lp = 0.9 * lp + 0.1 * rand()) * amp * 4)
}
const keyboard = (n, amp) => {
  const out = new Float32Array(n)
  for (let t = 0; t < n; t += RATE * 0.17 + Math.floor(Math.abs(rand()) * RATE * 0.06)) {
    const at = Math.floor(t)
    for (let i = 0; i < 1400 && at + i < n; i++) out[at + i] = rand() * amp * 5 * Math.exp(-i / 220)
  }
  return out
}

try {
  const page = await browser.newPage()
  page.on('console', (m) => m.type() === 'error' && console.log('  [browser]', m.text().slice(0, 160)))
  await open(page)

  // 1. 잡음만 들어올 때
  const tail = (p) => p.subarray(RATE * 2, RATE * 4)
  // 키보드 같은 짧은 충격음은 RNNoise도 조금만 줄인다
  for (const [name, make, min] of [['fan', fan, 20], ['keyboard', keyboard, 3]]) {
    const n = make(RATE * 5, 0.03)
    const off = await run(page, n, false)
    const on = await run(page, n, true)
    assert.equal(on.applied, true, `${name}: RNNoise가 켜지지 않음`)
    const cut = db(rms(tail(off.pcm))) - db(rms(tail(on.pcm)))
    console.log(`${name} only: ${cut.toFixed(1)} dB reduction`)
    assert.ok(cut > min, `${name} 잡음 감소 부족`)
  }

  // 2. 말소리에 잡음이 섞였을 때: 음량만 줄이는 게이트는 통과하지 못한다
  const wav = process.argv[2]
  if (wav) {
    const raw = readFileSync(wav)
    const at = raw.indexOf('data') + 8
    const pcm = new Int16Array(raw.buffer.slice(raw.byteOffset + at, raw.byteOffset + at + ((raw.length - at) & ~1)))
    const speech = new Float32Array(RATE + pcm.length)
    const peak = pcm.reduce((m, x) => Math.max(m, Math.abs(x)), 1)
    pcm.forEach((x, i) => (speech[RATE + i] = (x / peak) * 0.3))
    const noise = fan(speech.length, 0.06)
    const mix = speech.map((x, i) => x + noise[i])
    const before = siSdr(speech, (await run(page, mix, false)).pcm)
    const after = siSdr(speech, (await run(page, mix, true)).pcm)
    console.log(`speech + loud fan: SI-SDR ${before.toFixed(1)} -> ${after.toFixed(1)} dB`)
    assert.ok(after > before + 3, '말소리 속 잡음이 줄지 않음')
  }

  // 3. 모델을 못 받으면(HTML 응답) 실패를 알리고 원래 소리를 내보내야 한다
  const broken = await browser.newPage()
  await broken.route(/\.wasm$/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' }))
  await open(broken)
  const n = fan(RATE * 2, 0.03)
  const bypass = await run(broken, n, true)
  assert.equal(bypass.applied, false, '모델 로드 실패를 알리지 않음')
  assert.ok(db(rms(bypass.pcm.subarray(RATE / 2, RATE))) > -50, '모델 로드 실패 시 소리가 끊김')
  console.log('broken model: reported and bypassed')
  console.log('OK')
} finally {
  await browser.close()
  await server.close()
}
