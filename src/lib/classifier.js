/**
 * 图片分类器
 * 预设 6 大类：风景、人物、建筑、动物、美食、抽象
 * 支持自定义分类（持久化到 localStorage）
 * 使用 Agnes API 智能识别，支持任意分类名
 */

import { classifyWithAgnes } from './apiClassifier.js';

// localStorage key
const CUSTOM_CATEGORIES_KEY = 'pmndrs-custom-categories'

// 预设分类
export const DEFAULT_CATEGORIES = [
  { id: 'landscape', name: '风景', color: '#2e7d32', icon: 'landscape' },
  { id: 'portrait', name: '人物', color: '#c62828', icon: 'portrait' },
  { id: 'architecture', name: '建筑', color: '#1565c0', icon: 'architecture' },
  { id: 'animal', name: '动物', color: '#e65100', icon: 'animal' },
  { id: 'food', name: '美食', color: '#6a1b9a', icon: 'food' },
  { id: 'abstract', name: '抽象', color: '#455a64', icon: 'abstract' },
]

// 从 localStorage 加载自定义分类
function loadCustomCategories() {
  try {
    const stored = localStorage.getItem(CUSTOM_CATEGORIES_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.warn('加载自定义分类失败:', e)
  }
  return []
}

// 保存自定义分类到 localStorage
function saveCustomCategories(categories) {
  try {
    localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(categories))
  } catch (e) {
    console.warn('保存自定义分类失败:', e)
  }
}

const CATEGORY_KEYWORDS = {
  landscape: ['绿', '蓝', '天空', '山', '水', '树', '自然', '风景', '户外', '地平线'],
  portrait: ['人', '脸', '人物', '肖像', '眼睛', '皮肤', '头发', '表情'],
  architecture: ['建筑', '楼', '房子', '窗', '门', '墙', '砖', '混凝土', '城市', '街道'],
  animal: ['动物', '猫', '狗', '鸟', '毛', '爪', '尾巴', '野生', '宠物'],
  food: ['食物', '吃', '菜', '饭', '面', '水果', '甜点', '餐厅', '厨房', '美味'],
  abstract: ['抽象', '几何', '纹理', '图案', '色块', '线条', '形状', '艺术'],
}

// 简单的颜色分析：从 canvas 获取主色调
async function analyzeColors(imageData) {
  const data = imageData.data
  let r = 0, g = 0, b = 0, count = 0
  const step = Math.max(1, Math.floor(data.length / 4 / 5000)) // 采样约 5000 像素

  for (let i = 0; i < data.length; i += step * 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
    count++
  }

  r = Math.round(r / count)
  g = Math.round(g / count)
  b = Math.round(b / count)

  // 计算亮度
  const brightness = (r * 299 + g * 587 + b * 114) / 1000

  // 简单的色相判断
  let dominant = 'neutral'
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const diff = max - min

  if (diff > 30) {
    if (max === r && r - g > 20) dominant = 'warm' // 红/橙/黄系
    else if (max === g && g - b > 20) dominant = 'green' // 绿系
    else if (max === b && b - r > 20) dominant = 'cool' // 蓝/紫系
  }

  return { r, g, b, brightness, dominant }
}

// 肤色检测：判断图片是否包含大量肤色像素
function detectSkinTone(imageData) {
  const data = imageData.data
  const width = imageData.width
  const height = imageData.height
  let skinPixels = 0
  let totalPixels = 0
  const step = 4 // 每 2 像素采样

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      
      // 肤色判断：RGB 色域法
      // 典型肤色范围：R > 95, G > 40, B > 20, R > G, R > B, |R-G| > 15
      // 以及 HSV 色相在 0-50 度之间
      const maxVal = Math.max(r, g, b)
      const minVal = Math.min(r, g, b)
      
      if (r > 95 && g > 40 && b > 20 && 
          maxVal - minVal > 15 &&
          r > g && r > b &&
          Math.abs(r - g) > 15) {
        skinPixels++
      }
      totalPixels++
    }
  }

  const skinRatio = totalPixels > 0 ? skinPixels / totalPixels : 0
  return skinRatio > 0.15 // 肤色像素超过 15% 判定为有人脸/人物
}

// 纹理复杂度：梯度幅值平均值
function analyzeTexture(imageData) {
  const data = imageData.data
  const width = imageData.width
  const height = imageData.height
  let gradSum = 0
  let count = 0
  const step = 4 // 每 2 像素采样

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = (y * width + x) * 4
      // 简化的灰度梯度
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3
      const grayRight = (data[i + 4] + data[i + 5] + data[i + 6]) / 3
      const grayDown = (data[(y + 1) * width * 4 + x * 4] + data[(y + 1) * width * 4 + x * 4 + 1] + data[(y + 1) * width * 4 + x * 4 + 2]) / 3
      gradSum += Math.abs(gray - grayRight) + Math.abs(gray - grayDown)
      count++
    }
  }

  return count > 0 ? gradSum / count : 0
}

function matchKeywords(text, keywords) {
  if (!text) return 0
  const lower = text.toLowerCase()
  return keywords.filter(k => lower.includes(k)).length
}

// MobileNet 标签到我们分类 ID 的映射
const MOBILENET_LABEL_MAP = {
  // 人物相关
  'person': 'portrait',
  'person, portrait': 'portrait',
  'business_person': 'portrait',
  'suit': 'portrait',
  'man': 'portrait',
  'woman': 'portrait',
  'boy': 'portrait',
  'girl': 'portrait',
  'child': 'portrait',
  'baby': 'portrait',
  'face': 'portrait',
  'head': 'portrait',
  'selfie': 'portrait',
  'portrait': 'portrait',
  'smile': 'portrait',
  'smiling': 'portrait',
  'cheek': 'portrait',
  'forehead': 'portrait',
  'chin': 'portrait',
  'eye': 'portrait',
  'nose': 'portrait',
  'mouth': 'portrait',
  'ear': 'portrait',
  'hair': 'portrait',
  'skin': 'portrait',
  'beard': 'portrait',
  'mustache': 'portrait',
  'glasses': 'portrait',
  'sunglasses': 'portrait',
  
  // 风景相关
  'landscape': 'landscape',
  'nature': 'landscape',
  'mountain': 'landscape',
  'beach': 'landscape',
  'sunset': 'landscape',
  'sunrise': 'landscape',
  'horizon': 'landscape',
  'valley': 'landscape',
  'canyon': 'landscape',
  'waterfall': 'landscape',
  'lake': 'landscape',
  'river': 'landscape',
  'ocean': 'landscape',
  'sea': 'landscape',
  'sky': 'landscape',
  'cloud': 'landscape',
  'tree': 'landscape',
  'forest': 'landscape',
  'field': 'landscape',
  'meadow': 'landscape',
  'park': 'landscape',
  'garden': 'landscape',
  'plant': 'landscape',
  'flower': 'landscape',
  'grass': 'landscape',
  'leaf': 'landscape',
  'wood': 'landscape',
  'outdoor': 'landscape',
  'scenery': 'landscape',
  'view': 'landscape',
  
  // 建筑相关
  'building': 'architecture',
  'building, edifice': 'architecture',
  'house': 'architecture',
  'home': 'architecture',
  'skyscraper': 'architecture',
  'tower': 'architecture',
  'bridge': 'architecture',
  'bridge, span': 'architecture',
  'church': 'architecture',
  'cathedral': 'architecture',
  'temple': 'architecture',
  'mosque': 'architecture',
  'castle': 'architecture',
  'palace': 'architecture',
  'monument': 'architecture',
  'stadium': 'architecture',
  'bridge, span': 'architecture',
  'viaduct': 'architecture',
  'dam': 'architecture',
  'tower': 'architecture',
  'lighthouse': 'architecture',
  'windmill': 'architecture',
  'window': 'architecture',
  'door': 'architecture',
  'wall': 'architecture',
  'roof': 'architecture',
  'floor': 'architecture',
  'ceiling': 'architecture',
  'staircase': 'architecture',
  'column': 'architecture',
  'arch': 'architecture',
  'facade': 'architecture',
  'brick': 'architecture',
  'concrete': 'architecture',
  'city': 'architecture',
  'street': 'architecture',
  'urban': 'architecture',
  'downtown': 'architecture',
  'skyline': 'architecture',
  
  // 动物相关
  'animal': 'animal',
  'dog': 'animal',
  'cat': 'animal',
  'bird': 'animal',
  'horse': 'animal',
  'horse, equus caballus': 'animal',
  'cow': 'animal',
  'sheep': 'animal',
  'cattle': 'animal',
  'lion': 'animal',
  'tiger': 'animal',
  'bear': 'animal',
  'elephant': 'animal',
  'giraffe': 'animal',
  'zebra': 'animal',
  'fish': 'animal',
  'shark': 'animal',
  'whale': 'animal',
  'dolphin': 'animal',
  'pet': 'animal',
  'puppy': 'animal',
  'kitten': 'animal',
  'wildlife': 'animal',
  'mammal': 'animal',
  'reptile': 'animal',
  'amphibian': 'animal',
  'insect': 'animal',
  'butterfly': 'animal',
  'spider': 'animal',
  'snake': 'animal',
  'frog': 'animal',
  'turtle': 'animal',
  'lizard': 'animal',
  
  // 食物相关
  'food': 'food',
  'dish': 'food',
  'meal': 'food',
  'pizza': 'food',
  'hamburger': 'food',
  'sandwich': 'food',
  'salad': 'food',
  'fruit': 'food',
  'vegetable': 'food',
  'dessert': 'food',
  'cake': 'food',
  'ice_cream': 'food',
  'bread': 'food',
  'meat': 'food',
  'seafood': 'food',
  'sushi': 'food',
  'noodle': 'food',
  'rice': 'food',
  'cooking': 'food',
  'kitchen': 'food',
  'restaurant': 'food',
  'cuisine': 'food',
  'delicious': 'food',
  'tasty': 'food',
  'breakfast': 'food',
  'lunch': 'food',
  'dinner': 'food',
  'snack': 'food',
  'drink': 'food',
  'beverage': 'food',
  'coffee': 'food',
  'tea': 'food',
  'wine': 'food',
  'beer': 'food',
  
  // 抽象/其他
  'abstract': 'abstract',
  'pattern': 'abstract',
  'texture': 'abstract',
  'geometric': 'abstract',
  'art': 'abstract',
  'painting': 'abstract',
  'drawing': 'abstract',
  'sculpture': 'abstract',
  'art': 'abstract',
  'design': 'abstract',
  'graphic': 'abstract',
  'illustration': 'abstract',
  'sketch': 'abstract',
  'cartoon': 'abstract',
  'anime': 'abstract',
  'digital': 'abstract',
  'computer': 'abstract',
  'technology': 'abstract',
  'science': 'abstract',
}

// MobileNet 标签到我们分类 ID 的映射函数
function mapMobileNetLabelToCategory(label) {
  const normalizedLabel = label.toLowerCase().trim()
  // 精确匹配
  if (MOBILENET_LABEL_MAP[normalizedLabel]) {
    return MOBILENET_LABEL_MAP[normalizedLabel]
  }
  // 部分匹配（包含关系）
  for (const [key, value] of Object.entries(MOBILENET_LABEL_MAP)) {
    if (normalizedLabel.includes(key) || key.includes(normalizedLabel)) {
      return value
    }
  }
  return null
}

export class ImageClassifier {
  constructor() {
    // 从 localStorage 加载自定义分类
    this.customCategories = loadCustomCategories()
  }

  addCustomCategory(category) {
    const newCategory = {
      ...category,
      id: category.id || `custom-${Date.now()}`,
      isCustom: true, // 标记为自定义分类
      keywords: category.keywords || [], // 支持关键词
    }
    this.customCategories.push(newCategory)
    saveCustomCategories(this.customCategories)
  }

  removeCustomCategory(id) {
    this.customCategories = this.customCategories.filter(c => c.id !== id)
    saveCustomCategories(this.customCategories)
  }

  updateCustomCategory(id, updates) {
    const idx = this.customCategories.findIndex(c => c.id === id)
    if (idx !== -1) {
      this.customCategories[idx] = { ...this.customCategories[idx], ...updates }
      saveCustomCategories(this.customCategories)
    }
  }

  getAllCategories() {
    return [...DEFAULT_CATEGORIES, ...this.customCategories]
  }

  /**
   * 对图片进行分类
   * @param {HTMLImageElement|HTMLCanvasElement|ImageData} source
   * @returns {Promise<{categoryId: string, confidence: number, allScores: Array, source: string}>}
   */
  async classify(source) {
    // 优先使用 Agnes API（智能识别，支持任意分类）
    try {
      console.log('[Classifier] 调用 Agnes API 智能分类...')
      const allCategories = this.getAllCategories()
      const agnesResult = await classifyWithAgnes(source, allCategories)
      
      console.log(`[Classifier] Agnes 分类成功: ${agnesResult.categoryId} (${agnesResult.confidence.toFixed(2)})`)
      return {
        ...agnesResult,
        source: 'agnes'
      }
    } catch (error) {
      console.warn('[Classifier] Agnes API 分类失败，回退启发式规则:', error)
    }

    // 回退启发式规则分类
    return this.classifyHeuristic(source)
  }

  // 启发式规则分类（原有逻辑）
  async classifyHeuristic(source) {
    let imageData

    if (source instanceof HTMLImageElement) {
      const canvas = document.createElement('canvas')
      canvas.width = source.naturalWidth || source.width
      canvas.height = source.naturalHeight || source.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(source, 0, 0)
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    } else if (source instanceof HTMLCanvasElement) {
      const ctx = source.getContext('2d')
      imageData = ctx.getImageData(0, 0, source.width, source.height)
    } else if (source.data) {
      imageData = source
    } else {
      throw new Error('不支持的输入类型')
    }

    // 降采样以提速
    const maxDim = 256
    let { width, height, data } = imageData
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(width * scale)
      canvas.height = Math.round(height * scale)
      const ctx = canvas.getContext('2d')
      // 将原始 imageData 绘制到临时 canvas 再缩放
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = width
      tempCanvas.height = height
      tempCanvas.getContext('2d').putImageData(imageData, 0, 0)
      ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height)
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    }

    const colors = await analyzeColors(imageData)
    const texture = analyzeTexture(imageData)
    const hasSkinTone = detectSkinTone(imageData)

    // 计算各分类得分
    const allCategories = this.getAllCategories()
    const scores = allCategories.map(cat => {
      let score = 0

      // 基于颜色特征
      if (cat.id === 'landscape') {
        if (colors.dominant === 'green') score += 0.4
        if (colors.dominant === 'cool') score += 0.2
        if (colors.brightness > 120) score += 0.1
      } else if (cat.id === 'portrait') {
        if (colors.dominant === 'warm') score += 0.3
        if (colors.brightness > 100 && colors.brightness < 200) score += 0.2
        // 肤色检测加分
        if (hasSkinTone) score += 0.5
      } else if (cat.id === 'architecture') {
        if (colors.dominant === 'neutral') score += 0.3
        if (texture > 15) score += 0.2 // 边缘多
      } else if (cat.id === 'animal') {
        if (texture > 20) score += 0.3 // 毛发纹理
        if (colors.dominant === 'warm') score += 0.1
      } else if (cat.id === 'food') {
        if (colors.dominant === 'warm') score += 0.3
        if (colors.brightness > 130) score += 0.2
      } else if (cat.id === 'abstract') {
        if (texture > 25) score += 0.3
        if (colors.brightness < 100 || colors.brightness > 200) score += 0.2
      }

      // 自定义分类：关键词匹配
      if (cat.id.startsWith('custom-') && cat.keywords && cat.keywords.length > 0) {
        // 这里可以结合文件名、EXIF 等信息，暂时给基础分
        // 后续可扩展：结合 CLIP 或用户反馈
        score = 0.4
      } else if (cat.id.startsWith('custom-')) {
        score = 0.3
      }

      // 基础分防止全零
      score += 0.05

      return { categoryId: cat.id, name: cat.name, score }
    })

    // 归一化
    const total = scores.reduce((sum, s) => sum + s.score, 0)
    const normalized = scores.map(s => ({ ...s, score: s.score / total }))

    // 排序
    normalized.sort((a, b) => b.score - a.score)

    return {
      categoryId: normalized[0].categoryId,
      confidence: normalized[0].score,
      allScores: normalized,
      source: 'heuristic'
    }
  }
}

// 单例
export const classifier = new ImageClassifier()