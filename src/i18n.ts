// ─────────────────────────────────────────────────────────────
// i18n: English / Chinese translation map
// ─────────────────────────────────────────────────────────────

export type Locale = "en" | "zh";

export interface Translations {
  // ── Host page ──────────────────────────────────────────
  splitTheBill: string;
  uploadDesc: string;
  yourDuitNowQR: string;
  changeAccount: string;
  uploadQRScreenshot: string;
  savedDuitNowActive: string;
  snapReceipt: string;
  exifStripped: string;
  mergeWithExisting: string;
  pasteSessionId: string;
  useLastSession: string;
  resumeCurrentSession: string;

  // Loading
  aiCrunching: string;
  parsingReceipt: string;

  // Review
  reviewAndEdit: string;
  tapAnyItem: string;
  sectionNameLabel: string;
  sectionPlaceholder: string;
  items: string;
  itemName: string;
  save: string;
  cancel: string;
  totals: string;
  subtotal: string;
  sstTax: string;
  serviceCharge: string;
  grandTotal: string;
  confirmAndGenerate: string;
  finalizing: string;
  startOver: string;
  includeReceiptPreview: string;
  includeReceiptPreviewDesc: string;

  // Success
  readyToSplit: string;
  shareLinkDesc: string;
  shareLink: string;
  copyShareLink: string;
  copied: string;
  sessionIdForMerging: string;
  copyId: string;
  sessionIdNote: string;
  uploadAnother: string;

  // Error
  couldntParse: string;
  tryAnotherPhoto: string;

  // Settings
  sessionControls: string;
  clearAllSessions: string;
  clearAllDesc: string;
  uploadQrFirst: string;

  // QR errors
  qrInvalidFormat: string;
  qrParseFailed: string;
  qrNoCode: string;

  // Host Dashboard
  liveDashboard: string;
  settlementProgress: string;
  claimedOf: string;
  unclaimedItems: string;
  guestList: string;
  wipeSession: string;
  wipeConfirm: string;
  wiping: string;
  sessionWiped: string;
  noActivity: string;
  refreshing: string;
  fullyClaimedBadge: string;
  unclaimed: string;

  // ── Guest page ─────────────────────────────────────────
  selectWhatYouAte: string;
  taxesAutoCalculated: string;
  billSummary: string;
  sst6: string;
  serviceCharge10: string;
  selectYourItems: string;
  available: string;
  claimed: string;
  yourTotal: string;
  pay: string;
  viewAllPendingBills: string;

  // Guest name entry
  whatsYourName: string;
  enterYourName: string;
  namePlaceholder: string;
  joinBill: string;
  nameRequired: string;

  // Split/Fractional
  splitWithOthers: string;
  peopleSharingPrefix: string;
  eachSuffix: string;
  splitCapped: string;

  // Receipt preview
  viewReceipt: string;
  receiptDisclaimer: string;
  noReceiptImage: string;

  // Modal
  scanToPay: string;
  bankSecurityNote: string;
  yourShareBreakdown: string;
  totalToPay: string;
  openBankingApp: string;
  saveQrToGallery: string;
  copyClaimSummary: string;
  copiedToClipboard: string;

  general: string;
  of: string;

  // Session expired (server page)
  sessionExpired: string;
  sessionExpiredDesc: string;
  invalidSessionData: string;
  invalidSessionDataDesc: string;
  viewLink: string;
  markAsPaidConfirm: string;
}

const en: Translations = {
  splitTheBill: "Split the Bill",
  uploadDesc: "Upload your QR and snap your receipt. AI will crunch it natively and safely.",
  yourDuitNowQR: "Your Personal DuitNow QR",
  changeAccount: "Change Account",
  uploadQRScreenshot: "Upload QR Screenshot",
  savedDuitNowActive: "✓ Saved DuitNow Account Active",
  snapReceipt: "Snap Receipt",
  exifStripped: "EXIF data will be stripped automatically",
  mergeWithExisting: "Merge with existing bill (Optional)",
  pasteSessionId: "Paste existing Session ID here",
  useLastSession: "Use Last Session",
  resumeCurrentSession: "Resume Current Session",

  aiCrunching: "AI is crunching the numbers...",
  parsingReceipt: "Parsing receipt, validating math, generating draft.",

  reviewAndEdit: "Review & Edit",
  tapAnyItem: "Tap any item to edit its name or price before sharing.",
  sectionNameLabel: "Section Name (Trip Mode)",
  sectionPlaceholder: 'e.g., "Dinner at Guangzhou", "Day 2 Coffee"',
  items: "Items",
  itemName: "Item name",
  save: "Save",
  cancel: "Cancel",
  totals: "Totals",
  subtotal: "Subtotal",
  sstTax: "SST (Tax)",
  serviceCharge: "Service Charge",
  grandTotal: "Grand Total",
  confirmAndGenerate: "Confirm & Generate Link",
  finalizing: "Finalizing...",
  startOver: "← Start Over",
  includeReceiptPreview: "Include receipt preview for guests",
  includeReceiptPreviewDesc: "Allows guests to view a sanitized copy of the receipt. May include printed details like names or addresses.",

  readyToSplit: "Ready to Split!",
  shareLinkDesc: "Share this link with your group. They can claim their items and pay via DuitNow.",
  shareLink: "Share Link",
  copyShareLink: "Copy Share Link",
  copied: "Copied!",
  sessionIdForMerging: "Session ID (for Merging)",
  copyId: "Copy ID",
  sessionIdNote: "Use this ID if you want to add another receipt to this bill later.",
  uploadAnother: "Upload another receipt",

  couldntParse: "Couldn't parse receipt",
  tryAnotherPhoto: "Try Another Photo",

  sessionControls: "Session Controls",
  clearAllSessions: "Clear All Sessions",
  clearAllDesc: "Removes saved QR, session history, and pending bills. Use this to start fresh.",
  uploadQrFirst: "Please upload your DuitNow QR screenshot first.",

  qrInvalidFormat: "Invalid format. Please ensure you upload a valid DuitNow or TNG eWallet QR.",
  qrParseFailed: "Failed to read QR code from the image. Please try a clearer screenshot.",
  qrNoCode: "No QR code found in the image.",

  liveDashboard: "Live Dashboard",
  settlementProgress: "Settlement Progress",
  claimedOf: "claimed",
  unclaimedItems: "Unclaimed Items",
  guestList: "Guest List",
  wipeSession: "Wipe Session",
  wipeConfirm: "This will permanently delete all session data from the server. This cannot be undone.",
  wiping: "Wiping...",
  sessionWiped: "Session wiped successfully.",
  noActivity: "No claims yet. Share the link with your group!",
  refreshing: "Refreshing...",
  fullyClaimedBadge: "All items claimed!",
  unclaimed: "unclaimed",

  selectWhatYouAte: "Select what you ate. Taxes and service charges will be calculated automatically.",
  taxesAutoCalculated: "Taxes and service charges will be calculated automatically.",
  billSummary: "Bill Summary",
  sst6: "SST (6%)",
  serviceCharge10: "Service Charge (10%)",
  selectYourItems: "Select Your Items",
  available: "available",
  claimed: "Claimed",
  yourTotal: "Your Total",
  pay: "Pay",
  viewAllPendingBills: "View All Pending Bills",

  whatsYourName: "What's your name?",
  enterYourName: "Enter your name so the host knows who you are.",
  namePlaceholder: "e.g., Daniel, Sarah, Alex",
  joinBill: "Join Bill",
  nameRequired: "Name is required to join.",

  splitWithOthers: "Split with others",
  peopleSharingPrefix: "people sharing ·",
  eachSuffix: "each",
  splitCapped: "Max 10 people can share an item.",

  viewReceipt: "View Receipt",
  receiptDisclaimer: "This image will self-destruct in 2 hours along with the session.",
  noReceiptImage: "The host didn't share a receipt image for this session.",

  scanToPay: "Scan to Pay",
  bankSecurityNote: "Bank Security: Manual entry required. Tap the amount below to copy it for easy pasting.",
  yourShareBreakdown: "Your Share Breakdown",
  totalToPay: "Total to Pay",
  openBankingApp: "Open your banking app, tap Scan, and select this image from your gallery.",
  saveQrToGallery: "Save QR to Gallery",
  copyClaimSummary: "Copy Claim Summary",
  copiedToClipboard: "Copied to clipboard!",

  general: "General",
  of: "of",

  sessionExpired: "Session Expired",
  sessionExpiredDesc: "This bill has already been settled, or the session was wiped for privacy.",
  invalidSessionData: "Invalid Session Data",
  invalidSessionDataDesc: "This session's data appears corrupted. Please ask the host to re-upload.",
  viewLink: "View link",
  markAsPaidConfirm: "Are you sure? This will remove the bill from your device permanently.",
};

const zh: Translations = {
  splitTheBill: "分账",
  uploadDesc: "上传你的二维码并拍摄收据。AI 将安全地进行解析。",
  yourDuitNowQR: "你的 DuitNow 二维码",
  changeAccount: "更换账户",
  uploadQRScreenshot: "上传二维码截图",
  savedDuitNowActive: "✓ DuitNow 账户已激活",
  snapReceipt: "拍摄收据",
  exifStripped: "EXIF 数据将自动清除",
  mergeWithExisting: "合并到已有账单（可选）",
  pasteSessionId: "粘贴现有会话 ID",
  useLastSession: "使用上次会话",
  resumeCurrentSession: "恢复当前会话",

  aiCrunching: "AI 正在处理数据...",
  parsingReceipt: "解析收据、验证数学、生成草稿。",

  reviewAndEdit: "审核与编辑",
  tapAnyItem: "点击任意项目以编辑名称或价格。",
  sectionNameLabel: "分类名称（行程模式）",
  sectionPlaceholder: '例如："广州晚餐"、"第二天咖啡"',
  items: "项目",
  itemName: "项目名称",
  save: "保存",
  cancel: "取消",
  totals: "合计",
  subtotal: "小计",
  sstTax: "销售税",
  serviceCharge: "服务费",
  grandTotal: "总计",
  confirmAndGenerate: "确认并生成链接",
  finalizing: "正在生成...",
  startOver: "← 重新开始",
  includeReceiptPreview: "向客人展示收据预览",
  includeReceiptPreviewDesc: "允许客人查看收据的脱敏副本。可能包含打印的姓名或地址等信息。",

  readyToSplit: "准备好分账了！",
  shareLinkDesc: "将此链接分享给你的朋友。他们可以选择自己的项目并通过 DuitNow 付款。",
  shareLink: "分享链接",
  copyShareLink: "复制分享链接",
  copied: "已复制！",
  sessionIdForMerging: "会话 ID（用于合并）",
  copyId: "复制 ID",
  sessionIdNote: "如果你想稍后添加另一张收据到此账单，请使用此 ID。",
  uploadAnother: "上传另一张收据",

  couldntParse: "无法解析收据",
  tryAnotherPhoto: "重新拍照",

  sessionControls: "会话管理",
  clearAllSessions: "清除所有会话",
  clearAllDesc: "移除已保存的二维码、会话记录和待付账单。",
  uploadQrFirst: "请先上传你的 DuitNow 二维码截图。",

  qrInvalidFormat: "格式无效。请确保上传有效的 DuitNow 或 TNG 电子钱包二维码。",
  qrParseFailed: "无法从图片中读取二维码。请尝试更清晰的截图。",
  qrNoCode: "图片中未找到二维码。",

  liveDashboard: "实时面板",
  settlementProgress: "结算进度",
  claimedOf: "已选",
  unclaimedItems: "未认领项目",
  guestList: "客人列表",
  wipeSession: "清除会话",
  wipeConfirm: "这将永久删除服务器上的所有会话数据，此操作不可撤销。",
  wiping: "正在清除...",
  sessionWiped: "会话已成功清除。",
  noActivity: "暂无认领。将链接分享给你的朋友！",
  refreshing: "刷新中...",
  fullyClaimedBadge: "所有项目已认领！",
  unclaimed: "未认领",

  selectWhatYouAte: "选择你吃的。税费和服务费将自动计算。",
  taxesAutoCalculated: "税费和服务费将自动计算。",
  billSummary: "账单摘要",
  sst6: "SST (6%)",
  serviceCharge10: "服务费 (10%)",
  selectYourItems: "选择你的项目",
  available: "可选",
  claimed: "已被选",
  yourTotal: "你的总额",
  pay: "付款",
  viewAllPendingBills: "查看所有待付账单",

  whatsYourName: "你叫什么名字？",
  enterYourName: "输入你的名字，以便主人知道你是谁。",
  namePlaceholder: "例如：小明、小红、阿强",
  joinBill: "加入账单",
  nameRequired: "需要输入名字才能加入。",

  splitWithOthers: "与他人分摊",
  peopleSharingPrefix: "人分摊 ·",
  eachSuffix: "每人",
  splitCapped: "每个项目最多 10 人分摊。",

  viewReceipt: "查看收据",
  receiptDisclaimer: "此图片将在 2 小时后随会话一起自动销毁。",
  noReceiptImage: "主人未分享此会话的收据图片。",

  scanToPay: "扫码付款",
  bankSecurityNote: "银行安全提示：需要手动输入金额。点击下方金额即可复制。",
  yourShareBreakdown: "你的分账明细",
  totalToPay: "应付金额",
  openBankingApp: "打开你的银行应用，点击扫描，从相册选择此图片。",
  saveQrToGallery: "保存二维码到相册",
  copyClaimSummary: "复制选择摘要",
  copiedToClipboard: "已复制到剪贴板！",

  general: "通用",
  of: "/",

  sessionExpired: "会话已过期",
  sessionExpiredDesc: "此账单已结清，或会话已被清除以保护隐私。",
  invalidSessionData: "会话数据无效",
  invalidSessionDataDesc: "此会话的数据似乎已损坏。请联系主人重新上传。",
  viewLink: "查看链接",
  markAsPaidConfirm: "确定吗？这将从你的设备中永久移除此账单。",
};

export const translations: Record<Locale, Translations> = { en, zh };
