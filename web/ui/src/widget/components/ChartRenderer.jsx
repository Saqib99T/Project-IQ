import React from 'react';
import { motion } from 'framer-motion';

/**
 * ChartRenderer - Lightweight SVG-based chart component
 * Supports: line, bar, pie, area charts
 * Data format: { type, title, labels, datasets: [{ label, data, color }] }
 */
const ChartRenderer = ({ chartData }) => {
    if (!chartData) return null;

    const { type, title, labels = [], datasets = [], subtitle } = chartData;

    // Default colors matching the violet theme
    const defaultColors = [
        '#8B5CF6', '#6366F1', '#A855F7', '#EC4899',
        '#14B8A6', '#F59E0B', '#EF4444', '#10B981'
    ];

    // Chart dimensions
    const width = 320;
    const height = 200;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Calculate max value for scaling
    const allValues = datasets.flatMap(d => d.data);
    const maxValue = Math.max(...allValues, 1);
    const minValue = Math.min(...allValues, 0);
    const valueRange = maxValue - minValue || 1;

    // Scale helpers
    const scaleY = (value) => {
        const normalized = (value - minValue) / valueRange;
        return padding.top + chartHeight * (1 - normalized);
    };

    const scaleX = (index) => {
        const step = chartWidth / Math.max(labels.length - 1, 1);
        return padding.left + index * step;
    };

    // Generate Y-axis ticks
    const yTicks = Array.from({ length: 5 }, (_, i) => {
        const value = minValue + (valueRange * (4 - i)) / 4;
        return { value, y: scaleY(value) };
    });

    // Render Line Chart
    const renderLineChart = () => (
        <g>
            {/* Grid lines */}
            {yTicks.map((tick, i) => (
                <line
                    key={i}
                    x1={padding.left}
                    y1={tick.y}
                    x2={width - padding.right}
                    y2={tick.y}
                    stroke="rgba(255,255,255,0.1)"
                    strokeDasharray="4,4"
                />
            ))}

            {/* Y-axis labels */}
            {yTicks.map((tick, i) => (
                <text
                    key={i}
                    x={padding.left - 8}
                    y={tick.y + 4}
                    textAnchor="end"
                    fill="rgba(255,255,255,0.6)"
                    fontSize="10"
                >
                    {formatNumber(tick.value)}
                </text>
            ))}

            {/* X-axis labels */}
            {labels.map((label, i) => (
                <text
                    key={i}
                    x={scaleX(i)}
                    y={height - padding.bottom + 20}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.6)"
                    fontSize="10"
                >
                    {label}
                </text>
            ))}

            {/* Data lines */}
            {datasets.map((dataset, datasetIndex) => {
                const color = dataset.color || defaultColors[datasetIndex % defaultColors.length];
                const points = dataset.data.map((value, i) => ({
                    x: scaleX(i),
                    y: scaleY(value)
                }));

                const pathD = points
                    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                    .join(' ');

                // Area fill path
                const areaPath = `${pathD} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

                return (
                    <g key={datasetIndex}>
                        {/* Area fill */}
                        <motion.path
                            d={areaPath}
                            fill={`url(#gradient-${datasetIndex})`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 0.3 }}
                            transition={{ duration: 0.5 }}
                        />

                        {/* Gradient definition */}
                        <defs>
                            <linearGradient id={`gradient-${datasetIndex}`} x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor={color} stopOpacity="0.4" />
                                <stop offset="100%" stopColor={color} stopOpacity="0" />
                            </linearGradient>
                        </defs>

                        {/* Line */}
                        <motion.path
                            d={pathD}
                            fill="none"
                            stroke={color}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            filter="drop-shadow(0 0 4px rgba(139, 92, 246, 0.5))"
                        />

                        {/* Data points */}
                        {points.map((point, i) => (
                            <motion.circle
                                key={i}
                                cx={point.x}
                                cy={point.y}
                                r="4"
                                fill={color}
                                stroke="white"
                                strokeWidth="2"
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ delay: 0.5 + i * 0.1 }}
                            />
                        ))}
                    </g>
                );
            })}
        </g>
    );

    // Render Bar Chart
    const renderBarChart = () => {
        const barWidth = chartWidth / labels.length / (datasets.length + 1);
        const groupWidth = chartWidth / labels.length;

        return (
            <g>
                {/* Grid lines */}
                {yTicks.map((tick, i) => (
                    <g key={i}>
                        <line
                            x1={padding.left}
                            y1={tick.y}
                            x2={width - padding.right}
                            y2={tick.y}
                            stroke="rgba(255,255,255,0.1)"
                            strokeDasharray="4,4"
                        />
                        <text
                            x={padding.left - 8}
                            y={tick.y + 4}
                            textAnchor="end"
                            fill="rgba(255,255,255,0.6)"
                            fontSize="10"
                        >
                            {formatNumber(tick.value)}
                        </text>
                    </g>
                ))}

                {/* X-axis labels */}
                {labels.map((label, i) => (
                    <text
                        key={i}
                        x={padding.left + groupWidth * i + groupWidth / 2}
                        y={height - padding.bottom + 20}
                        textAnchor="middle"
                        fill="rgba(255,255,255,0.6)"
                        fontSize="10"
                    >
                        {label}
                    </text>
                ))}

                {/* Bars */}
                {datasets.map((dataset, datasetIndex) => {
                    const color = dataset.color || defaultColors[datasetIndex % defaultColors.length];

                    return dataset.data.map((value, i) => {
                        const barHeight = (value - minValue) / valueRange * chartHeight;
                        const x = padding.left + groupWidth * i + barWidth * (datasetIndex + 0.5);
                        const y = padding.top + chartHeight - barHeight;

                        return (
                            <motion.rect
                                key={`${datasetIndex}-${i}`}
                                x={x}
                                y={padding.top + chartHeight}
                                width={barWidth * 0.8}
                                height={0}
                                fill={color}
                                rx="4"
                                initial={{ y: padding.top + chartHeight, height: 0 }}
                                animate={{ y, height: barHeight }}
                                transition={{ duration: 0.5, delay: i * 0.1 }}
                                filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
                            />
                        );
                    });
                })}
            </g>
        );
    };

    // Render Pie Chart
    const renderPieChart = () => {
        if (!datasets[0]?.data) return null;

        const data = datasets[0].data;
        const total = data.reduce((sum, val) => sum + val, 0);
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(chartWidth, chartHeight) / 2 - 10;

        let startAngle = -Math.PI / 2;

        return (
            <g>
                {data.map((value, i) => {
                    const angle = (value / total) * Math.PI * 2;
                    const endAngle = startAngle + angle;
                    const color = defaultColors[i % defaultColors.length];

                    // Arc path
                    const x1 = centerX + radius * Math.cos(startAngle);
                    const y1 = centerY + radius * Math.sin(startAngle);
                    const x2 = centerX + radius * Math.cos(endAngle);
                    const y2 = centerY + radius * Math.sin(endAngle);
                    const largeArc = angle > Math.PI ? 1 : 0;

                    const pathD = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

                    // Label position
                    const midAngle = startAngle + angle / 2;
                    const labelRadius = radius * 0.7;
                    const labelX = centerX + labelRadius * Math.cos(midAngle);
                    const labelY = centerY + labelRadius * Math.sin(midAngle);

                    const result = (
                        <g key={i}>
                            <motion.path
                                d={pathD}
                                fill={color}
                                stroke="rgba(15, 23, 42, 0.8)"
                                strokeWidth="2"
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ duration: 0.5, delay: i * 0.1 }}
                                style={{ transformOrigin: `${centerX}px ${centerY}px` }}
                                filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
                            />
                            {angle > 0.3 && (
                                <motion.text
                                    x={labelX}
                                    y={labelY}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fill="white"
                                    fontSize="11"
                                    fontWeight="bold"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.5 + i * 0.1 }}
                                >
                                    {Math.round((value / total) * 100)}%
                                </motion.text>
                            )}
                        </g>
                    );

                    startAngle = endAngle;
                    return result;
                })}

                {/* Legend */}
                <g transform={`translate(${width - 80}, 20)`}>
                    {labels.map((label, i) => (
                        <g key={i} transform={`translate(0, ${i * 18})`}>
                            <rect x="0" y="0" width="12" height="12" rx="2" fill={defaultColors[i % defaultColors.length]} />
                            <text x="18" y="10" fill="rgba(255,255,255,0.8)" fontSize="10">{label}</text>
                        </g>
                    ))}
                </g>
            </g>
        );
    };

    // Number formatter
    const formatNumber = (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return Math.round(num).toString();
    };

    // Select chart renderer
    const renderChart = () => {
        switch (type?.toLowerCase()) {
            case 'line':
            case 'area':
                return renderLineChart();
            case 'bar':
                return renderBarChart();
            case 'pie':
            case 'donut':
                return renderPieChart();
            default:
                return renderLineChart();
        }
    };

    return (
        <motion.div
            className="chart-container my-3 p-3 rounded-xl bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-sm border border-white/10"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            {/* Title */}
            {title && (
                <div className="mb-2">
                    <h3 className="text-white font-semibold text-sm">{title}</h3>
                    {subtitle && <p className="text-gray-400 text-xs">{subtitle}</p>}
                </div>
            )}

            {/* Chart SVG */}
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full h-auto"
                style={{ maxHeight: '220px' }}
            >
                {renderChart()}
            </svg>

            {/* Legend for line/bar charts */}
            {type !== 'pie' && datasets.length > 1 && (
                <div className="flex flex-wrap gap-3 mt-2 justify-center">
                    {datasets.map((dataset, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                            <span
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: dataset.color || defaultColors[i % defaultColors.length] }}
                            />
                            <span className="text-xs text-gray-300">{dataset.label}</span>
                        </div>
                    ))}
                </div>
            )}
        </motion.div>
    );
};

export default ChartRenderer;
