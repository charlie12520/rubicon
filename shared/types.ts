export type SourceStatus = "ok" | "warning" | "missing";

export type SourceHealth = {
  label: string;
  status: SourceStatus;
  detail: string;
  count?: number;
  url?: string;
};

export type GoogleSnapshotRefreshResult = {
  ok: boolean;
  message: string;
  outPath?: string;
  generatedAt: string;
};

export type IbkrWalletRefreshResult = {
  ok: boolean;
  message: string;
  wallet?: WalletSnapshot;
  outPath?: string;
  generatedAt: string;
};

export type IbkrHoldingPosition = {
  account: string;
  ask?: number | null;
  averageCost: number | null;
  bid?: number | null;
  conId?: number;
  costBasis?: number | null;
  currency?: string;
  delta?: number | null;
  exchange?: string;
  earnings?: IbkrHoldingEarningsEvent | null;
  expiration?: string;
  gamma?: number | null;
  greeksSource?: string;
  impliedVol?: number | null;
  last?: number | null;
  localSymbol: string;
  currentValue?: number | null;
  manualGreeksStatus?: string;
  marketDataStatus?: string;
  marketPrice?: number | null;
  multiplier?: string;
  position: number;
  positionDelta?: number | null;
  positionTheta?: number | null;
  primaryExchange?: string;
  right?: string;
  realizedPnl?: number | null;
  securityType: string;
  strike: number | null;
  symbol: string;
  theta?: number | null;
  tradingClass?: string;
  underlyingPrice?: number | null;
  unrealizedPnl?: number | null;
  vega?: number | null;
};

export type IbkrHoldingEarningsEvent = {
  date: string;
  daysUntil: number;
  epsForecast?: string;
  fiscalQuarterEnding?: string;
  name?: string;
  source?: string;
  time?: "before-open" | "after-close" | "not-supplied" | string;
  warning: "yellow" | "red";
};

export type IbkrHoldingsSnapshot = {
  account?: string;
  autoRefreshEt?: string | null;
  autoRefreshLastFiredDate?: string | null;
  count: number;
  earningsErrors?: string[];
  earningsEventsBySymbol?: Record<string, IbkrHoldingEarningsEvent>;
  earningsSource?: string;
  fetchedAt: string | null;
  grossCostBasis: number | null;
  grossCurrentValue?: number | null;
  manualGreeksSummary?: {
    computed: number;
    ibkr: number;
    manual: number;
    missing: number;
    optionCount: number;
    source?: string;
  };
  marketDataSummary?: {
    optionCount: number;
    withDelta: number;
    withMarketPrice: number;
    withTheta: number;
  };
  message: string;
  positions: IbkrHoldingPosition[];
  port?: number;
  source: string;
  status: "ok" | "missing" | "error";
};

export type IbkrHoldingsRefreshResult = {
  generatedAt: string;
  message: string;
  ok: boolean;
  outPath?: string;
  snapshot?: IbkrHoldingsSnapshot;
};

export type DesktopAlertResult = {
  generatedAt: string;
  message: string;
  ok: boolean;
  pid?: number;
};

export type DailySyncState = "idle" | "running" | "completed" | "failed" | "missing";

export type DailySyncStepStatus = "pending" | "running" | "complete" | "warning" | "failed";

export type DailySyncStep = {
  id: string;
  label: string;
  status: DailySyncStepStatus;
  detail?: string;
  updatedAt?: string;
};

export type DailyPipelineStageId = "dataCollection" | "rubiconIngest" | "googleUpload";

export type DailyPipelineStageStatus = "pending" | "running" | "complete" | "warning" | "failed" | "skipped";

export type DailyPipelineStage = {
  id: DailyPipelineStageId;
  label: string;
  status: DailyPipelineStageStatus;
  detail?: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  warnings?: string[];
  blockers?: string[];
};

export type DailyPipelineStages = Record<DailyPipelineStageId, DailyPipelineStage>;

export type DailySyncLatestSummary = {
  date: string;
  path: string;
  runId?: string;
  status?: string;
  spxStatus?: string;
  tradeStatus?: string;
  fillCount?: number;
  spreadCount?: number;
  entryCount?: number;
  googleUploadMode?: string;
  googleUploadStatus?: string;
  googleUploaded?: boolean;
  googleUploadedAt?: string;
};

export type DailySyncTargetPlan = {
  requestedDate: string;
  estimatedTargetDate: string;
  mode: "auto" | "explicit";
  cutoffTimeEt: string;
  nowEt: string;
  afterCutoff: boolean;
  note: string;
};

export type DailySyncLockInfo = {
  active: boolean;
  path: string;
  pid?: number;
  runId?: string;
  stale?: boolean;
  startedAt?: string;
  targetDate?: string;
  command?: string[];
  message?: string;
};

export type DailySyncCatchupStatus = {
  attempted: boolean;
  refreshedDates: string[];
  generatedAt: string;
  message: string;
  ok: boolean;
  warnings?: string[];
};

export type DailySyncPipelineState = "idle" | "running" | "completed" | "failed-with-stage-errors" | "failed" | "missing";

export type DailySyncStatusResult = {
  ok: boolean;
  state: DailySyncState;
  message: string;
  command?: string[];
  cwd?: string;
  catchup?: DailySyncCatchupStatus;
  dryRun?: boolean;
  exitCode?: number | null;
  finishedAt?: string;
  generatedAt: string;
  googleUploaded?: boolean;
  latestLogPath?: string;
  latestLogTail?: string;
  latestPipelineRun?: DailySyncLatestSummary;
  latestSummary?: DailySyncLatestSummary;
  lock?: DailySyncLockInfo;
  logPath?: string;
  pid?: number;
  pipelineState?: DailySyncPipelineState;
  reviewReady?: boolean;
  runId?: string;
  startedAt?: string;
  stages?: DailyPipelineStages;
  targetDate?: string;
  steps?: DailySyncStep[];
  targetPlan?: DailySyncTargetPlan;
  warnings?: string[];
};

export type DataIssueSeverity = "info" | "warning" | "error";

export type DataIssueStage = "pull" | "upload" | "availability";

export type DataIssue = {
  stage: DataIssueStage;
  severity: DataIssueSeverity;
  title: string;
  detail: string;
  count?: number;
};

export type UploadReceiptCheckEvidence = {
  checkedAt?: string;
  detail: string;
  matchedRowCount?: number;
  scannedRange?: string;
  source: string;
  status: "found" | "missing_receipt_row" | "quota_limited" | "error" | "unknown";
  url?: string;
};

export type WalletSnapshot = {
  netLiquidation: number | null;
  source: string;
  updatedAt: string | null;
  account?: string;
};

export type DailyReviewNote = {
  date: string;
  note: string;
  tradeFlags: Record<string, TradeReviewFlag>;
  updatedAt: string | null;
};

export type TradeReviewFlag = "follow_up" | "mistake" | "quality";

export type SpreadLeg = {
  localSymbol: string;
  right: "C" | "P" | "";
  strike: number;
  ratio: number;
};

export type TradeRecord = {
  id: string;
  account: string;
  date: string;
  status: string;
  side: "Call" | "Put" | "Mixed";
  strategy: string;
  bias: "Bullish" | "Bearish" | "Neutral";
  entryTime: string;
  exitTime: string | null;
  expiration: string | null;
  shortStrike: number | null;
  longStrike: number | null;
  width: number;
  contracts: number;
  positionBefore: number;
  positionAfter: number;
  entryPrice: number;
  entryChartDeviation: number | null;
  entryChartDeviationFlag: boolean;
  entryChartDeviationPct: number | null;
  entryChartMark: number | null;
  entryChartMarkTime: string | null;
  entryChartRangeHigh: number | null;
  entryChartRangeLow: number | null;
  entryChartWithinRange: boolean | null;
  exitPrice: number | null;
  priceType: "Credit" | "Debit";
  fees: number;
  maxRisk: number;
  maxProfit: number;
  pnl: number;
  returnOnRisk: number | null;
  winLoss: "Win" | "Loss" | "Flat" | "Open";
  spxEntry: number | null;
  spxExit: number | null;
  legs: SpreadLeg[];
  notes: string;
  source: string;
};

export type DailySummary = {
  date: string;
  tradeCount: number;
  fillCount: number;
  spreadCount: number;
  entryCount: number;
  optionContractCount: number;
  spxStatus: string;
  spxIntradayBarSize?: string;
  spxIntradayExpectedRows?: number;
  spxIntradayRowCount?: number;
  tradeStatus: string;
  ibkrEndpointExpectedCount?: number;
  ibkrEndpointConnectedCount?: number;
  tradeArtifactExpectedCount?: number;
  tradeArtifactReadyCount?: number;
  optionIntradayStatus: string;
  optionIntradayBarSize?: string;
  optionIntradayContractCount?: number;
  optionIntradayExpectedRowsPerContract?: number;
  optionIntradayExpectedRows?: number;
  optionIntradayRowCount?: number;
  optionIntradayExpectedNoDataContractCount?: number;
  optionIntradayEmptyContractCount?: number;
  optionIntradayUnexpectedErrorCount?: number;
  tradedOptionContractCount?: number;
  spreadMarkExpectedRows?: number;
  spreadMarkRowCount?: number;
  volumeProfileExpectedRows?: number;
  volumeProfileRowCount?: number;
  openInterestExpectedRows?: number;
  openInterestRowCount?: number;
  openInterestValidRowCount?: number;
  underlyingIntradayStatus?: string;
  underlyingIntradayExpectedRows?: number;
  underlyingIntradaySymbolCount?: number;
  underlyingIntradayRowCount?: number;
  underlyingIntradayPath?: string;
  availabilityStatus: string;
  uploadStatus: string;
  logPath?: string;
  payloadPath?: string;
  workbookPath?: string;
  generatedAtLocal?: string;
  issueCount: number;
  issues: DataIssue[];
  uploadTabCount: number;
  payloadRows: number;
  rawUploadGoogleSheetUrl?: string;
  uploadReceiptSource?: string;
  uploadReceiptReadAt?: string;
  uploadReceiptCheck?: UploadReceiptCheckEvidence;
};

export type TrackerSnapshot = {
  generatedAt: string;
  aiStuffRoot: string;
  googleSheetUrl: string;
  today: string;
  availableDates: string[];
  latestTradeDate: string | null;
  trades: TradeRecord[];
  dailySummaries: DailySummary[];
  wallet: WalletSnapshot;
  reviewNotes: Record<string, DailyReviewNote>;
  sourceHealth: SourceHealth[];
};

export type SpxBar = {
  time: number;
  timestampEt: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type SpreadMark = {
  tradeId: string;
  permId: string;
  entrySequence: number;
  timestampEt: string;
  label: string;
  time: number;
  value: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  vwap?: number;
  staleLegCount?: number;
  activeLegCount?: number;
  minLegVolume?: number;
  minLegCount?: number;
  legSymbols?: string[];
  source: string;
};

export type SpreadRangeBar = {
  tradeId: string;
  timestampEt: string;
  label: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  source: string;
  constructed: boolean;
};

export type OpenInterestPoint = {
  strike: number;
  right: "C" | "P";
  label: string;
  openInterest: number;
};

export type VolumePoint = {
  timestampEt: string;
  label: string;
  time: number;
  strike: number;
  right: "C" | "P";
  optionLabel: string;
  minuteVolume: number;
  cumulativeVolume: number;
};

export type ReplayPayload = {
  date: string;
  selectedTradeId: string | null;
  spxBars: SpxBar[];
  spreadMarks: SpreadMark[];
  openInterest: OpenInterestPoint[];
  volume: VolumePoint[];
  quickTrades: TradeRecord[];
};

// Live SPX intraday bars written by scripts/refresh-spx-live-bars.py during the
// session (a dedicated IBKR sidecar). The Estimator's 2-minute chart prefers
// these over the post-close replay bars so the target-level line has a live SPX
// backdrop mid-session.
export type SpxLiveBarsPayload = {
  generatedAt: string;
  session: string; // YYYY-MM-DD ET the bars cover
  source: string; // "ibkr-live" | "none"
  live: boolean;
  barSize: string; // e.g. "1 min"
  asOf: string | null; // ET label ("HH:MM") of the latest bar, or null when empty
  bars: SpxBar[];
  note?: string;
};

// Status of the per-interval SPX live-bar sidecar process. Mirrors SpxHeatmapLiveStatus.
export type SpxLiveBarsLiveStatus = {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  lastExit: { code: number | null; at: string } | null;
  logTail: string[];
  script: string;
  python: string;
  available: boolean;
  autoStartEt: string | null;
  autoStartLastFiredDate: string | null;
  marketOpen: boolean; // true only during the RTH pull window (≈09:25–16:00 ET, Mon–Fri)
};

export type SpreadSpeedRegime = "FAST" | "MED" | "DEAD";

export type SpreadSpeedRow = {
  side: "PCS" | "CCS";
  shortStrike: number;
  longStrike: number;
  shortDelta: number;
  netDelta: number;
  dollarPerPoint: number;
  regime: SpreadSpeedRegime;
  distEm: number;
  value: number | null;
};

export type SpreadSpeedPick = {
  shortStrike: number;
  longStrike: number;
  netDelta: number;
  dollarPerPoint: number;
  shortDelta: number;
  regime: SpreadSpeedRegime;
  value: number | null;
} | null;

export type SpreadSpeedFrame = {
  label: string;
  minutesToClose: number;
  spot: number;
  atmStraddle: number;
  em: number;
  speedCeiling: number;
  pcs: SpreadSpeedRow[];
  ccs: SpreadSpeedRow[];
  recommendPcs: SpreadSpeedPick;
  recommendCcs: SpreadSpeedPick;
  fastestPcs: SpreadSpeedPick;
  fastestCcs: SpreadSpeedPick;
  pcsFastLow: number | null;
  pcsFastHigh: number | null;
  ccsFastLow: number | null;
  ccsFastHigh: number | null;
};

export type SpreadSpeedPayload = {
  date: string;
  generatedAt: string;
  available: boolean;
  note: string;
  targetNetDelta: number;
  fastThreshold: number;
  frames: SpreadSpeedFrame[];
};

export type MorningBriefSourceStatus = "ok" | "warning" | "error" | "stub";

export type MorningBriefSource = {
  label: string;
  status: MorningBriefSourceStatus;
  detail: string;
  url?: string;
};

export type MorningCalendarSource =
  | "BLS"
  | "BEA"
  | "Census"
  | "DOL"
  | "Fed"
  | "ISM"
  | "Treasury"
  | "EIA"
  | "MBA"
  | "ADP"
  | "API"
  | "NAR"
  | "UMich"
  | "NYFed"
  | "NAHB"
  | "RollCall";

export type MorningCalendarEvent = {
  id: string;
  source: MorningCalendarSource;
  date: string;
  timeLabel: string;
  sortMinute: number | null;
  title: string;
  impact?: "medium" | "high" | "political" | "unknown";
  country?: string;
  location?: string;
  coverage?: string;
  detail?: string;
  url?: string;
};

export type MorningMajorEvent = {
  coverage?: string;
  date: string;
  detail?: string;
  id: string;
  impact: "high" | "market";
  kind: "macro" | "fomc" | "inflation" | "jobs" | "opex";
  source: Exclude<MorningCalendarSource, "RollCall"> | "OPEX";
  sortMinute: number | null;
  timeLabel: string;
  title: string;
  url?: string;
  window: "thisWeek" | "nextWeek";
};

export type MorningLiveUpdate = {
  author?: string;
  feedUrl?: string;
  id: string;
  kind?: "post" | "reply" | "repost";
  originalAuthor?: string;
  source: "FirstSquawk" | "Godel";
  replyTo?: string;
  repostedBy?: string;
  timeLabel: string;
  publishedAt: string | null;
  text: string;
  trackedAccount?: string;
  url?: string;
};

export type MorningTc2000ArtifactKind = "snapshot" | "crop" | "ocr" | "csv" | "other";

export type MorningTc2000Artifact = {
  name: string;
  kind: MorningTc2000ArtifactKind;
  size: number;
  updatedAt: string;
  url?: string;
  symbols?: string[];
};

export type MorningDailyBar = {
  close: number;
  date: string;
  high: number;
  low: number;
  open: number;
  volume: number | null;
};

export type MorningCompanyProfile = {
  description?: string;
  industry?: string;
  name?: string;
  source?: string;
  updatedAt?: string;
};

export type MorningTc2000Screener = {
  name: string;
  symbols: string[];
  newSymbols?: string[];
  source: "csv" | "ocr" | "stairstep";
  sourcePath?: string;
  updatedAt?: string;
  note?: string;
};

export type MorningTc2000Pulls = {
  available: boolean;
  sourceDir: string | null;
  screenerName?: string;
  latestSnapshot?: MorningTc2000Artifact;
  latestOcr?: MorningTc2000Artifact;
  symbols: string[];
  newSymbols?: string[];
  newSymbolsComparedWithDate?: string;
  screeners: MorningTc2000Screener[];
  dailyBars: Record<string, MorningDailyBar[]>;
  dailyBarsGeneratedAt: string | null;
  dailyBarsSource: string | null;
  dailyBarsNote?: string;
  profiles: Record<string, MorningCompanyProfile>;
  artifacts: MorningTc2000Artifact[];
  note: string;
};

export type MorningBriefPayload = {
  date: string;
  generatedAt: string;
  economicEvents: MorningCalendarEvent[];
  trumpEvents: MorningCalendarEvent[];
  combinedEvents: MorningCalendarEvent[];
  majorEvents: MorningMajorEvent[];
  liveUpdates: MorningLiveUpdate[];
  tc2000: MorningTc2000Pulls;
  sources: MorningBriefSource[];
};

export type MorningLiveUpdatesPayload = {
  generatedAt: string;
  liveUpdates: MorningLiveUpdate[];
  sources: MorningBriefSource[];
};

export type GodelAlertBridgeStatus = {
  bookmarkletUrl: string;
  generatedAt: string;
  lastAlert: {
    headline?: string;
    publishedAt?: string | null;
    sourceUrl?: string | null;
  } | null;
  lastRejected: {
    at?: string;
    reason?: string;
    text?: string;
  } | null;
  message: string;
  mode: "dom-bridge";
  setupUrl: string;
  validCount: number;
};

export type MorningAiNotesBlock = {
  available: boolean;
  bullets: string[];
  dateRange: string;
  label: string;
};

export type MorningAiNotesPayload = {
  date: string;
  generatedAt: string | null;
  message: string;
  previousDay: MorningAiNotesBlock;
  previousWeek: MorningAiNotesBlock;
  source: "codex_automation" | "pending";
};

export type TradeJournalSnapshotSaveResult = {
  count: number;
  generatedAt: string;
  message: string;
  ok: boolean;
};

export type FplStructuralState = {
  isInOpenPosition: number;
  nOpenPositions: number;
  minutesSinceOpen: number;
  pnlPctProxy: number;
  prevClose: number;
  prevHigh: number;
  prevLow: number;
  distPdcPct: number;
  distPdhPct: number;
  distPdlPct: number;
  gapToPdcPct: number;
  cheatCode50Ema2m: number;
  cheatCode50Sma2m: number;
  cheatCode200Ema2m: number;
  cheatCode200Sma2m: number;
  distCc50Ema2m: number;
  distCc200Ema2m: number;
  hvCallPeak: number;
  hvCallLow: number;
  hvCallHigh: number;
  hvPutPeak: number;
  hvPutLow: number;
  hvPutHigh: number;
  insideHvContainment: number;
  oiCallPeak: number;
  oiCallLow: number;
  oiCallHigh: number;
  oiPutPeak: number;
  oiPutLow: number;
  oiPutHigh: number;
};

export type FplIndicatorBar = {
  time: number;
  label: string;
  timestampEt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  pHold: number;
  pEnter: number;
  pScaleIn: number;
  pScaleOut: number;
  pExit: number;
  pSideBullish: number;
  pSideBearish: number;
  structural: FplStructuralState;
};

export type FplIndicatorPayload = {
  date: string;
  barsCount: number;
  bars: FplIndicatorBar[];
  isLive: boolean;
  fetchedAt: string;
};

export type FplIndicatorManifest = {
  dates: string[];
  count: number;
  root: string;
};

export type FplLiveStatus = {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  lastExit: { code: number | null; at: string } | null;
  logTail: string[];
  script: string;
  python: string;
  available: boolean;
  // Auto-start scheduler (Mon-Fri at the given ET time). null when disabled.
  autoStartEt: string | null;
  autoStartLastFiredDate: string | null;
};

// Daily OHLCV bars served to the Relative Rotation Graph. Reuses the TC2000
// daily-bar shape already exported for the morning brief.
export type RrgBarsPayload = {
  barsBySymbol: Record<string, MorningDailyBar[]>;
  symbols: string[];
  generatedAt: string | null;
  source: string | null;
  note?: string;
};

// Intraday S&P 500 market-map heatmap. Each tile is a constituent sized by index
// weight and coloured by its intraday % change; pctByTime is aligned to `times`
// so the scrubber/playback can recolour the whole map at any minute of the session.
export type SpxHeatmapTile = {
  symbol: string;
  name: string;
  sector: string; // Finviz/Morningstar sector (re-keyed from GICS at load time)
  industry: string; // Finviz industry within the sector (sector → industry → stock)
  weight: number; // index weight in %, drives tile area
  last: number | null; // latest trade price at asOf
  prevClose: number | null;
  pct: number | null; // % change at the latest available bucket (whole-session view)
  pctByTime: (number | null)[]; // % change aligned to `times`; null = no print yet that minute
  iv: number | null; // annualized ATM implied vol (IBKR ~30-day, fraction e.g. 0.27); null when no live IV — drives the σ (IV-normalized) view
  earningsDate: string | null; // next earnings report date YYYY-MM-DD (Nasdaq calendar), or null
  earningsTime: "before-open" | "after-close" | "not-supplied" | null; // report timing; drives the earnings overlay
};

export type SpxHeatmapSector = {
  name: string;
  weight: number; // summed constituent weight
  pct: number | null; // weight-weighted sector % change at the latest bucket
  count: number;
};

export type SpxHeatmapIndexSummary = {
  label: string;
  pct: number | null; // weight-weighted index % change (SPY proxy)
  advancers: number;
  decliners: number;
  unchanged: number;
};

export type SpxHeatmapPayload = {
  generatedAt: string;
  session: string; // YYYY-MM-DD the data covers
  asOf: string | null; // ET label of the latest bucket with data
  source: string; // "sample" | "yahoo-1m" | "ibkr-1m-disk" | "ibkr-live"
  live: boolean; // true when (near) real-time
  delayMinutes: number | null; // feed delay, e.g. 15 for free Yahoo/IBKR-delayed
  times: string[]; // shared intraday axis, e.g. ["09:30", ... "16:00"]
  tiles: SpxHeatmapTile[];
  sectors: SpxHeatmapSector[];
  index: SpxHeatmapIndexSummary | null;
  note?: string;
};

// Status of the per-minute IBKR live snapshot-poll process that rewrites
// data/spx-heatmap.json during the session. Mirrors FplLiveStatus.
export type SpxHeatmapLiveStatus = {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  lastExit: { code: number | null; at: string } | null;
  logTail: string[];
  script: string;
  python: string;
  available: boolean;
  autoStartEt: string | null; // ET HH:MM the daily auto-start fires, or null if disabled
  autoStartLastFiredDate: string | null;
  marketOpen: boolean; // true only during the RTH pull window (≈09:25–16:00 ET, Mon–Fri); Start is refused otherwise
};
