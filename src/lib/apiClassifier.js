/**
 * Agnes API 智能分类器
 * 使用 Agnes 视觉模型进行零样本图片分类
 * 兼容 OpenAI Vision API 格式
 */

// Agnes API 配置（Key 由 Worker 代理注入，前端不存）
const AGNES_CONFIG = {
  baseURL: 'https://agnes-proxy.1987156333.workers.dev',
  model: 'agnes-3.0-flash',
  timeout: 30000
}

/**
 * 将图片转为 Base64 Data URL
 */
async function imageToBase64(source) {
  let canvas, ctx;

  if (source instanceof HTMLImageElement) {
    canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);
  } else if (source instanceof HTMLCanvasElement) {
    canvas = source;
  } else if (source.data) {
    // ImageData
    canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(source.data, source.width, source.height), 0, 0);
  } else {
    throw new Error('不支持的输入类型');
  }

  // 压缩大图（最大 1024px）
  const maxDim = 1024;
  if (canvas.width > maxDim || canvas.height > maxDim) {
    const scale = maxDim / Math.max(canvas.width, canvas.height);
    const newCanvas = document.createElement('canvas');
    newCanvas.width = Math.round(canvas.width * scale);
    newCanvas.height = Math.round(canvas.height * scale);
    const newCtx = newCanvas.getContext('2d');
    newCtx.drawImage(canvas, 0, 0, newCanvas.width, newCanvas.height);
    canvas = newCanvas;
  }

  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * 构建分类提示词
 */
function buildClassificationPrompt(categories) {
  const categoryNames = categories.map(c => c.name).join('、');
  return `请分析这张图片，从以下分类中选择最匹配的一个：${categoryNames}。只需返回分类名称，不要其他解释。`;
}

/**
 * 调用 Agnes API 进行分类
 * @param {HTMLImageElement|HTMLCanvasElement|ImageData} source - 图片源
 * @param {Array} categories - 分类列表 [{id, name}, ...]
 * @returns {Promise<{categoryId: string, confidence: number, allScores: Array, source: string}>}
 */
async function classifyWithAgnes(source, categories) {
  try {
    console.log('[Agnes] 正在准备图片...');
    const base64Image = await imageToBase64(source);

    console.log('[Agnes] 正在调用 API...');
    const prompt = buildClassificationPrompt(categories);

    const response = await fetch(`${AGNES_CONFIG.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 注意：不再需要前端传 Authorization，Worker 会注入
      },
      body: JSON.stringify({
        model: AGNES_CONFIG.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: base64Image } }
            ]
          }
        ],
        max_tokens: 50,
        temperature: 0
      }),
      signal: AbortSignal.timeout(AGNES_CONFIG.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Agnes API 错误: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content?.trim() || '';
    console.log('[Agnes] API 返回:', resultText);

    const matchedCategory = categories.find(c => resultText.includes(c.name));
    if (!matchedCategory) {
      console.warn('[Agnes] 无法匹配分类，使用第一个:', resultText);
      return {
        categoryId: categories[0].id,
        confidence: 0.5,
        allScores: [],
        source: 'agnes'
      };
    }

    return {
      categoryId: matchedCategory.id,
      confidence: 0.9,
      allScores: [],
      source: 'agnes'
    };
  } catch (error) {
    console.warn('[Agnes] 分类失败:', error);
    throw error;
  }
}

/**
 * 检查 Agnes API 连通性
 */
export async function checkAgnesConnection() {
  try {
    const response = await fetch(`${AGNES_CONFIG.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AGNES_CONFIG.model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(10000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export { classifyWithAgnes };