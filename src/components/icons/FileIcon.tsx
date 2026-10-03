import React from "react";

interface FileIconProps {
  fileName: string;
  size?: number;
  className?: string;
}

interface FolderIconProps {
  folderName: string;
  isExpanded: boolean;
  size?: number;
  className?: string;
}

export const FileIcon: React.FC<FileIconProps> = ({ fileName, size = 15, className = "" }) => {
  const lower = fileName.toLowerCase();
  const ext = lower.split(".").pop() || "";

  // Exact file name matches
  if (lower === "package.json") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
        <path d="M2.5 2.5h11v11h-11V2.5zm3 3v5h5v-5h-5z" fill="#CB3837" />
      </svg>
    );
  }

  if (lower === "cargo.toml" || lower === "cargo.lock" || lower.endsWith(".lock")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
        <rect x="3" y="6" width="10" height="8" rx="2" fill="#CCA700" />
        <path d="M5.5 6V4a2.5 2.5 0 0 1 5 0v2" stroke="#CCA700" strokeWidth="1.3" fill="none" />
        <circle cx="8" cy="10" r="1.1" fill="#1e1e1e" />
      </svg>
    );
  }

  if (lower === ".gitignore" || lower === ".gitattributes" || lower === ".gitmodules") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
        <rect x="8" y="1" width="9" height="9" rx="1.5" transform="rotate(45 8 1)" fill="#F05032" />
        <circle cx="6" cy="8" r="1.1" fill="#ffffff" />
        <circle cx="10" cy="6" r="1.1" fill="#ffffff" />
        <circle cx="10" cy="10" r="1.1" fill="#ffffff" />
        <path d="M6 8h1.5a1.5 1.5 0 0 1 1.5 1.5V10m0-4v4" stroke="#ffffff" strokeWidth="1" />
      </svg>
    );
  }

  if (lower === "dockerfile" || lower.startsWith("docker-compose")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
        <path d="M14.5 8c-.3 0-.6.1-.8.2-.5-.4-1.2-.5-1.9-.3-.1-.6-.5-1.1-1.1-1.3l-.2-.1-.1.2c-.3.7-.3 1.5.1 2.2-.4.2-.9.5-1.3.8H1c-.3 0-.6.2-.7.5-.1.5.1 1.2.6 1.8 1.4 1.8 3.5 2.7 6.4 2.7 4.2 0 6.9-1.9 7.6-5.4.5-.1.8-.6.6-1.1-.1-.1-.2-.2-.4-.2z" fill="#2496ED" />
        <rect x="3" y="6.5" width="1.4" height="1.2" rx=".2" fill="#2496ED" />
        <rect x="5" y="6.5" width="1.4" height="1.2" rx=".2" fill="#2496ED" />
        <rect x="7" y="6.5" width="1.4" height="1.2" rx=".2" fill="#2496ED" />
        <rect x="5" y="5" width="1.4" height="1.2" rx=".2" fill="#2496ED" />
      </svg>
    );
  }

  // Extensions
  switch (ext) {
    // Python - Official Two-Snake Logo
    case "py":
    case "pyw":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M7.9 1.1c-3.1 0-2.9 1.3-2.9 1.3l.01 1.4h2.9v.4H3.8S2 4 2 7.1s1.6 3 1.6 3h.9V8.7s-.1-1.6 1.6-1.6h2.8s1.5 0 1.5-1.5V2.6s.2-1.5-2.5-1.5zm-1.5.9a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1z" fill="#3776AB" />
          <path d="M8.1 14.9c3.1 0 2.9-1.3 2.9-1.3l-.01-1.4H8.1v-.4h4.1s1.8.2 1.8-2.9-1.6-3-1.6-3h-.9v1.4s.1 1.6-1.6 1.6H7.1s-1.5 0-1.5 1.5v3.1s-.2 1.5 2.5 1.5zm1.5-.9a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1z" fill="#FFD43B" />
        </svg>
      );

    // Java - Official Coffee Cup & Steam
    case "java":
    case "class":
    case "jar":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M5.5 1.8c-.4 1 .4 1.7 0 2.7" stroke="#E76F51" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M8 1.2c-.6 1.1.6 1.9 0 3" stroke="#F4A261" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M10.5 1.8c-.4 1 .4 1.7 0 2.7" stroke="#E76F51" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M3 6h7.5c.3 0 .5.2.5.5v2.5c0 2-1.5 3-4 3S3 11 3 9V6.5c0-.3.2-.5.5-.5z" fill="#5382A1" />
          <path d="M11 6.5h1.2a1.8 1.8 0 0 1 0 3.6H10" stroke="#5382A1" strokeWidth="1.1" />
          <path d="M2 13.5c2 1 8 1 10.5 0" stroke="#5382A1" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );

    // C - Official Blue Hexagon
    case "c":
    case "h":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M8 1.2l5.5 3.2v6.4L8 14.8 2.5 11.2V4.8L8 1.2z" fill="#00599C" />
          <path d="M8 2.4l4.5 2.6v5.2L8 12.8 3.5 10.2V5L8 2.4z" fill="#004482" />
          <path d="M10.5 5.8a3.4 3.4 0 1 0 0 4.4" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      );

    // C++ - Official Blue Hexagon with ++
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hxx":
    case "hh":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M8 1.2l5.5 3.2v6.4L8 14.8 2.5 11.2V4.8L8 1.2z" fill="#00599C" />
          <path d="M8 2.4l4.5 2.6v5.2L8 12.8 3.5 10.2V5L8 2.4z" fill="#004482" />
          <path d="M7.2 5.8a2.8 2.8 0 1 0 0 4.4" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" fill="none" />
          <path d="M9.5 7.2v2M8.5 8.2h2M12.5 7.2v2M11.5 8.2h2" stroke="#00B4D8" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      );

    // Rust - Official Gear with R
    case "rs":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <circle cx="8" cy="8" r="6.2" stroke="#DEA584" strokeWidth="1.3" strokeDasharray="1.6 1" />
          <circle cx="8" cy="8" r="5" fill="#CE412B" />
          <path d="M6.2 5.5h2.2c.8 0 1.4.4 1.4 1.2 0 .6-.4 1-1 1.1l1.2 2.7h-1.1L7.8 8h-.6v2.5H6.2V5.5zm1 1.7h1.1c.3 0 .5-.2.5-.5s-.2-.5-.5-.5H7.2v1z" fill="#ffffff" />
        </svg>
      );

    // JavaScript - Official Yellow JS Square
    case "js":
    case "mjs":
    case "cjs":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M4.5 11.2c.3.5.7.8 1.4.8.7 0 1.1-.3 1.1-.9v-3.6H8.2v3.6c0 1.2-.8 1.8-2.2 1.8-1.2 0-2-.6-2.4-1.5l.9-.4zm4.8-.4c.4.6 1 1 1.9 1 .8 0 1.3-.4 1.3-.9 0-.6-.5-.8-1.4-1.2-.9-.4-2-.8-2-2 0-1.1.9-1.9 2.2-1.9 1 0 1.6.4 2.1 1.1l-.8.5c-.3-.5-.7-.7-1.3-.7-.6 0-1 .3-1 .8 0 .5.4.7 1.3 1.1 1.1.5 2.1.9 2.1 2.1 0 1.2-.9 2-2.4 2-1.3 0-2.1-.6-2.6-1.5l.9-.4z" fill="#F7DF1E" />
        </svg>
      );

    // TypeScript - Official Blue TS Square
    case "ts":
    case "mts":
    case "cts":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M3.5 5.8h4.5v1.2H6.4v5.5H5.1V7H3.5V5.8zm5.5 5c.4.6 1 1 1.9 1 .8 0 1.3-.4 1.3-.9 0-.6-.5-.8-1.4-1.2-.9-.4-2-.8-2-2 0-1.1.9-1.9 2.2-1.9 1 0 1.6.4 2.1 1.1l-.9.6c-.3-.4-.7-.6-1.2-.6-.6 0-1 .3-1 .7 0 .5.4.7 1.2 1.1 1.1.5 2.2.9 2.2 2.1 0 1.2-.9 2-2.4 2-1.3 0-2.1-.6-2.6-1.5l.8-.5z" fill="#3178C6" />
        </svg>
      );

    // React JSX / TSX - Official Cyan Atom
    case "jsx":
    case "tsx":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <ellipse cx="8" cy="8" rx="6.5" ry="2.5" stroke="#61DAFB" strokeWidth="1" />
          <ellipse cx="8" cy="8" rx="6.5" ry="2.5" stroke="#61DAFB" strokeWidth="1" transform="rotate(60 8 8)" />
          <ellipse cx="8" cy="8" rx="6.5" ry="2.5" stroke="#61DAFB" strokeWidth="1" transform="rotate(120 8 8)" />
          <circle cx="8" cy="8" r="1.3" fill="#61DAFB" />
        </svg>
      );

    // HTML5 - Official Orange Shield
    case "html":
    case "htm":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M2.5 1.5l1.1 12.3 4.4 1.2 4.4-1.2L13.5 1.5H2.5z" fill="#E44D26" />
          <path d="M8 2.5v11.3l3.4-.9.8-9.4H8z" fill="#F16529" />
          <path d="M8 5.2H5.1l.2 2.1H8V6.3zm0 3.2H6.4l.2 2.1L8 10.9V9.8l-.9-.2-.1-.9H8V8.4zm2.8-3.2H8v1.1h2.7l-.3 3.3L8 10.9v1.1l2.4-.7.6-6.1z" fill="#ffffff" />
        </svg>
      );

    // CSS3 - Official Blue Shield
    case "css":
    case "scss":
    case "sass":
    case "less":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M2.5 1.5l1.1 12.3 4.4 1.2 4.4-1.2L13.5 1.5H2.5z" fill="#1572B6" />
          <path d="M8 2.5v11.3l3.4-.9.8-9.4H8z" fill="#33A9DC" />
          <path d="M8 5.2h2.8l-.2 2.1H8V6.3zm0 3.2h2.3l-.2 2.1L8 10.9V9.8l.9-.2.1-.9H8V8.4zm-2.8-3.2H8v1.1H5.3l.3 3.3L8 10.9v1.1l-2.4-.7-.6-6.1z" fill="#ffffff" />
        </svg>
      );

    // JSON
    case "json":
    case "jsonc":
    case "json5":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <text x="8" y="11.5" textAnchor="middle" fill="#F4A261" fontSize="11" fontWeight="bold" fontFamily="monospace">{"{}"}</text>
        </svg>
      );

    // Markdown
    case "md":
    case "markdown":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="#4EA8DE" strokeWidth="1.2" fill="none" />
          <path d="M3 10.5V5.5l1.8 2 1.8-2v5M11.5 5.5v5m-1.5-2l1.5 2 1.5-2" stroke="#4EA8DE" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    // TOML
    case "toml":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <text x="8" y="11" textAnchor="middle" fill="#9C59B6" fontSize="7" fontWeight="bold" fontFamily="monospace">TOML</text>
        </svg>
      );

    // YAML
    case "yaml":
    case "yml":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <text x="8" y="11" textAnchor="middle" fill="#CB171E" fontSize="7" fontWeight="bold" fontFamily="sans-serif">YML</text>
        </svg>
      );

    // Salivo - Official Crimson & Carbon S-Blade Logo
    case "sal":
    case "salivo":
    case "sf":
    case "slv":
      return (
        <svg width={size} height={size} viewBox="0 0 512 512" fill="none" className={className}>
          <defs>
            <linearGradient id="salivoCrimson" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FF1A2A" />
              <stop offset="100%" stopColor="#D90416" />
            </linearGradient>
            <linearGradient id="salivoCarbon" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4A4A54" />
              <stop offset="100%" stopColor="#222226" />
            </linearGradient>
          </defs>
          <polygon
            points="200,76 456,76 366,150 232,150 144,226 284,354 196,354 68,226"
            fill="url(#salivoCrimson)"
          />
          <polygon
            points="312,436 56,436 146,362 280,362 368,286 228,158 316,158 444,286"
            fill="url(#salivoCarbon)"
          />
        </svg>
      );

    // Zig - Official Orange Logo
    case "zig":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M3.5 5h9L4.5 11H12.5" stroke="#F7A41D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    // Shell / Batch
    case "sh":
    case "bash":
    case "zsh":
    case "bat":
    case "cmd":
    case "ps1":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M3 5l3 3-3 3m4.5 0H13" stroke="#4EC9B0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    // SQL / Database
    case "sql":
    case "db":
    case "sqlite":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <ellipse cx="8" cy="4" rx="5" ry="2" fill="#E8B339" />
          <path d="M3 4v4c0 1.1 2.2 2 5 2s5-.9 5-2V4" fill="none" stroke="#E8B339" strokeWidth="1" />
          <path d="M3 8v4c0 1.1 2.2 2 5 2s5-.9 5-2V8" fill="none" stroke="#E8B339" strokeWidth="1" />
        </svg>
      );

    // Go - Official Cyan Logo
    case "go":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M4 6.5h3.2v1.5H5.7v1.8h2.3V11H4V6.5zm4.8 2.2c0-1.3.8-2.3 2.1-2.3s2.1 1 2.1 2.3-.8 2.3-2.1 2.3-2.1-1-2.1-2.3zm2.8 0c0-.6-.3-1.1-.7-1.1s-.7.5-.7 1.1.3 1.1.7 1.1.7-.5.7-1.1z" fill="#00ADD8" />
        </svg>
      );

    // PHP - Official Purple Logo
    case "php":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <ellipse cx="8" cy="8" rx="7" ry="4.5" fill="#777BB4" />
          <text x="8" y="10.2" textAnchor="middle" fill="#ffffff" fontSize="6" fontWeight="bold" fontFamily="sans-serif">PHP</text>
        </svg>
      );

    // C# - Official Purple Hexagon
    case "cs":
    case "csx":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M8 1.2l5.5 3.2v6.4L8 14.8 2.5 11.2V4.8L8 1.2z" fill="#9B4993" />
          <path d="M7 6a2.5 2.5 0 1 0 0 4" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" fill="none" />
          <text x="10.5" y="9.5" textAnchor="middle" fill="#239120" fontSize="7" fontWeight="bold" fontFamily="sans-serif">#</text>
        </svg>
      );

    // Kotlin - Official Geometric Logo
    case "kt":
    case "kts":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <polygon points="1.5,1.5 14.5,1.5 8,8 1.5,14.5" fill="#7F52FF" />
          <polygon points="1.5,14.5 8,8 14.5,14.5" fill="#C711E1" />
          <polygon points="8,8 14.5,1.5 14.5,14.5" fill="#E24462" />
        </svg>
      );

    // Swift - Official Swift Bird
    case "swift":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M4 12.5c2.8 0 5-1.5 6-3.8-.8.3-1.8.4-2.8.2 2-.8 3.3-2.5 3.8-4.4-.7.6-1.6 1.1-2.5 1.2.9-1.2 1.2-2.8.8-4.2-.6 1.5-1.8 2.8-3.3 3.5-.8.4-1.7.5-2.6.4.4.6 1 1.1 1.7 1.4-1.2.1-2.4-.4-3.3-1.3.4 1.8 1.8 3.2 3.5 3.8-1.4.1-2.8-.4-3.7-1.3.6 1.8 2.3 3 4.2 3.1-1.3.9-2.9 1.4-4.5 1.4-.4 0-.8 0-1.2-.1z" fill="#F05138" />
        </svg>
      );

    // Ruby - Official Gemstone
    case "rb":
    case "erb":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <polygon points="4,2 12,2 14.5,5.5 8,14.5 1.5,5.5" fill="#CC342D" />
          <polygon points="4,2 12,2 10.5,5.5 5.5,5.5" fill="#E84D3D" />
          <polygon points="1.5,5.5 5.5,5.5 8,14.5" fill="#B32B25" />
          <polygon points="14.5,5.5 10.5,5.5 8,14.5" fill="#99231E" />
          <polygon points="5.5,5.5 10.5,5.5 8,14.5" fill="#E84D3D" />
        </svg>
      );

    // Lua - Official Blue Orb
    case "lua":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <circle cx="7" cy="8.5" r="5" fill="#000080" />
          <circle cx="9" cy="6.5" r="2.5" fill="#ffffff" />
          <circle cx="12.5" cy="3.5" r="1.5" fill="#000080" />
        </svg>
      );

    // XML
    case "xml":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M4.5 5.5L2 8l2.5 2.5m7-5L14 8l-2.5 2.5m-3.5-6l-2 7" stroke="#E34C26" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    // Images
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "ico":
    case "webp":
    case "svg":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="#4CAF50" strokeWidth="1.1" />
          <circle cx="5.5" cy="6" r="1.3" fill="#FFE082" />
          <path d="M3 12.5l3-4 2.5 2.8 1.8-2.2 2.7 3.4H3z" fill="#4CAF50" />
        </svg>
      );

    // Plain Text & Logs
    case "txt":
    case "log":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M3 2a1 1 0 0 1 1-1h5.5L13 4.5V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2z" fill="#3A3A3A" />
          <path d="M9.5 1v3.5H13" fill="#555555" />
          <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" stroke="#B0BEC5" strokeWidth="1" strokeLinecap="round" />
        </svg>
      );

    // Generic Default File
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M3 2a1 1 0 0 1 1-1h5.5L13 4.5V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2z" fill="#2A2D2E" stroke="#555" strokeWidth="0.8" />
          <path d="M9.5 1v3.5H13" fill="#444" />
        </svg>
      );
  }
};

// Outline folders (VS Code style). Well-known folders keep their color as a small corner badge.
const FOLDER_BADGES: Record<string, string> = {
  ".git": "#F05032",
  ".github": "#8B949E",
  ".vscode": "#007ACC",
  src: "#61DAFB",
  components: "#007ACC",
  component: "#007ACC",
  test: "#4CAF50",
  tests: "#4CAF50",
  assets: "#D97706",
  images: "#D97706",
  icons: "#D97706",
  public: "#A855F7",
  build: "#A855F7",
  crates: "#A855F7",
  target: "#A855F7",
  dist: "#A855F7",
  release: "#A855F7",
  node_modules: "#22C55E",
  docs: "#4EA8DE",
};

export const FolderIcon: React.FC<FolderIconProps> = ({
  folderName,
  isExpanded,
  size = 15,
  className = "",
}) => {
  const badge = FOLDER_BADGES[folderName.toLowerCase()];
  const stroke = { stroke: "#C5C5C5", strokeWidth: 1.1, strokeLinejoin: "round" as const };

  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      {isExpanded ? (
        <>
          <path d="M1.75 12.25V3.5a1 1 0 0 1 1-1h3.4l1.5 1.5h5.1a1 1 0 0 1 1 1v1.5" {...stroke} />
          <path d="M1.75 12.25l1.6-5.1a1 1 0 0 1 .95-.7h9.9a.7.7 0 0 1 .67.9l-1.45 4.6a1 1 0 0 1-.95.7H2.75z" {...stroke} />
        </>
      ) : (
        <path d="M1.75 3.5a1 1 0 0 1 1-1h3.4l1.5 1.5h5.6a1 1 0 0 1 1 1v7.25a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1V3.5z" {...stroke} />
      )}
      {badge && <circle cx="12.5" cy="12" r="2.6" fill={badge} stroke="#181818" strokeWidth="1" />}
    </svg>
  );
};
