/**
 * Centralized resource limits for sprite-gen MCP server.
 *
 * All limits are defined here for easy auditing and tuning.
 * Modules import specific limits as needed.
 */

export const LIMITS = {
  // ── Image ─────────────────────────────────────────────────────────────────
  image: {
    /** Max file size in bytes (50 MB) */
    maxFileSizeBytes: 50 * 1024 * 1024,
    /** Max width in pixels */
    maxWidth: 4096,
    /** Max height in pixels */
    maxHeight: 4096,
    /** Max total pixels (width × height) — decompression bomb guard */
    maxTotalPixels: 4096 * 4096, // ~16 Mpx
    /** Supported MIME types for input validation */
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'],
    /** Allowed file extensions */
    allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'],
    /** Max total pixel count across all processed images in a single batch */
    maxBatchTotalPixels: 100 * 1024 * 1024, // 100 Mpx
  },

  // ── Video ─────────────────────────────────────────────────────────────────
  video: {
    /** Max file size in bytes (500 MB) */
    maxFileSizeBytes: 500 * 1024 * 1024,
    /** Max duration in seconds */
    maxDurationSeconds: 600, // 10 min
    /** Max extracted frames per operation */
    maxFrames: 1000,
    /** Max FPS for extraction */
    maxFps: 60,
    /** Allowed video extensions */
    allowedExtensions: ['.mp4', '.webm', '.avi', '.mov', '.mkv', '.gif'],
  },

  // ── Sprite sheet / processing ─────────────────────────────────────────────
  sprite: {
    /** Max grid cols or rows */
    maxGridDimension: 64,
    /** Max pixel scale factor */
    maxPixelScale: 32,
    /** Max colors for quantization */
    maxColors: 256,
    /** Max batch items (generate) */
    maxBatchGenerateItems: 50,
    /** Max batch items (process) */
    maxBatchProcessItems: 100,
    /** Max output file count per operation */
    maxOutputFiles: 200,
  },

  // ── Prompt / text ─────────────────────────────────────────────────────────
  text: {
    /** Max prompt length in characters */
    maxPromptLength: 10000,
    /** Max instruction length for edit */
    maxInstructionLength: 5000,
    /** Max animation name length */
    maxAnimationNameLength: 100,
  },

  // ── Timeouts ──────────────────────────────────────────────────────────────
  timeout: {
    /** Python subprocess timeout in ms */
    pythonMs: 60_000,
    /** ffmpeg process timeout in ms */
    ffmpegMs: 300_000, // 5 min
    /** gifsicle process timeout in ms */
    gifsicleMs: 60_000,
    /** External HTTP request timeout in ms */
    fetchMs: 120_000, // 2 min
    /** ComfyUI poll timeout in ms */
    comfyPollMs: 120_000,
    /** Version-check subprocess timeout in ms */
    versionCheckMs: 2_000,
  },

  // ── Godot scan ────────────────────────────────────────────────────────────
  godotScan: {
    /** Max recursive directory depth */
    maxDepth: 10,
    /** Max files to scan */
    maxFiles: 5000,
    /** Directories to skip */
    skipDirs: new Set(['.git', 'node_modules', '.import', '.godot', '__pycache__', '.vscode', '.idea', 'addons']),
    /** Max symlinks to follow before aborting */
    maxSymlinkFollows: 10,
  },

  // ── Temp files ────────────────────────────────────────────────────────────
  temp: {
    /** Base directory for temp operations (relative to project root) */
    baseDir: 'tmp',
    /** Max temp disk space in bytes (1 GB) */
    maxDiskBytes: 1024 * 1024 * 1024,
  },

  // ── Concurrency ────────────────────────────────────────────────────────────
  concurrency: {
    /** Max parallel AI provider requests */
    maxProvider: 3,
    /** Max parallel ffmpeg processes */
    maxFfmpeg: 2,
    /** Max parallel Python script processes */
    maxPython: 2,
    /** Max parallel Sharp image processing tasks */
    maxSharp: 4,
  },

  // ── Cache ──────────────────────────────────────────────────────────────────
  cache: {
    /** Enable caching */
    enabled: true,
    /** Max cache entries */
    maxEntries: 128,
    /** Default TTL in ms (5 minutes) */
    defaultTtlMs: 5 * 60 * 1000,
    /** Max total cache size in bytes (64 MB) */
    maxTotalBytes: 64 * 1024 * 1024,
  },

  // ── Output paths ──────────────────────────────────────────────────────────
  output: {
    /** Default output root directory (relative to project root) */
    defaultRoot: 'output',
    /** Absolute project root — all output paths must resolve within this */
    get projectRoot() {
      // Lazy-resolved to avoid circular import issues
      return process.cwd();
    },
    /** Allow overwriting existing output files */
    allowOverwrite: false,
    /** Allow writing to input file paths */
    allowOverwriteInput: false,
  },

  // ── URL / network ─────────────────────────────────────────────────────────
  network: {
    /** Allowed URL protocols */
    allowedProtocols: ['http:', 'https:'],
    /** Blocked protocols (SSRF prevention) */
    blockedProtocols: ['file:', 'ftp:', 'data:', 'javascript:', 'vbscript:'],
    /** Default ComfyUI base URL — only localhost allowed */
    comfyDefaultHost: '127.0.0.1',
    /** Max URL length */
    maxUrlLength: 2048,
  },
};

/**
 * Clamp a number to [min, max], returning the clamped value.
 */
export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
