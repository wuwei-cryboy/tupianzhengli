/**
 * CLIP 零样本分类器
 * 使用 transformers.js + Xenova/clip-vit-base-patch32
 * 支持任意文本标签的开放词汇分类
 */

import { pipeline, env } from '@xenova/transformers';

// 允许本地模型缓存
env.allowLocalModels = false;
env.useBrowserCache = true;

// 单例状态
let clipPipeline = null;
let isLoading = false;
let loadPromise = null;

/**
 * 获取或创建 CLIP pipeline（单例）
 */
async function getCLIPPipeline() {
  if (clipPipeline) return clipPipeline;
  if (isLoading) return loadPromise;

  isLoading = true;
  loadPromise = (async () => {
    try {
      console.log('[CLIP] 正在加载 CLIP 模型...');
      // 使用 feature-extraction pipeline，指定 CLIP 模型
      clipPipeline = await pipeline('feature-extraction', 'Xenova/clip-vit-base-patch32', {
        quantized: true, // 使用量化模型，体积更小
        progress_callback: (progress) => {
          if (progress.status === 'downloading') {
            console.log(`[CLIP] 下载进度: ${(progress.loaded / progress.total * 100).toFixed(1)}%`);
          }
        }
      });
      console.log('[CLIP] 模型加载完成');
      return clipPipeline;
    } catch (error) {
      console.error('[CLIP] 加载失败:', error);
      clipPipeline = null;
      throw error;
    } finally {
      isLoading = false;
    }
  })();

  return loadPromise;
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 文本提示词模板
 * 将分类名转为 CLIP 友好的提示词
 */
function buildPrompts(categories) {
  // categories: [{id, name}, ...]
  return categories.map(cat => ({
    categoryId: cat.id,
    categoryName: cat.name,
    prompt: `a photo of a ${cat.name}`  // 标准 CLIP 模板
  }));
}

/**
 * 使用 CLIP 进行零样本分类
 * @param {HTMLImageElement|HTMLCanvasElement|ImageData} source - 图片源
 * @param {Array} categories - 分类列表 [{id, name}, ...]
 * @param {number} topK - 返回前 K 个结果
 * @returns {Promise<{categoryId: string, confidence: number, allScores: Array, source: string}>}
 */
export async function classifyWithCLIP(source, categories, topK = 1) {
  const pipe = await getCLIPPipeline();
  
  // 1. 准备图片输入
  let imgElement;
  if (source instanceof HTMLImageElement) {
    imgElement = source;
  } else if (source instanceof HTMLCanvasElement) {
    // Canvas 转 Image
    imgElement = new Image();
    imgElement.src = source.toDataURL();
    await new Promise(r => { imgElement.onload = r; });
  } else if (source.data) {
    // ImageData -> Canvas -> Image
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(source.data, source.width, source.height), 0, 0);
    imgElement = new Image();
    imgElement.src = canvas.toDataURL();
    await new Promise(r => { imgElement.onload = r; });
  } else {
    throw new Error('不支持的输入类型');
  }

  // 2. 构建提示词
  const prompts = buildPrompts(categories);
  const promptTexts = prompts.map(p => p.prompt);

  // 3. 编码图片
  console.log('[CLIP] 正在编码图片...');
  const imageEmbedding = await pipe(imgElement, { pooling: 'mean', normalize: true });
  const imageVec = Array.from(imageEmbedding.data);

  // 4. 编码文本提示词（批量）
  console.log('[CLIP] 正在编码文本提示词...');
  const textEmbeddings = await pipe(promptTexts, { pooling: 'mean', normalize: true });
  // textEmbeddings 是 (num_prompts, dim) 的扁平数组
  const dim = textEmbeddings.dims[1];
  const textVecs = [];
  for (let i = 0; i < prompts.length; i++) {
    const start = i * dim;
    textVecs.push(Array.from(textEmbeddings.data.slice(start, start + dim)));
  }

  // 5. 计算相似度
  const scores = textVecs.map((textVec, i) => ({
    categoryId: prompts[i].categoryId,
    categoryName: prompts[i].categoryName,
    score: cosineSimilarity(imageVec, textVec)
  }));

  // 6. 排序
  scores.sort((a, b) => b.score - a.score);

  // 7. 归一化为概率分布（softmax with temperature）
  const temperature = 0.01; // CLIP 通常用较小 temperature
  const exps = scores.map(s => Math.exp(s.score / temperature));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  const normalized = scores.map((s, i) => ({
    ...s,
    score: exps[i] / sumExp
  }));
  normalized.sort((a, b) => b.score - a.score);

  return {
    categoryId: normalized[0].categoryId,
    confidence: normalized[0].score,
    allScores: normalized.slice(0, topK),
    source: 'clip'
  };
}

/**
 * 检查模型是否已加载
 */
export function isCLIPLoaded() {
  return clipPipeline !== null;
}

/**
 * 获取加载状态
 */
export function getCLIPLoadStatus() {
  if (clipPipeline) return 'loaded';
  if (isLoading) return 'loading';
  return 'not_loaded';
}

/**
 * 预加载模型（可在空闲时调用）
 */
export async function preloadCLIP() {
  return getCLIPPipeline();
}

export {
  getCLIPPipeline,
  classifyWithCLIP,
  isCLIPLoaded,
  getCLIPLoadStatus,
  preloadCLIP
};