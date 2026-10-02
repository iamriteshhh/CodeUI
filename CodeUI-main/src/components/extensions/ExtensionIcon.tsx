import React from "react";

interface ExtensionIconProps {
  iconType?: string;
  iconUrl?: string;
  size?: number;
  className?: string;
}

export const ExtensionIcon: React.FC<ExtensionIconProps> = ({
  iconType,
  iconUrl,
  size = 36,
  className = "",
}) => {
  const [imgError, setImgError] = React.useState(false);

  // If live iconUrl is available and hasn't failed to load, render the actual image
  if (iconUrl && !imgError) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className={className}
        onError={() => setImgError(true)}
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          objectFit: "contain",
          flexShrink: 0,
        }}
      />
    );
  }

  switch (iconType) {
    // Claude - Terracotta Sunburst (matches Screenshot 3)
    case "claude":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <circle cx="24" cy="24" r="23" fill="#D97757" />
          <g stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round">
            {/* Center sunburst rays */}
            <line x1="24" y1="9" x2="24" y2="18" />
            <line x1="24" y1="30" x2="24" y2="39" />
            <line x1="9" y1="24" x2="18" y2="24" />
            <line x1="30" y1="24" x2="39" y2="24" />
            <line x1="13.4" y1="13.4" x2="19.8" y2="19.8" />
            <line x1="28.2" y1="28.2" x2="34.6" y2="34.6" />
            <line x1="34.6" y1="13.4" x2="28.2" y2="19.8" />
            <line x1="19.8" y1="28.2" x2="13.4" y2="34.6" />
            <line x1="16.5" y1="10.5" x2="21" y2="18.5" />
            <line x1="27" y1="29.5" x2="31.5" y2="37.5" />
            <line x1="31.5" y1="10.5" x2="27" y2="18.5" />
            <line x1="21" y1="29.5" x2="16.5" y2="37.5" />
            <line x1="10.5" y1="16.5" x2="18.5" y2="21" />
            <line x1="29.5" y1="27" x2="37.5" y2="31.5" />
            <line x1="10.5" y1="31.5" x2="18.5" y2="27" />
            <line x1="29.5" y1="21" x2="37.5" y2="16.5" />
          </g>
          <circle cx="24" cy="24" r="3.2" fill="#ffffff" />
        </svg>
      );

    // Salivo - Official Crimson & Carbon S-Blade Logo
    case "salivo":
      return (
        <svg width={size} height={size} viewBox="0 0 512 512" fill="none" className={className}>
          <defs>
            <linearGradient id="salivoCrimsonExt" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FF1A2A" />
              <stop offset="100%" stopColor="#D90416" />
            </linearGradient>
            <linearGradient id="salivoCarbonExt" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4A4A54" />
              <stop offset="100%" stopColor="#222226" />
            </linearGradient>
          </defs>
          <rect width="512" height="512" rx="88" fill="#08080A" />
          <polygon
            points="200,76 456,76 366,150 232,150 144,226 284,354 196,354 68,226"
            fill="url(#salivoCrimsonExt)"
          />
          <polygon
            points="312,436 56,436 146,362 280,362 368,286 228,158 316,158 444,286"
            fill="url(#salivoCarbonExt)"
          />
        </svg>
      );

    // clangd - C/C++ tooling
    case "clangd":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <rect width="48" height="48" rx="10" fill="#1C2536" />
          <path d="M34 16a13 13 0 1 0 0 16" stroke="#00D26A" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="34" cy="24" r="4" fill="#00D26A" />
        </svg>
      );

    // Docker
    case "docker":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <rect width="48" height="48" rx="10" fill="#0E2439" />
          <path d="M43.5 24c-.9 0-1.8.3-2.4.6-1.5-1.2-3.6-1.5-5.7-.9-.3-1.8-1.5-3.3-3.3-3.9l-.6-.3-.3.6c-.9 2.1-.9 4.5.3 6.6-1.2.6-2.7 1.5-3.9 2.4H3c-.9 0-1.8.6-2.1 1.5-.3 1.5.3 3.6 1.8 5.4 4.2 5.4 10.5 8.1 19.2 8.1 12.6 0 20.7-5.7 22.8-16.2 1.5-.3 2.4-1.8 1.8-3.3-.3-.3-.6-.6-3-.6z" fill="#2496ED" />
          <rect x="9" y="19" width="4.2" height="3.6" rx=".6" fill="#2496ED" />
          <rect x="15" y="19" width="4.2" height="3.6" rx=".6" fill="#2496ED" />
          <rect x="21" y="19" width="4.2" height="3.6" rx=".6" fill="#2496ED" />
          <rect x="15" y="14" width="4.2" height="3.6" rx=".6" fill="#2496ED" />
          <rect x="21" y="14" width="4.2" height="3.6" rx=".6" fill="#2496ED" />
          <rect x="27" y="19" width="4.2" height="3.6" rx=".6" fill="#2496ED" />
        </svg>
      );

    // Java
    case "java":
    case "java-pack":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <rect width="48" height="48" rx="10" fill="#261E1A" />
          <path d="M16 8c-1.5 3.5 1.5 6 0 9.5" stroke="#E76F51" strokeWidth="3" strokeLinecap="round" />
          <path d="M24 6c-2 4 2 7 0 10.5" stroke="#F4A261" strokeWidth="3" strokeLinecap="round" />
          <path d="M32 8c-1.5 3.5 1.5 6 0 9.5" stroke="#E76F51" strokeWidth="3" strokeLinecap="round" />
          <path d="M9 22h24c1 0 1.6.8 1.6 1.8v8c0 6-5 9-13.6 9S9 37.8 9 31.8v-8c0-1 .6-1.8 1.6-1.8z" fill="#5382A1" />
          <path d="M34.5 23.5h3.6a5.5 5.5 0 0 1 0 11H32" stroke="#5382A1" strokeWidth="3.5" />
          <path d="M7 43c6 3 24 3 32 0" stroke="#5382A1" strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      );

    // GitLens
    case "gitlens":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <rect width="48" height="48" rx="10" fill="#1A0D2E" />
          <circle cx="24" cy="24" r="16" stroke="#2B7AFF" strokeWidth="3" strokeDasharray="3 2" />
          <circle cx="24" cy="24" r="9" fill="#00D2FF" />
          <circle cx="24" cy="24" r="4.5" fill="#ffffff" />
        </svg>
      );

    // GitHub
    case "github":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <rect width="48" height="48" rx="10" fill="#161B22" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M24 8C15.2 8 8 15.2 8 24c0 7.1 4.6 13.1 11 15.2.8.1 1.1-.3 1.1-.8v-2.7c-4.5 1-5.4-2.1-5.4-2.1-.7-1.8-1.8-2.3-1.8-2.3-1.5-1 .1-1 .1-1 1.6.1 2.5 1.7 2.5 1.7 1.4 2.5 3.8 1.8 4.7 1.4.1-1.1.6-1.8 1-2.2-3.6-.4-7.3-1.8-7.3-8 0-1.8.6-3.2 1.7-4.3-.2-.4-.7-2 .2-4.2 0 0 1.4-.4 4.5 1.7 1.3-.4 2.7-.5 4.1-.5s2.8.2 4.1.5c3.1-2.1 4.5-1.7 4.5-1.7.9 2.2.4 3.8.2 4.2 1.1 1.1 1.7 2.5 1.7 4.3 0 6.2-3.7 7.6-7.3 8 .6.5 1.1 1.5 1.1 3v4.4c0 .5.3.9 1.1.8 6.4-2.1 11-8.1 11-15.2 0-8.8-7.2-16-16-16z"
            fill="#ffffff"
          />
        </svg>
      );

    // Go
    case "go":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <rect width="48" height="48" rx="10" fill="#007D9C" />
          <path d="M12 20h10v4h-6v6h8v4H12V20zm14 7c0-4 2.5-7 6.5-7s6.5 3 6.5 7-2.5 7-6.5 7-6.5-3-6.5-7zm8.5 0c0-2-.9-3.5-2-3.5s-2 1.5-2 3.5.9 3.5 2 3.5 2-1.5 2-3.5z" fill="#ffffff" />
        </svg>
      );

    // Python
    case "python":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <rect width="48" height="48" rx="10" fill="#1B2838" />
          <path d="M23.7 8.3c-9.3 0-8.7 3.9-8.7 3.9l.03 4.2h8.7v1.2H11.4S6 17 6 26.3s4.8 9 4.8 9h2.7v-4.2s-.3-4.8 4.8-4.8h8.4s4.5 0 4.5-4.5v-9.3s.6-4.2-7.5-4.2zm-4.5 2.7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" fill="#3776AB" />
          <path d="M24.3 39.7c9.3 0 8.7-3.9 8.7-3.9l-.03-4.2h-8.7v-1.2h12.3s5.4.6 5.4-8.7-4.8-9-4.8-9h-2.7v4.2s.3 4.8-4.8 4.8h-8.4s-4.5 0-4.5 4.5v9.3s-.6 4.2 7.5 4.2zm4.5-2.7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" fill="#FFD43B" />
        </svg>
      );

    // Rust
    case "rust":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <rect width="48" height="48" rx="10" fill="#2E1B15" />
          <circle cx="24" cy="24" r="18" stroke="#DEA584" strokeWidth="3" strokeDasharray="5 3" />
          <circle cx="24" cy="24" r="15" fill="#CE412B" />
          <path d="M18.5 16h6.6c2.4 0 4.2 1.2 4.2 3.6 0 1.8-1.2 3-3 3.3l3.6 8.1h-3.3L23.4 24h-1.8v7h-3.1V16zm3.1 5.1h3.3c.9 0 1.5-.6 1.5-1.5s-.6-1.5-1.5-1.5h-3.3v3z" fill="#ffffff" />
        </svg>
      );

    // Zig
    case "zig":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <rect width="48" height="48" rx="10" fill="#2B2113" stroke="#F7A41D" strokeWidth="1.5" />
          <path d="M10 15h26L13 33h25" stroke="#F7A41D" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    default:
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
          <rect width="48" height="48" rx="10" fill="#2D2D2D" />
          <path d="M16 16h16v16H16z" stroke="#007acc" strokeWidth="2.5" fill="none" />
        </svg>
      );
  }
};
