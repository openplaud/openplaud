"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format-duration";
import { cn } from "@/lib/utils";

interface WaveformProps {
    peaks: number[];
    /** Current playback position in [0, 1]. */
    progress: number;
    /** Total audio length in seconds, for aria-valuetext + hover tooltip. */
    durationSeconds: number;
    /** Disable click/drag seek (e.g. while audio is not loaded yet). */
    disabled?: boolean;
    /**
     * Called with a new progress value in [0, 1] on click or drag.
     * Mirrors the existing Slider API the player previously used so the
     * caller doesn't need a second seek branch.
     */
    onSeek: (next: number) => void;
    className?: string;
    /** Pixel height of the rendered canvas. */
    height?: number;
}

// Visual tuning constants. Pulled out of the render loop so the
// component reads as "geometry + state", not "magic numbers".
const TARGET_BAR_WIDTH_PX = 3; // ideal opaque bar width
const TARGET_BAR_GAP_PX = 2; // ideal gap between bars
const MIN_VISIBLE_BARS = 32; // never collapse below this
const MAX_VISIBLE_BARS = 220; // never exceed this (perf + aesthetics)
const CENTER_DEAD_ZONE_PX = 1; // gap between top and bottom mirror halves
const MIN_BAR_HEIGHT_FRAC = 0.04; // silence still reads as a faint line
const PLAYHEAD_WIDTH_PX = 2;
const PLAYHEAD_GLOW_PX = 6;
const UNPLAYED_ALPHA = 0.35; // soften the unplayed half visually
const HOVER_LINE_ALPHA = 0.55;

// Thin alias so the JSX still reads as "format the second-position";
// shared helper lives in @/lib/format-duration and now supports hours.
const formatSeconds = formatDuration;

/**
 * Aggregate the stored high-resolution peaks (~500) into N visible
 * buckets by taking the max amplitude per bucket. This is the right
 * operation visually: we want the loudest moment of each ~50ms slice
 * to be the bar's height, not the average (which mushes out spikes).
 */
function aggregatePeaks(peaks: number[], visibleBars: number): number[] {
    if (visibleBars >= peaks.length) return peaks.slice();
    const out = new Array<number>(visibleBars);
    const ratio = peaks.length / visibleBars;
    for (let i = 0; i < visibleBars; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
        let peak = 0;
        for (let j = start; j < end && j < peaks.length; j++) {
            if (peaks[j] > peak) peak = peaks[j];
        }
        out[i] = peak;
    }
    return out;
}

/**
 * Compute the number of visible bars from container width. Honors the
 * target bar+gap rhythm and clamps to a sane range so very wide screens
 * don't melt under thousands of rect() calls and very narrow ones still
 * have enough resolution to recognize speech vs. silence.
 */
function computeVisibleBars(cssWidth: number): number {
    const slot = TARGET_BAR_WIDTH_PX + TARGET_BAR_GAP_PX;
    const raw = Math.floor(cssWidth / slot);
    return Math.max(MIN_VISIBLE_BARS, Math.min(MAX_VISIBLE_BARS, raw));
}

/**
 * Browser-compat helper: roundRect was added to Canvas2D recently. Fall
 * back to a plain fillRect on engines that lack it. The visual delta is
 * 1-2 px of corner rounding — gracefully imperceptible when missing.
 */
function fillBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
) {
    const ctxAny = ctx as CanvasRenderingContext2D & {
        roundRect?: (
            x: number,
            y: number,
            w: number,
            h: number,
            radii: number | number[],
        ) => void;
    };
    if (typeof ctxAny.roundRect === "function") {
        ctx.beginPath();
        ctxAny.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
        ctx.fill();
    } else {
        ctx.fillRect(x, y, w, h);
    }
}

export function Waveform({
    peaks,
    progress,
    durationSeconds,
    disabled = false,
    onSeek,
    className,
    height = 56,
}: WaveformProps) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDraggingRef = useRef(false);
    const [hoverRatio, setHoverRatio] = useState<number | null>(null);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = wrap.clientWidth;
        const cssHeight = height;
        canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
        canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssWidth, cssHeight);

        // Read theme tokens at paint time so dark mode + theme switcher
        // get the right colors without any JS theme awareness.
        const styles = getComputedStyle(wrap);
        const primary =
            styles.getPropertyValue("--primary").trim() ||
            "oklch(0.6171 0.1375 39.0427)";
        const muted =
            styles.getPropertyValue("--muted-foreground").trim() ||
            "rgba(0,0,0,0.5)";

        if (peaks.length === 0) return;

        const visibleBars = computeVisibleBars(cssWidth);
        const bars = aggregatePeaks(peaks, visibleBars);

        const slotWidth = cssWidth / visibleBars;
        const barWidth = Math.max(1, slotWidth - TARGET_BAR_GAP_PX);
        const centerY = cssHeight / 2;
        const halfMax = (cssHeight - CENTER_DEAD_ZONE_PX) / 2;
        const minHalfHeight = halfMax * MIN_BAR_HEIGHT_FRAC;
        const radius = Math.min(barWidth / 2, 2);

        const playedX = progress * cssWidth;

        for (let i = 0; i < visibleBars; i++) {
            const x = i * slotWidth + (slotWidth - barWidth) / 2;
            const p = bars[i] ?? 0;
            const halfH = Math.max(minHalfHeight, p * halfMax);

            // A bar belongs to "played" if its center is left of the playhead.
            const barCenter = x + barWidth / 2;
            const played = barCenter <= playedX;

            if (played) {
                ctx.fillStyle = primary;
                ctx.globalAlpha = 1;
            } else {
                ctx.fillStyle = muted;
                ctx.globalAlpha = UNPLAYED_ALPHA;
            }

            // Top half (mirrored upwards from centerline + dead zone)
            const topY = centerY - CENTER_DEAD_ZONE_PX / 2 - halfH;
            fillBar(ctx, x, topY, barWidth, halfH, radius);
            // Bottom half
            const botY = centerY + CENTER_DEAD_ZONE_PX / 2;
            fillBar(ctx, x, botY, barWidth, halfH, radius);
        }

        ctx.globalAlpha = 1;

        // Hover preview: faint vertical line at pointer position. Drawn
        // before the playhead so the (stronger) playhead overlaps cleanly
        // when hover ≈ progress.
        if (
            hoverRatio !== null &&
            !disabled &&
            Math.abs(hoverRatio - progress) > 0.001
        ) {
            const hx = hoverRatio * cssWidth;
            ctx.save();
            ctx.globalAlpha = HOVER_LINE_ALPHA;
            ctx.fillStyle = muted;
            ctx.fillRect(Math.floor(hx), 0, 1, cssHeight);
            ctx.restore();
        }

        // Playhead: subtle outer glow + crisp inner line. Drawn in
        // primary color regardless of played/unplayed so it's always
        // findable. Skip when at the extreme edges to avoid clipping.
        if (progress > 0 && progress < 1) {
            ctx.save();
            // Glow halo
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = primary;
            ctx.fillRect(
                Math.floor(playedX) - PLAYHEAD_GLOW_PX / 2,
                0,
                PLAYHEAD_GLOW_PX,
                cssHeight,
            );
            // Crisp center
            ctx.globalAlpha = 1;
            ctx.fillRect(
                Math.floor(playedX) - PLAYHEAD_WIDTH_PX / 2,
                0,
                PLAYHEAD_WIDTH_PX,
                cssHeight,
            );
            ctx.restore();
        }
    }, [peaks, progress, height, hoverRatio, disabled]);

    // Initial + prop-driven repaint.
    useEffect(() => {
        draw();
    }, [draw]);

    // Resize-driven repaint.
    useEffect(() => {
        const wrap = wrapRef.current;
        if (!wrap || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => draw());
        ro.observe(wrap);
        return () => ro.disconnect();
    }, [draw]);

    const ratioFromClientX = useCallback((clientX: number) => {
        const wrap = wrapRef.current;
        if (!wrap) return 0;
        const rect = wrap.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
        return rect.width > 0 ? x / rect.width : 0;
    }, []);

    const onPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (disabled) return;
            isDraggingRef.current = true;
            // Capture on `currentTarget` (the wrapper div that owns the
            // pointer handlers), not `e.target` — the user might press
            // on the inner <canvas>, which would still capture but only
            // until the canvas is removed from the tree, and would also
            // stop working the day we add e.g. an absolute-positioned
            // tooltip child that swallows the pointer event.
            e.currentTarget.setPointerCapture(e.pointerId);
            const r = ratioFromClientX(e.clientX);
            setHoverRatio(r);
            onSeek(r);
        },
        [disabled, ratioFromClientX, onSeek],
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (disabled) return;
            // Touch pointers don't get hover-style preview — they're
            // already committed to a drag the moment they land.
            if (e.pointerType !== "touch") {
                setHoverRatio(ratioFromClientX(e.clientX));
            }
            if (isDraggingRef.current) {
                onSeek(ratioFromClientX(e.clientX));
            }
        },
        [disabled, ratioFromClientX, onSeek],
    );

    const onPointerUp = useCallback(() => {
        isDraggingRef.current = false;
    }, []);

    const onPointerLeave = useCallback(() => {
        setHoverRatio(null);
    }, []);

    // Keyboard support: role="slider" promises it, we deliver. The
    // player owns global ←/→ (±5 s) when focus is *outside* an
    // interactive element; here on the focused waveform the smaller
    // 1%/5% step matches typical slider expectations.
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (disabled) return;
            const step = e.shiftKey ? 0.05 : 0.01;
            switch (e.key) {
                case "ArrowLeft":
                    e.preventDefault();
                    onSeek(Math.max(0, progress - step));
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    onSeek(Math.min(1, progress + step));
                    break;
                case "Home":
                    e.preventDefault();
                    onSeek(0);
                    break;
                case "End":
                    e.preventDefault();
                    onSeek(1);
                    break;
            }
        },
        [disabled, progress, onSeek],
    );

    // Hover timestamp tooltip. Pure DOM (not canvas) so it inherits
    // typography + DPR scaling for free, and so screen readers can pick
    // up the live region if they want to.
    const tooltipRatio = hoverRatio;
    const tooltipVisible =
        tooltipRatio !== null &&
        !disabled &&
        durationSeconds > 0 &&
        Number.isFinite(durationSeconds);
    const tooltipSeconds = tooltipVisible
        ? (tooltipRatio as number) * durationSeconds
        : 0;
    const tooltipLeftPct = tooltipVisible
        ? Math.max(0, Math.min(100, (tooltipRatio as number) * 100))
        : 0;

    return (
        <div
            ref={wrapRef}
            className={cn(
                "relative w-full select-none touch-none",
                disabled
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm",
                className,
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
            onKeyDown={onKeyDown}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="Audio waveform scrubber"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-valuetext={`${formatSeconds(progress * durationSeconds)} of ${formatSeconds(durationSeconds)}`}
            aria-disabled={disabled || undefined}
            style={{ height }}
        >
            <canvas ref={canvasRef} />
            {tooltipVisible && (
                <div
                    className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 font-mono text-[11px] text-background shadow-md"
                    style={{ left: `${tooltipLeftPct}%` }}
                    aria-hidden="true"
                >
                    {formatSeconds(tooltipSeconds)}
                </div>
            )}
        </div>
    );
}
