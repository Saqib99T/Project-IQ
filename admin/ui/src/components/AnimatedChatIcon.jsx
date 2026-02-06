import React from 'react';

/**
 * Sophisticated animated chatbot icon with multiple animation effects
 * Features: Pulsing glow, floating particles, breathing effect, and wave animations
 */
const AnimatedChatIcon = ({ size = 56, className = '', isOpen = false, themeColor = null }) => {
    // Default to black if no theme color provided
    const primaryColor = themeColor || '#000000';
    const lighterColor = adjustBrightness(primaryColor, 30);
    const lightestColor = adjustBrightness(primaryColor, 50);

    // Helper function to adjust color brightness
    function adjustBrightness(hex, percent) {
        const num = parseInt(hex.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, Math.max(0, (num >> 16) + amt));
        const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
        const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
        return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
    }

    return (
        <div
            className={`chat-icon-container ${className} ${isOpen ? 'open' : ''}`}
            style={{
                width: size,
                height: size,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            {/* Ambient glow effect */}
            <div className="ambient-glow" style={{
                position: 'absolute',
                width: '120%',
                height: '120%',
                background: `radial-gradient(circle, ${primaryColor}80 0%, ${lighterColor}4D 40%, transparent 70%)`,
                borderRadius: '50%',
                filter: 'blur(12px)',
                animation: 'glowPulse 2.5s ease-in-out infinite',
                zIndex: -1,
            }}></div>

            {/* Floating particles */}
            <div className="particles" style={{ position: 'absolute', width: '100%', height: '100%', pointerEvents: 'none' }}>
                {[1, 2, 3, 4, 5].map((i) => (
                    <span
                        key={i}
                        className={`particle particle-${i}`}
                        style={{
                            position: 'absolute',
                            width: '4px',
                            height: '4px',
                            background: `linear-gradient(135deg, ${lightestColor}, ${primaryColor})`,
                            borderRadius: '50%',
                            opacity: 0,
                            animation: `floatParticle 3s ease-in-out infinite ${i * 0.4}s`,
                            left: `${20 + (i * 15)}%`,
                            top: `${10 + (i % 3) * 30}%`,
                        }}
                    />
                ))}
            </div>

            {/* Main SVG Icon */}
            <svg
                viewBox="0 0 100 100"
                style={{ width: '100%', height: '100%', position: 'relative', zIndex: 1 }}
                xmlns="http://www.w3.org/2000/svg"
            >
                {/* Definitions for gradients and filters */}
                <defs>
                    {/* Main gradient - using theme colors */}
                    <linearGradient id="chatIconGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={primaryColor} />
                        <stop offset="50%" stopColor={lighterColor} />
                        <stop offset="100%" stopColor={lightestColor} />
                    </linearGradient>

                    {/* Inner highlight */}
                    <radialGradient id="chatInnerGlow" cx="30%" cy="30%" r="50%">
                        <stop offset="0%" stopColor="rgba(255,255,255,0.4)" />
                        <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                    </radialGradient>

                    {/* Glow filter */}
                    <filter id="chatGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>

                    {/* Drop shadow */}
                    <filter id="chatShadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor={primaryColor} floodOpacity="0.5" />
                    </filter>
                </defs>

                {/* Main chat bubble */}
                <g filter="url(#chatShadow)">
                    <path
                        d="M50 10 C73 10 90 27 90 47 C90 67 73 84 50 84 C45 84 40 83 36 81 L20 90 L24 75 C15 69 10 58 10 47 C10 27 27 10 50 10 Z"
                        fill="url(#chatIconGradient)"
                        filter="url(#chatGlow)"
                    >
                        <animate
                            attributeName="d"
                            values="M50 10 C73 10 90 27 90 47 C90 67 73 84 50 84 C45 84 40 83 36 81 L20 90 L24 75 C15 69 10 58 10 47 C10 27 27 10 50 10 Z;
                      M50 8 C75 8 92 25 92 45 C92 65 75 82 50 82 C44 82 39 81 34 79 L18 88 L22 72 C13 66 8 56 8 45 C8 25 25 8 50 8 Z;
                      M50 10 C73 10 90 27 90 47 C90 67 73 84 50 84 C45 84 40 83 36 81 L20 90 L24 75 C15 69 10 58 10 47 C10 27 27 10 50 10 Z"
                            dur="3s"
                            repeatCount="indefinite"
                        />
                    </path>

                    {/* Inner highlight */}
                    <path
                        d="M50 14 C70 14 86 29 86 47 C86 52 85 56 83 60 C78 42 63 28 47 25 C48 18 49 14 50 14 Z"
                        fill="url(#chatInnerGlow)"
                    />
                </g>

                {/* Animated typing dots */}
                <g>
                    <circle cx="35" cy="50" r="5" fill="white">
                        <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" begin="0s" />
                        <animate attributeName="cy" values="50;44;50" dur="1.2s" repeatCount="indefinite" begin="0s" />
                    </circle>
                    <circle cx="50" cy="50" r="5" fill="white">
                        <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" begin="0.15s" />
                        <animate attributeName="cy" values="50;44;50" dur="1.2s" repeatCount="indefinite" begin="0.15s" />
                    </circle>
                    <circle cx="65" cy="50" r="5" fill="white">
                        <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" begin="0.3s" />
                        <animate attributeName="cy" values="50;44;50" dur="1.2s" repeatCount="indefinite" begin="0.3s" />
                    </circle>
                </g>

                {/* Rotating orbital ring */}
                <ellipse
                    cx="50"
                    cy="50"
                    rx="46"
                    ry="46"
                    fill="none"
                    stroke="url(#chatIconGradient)"
                    strokeWidth="1.5"
                    strokeDasharray="6 10"
                    opacity="0.6"
                >
                    <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from="0 50 50"
                        to="360 50 50"
                        dur="15s"
                        repeatCount="indefinite"
                    />
                </ellipse>
            </svg>

            {/* Pulse rings */}
            <div className="pulse-rings" style={{ position: 'absolute', width: '100%', height: '100%', pointerEvents: 'none' }}>
                {[1, 2, 3].map((i) => (
                    <span
                        key={i}
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            width: '100%',
                            height: '100%',
                            border: `2px solid ${primaryColor}66`,
                            borderRadius: '50%',
                            transform: 'translate(-50%, -50%) scale(1)',
                            opacity: 0,
                            animation: `pulseExpand 2.5s ease-out infinite ${(i - 1) * 0.8}s`,
                        }}
                    />
                ))}
            </div>

            {/* CSS Animations */}
            <style>{`
        @keyframes glowPulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.15); }
        }
        
        @keyframes floatParticle {
          0% { opacity: 0; transform: translateY(0) scale(0); }
          20% { opacity: 1; transform: translateY(-8px) scale(1); }
          80% { opacity: 1; transform: translateY(-25px) scale(1); }
          100% { opacity: 0; transform: translateY(-35px) scale(0); }
        }
        
        @keyframes pulseExpand {
          0% { transform: translate(-50%, -50%) scale(0.8); opacity: 0.7; }
          100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
        }
        
        .chat-icon-container {
          animation: breathe 3s ease-in-out infinite;
          cursor: pointer;
          transition: transform 0.3s ease;
        }
        
        .chat-icon-container:hover {
          transform: scale(1.1);
        }
        
        @keyframes breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        
        .chat-icon-container.open {
          animation: none;
        }
        
        @media (prefers-reduced-motion: reduce) {
          .chat-icon-container,
          .ambient-glow,
          .particle,
          .pulse-rings span {
            animation: none !important;
          }
        }
      `}</style>
        </div>
    );
};

export default AnimatedChatIcon;
