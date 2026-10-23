import { hashBlob } from './file-hash';

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const digest = await hashBlob(event.data, ratio => self.postMessage({ ratio }));
    self.postMessage({ digest });
  } catch { self.postMessage({ error: '读取视频失败，请保留文件并重试。' }); }
};
