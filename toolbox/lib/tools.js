'use strict';
// 工具注册表：前端首页、搜索、路由全部由它驱动。
// server:true 表示需要服务端处理（ffmpeg / LibreOffice），默认要求登录。
const CATEGORIES = [
  { id: 'office', name: '办公创作', desc: 'PPT、Word、Markdown、表格', icon: 'briefcase', hue: 255 },
  { id: 'pdf',    name: 'PDF 工具', desc: '合并、拆分、压缩、签名', icon: 'file-text', hue: 8 },
  { id: 'scan',   name: '扫描识别', desc: '文档扫描、OCR、二维码', icon: 'scan-line', hue: 160 },
  { id: 'media',  name: '音视频', desc: '格式转换、播放、录制', icon: 'clapperboard', hue: 320 },
  { id: 'image',  name: '图片工具', desc: '压缩、裁剪、水印、拼图', icon: 'image', hue: 35 },
  { id: 'life',   name: '生活实用', desc: '计算器、房贷、日期、倒计时', icon: 'calculator', hue: 200 },
  { id: 'text',   name: '文本处理', desc: '字数统计、对比、简繁转换', icon: 'type', hue: 280 },
  { id: 'dev',    name: '开发工具', desc: 'JSON、编码、哈希、正则', icon: 'terminal', hue: 220 },
];

const T = (id, cat, name, desc, icon, tags = '', extra = {}) => ({ id, cat, name, desc, icon, tags, ...extra });

const TOOLS = [
  // ── 办公创作
  T('ppt-maker', 'office', '在线 PPT 制作', '拖拽式幻灯片编辑器，多种主题，一键导出 .pptx', 'presentation', 'powerpoint 演示文稿 幻灯片 slides', { hot: true }),
  T('word-editor', 'office', '在线 Word 编辑', '富文本文档编辑，导出 .docx / PDF / HTML', 'file-pen-line', 'word 文档 docx 写作 编辑器', { hot: true }),
  T('md-editor', 'office', 'Markdown 编辑器', '实时预览，导出 HTML / Word / PDF', 'notebook-pen', 'markdown md 笔记 文档'),
  T('sheet-convert', 'office', '表格格式转换', 'Excel / CSV / JSON / HTML 互转，在线预览', 'table', 'excel xlsx csv json 表格'),
  T('office-convert', 'office', 'Office 文档转换', 'Word / Excel / PPT 互转与导出，支持 WPS 文件', 'file-cog', 'word excel ppt doc xls 转换 wps', { server: 'office' }),
  T('pdf-to-word', 'office', 'PDF 转 Word', '把 PDF 还原为可编辑的 Word 文档', 'file-type', 'pdf word docx 转换', { server: 'office', mod: 'office-convert' }),
  T('word-to-pdf', 'office', 'Word 转 PDF', 'doc / docx / wps 一键转 PDF，版式保真', 'file-output', 'word pdf docx doc', { server: 'office', mod: 'office-convert' }),
  T('ppt-to-pdf', 'office', 'PPT 转 PDF', 'ppt / pptx 转 PDF，便于分享与打印', 'presentation', 'ppt powerpoint pdf pptx', { server: 'office', mod: 'office-convert' }),
  T('excel-to-pdf', 'office', 'Excel 转 PDF', 'xls / xlsx / csv 转 PDF', 'sheet', 'excel pdf xlsx 表格', { server: 'office', mod: 'office-convert' }),

  // ── PDF
  T('pdf-merge', 'pdf', 'PDF 合并', '多个 PDF 按顺序合并为一个，可拖拽排序', 'merge', 'pdf 合并 拼接', { hot: true }),
  T('pdf-split', 'pdf', 'PDF 拆分 / 提取', '按页码范围提取，或每页拆成单独文件', 'split', 'pdf 拆分 提取 分割'),
  T('pdf-organize', 'pdf', 'PDF 页面管理', '缩略图预览，拖拽排序、旋转、删除页面', 'layout-grid', 'pdf 排序 旋转 删除页 整理'),
  T('pdf-to-image', 'pdf', 'PDF 转图片', '每页导出为 PNG / JPG，打包下载', 'file-image', 'pdf 图片 png jpg 转换'),
  T('image-to-pdf', 'pdf', '图片转 PDF', '多张图片合成一个 PDF，可调页面大小与边距', 'images', '图片 pdf jpg png 合成'),
  T('pdf-compress', 'pdf', 'PDF 压缩', '重新采样页面，显著减小体积', 'file-archive', 'pdf 压缩 缩小 体积'),
  T('pdf-watermark', 'pdf', 'PDF 加水印', '文字水印，支持中文、旋转、透明度、平铺', 'droplets', 'pdf 水印 watermark'),
  T('pdf-pagenum', 'pdf', 'PDF 添加页码', '自定义位置、格式与起始页', 'list-ordered', 'pdf 页码 页眉'),
  T('pdf-sign', 'pdf', 'PDF 签名 / 批注', '手写签名、插入文字与图片到 PDF 页面', 'signature', 'pdf 签名 签字 批注 填写', { hot: true }),
  T('pdf-text', 'pdf', 'PDF 提取文字', '提取 PDF 中的文本内容，一键复制或下载', 'text-select', 'pdf 文字 提取 文本'),

  // ── 扫描识别
  T('doc-scanner', 'scan', '全能扫描', '拍照 / 上传，自动识别边缘、矫正、增强，导出 PDF', 'scan-line', '扫描 扫描王 文档 矫正 裁剪 增强', { hot: true }),
  T('ocr', 'scan', '图片文字识别', '中英文 OCR，本地识别，图片不上传', 'scan-text', 'ocr 文字识别 提取文字 图片转文字', { hot: true }),
  T('qr-gen', 'scan', '二维码生成', '文本 / 链接 / WiFi 生成二维码，自定义颜色', 'qr-code', '二维码 qr 生成'),
  T('qr-scan', 'scan', '二维码识别', '上传图片或打开摄像头识别二维码', 'scan-qr-code', '二维码 qr 扫描 识别'),

  // ── 音视频
  T('video-convert', 'media', '视频格式转换', 'MP4 / MKV / MOV / WebM / AVI 等互转', 'film', '视频 转换 mp4 mkv avi mov webm flv wmv', { server: 'media', hot: true }),
  T('video-compress', 'media', '视频压缩', '智能降低码率与分辨率，支持 H.265', 'minimize-2', '视频 压缩 缩小 体积', { server: 'media' }),
  T('video-gif', 'media', '视频转 GIF', '截取片段生成高质量 GIF 动图', 'image-play', '视频 gif 动图', { server: 'media' }),
  T('video-audio', 'media', '视频提取音频', '提取视频中的声音为 MP3 / WAV / FLAC 等', 'audio-lines', '视频 音频 提取 mp3', { server: 'media' }),
  T('audio-convert', 'media', '音频格式转换', 'MP3 / WAV / FLAC / AAC / OGG / M4A 互转', 'file-audio', '音频 转换 mp3 wav flac aac ogg m4a', { server: 'media' }),
  T('media-trim', 'media', '音视频剪切', '按起止时间裁剪音频或视频片段', 'scissors', '剪切 裁剪 截取 音频 视频', { server: 'media' }),
  T('audio-player', 'media', '音频播放器', '本地音乐播放，频谱可视化、均衡器、LRC 歌词', 'music-4', '音乐 播放器 mp3 歌词 频谱', { hot: true }),
  T('video-player', 'media', '视频播放器', '本地视频播放，倍速、画中画、截图', 'circle-play', '视频 播放器 倍速'),
  T('recorder', 'media', '在线录音机', '麦克风录音，实时波形，导出 WebM / WAV', 'mic', '录音 麦克风'),
  T('screen-recorder', 'media', '屏幕录制', '录制屏幕 / 窗口 / 标签页，可带麦克风声音', 'monitor-play', '录屏 屏幕录制'),

  // ── 图片
  T('img-compress', 'image', '图片压缩', '批量压缩 JPG / PNG / WebP，实时对比大小', 'file-down', '图片 压缩 缩小 体积'),
  T('img-convert', 'image', '图片格式转换', 'PNG / JPG / WebP / BMP 互转，批量处理', 'refresh-cw', '图片 格式 转换 png jpg webp'),
  T('img-resize', 'image', '图片尺寸调整', '按像素或百分比缩放，批量处理', 'scaling', '图片 缩放 尺寸 大小'),
  T('img-crop', 'image', '图片裁剪 / 旋转', '自由裁剪、固定比例、旋转与翻转', 'crop', '图片 裁剪 旋转 翻转 剪裁'),
  T('img-watermark', 'image', '图片加水印', '文字水印，平铺或单个，批量添加', 'stamp', '图片 水印'),
  T('img-stitch', 'image', '长图拼接', '多张图片纵向 / 横向拼成长图', 'gallery-vertical', '拼图 长图 拼接 截图'),
  T('img-base64', 'image', '图片 Base64', '图片与 Base64 / Data URI 互转', 'binary', '图片 base64 datauri'),
  T('color-tool', 'image', '取色与颜色转换', '从图片取色，HEX / RGB / HSL 互转，生成色板', 'pipette', '颜色 取色 吸管 hex rgb hsl'),

  // ── 生活
  T('calculator', 'life', '科学计算器', '四则运算、函数、历史记录，支持键盘', 'calculator', '计算器 科学计算'),
  T('unit-convert', 'life', '单位换算', '长度、重量、面积、体积、温度、速度、数据量', 'ruler', '单位 换算 长度 重量 温度'),
  T('loan-calc', 'life', '房贷计算器', '等额本息 / 等额本金，还款明细与利息', 'house', '房贷 贷款 利息 公积金 还款'),
  T('tax-calc', 'life', '个税计算器', '按累计预扣法计算每月个税与到手工资', 'receipt', '个税 工资 税 年终奖 五险一金'),
  T('bmi-calc', 'life', 'BMI 与基础代谢', '体质指数、理想体重、每日热量参考', 'heart-pulse', 'bmi 体重 健康 代谢 热量'),
  T('date-calc', 'life', '日期计算', '日期间隔、日期加减、年龄、星期与星座', 'calendar-days', '日期 天数 年龄 星期 间隔'),
  T('countdown', 'life', '倒计时 / 秒表', '目标日倒计时、计时器与秒表', 'timer', '倒计时 秒表 计时器'),
  T('pomodoro', 'life', '番茄钟', '专注 25 分钟，休息 5 分钟，统计专注次数', 'alarm-clock', '番茄钟 专注 学习 工作'),
  T('rmb-upper', 'life', '金额大写转换', '数字金额转人民币大写，财务报销必备', 'banknote', '金额 大写 人民币 财务 发票'),
  T('percent-calc', 'life', '百分比 / 折扣计算', '折扣、涨跌幅、占比、增长率', 'percent', '百分比 折扣 打折 涨幅'),
  T('random-pick', 'life', '随机抽取', '随机数、抽签、转盘、掷骰子', 'dices', '随机 抽签 转盘 骰子 点名'),
  T('password-gen', 'life', '密码生成器', '生成高强度随机密码，评估强度', 'key-round', '密码 生成 随机 安全'),
  T('todo', 'life', '待办清单', '简洁待办，数据保存在浏览器中', 'list-checks', '待办 清单 任务 todo'),
  T('notepad', 'life', '在线便签', '自动保存的随手记，支持多条便签', 'sticky-note', '便签 记事本 笔记'),
  T('world-clock', 'life', '世界时钟', '全球主要城市当前时间与时差', 'globe', '世界时间 时区 时差'),

  // ── 文本
  T('word-count', 'text', '字数统计', '字数、字符、行数、段落与阅读时长', 'text-cursor-input', '字数 统计 字符'),
  T('case-convert', 'text', '大小写转换', '大写、小写、首字母大写、驼峰、下划线等', 'case-sensitive', '大小写 驼峰 下划线 命名'),
  T('text-diff', 'text', '文本对比', '逐行 / 逐字对比差异，高亮显示', 'git-compare', '文本 对比 差异 diff'),
  T('text-tidy', 'text', '文本整理', '去重、排序、去空行、添加行号、查找替换', 'list-filter', '去重 排序 去空行 整理'),
  T('zh-convert', 'text', '简繁转换', '简体、繁体（台湾 / 香港）互转', 'languages', '简体 繁体 转换'),
  T('pinyin', 'text', '汉字转拼音', '带声调 / 无声调 / 首字母，批量转换', 'a-large-small', '拼音 汉字 声调'),

  // ── 开发
  T('json-tool', 'dev', 'JSON 工具', '格式化、压缩、校验、转义、树形查看', 'braces', 'json 格式化 校验 压缩'),
  T('base64', 'dev', 'Base64 编解码', '文本 Base64 编码与解码，支持 UTF-8', 'binary', 'base64 编码 解码'),
  T('url-codec', 'dev', 'URL 编解码', 'URL 编码、解码与参数解析', 'link', 'url 编码 解码 参数'),
  T('hash-tool', 'dev', '哈希计算', 'MD5 / SHA-1 / SHA-256 / SHA-512，支持文件', 'fingerprint', 'md5 sha1 sha256 哈希 校验 hash'),
  T('timestamp', 'dev', '时间戳转换', 'Unix 时间戳与日期时间互转', 'clock', '时间戳 unix 日期'),
  T('uuid-gen', 'dev', 'UUID 生成', '批量生成 UUID v4，可去横线、转大写', 'hash', 'uuid guid 随机'),
  T('base-convert', 'dev', '进制转换', '二 / 八 / 十 / 十六进制及任意进制互转', 'binary', '进制 二进制 十六进制'),
  T('jwt-decode', 'dev', 'JWT 解析', '解码 JWT 的 Header 与 Payload，查看过期时间', 'badge-check', 'jwt token 解析'),
  T('regex-test', 'dev', '正则测试', '实时匹配高亮，捕获组，常用正则速查', 'regex', '正则 regex 表达式 匹配'),
];

// 同一前端模块承载多个工具的映射（public/js/tools/<module>.js）
const GROUPS = {
  'pdf-basic': ['pdf-merge', 'pdf-split', 'pdf-organize', 'pdf-text'],
  'pdf-convert': ['pdf-to-image', 'image-to-pdf', 'pdf-compress'],
  'pdf-edit': ['pdf-watermark', 'pdf-pagenum', 'pdf-sign'],
  qr: ['qr-gen', 'qr-scan'],
  'media-server': ['video-convert', 'video-compress', 'video-gif', 'video-audio', 'audio-convert', 'media-trim'],
  recorders: ['recorder', 'screen-recorder'],
  'image-batch': ['img-compress', 'img-convert', 'img-resize', 'img-watermark'],
  'image-misc': ['img-crop', 'img-stitch', 'img-base64', 'color-tool'],
  'life-calc': ['calculator', 'unit-convert', 'loan-calc', 'tax-calc', 'bmi-calc', 'percent-calc', 'rmb-upper'],
  'life-time': ['date-calc', 'countdown', 'pomodoro', 'world-clock'],
  'life-misc': ['random-pick', 'password-gen', 'todo', 'notepad'],
  'text-tools': ['word-count', 'case-convert', 'text-diff', 'text-tidy', 'zh-convert', 'pinyin'],
  'dev-tools': ['json-tool', 'base64', 'url-codec', 'hash-tool', 'timestamp', 'uuid-gen', 'base-convert', 'jwt-decode', 'regex-test'],
};
for (const [mod, ids] of Object.entries(GROUPS)) for (const id of ids) {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) throw new Error('GROUPS 引用了不存在的工具：' + id);
  t.mod = mod;
}

module.exports = { CATEGORIES, TOOLS };
