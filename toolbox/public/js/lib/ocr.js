// Tesseract.js OCR：语言包与内核全部由本站提供，无需外网
import { loadScript } from '../ui.js';
let worker = null, workerLang = '', onProg = null;

export async function recognize(source, { lang = 'chi_sim+eng', onProgress } = {}) {
  await loadScript('/vendor/tesseract/tesseract.min.js');
  onProg = onProgress;
  if (!worker || workerLang !== lang) {
    if (worker) { await worker.terminate().catch(() => {}); worker = null; }
    onProg?.(0, '正在加载识别引擎…');
    worker = await window.Tesseract.createWorker(lang, 1, {
      workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract-core/', langPath: '/vendor/tessdata/', gzip: true,
      logger: (m) => { if (m.status === 'recognizing text') onProg?.(m.progress, '正在识别…'); else if (/loading|initializ/.test(m.status)) onProg?.(0, '正在加载语言包…'); },
    });
    workerLang = lang;
  }
  const { data } = await worker.recognize(source);
  return { text: data.text, confidence: data.confidence, words: data.words };
}
export async function disposeOcr() { if (worker) { await worker.terminate().catch(() => {}); worker = null; } }

/** 中文识别结果里汉字之间会夹杂多余空格，这里做清理 */
export function tidyText(t) {
  return t.replace(/([\u4e00-\u9fff，。！？；：、）】》”’])[ \t]+(?=[\u4e00-\u9fff，。！？；：、（【《“‘])/g, '$1').replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, '$1').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
