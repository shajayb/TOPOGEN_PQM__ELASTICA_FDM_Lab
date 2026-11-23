// ============================================================================
// compositor_layout_helpers.h
// Reusable C++20 / GDI+ / Media Foundation Compositional & Typography Helpers
// Synthesized from Explainer Film (R1-R13) & ALICE 3.0 Show-Reel (R14-R19)
// ============================================================================
#pragma once

#include <windows.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
using std::min;
using std::max;
#include <gdiplus.h>

namespace alice::video_skill {

// Unified Deep Obsidian Dark Architectural Canvas (#070A10)
static constexpr uint8_t OBSIDIAN_R = 7;
static constexpr uint8_t OBSIDIAN_G = 10;
static constexpr uint8_t OBSIDIAN_B = 16;

// Layout Safe-Zone Constants (1920x1080 1K Reference Coordinates)
static constexpr float LEFT_MARGIN_X       = 40.0f;  // REV-10A..C: All overlay text aligns here
static constexpr float TITLE_Y             = 32.0f;  // 26 pt Bold White Headline
static constexpr float SUBTITLE_Y          = 66.0f;  // 18 pt Silver Subtitle (34 px single-line pitch)
static constexpr float BULLET_START_Y      = 104.0f; // 17.5 pt Short 2-4 Word Bullets
static constexpr float BULLET_PITCH_Y      = 28.0f;  // Tight single-line spacing, zero secondary sub-lines
static constexpr float VIEWPORT_SAFE_TOP_Y = 140.0f; // 3D/2D active geometry top clearance
static constexpr float VIEWPORT_SAFE_BOT_Y = 845.0f; // 3D/2D active geometry bottom clearance
static constexpr float CAPTION_MAX_Y       = 858.0f; // Last allowed line of text
static constexpr float SEEKBAR_PROTECTED_Y = 900.0f; // REV-10B: 0% text allowed in y = 900..1080

// 1. Un-Boxed Direct Typography with Soft 2-Pass Halo Drop-Shadow (REV-09D)
inline void drawUnboxedText(Gdiplus::Graphics& g,
                            const wchar_t* text,
                            float x, float y,
                            float ptSize,
                            bool bold,
                            Gdiplus::Color fgColor = Gdiplus::Color(255, 248, 250, 252),
                            const wchar_t* family = L"Segoe UI") {
    if (!text || !text[0]) return;
    Gdiplus::Font font(family, ptSize,
                       bold ? Gdiplus::FontStyleBold : Gdiplus::FontStyleRegular,
                       Gdiplus::UnitPoint);
    Gdiplus::StringFormat fmt(Gdiplus::StringFormat::GenericTypographic());
    fmt.SetFormatFlags(Gdiplus::StringFormatFlagsNoWrap);

    // Outer & inner dark drop-shadow passes (zero pill boxes or borders!)
    Gdiplus::SolidBrush shadowOuter(Gdiplus::Color(180, 4, 6, 10));
    Gdiplus::SolidBrush shadowInner(Gdiplus::Color(235, 4, 6, 10));
    Gdiplus::SolidBrush fgBrush(fgColor);

    g.DrawString(text, -1, &font, Gdiplus::PointF(x + 2.5f, y + 2.5f), &fmt, &shadowOuter);
    g.DrawString(text, -1, &font, Gdiplus::PointF(x + 1.2f, y + 1.2f), &fmt, &shadowInner);
    g.DrawString(text, -1, &font, Gdiplus::PointF(x, y), &fmt, &fgBrush);
}

// 2. Left-Aligned Single-Spaced Stage Header & Short Bullet Stack (REV-10A..C)
inline void drawLeftAlignedStageHeader(Gdiplus::Graphics& g,
                                       const wchar_t* title,
                                       const wchar_t* subtitle,
                                       const wchar_t* const* bullets = nullptr,
                                       int bulletCount = 0,
                                       float scale = 1.0f,
                                       bool lightCanvas = false) {
    const Gdiplus::Color titleCol = lightCanvas
        ? Gdiplus::Color(255, 15, 23, 42)
        : Gdiplus::Color(255, 248, 250, 252);
    const Gdiplus::Color subCol = lightCanvas
        ? Gdiplus::Color(255, 71, 85, 105)
        : Gdiplus::Color(255, 203, 213, 225);

    drawUnboxedText(g, title, LEFT_MARGIN_X * scale, TITLE_Y * scale,
                    26.0f * scale, true, titleCol);
    if (subtitle && subtitle[0]) {
        drawUnboxedText(g, subtitle, LEFT_MARGIN_X * scale, SUBTITLE_Y * scale,
                        18.0f * scale, false, subCol);
    }
    for (int i = 0; i < bulletCount && i < 4; ++i) {
        if (!bullets[i] || !bullets[i][0]) continue;
        const float by = (BULLET_START_Y + i * BULLET_PITCH_Y) * scale;
        drawUnboxedText(g, bullets[i], LEFT_MARGIN_X * scale, by,
                        17.5f * scale, false, titleCol);
    }
}

// 3. Pure-Black 18-Frame (0.60 s) Chapter Title Card (R12-03, REV-02A)
//    Calibri 44 pt Bold Italic ALL CAPS + Calibri 22 pt Italic Subtitle
inline void drawPureBlackChapterCard(Gdiplus::Graphics& g,
                                     int outW, int outH,
                                     const wchar_t* chapterAllCapsTitle,
                                     const wchar_t* conciseSubtitle) {
    Gdiplus::SolidBrush blackBg(Gdiplus::Color(255, 5, 6, 8));
    g.FillRectangle(&blackBg, 0, 0, outW, outH);

    const float sc = outW / 1920.0f;
    Gdiplus::Font titleFont(L"Calibri", 44.0f * sc,
                            Gdiplus::FontStyleBoldItalic, Gdiplus::UnitPoint);
    Gdiplus::Font subFont(L"Calibri", 22.0f * sc,
                          Gdiplus::FontStyleItalic, Gdiplus::UnitPoint);

    Gdiplus::SolidBrush whiteBr(Gdiplus::Color(255, 255, 255, 255));
    Gdiplus::SolidBrush cyanBr(Gdiplus::Color(255, 56, 189, 248));

    g.DrawString(chapterAllCapsTitle, -1, &titleFont,
                 Gdiplus::PointF(120.0f * sc, 455.0f * sc), &whiteBr);
    g.DrawString(conciseSubtitle, -1, &subFont,
                 Gdiplus::PointF(120.0f * sc, 535.0f * sc), &cyanBr);
}

// 4. Strict 1:1 Isotropic Aspect-Ratio Blit + White-on-Black 2D CAD Inversion (REV-09B, REV-09C)
inline void blitIsotropicWhiteOnBlack2DDrawing(uint32_t* dstBGRA, int dstW, int dstH,
                                               const uint32_t* srcBGRA, int srcW, int srcH,
                                               int cropX, int cropY, int cropW, int cropH,
                                               int slotX, int slotY, int slotW, int slotH,
                                               bool invertPaperToObsidian = true) {
    const double scale = std::min(static_cast<double>(slotW) / cropW,
                                  static_cast<double>(slotH) / cropH); // scaleX == scaleY!
    const int blitW = static_cast<int>(std::round(cropW * scale));
    const int blitH = static_cast<int>(std::round(cropH * scale));
    const int ox = slotX + (slotW - blitW) / 2;
    const int oy = slotY + (slotH - blitH) / 2;

    for (int dy = 0; dy < blitH; ++dy) {
        const int ty = oy + dy;
        if (ty < 0 || ty >= dstH) continue;
        const int sy = std::clamp(cropY + static_cast<int>(dy / scale), 0, srcH - 1);
        for (int dx = 0; dx < blitW; ++dx) {
            const int tx = ox + dx;
            if (tx < 0 || tx >= dstW) continue;
            const int sx = std::clamp(cropX + static_cast<int>(dx / scale), 0, srcW - 1);

            const uint32_t px = srcBGRA[sy * srcW + sx];
            uint8_t b = (px >> 0) & 0xFF;
            uint8_t g = (px >> 8) & 0xFF;
            uint8_t r = (px >> 16) & 0xFF;

            if (invertPaperToObsidian) {
                // Convert white paper (#FAF8F5) to deep obsidian (#070A10)
                // and dark ink lines to crisp white/silver-cyan while preserving azure/emerald tints
                const int lum = (r * 77 + g * 150 + b * 29) >> 8;
                const int ink = std::clamp(250 - lum, 0, 255);
                r = static_cast<uint8_t>(std::clamp(OBSIDIAN_R + (ink * 241) / 255, 0, 255));
                g = static_cast<uint8_t>(std::clamp(OBSIDIAN_G + (ink * 244) / 255, 0, 255));
                b = static_cast<uint8_t>(std::clamp(OBSIDIAN_B + (ink * 248) / 255, 0, 255));
            }
            dstBGRA[ty * dstW + tx] = (0xFFu << 24) | (uint32_t(r) << 16) | (uint32_t(g) << 8) | uint32_t(b);
        }
    }
}

// 5. Seamless Full-Width Background-Matched HUD Mask (REV-11B)
//    Never draw a partial grey patch rectangle; mask full 0..dstW width in exact canvas color.
inline void maskTopHudFullWidth(uint32_t* dstBGRA, int dstW, int dstH,
                                int maskHeightPx,
                                uint8_t bgR, uint8_t bgG, uint8_t bgB) {
    const uint32_t bgPx = (0xFFu << 24) | (uint32_t(bgR) << 16) | (uint32_t(bgG) << 8) | uint32_t(bgB);
    const int h = std::clamp(maskHeightPx, 0, dstH);
    for (int y = 0; y < h; ++y) {
        uint32_t* row = dstBGRA + y * dstW;
        for (int x = 0; x < dstW; ++x) row[x] = bgPx;
    }
}

// 6. Calm Non-Pulsing Architectural CAD Leader Callout (REV-10D, REV-10E)
inline void drawCalmCadLeader(Gdiplus::Graphics& g,
                              float anchorX, float anchorY,
                              float elbowX, float elbowY,
                              float labelEndX,
                              const wchar_t* label,
                              float scale = 1.0f) {
    Gdiplus::Pen leaderPen(Gdiplus::Color(230, 248, 250, 252), 1.5f * scale);
    Gdiplus::SolidBrush dotBr(Gdiplus::Color(255, 56, 189, 248));

    const float r = 4.5f * scale;
    g.FillEllipse(&dotBr, anchorX - r, anchorY - r, 2.0f * r, 2.0f * r);
    g.DrawEllipse(&leaderPen, anchorX - 1.8f * r, anchorY - 1.8f * r, 3.6f * r, 3.6f * r);
    g.DrawLine(&leaderPen, anchorX, anchorY, elbowX, elbowY);
    g.DrawLine(&leaderPen, elbowX, elbowY, labelEndX, elbowY);

    const float textX = (labelEndX >= elbowX) ? (elbowX + 6.0f * scale) : (labelEndX + 4.0f * scale);
    drawUnboxedText(g, label, textX, elbowY - 24.0f * scale, 16.0f * scale, true);
}

} // namespace alice::video_skill
