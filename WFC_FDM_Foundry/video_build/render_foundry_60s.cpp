#define UNICODE
#define _UNICODE
#include <windows.h>
#include <algorithm>
using std::min;
using std::max;
#include <gdiplus.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>

#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "foundry_video_data.hpp"

using namespace Gdiplus;

static constexpr int OUT_W = 1920;
static constexpr int OUT_H = 1080;
static constexpr int FPS = 30;
static constexpr int TOTAL_FRAMES = 1800; // 60.00 seconds exact
static constexpr UINT32 BITRATE = 22000000; // 22 Mbps H.264 1K Full HD
static constexpr float PI = 3.14159265358979323846f;

// Exact chapter start frames synced 1:1 with storyboard_foundry_60s.md (Gate S1)
static constexpr int CH_START[8] = {0, 60, 210, 690, 900, 1260, 1620, 1800};

// ============================================================
//  MATH & 3D ISOTROPIC CAMERA HELPERS (Z-up right-handed, scaleX == scaleY)
// ============================================================
struct V3 {
    float x, y, z;
    V3 operator+(const V3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    V3 operator-(const V3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    V3 operator*(float s) const { return {x * s, y * s, z * s}; }
};
static inline V3 toV3(const Vec3& v) { return {v.x, v.y, v.z}; }
static inline float dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
static inline float vlen(V3 a) { return std::sqrt(dot(a, a)); }
static inline V3 vnorm(V3 a) { float l = vlen(a); return l > 1e-7f ? a * (1.0f / l) : V3{0, 0, 1}; }
static inline float clamp01(float x) { return x < 0.f ? 0.f : (x > 1.f ? 1.f : x); }
static inline float smoothstep(float x) { x = clamp01(x); return x * x * (3.0f - 2.0f * x); }
static inline float lerpf(float a, float b, float t) { return a + (b - a) * t; }
static inline V3 lerp3(V3 a, V3 b, float t) { return a * (1.0f - t) + b * t; }

struct Cam {
    V3 eye, target, right, up, fwd;
    float cx, cy, fpx; // Single fpx enforces exact 1:1 isotropic aspect ratio (scaleX == scaleY)
    void setup(float azim, float elev, float dist, V3 tgt, float viewCx, float viewCy, float focalPx) {
        target = tgt;
        cx = viewCx; cy = viewCy; fpx = focalPx;
        eye = {
            tgt.x + dist * std::cos(elev) * std::cos(azim),
            tgt.y + dist * std::cos(elev) * std::sin(azim),
            tgt.z + dist * std::sin(elev)
        };
        fwd = vnorm(tgt - eye);
        V3 worldUp = {0, 0, 1};
        right = vnorm(cross(fwd, worldUp));
        up = vnorm(cross(right, fwd));
    }
    bool project(V3 p, float& sx, float& sy, float& depth) const {
        V3 d = p - eye;
        depth = dot(d, fwd);
        if (depth < 0.05f) return false;
        sx = cx + (dot(d, right) / depth) * fpx;
        sy = cy - (dot(d, up) / depth) * fpx;
        return true;
    }
};

// ============================================================
//  GDI+ TYPOGRAPHY & ARCHITECTURAL CAD PRIMITIVES
// ============================================================
static void drawShadowText(Graphics& g, const std::wstring& txt, const Font& font, float x, float y, Color col, StringAlignment align = StringAlignmentNear) {
    // Hard safety guard: never render any text in the protected seekbar zone (y > 900)
    if (y > 882.0f) y = 882.0f;
    StringFormat sf;
    sf.SetAlignment(align);
    sf.SetLineAlignment(StringAlignmentNear);
    SolidBrush sh(Color(215, 3, 5, 10));
    SolidBrush br(col);
    g.DrawString(txt.c_str(), -1, &font, PointF(x + 2.0f, y + 2.0f), &sf, &sh);
    g.DrawString(txt.c_str(), -1, &font, PointF(x, y), &sf, &br);
}

static void drawHeaderLeft(Graphics& g, const std::wstring& title, const std::wstring& subtitle, const std::vector<std::wstring>& bullets = {}) {
    // Subtle frameless top-left scrim onto #070A10 (zero rectangle-in-rectangle chrome!)
    LinearGradientBrush scrim(Point(0, 0), Point(0, 205), Color(165, 7, 10, 16), Color(0, 7, 10, 16));
    g.FillRectangle(&scrim, 0, 0, OUT_W, 205);

    Font fTitle(L"Calibri", 26.0f, FontStyleBold, UnitPoint);
    Font fSub(L"Calibri", 18.0f, FontStyleRegular, UnitPoint);
    Font fBul(L"Calibri", 17.0f, FontStyleRegular, UnitPoint);
    drawShadowText(g, title, fTitle, 40.0f, 32.0f, Color(255, 248, 250, 252));
    drawShadowText(g, subtitle, fSub, 40.0f, 68.0f, Color(255, 203, 213, 225));
    float by = 106.0f;
    for (const auto& b : bullets) {
        drawShadowText(g, L"\u2022  " + b, fBul, 40.0f, by, Color(240, 226, 232, 240));
        by += 28.0f;
    }
}

static void drawChapterCard(Graphics& g, const std::wstring& headline, const std::wstring& subtitle, float alpha01) {
    SolidBrush bg(Color(255, 5, 6, 8));
    g.FillRectangle(&bg, 0, 0, OUT_W, OUT_H);
    BYTE a = (BYTE)(clamp01(alpha01) * 255.0f);
    Font fHead(L"Calibri", 44.0f, FontStyleBoldItalic, UnitPoint);
    Font fSub(L"Calibri", 22.0f, FontStyleItalic, UnitPoint);
    StringFormat sf;
    sf.SetAlignment(StringAlignmentNear);
    SolidBrush b1(Color(a, 255, 255, 255));
    SolidBrush b2(Color(a, 56, 189, 248));
    g.DrawString(headline.c_str(), -1, &fHead, PointF(140.0f, 430.0f), &sf, &b1);
    g.DrawString(subtitle.c_str(), -1, &fSub, PointF(144.0f, 515.0f), &sf, &b2);
}

static void drawCalmCadLeader(Graphics& g, float tx, float ty, float lx, float ly, const std::wstring& label, Color accent = Color(255, 248, 250, 252)) {
    Pen ringPen(Color(225, 248, 250, 252), 1.6f);
    g.DrawEllipse(&ringPen, tx - 5.0f, ty - 5.0f, 10.0f, 10.0f);
    Pen linePen(Color(195, 203, 213, 225), 1.5f);
    float elbowX = (lx > tx) ? (lx - 18.0f) : (lx + 18.0f);
    g.DrawLine(&linePen, tx, ty, elbowX, ly + 10.0f);
    g.DrawLine(&linePen, elbowX, ly + 10.0f, lx, ly + 10.0f);
    Font fLbl(L"Calibri", 15.0f, FontStyleBold, UnitPoint);
    StringAlignment align = (lx >= tx) ? StringAlignmentNear : StringAlignmentFar;
    drawShadowText(g, label, fLbl, lx + (lx >= tx ? 6.0f : -6.0f), ly - 2.0f, accent, align);
}

static void drawGroundGrid(Graphics& g, const Cam& cam, float halfSpan = 0.62f, int steps = 4) {
    Pen pGrid(Color(44, 148, 163, 184), 1.0f);
    Pen pEnv(Color(82, 148, 163, 184), 1.2f);
    for (int i = -steps; i <= steps; ++i) {
        float t = (float)i / steps * halfSpan;
        float x1, y1, d1, x2, y2, d2;
        if (cam.project({t, -halfSpan, 0}, x1, y1, d1) && cam.project({t, halfSpan, 0}, x2, y2, d2))
            g.DrawLine(&pGrid, x1, y1, x2, y2);
        if (cam.project({-halfSpan, t, 0}, x1, y1, d1) && cam.project({halfSpan, t, 0}, x2, y2, d2))
            g.DrawLine(&pGrid, x1, y1, x2, y2);
    }
    // Exact 1.0 x 1.0 m brief plan envelope on ground plane z = 0
    V3 sq[4] = {{-0.5f,-0.5f,0}, {0.5f,-0.5f,0}, {0.5f,0.5f,0}, {-0.5f,0.5f,0}};
    for (int i = 0; i < 4; ++i) {
        float x1, y1, d1, x2, y2, d2;
        if (cam.project(sq[i], x1, y1, d1) && cam.project(sq[(i+1)%4], x2, y2, d2))
            g.DrawLine(&pEnv, x1, y1, x2, y2);
    }
}

static void drawAnchorPins(Graphics& g, const Cam& cam, const Vec3* verts, const int* anc, int nAnc, float r = 5.8f) {
    SolidBrush aBr(Color(255, 16, 185, 129));
    Pen aRing(Color(245, 248, 250, 252), 1.4f);
    for (int i = 0; i < nAnc; ++i) {
        float sx, sy, d;
        if (cam.project(toV3(verts[anc[i]]), sx, sy, d)) {
            g.FillEllipse(&aBr, sx - r, sy - r, 2.0f * r, 2.0f * r);
            g.DrawEllipse(&aRing, sx - r, sy - r, 2.0f * r, 2.0f * r);
        }
    }
}

// ============================================================
//  3D ARCHITECTURAL CAD MESH, GRAPH & 2D UNROLLED STRIP RENDERERS
// ============================================================
struct DrawPoly {
    PointF pts[4];
    int n;
    float depth;
    Color fill;
    Color edge;
};

static void drawOBJShadedCAD(Graphics& g, const Cam& cam, const Vec3* verts, const Face4* faces, int nFaces,
                             Color baseTint = Color(255, 214, 220, 228), Color wireCol = Color(195, 46, 54, 68),
                             const int* faceBarMap = nullptr, const int* hiBars = nullptr,
                             const Color* hiCols = nullptr, int nHi = 0) {
    std::vector<DrawPoly> polys;
    polys.reserve(nFaces);
    V3 light1 = vnorm({0.55f, -0.65f, 0.85f});
    V3 light2 = vnorm({-0.6f, 0.5f, 0.4f});

    for (int i = 0; i < nFaces; ++i) {
        const Face4& f = faces[i];
        int idx[4] = {f.a, f.b, f.c, f.d};
        int n = (f.d >= 0) ? 4 : 3;
        V3 p[4];
        PointF sp[4];
        float dSum = 0.0f;
        bool ok = true;
        for (int k = 0; k < n; ++k) {
            p[k] = toV3(verts[idx[k]]);
            float sx, sy, dep;
            if (!cam.project(p[k], sx, sy, dep)) { ok = false; break; }
            sp[k] = {sx, sy};
            dSum += dep;
        }
        if (!ok) continue;

        V3 norm = vnorm(cross(p[1] - p[0], p[2] - p[0]));
        float nd1 = std::fabs(dot(norm, light1));
        float nd2 = std::fabs(dot(norm, light2));
        float lum = clamp01(0.34f + 0.54f * nd1 + 0.17f * nd2);

        Color tint = baseTint;
        Color wc = wireCol;
        if (faceBarMap && hiBars && hiCols && nHi > 0) {
            int bIdx = faceBarMap[i];
            for (int h = 0; h < nHi; ++h) {
                if (bIdx >= 0 && bIdx == hiBars[h]) {
                    tint = hiCols[h];
                    wc = Color(245, hiCols[h].GetR(), hiCols[h].GetG(), hiCols[h].GetB());
                    lum = clamp01(0.72f + 0.28f * nd1);
                    break;
                }
            }
        }

        DrawPoly dp;
        dp.n = n;
        for (int k = 0; k < n; ++k) dp.pts[k] = sp[k];
        dp.depth = dSum / n;
        dp.fill = Color(255,
                        (BYTE)(tint.GetR() * lum),
                        (BYTE)(tint.GetG() * lum),
                        (BYTE)(tint.GetB() * lum));
        dp.edge = wc;
        polys.push_back(dp);
    }

    std::sort(polys.begin(), polys.end(), [](const DrawPoly& a, const DrawPoly& b) {
        return a.depth > b.depth;
    });

    for (const auto& dp : polys) {
        SolidBrush br(dp.fill);
        g.FillPolygon(&br, dp.pts, dp.n);
        Pen pen(dp.edge, 0.90f);
        g.DrawPolygon(&pen, dp.pts, dp.n);
    }
}

static Color heatMapColor(float t) {
    t = clamp01(t);
    // Cyan (low compression) -> Emerald (moderate) -> Warm Amber (peak compression)
    if (t < 0.5f) {
        float u = t * 2.0f;
        return Color(255, (BYTE)lerpf(34, 16, u), (BYTE)lerpf(211, 185, u), (BYTE)lerpf(238, 129, u));
    } else {
        float u = (t - 0.5f) * 2.0f;
        return Color(255, (BYTE)lerpf(16, 245, u), (BYTE)lerpf(185, 158, u), (BYTE)lerpf(129, 11, u));
    }
}

struct DrawBar {
    float x1, y1, x2, y2, depth, width;
    Color col;
};

static void drawGraph3D(Graphics& g, const Cam& cam, const std::vector<V3>& verts,
                        const Edge2* edges, int nEdges, const int* anchors, int nAnchors,
                        const std::vector<Color>& edgeColors, float baseWidth = 3.4f, bool drawNodes = true) {
    std::vector<DrawBar> bars;
    bars.reserve(nEdges);
    for (int i = 0; i < nEdges; ++i) {
        float x1, y1, d1, x2, y2, d2;
        if (!cam.project(verts[edges[i].u], x1, y1, d1)) continue;
        if (!cam.project(verts[edges[i].v], x2, y2, d2)) continue;
        bars.push_back({x1, y1, x2, y2, 0.5f * (d1 + d2), baseWidth, edgeColors[i]});
    }
    std::sort(bars.begin(), bars.end(), [](const DrawBar& a, const DrawBar& b) { return a.depth > b.depth; });
    for (const auto& b : bars) {
        Pen penOut(Color(165, 10, 15, 24), b.width + 2.0f);
        penOut.SetStartCap(LineCapRound); penOut.SetEndCap(LineCapRound);
        g.DrawLine(&penOut, b.x1, b.y1, b.x2, b.y2);
        Pen pen(b.col, b.width);
        pen.SetStartCap(LineCapRound); pen.SetEndCap(LineCapRound);
        g.DrawLine(&pen, b.x1, b.y1, b.x2, b.y2);
    }
    if (drawNodes) {
        SolidBrush nBr(Color(225, 226, 232, 240));
        for (size_t i = 0; i < verts.size(); ++i) {
            float sx, sy, d;
            if (cam.project(verts[i], sx, sy, d)) g.FillEllipse(&nBr, sx - 3.0f, sy - 3.0f, 6.0f, 6.0f);
        }
    }
    SolidBrush aBr(Color(255, 16, 185, 129));
    Pen aRing(Color(255, 255, 255, 255), 1.5f);
    for (int i = 0; i < nAnchors; ++i) {
        float sx, sy, d;
        if (cam.project(verts[anchors[i]], sx, sy, d)) {
            g.FillEllipse(&aBr, sx - 6.0f, sy - 6.0f, 12.0f, 12.0f);
            g.DrawEllipse(&aRing, sx - 6.0f, sy - 6.0f, 12.0f, 12.0f);
        }
    }
}

static void drawVoxelBox(Graphics& g, const Cam& cam, V3 center, V3 half, Color col, float width = 1.4f) {
    V3 c[8] = {
        {center.x-half.x, center.y-half.y, center.z-half.z},
        {center.x+half.x, center.y-half.y, center.z-half.z},
        {center.x+half.x, center.y+half.y, center.z-half.z},
        {center.x-half.x, center.y+half.y, center.z-half.z},
        {center.x-half.x, center.y-half.y, center.z+half.z},
        {center.x+half.x, center.y-half.y, center.z+half.z},
        {center.x+half.x, center.y+half.y, center.z+half.z},
        {center.x-half.x, center.y+half.y, center.z+half.z},
    };
    const int be[12][2] = {{0,1},{1,2},{2,3},{3,0},{4,5},{5,6},{6,7},{7,4},{0,4},{1,5},{2,6},{3,7}};
    Pen pen(col, width);
    for (int i = 0; i < 12; ++i) {
        float x1, y1, d1, x2, y2, d2;
        if (cam.project(c[be[i][0]], x1, y1, d1) && cam.project(c[be[i][1]], x2, y2, d2))
            g.DrawLine(&pen, x1, y1, x2, y2);
    }
}

// White-on-#070A10 1:1 Isotropic (scaleX == scaleY) 2D Unrolled Per-Bar Strip Sheet Renderer
static void drawUnrolledSheet2D(Graphics& g, float boxX, float boxY, float boxW, float boxH,
                                const int* hiBars = nullptr, const Color* hiCols = nullptr, int nHi = 0) {
    // Strict 1:1 isotropic aspect ratio (scaleX == scaleY!)
    float scale = min(boxW / max(0.05f, CHAMP_SHEET_W), boxH / max(0.05f, CHAMP_SHEET_H));
    float dstW = CHAMP_SHEET_W * scale;
    float dstH = CHAMP_SHEET_H * scale;
    float ox = boxX + 0.5f * (boxW - dstW);
    float oy = boxY + 0.5f * (boxH - dstH);

    auto mapPt = [&](float x, float y) -> PointF {
        return PointF(ox + x * scale, oy + dstH - y * scale);
    };

    // Subtle CAD datum ticks at sheet corners (zero enclosing box border!)
    Pen tickPen(Color(95, 148, 163, 184), 1.2f);
    float tk = 10.0f;
    g.DrawLine(&tickPen, ox - 6, oy - 6, ox - 6 + tk, oy - 6);
    g.DrawLine(&tickPen, ox - 6, oy - 6, ox - 6, oy - 6 + tk);
    g.DrawLine(&tickPen, ox + dstW + 6, oy - 6, ox + dstW + 6 - tk, oy - 6);
    g.DrawLine(&tickPen, ox + dstW + 6, oy - 6, ox + dstW + 6, oy - 6 + tk);
    g.DrawLine(&tickPen, ox - 6, oy + dstH + 6, ox - 6 + tk, oy + dstH + 6);
    g.DrawLine(&tickPen, ox - 6, oy + dstH + 6, ox - 6, oy + dstH + 6 - tk);
    g.DrawLine(&tickPen, ox + dstW + 6, oy + dstH + 6, ox + dstW + 6 - tk, oy + dstH + 6);
    g.DrawLine(&tickPen, ox + dstW + 6, oy + dstH + 6, ox + dstW + 6, oy + dstH + 6 - tk);

    // Fill planar quads (subtle slate fill + luminous tint on highlighted bars linking 2D <-> 3D)
    SolidBrush baseFill(Color(38, 148, 163, 184));
    for (int i = 0; i < CHAMP_UNROLL_NQUADS; ++i) {
        const auto& q = CHAMP_UNROLL_QUADS[i];
        PointF pts[4] = {mapPt(q.x0, q.y0), mapPt(q.x1, q.y1), mapPt(q.x2, q.y2), mapPt(q.x3, q.y3)};
        int matchedH = -1;
        if (hiBars && hiCols && nHi > 0) {
            for (int h = 0; h < nHi; ++h) {
                if (q.barIdx == hiBars[h]) { matchedH = h; break; }
            }
        }
        if (matchedH >= 0) {
            Color c = hiCols[matchedH];
            SolidBrush hFill(Color(115, c.GetR(), c.GetG(), c.GetB()));
            g.FillPolygon(&hFill, pts, 4);
        } else {
            g.FillPolygon(&baseFill, pts, 4);
        }
    }

    // Internal longitudinal & transverse fold creases in silver-cyan (#38BDF8)
    Pen foldPen(Color(125, 56, 189, 248), 0.85f);
    for (int i = 0; i < CHAMP_UNROLL_NFOLD; ++i) {
        const auto& s = CHAMP_UNROLL_FOLD_SEGS[i];
        PointF p1 = mapPt(s.x1, s.y1), p2 = mapPt(s.x2, s.y2);
        g.DrawLine(&foldPen, p1, p2);
    }

    // Outer laser/knife cut contours in crisp pure white (#F8FAFC) or highlighted accent
    Pen cutPen(Color(238, 248, 250, 252), 1.45f);
    for (int i = 0; i < CHAMP_UNROLL_NCUT; ++i) {
        const auto& s = CHAMP_UNROLL_CUT_SEGS[i];
        PointF p1 = mapPt(s.x1, s.y1), p2 = mapPt(s.x2, s.y2);
        int matchedH = -1;
        if (hiBars && hiCols && nHi > 0) {
            for (int h = 0; h < nHi; ++h) {
                if (s.barIdx == hiBars[h]) { matchedH = h; break; }
            }
        }
        if (matchedH >= 0) {
            Color c = hiCols[matchedH];
            Pen hPen(Color(255, c.GetR(), c.GetG(), c.GetB()), 2.1f);
            g.DrawLine(&hPen, p1, p2);
        } else {
            g.DrawLine(&cutPen, p1, p2);
        }
    }
}

// ============================================================
//  SCENE RENDERERS (6 CHAPTERS, 1800 FRAMES = 60.0s @ 30 FPS)
// ============================================================

// Ch 1 (frames 60..209, 5.0s): Immediate Frame-0 50/50 Input -> Output Opener (Unified Shaded CAD)
static void renderCh1_Opener(Graphics& g, int lf, int len) {
    float t = (float)lf / (float)len;
    float azim = -0.62f + t * 0.62f; // Calm 1.0x 35 deg orbit

    Pen divPen(Color(68, 148, 163, 184), 1.4f);
    g.DrawLine(&divPen, 960.0f, 165.0f, 960.0f, 850.0f);

    // Left Half (x = 0..960): Pilot v2 Initial Baseline
    Cam camL;
    camL.setup(azim, 0.27f, 3.90f, {0, 0, 1.0f}, 480.0f, 472.0f, 800.0f);
    drawGroundGrid(g, camL, 0.62f, 4);
    drawOBJShadedCAD(g, camL, BASE_OBJ_VERTS, BASE_OBJ_FACES, BASE_OBJ_NFACES,
                     Color(255, 196, 204, 216), Color(175, 42, 50, 64));
    drawAnchorPins(g, camL, BASE_VERTS, BASE_ANCHORS, BASE_NANCHORS);

    // Right Half (x = 960..1920): Verified Pilot v2 Champion
    Cam camR;
    camR.setup(azim, 0.27f, 3.90f, {0, 0, 1.0f}, 1440.0f, 472.0f, 800.0f);
    drawGroundGrid(g, camR, 0.62f, 4);
    drawOBJShadedCAD(g, camR, CHAMP_OBJ_VERTS, CHAMP_OBJ_FACES, CHAMP_OBJ_NFACES,
                     Color(255, 228, 224, 216), Color(200, 42, 50, 64));
    drawAnchorPins(g, camR, CHAMP_VERTS, CHAMP_ANCHORS, CHAMP_NANCHORS);

    drawHeaderLeft(g, L"Heavy Baseline to Pure-Compression Champion",
                   L"Two-meter cast plaster tower carrying fifty kilograms");

    Font fCap(L"Calibri", 17.5f, FontStyleBold, UnitPoint);
    Font fSub(L"Calibri", 14.5f, FontStyleRegular, UnitPoint);
    wchar_t bLine1[128], bLine2[128], cLine1[128], cLine2[128];
    std::swprintf(bLine1, 128, L"Initial Baseline  \u2022  %.2f kg  \u2022  %d Bars", BASE_MASS_KG, BASE_BAR_COUNT);
    std::swprintf(bLine2, 128, L"Unrolled Area: %.2f m\u00B2  \u2022  %ls Voxel Grid", BASE_AREA_M2, BASE_GRID_STR);
    std::swprintf(cLine1, 128, L"Verified Champion  \u2022  %.2f kg  \u2022  %d Bars", CHAMP_MASS_KG, CHAMP_BAR_COUNT);
    std::swprintf(cLine2, 128, L"Unrolled Area: %.2f m\u00B2  \u2022  100%% Pure Compression", CHAMP_AREA_M2);

    drawShadowText(g, bLine1, fCap, 480.0f, 802.0f, Color(230, 203, 213, 225), StringAlignmentCenter);
    drawShadowText(g, bLine2, fSub, 480.0f, 832.0f, Color(190, 148, 163, 184), StringAlignmentCenter);
    drawShadowText(g, cLine1, fCap, 1440.0f, 802.0f, Color(255, 110, 231, 183), StringAlignmentCenter);
    drawShadowText(g, cLine2, fSub, 1440.0f, 832.0f, Color(225, 203, 213, 225), StringAlignmentCenter);
}

// Ch 2 (frames 210..689, 16.0s): Swarm Exploration — Cycles 16 Real Pilot v2 Options + Live Adjacent 3D FEA
static void renderCh2_Exploration(Graphics& g, int lf, int len) {
    if (lf < 18) {
        drawChapterCard(g, L"01 \u00B7 SWARM DESIGN EXPLORATION",
                        L"Sixteen Multi-Voxel Topologies With Live Structural Analysis",
                        smoothstep(lf < 9 ? lf / 6.0f : (18 - lf) / 6.0f));
        return;
    }
    int f = lf - 18;
    int dur = len - 18;
    float t = (float)f / (float)dur;

    int activeIdx = min(EXPLORE_COUNT - 1, (int)(t * (float)EXPLORE_COUNT));
    const auto& cur = EXPLORE_CATALOG[activeIdx];

    // LEFT 2D SPACE (x = 54..654): Live Multi-Objective Pareto Scatter (Unrolled Area m2 vs Bar Count)
    float px0 = 56.0f, py0 = 242.0f, pw = 595.0f, ph = 315.0f;
    Pen axPen(Color(150, 148, 163, 184), 1.5f);
    g.DrawLine(&axPen, px0, py0 + ph, px0 + pw, py0 + ph);
    g.DrawLine(&axPen, px0, py0, px0, py0 + ph);
    Pen gridPen(Color(35, 148, 163, 184), 1.0f);
    for (int k = 1; k <= 4; ++k) {
        float gy = py0 + ph - k * (ph / 4.0f);
        g.DrawLine(&gridPen, px0, gy, px0 + pw, gy);
    }

    Font fAxis(L"Calibri", 12.5f, FontStyleRegular, UnitPoint);
    Font fBold(L"Calibri", 14.0f, FontStyleBold, UnitPoint);
    drawShadowText(g, L"Unrolled Surface Area (m\u00B2) \u2192", fAxis, px0 + pw * 0.5f, py0 + ph + 10.0f, Color(200, 148, 163, 184), StringAlignmentCenter);
    drawShadowText(g, L"Bar Count  \u2022  Pareto Frontier", fAxis, px0 + 4.0f, py0 - 22.0f, Color(210, 203, 213, 225));

    // Compute clean dynamic scatter bounds
    float minArea = 1e9f, maxArea = 0.2f;
    int minBars = 9999, maxBars = 12;
    for (int i = 0; i < PARETO_NPTS; ++i) {
        minArea = min(minArea, PARETO_PTS[i].areaM2);
        maxArea = max(maxArea, PARETO_PTS[i].areaM2);
        minBars = min(minBars, PARETO_PTS[i].nBars);
        maxBars = max(maxBars, PARETO_PTS[i].nBars);
    }
    for (int i = 0; i < EXPLORE_COUNT; ++i) {
        minArea = min(minArea, EXPLORE_CATALOG[i].areaM2);
        maxArea = max(maxArea, EXPLORE_CATALOG[i].areaM2);
        minBars = min(minBars, EXPLORE_CATALOG[i].nBars);
        maxBars = max(maxBars, EXPLORE_CATALOG[i].nBars);
    }
    minArea = max(0.0f, minArea * 0.85f);
    maxArea = max(minArea + 0.25f, min(maxArea, CHAMP_AREA_M2 * 4.5f + 0.8f));
    minBars = max(4, minBars - 4);
    maxBars = max(minBars + 16, min(maxBars + 6, 160));

    auto mapAreaX = [&](float a) {
        return px0 + 14.0f + clamp01((a - minArea) / (maxArea - minArea)) * (pw - 28.0f);
    };
    auto mapBarsY = [&](float b) {
        return py0 + ph - 12.0f - clamp01((b - (float)minBars) / (float)(maxBars - minBars)) * (ph - 26.0f);
    };

    const Color grpCols[6] = {
        Color(255, 16, 185, 129),  // Champion / Pilot
        Color(255, 236, 72, 153),  // Catenary Quadripod
        Color(255, 56, 189, 248),  // Vault / Arch
        Color(255, 34, 211, 238),  // Diagrid
        Color(255, 245, 158, 11),  // Hyperboloid
        Color(255, 148, 163, 184)  // Ortho / Space Frame
    };

    int showPts = min(PARETO_NPTS, (int)(smoothstep(clamp01(t * 1.35f)) * PARETO_NPTS) + 10);
    for (int i = 0; i < showPts; ++i) {
        const auto& pt = PARETO_PTS[i];
        float cx = mapAreaX(pt.areaM2);
        float cy = mapBarsY((float)pt.nBars);
        if (!pt.passed) {
            Pen rejPen(Color(125, 244, 63, 94), 1.3f);
            g.DrawEllipse(&rejPen, cx - 3.6f, cy - 3.6f, 7.2f, 7.2f);
        } else {
            float r = pt.isChamp ? 6.8f : (pt.isPareto ? 5.0f : 3.8f);
            SolidBrush br(grpCols[pt.group % 6]);
            g.FillEllipse(&br, cx - r, cy - r, 2 * r, 2 * r);
            if (pt.isPareto || pt.isChamp) {
                Pen pRing(pt.isChamp ? Color(255, 255, 255, 255) : Color(195, 226, 232, 240), pt.isChamp ? 1.8f : 1.1f);
                g.DrawEllipse(&pRing, cx - r - 1.5f, cy - r - 1.5f, 2 * (r + 1.5f), 2 * (r + 1.5f));
            }
        }
    }

    // Moving target ring synced to active cycling option
    {
        float hx = mapAreaX(cur.areaM2);
        float hy = mapBarsY((float)cur.nBars);
        Color ringCol = (cur.statusKind == 3) ? Color(255, 110, 231, 183)
                      : (cur.statusKind == 0 ? Color(255, 255, 255, 255) : Color(255, 251, 113, 133));
        Pen hiPen(ringCol, 2.4f);
        g.DrawEllipse(&hiPen, hx - 11.0f, hy - 11.0f, 22.0f, 22.0f);
    }

    // Explored >= 2x2x2 Voxel Grids (compact 2-column layout under Pareto scatter, strictly y < 860)
    drawShadowText(g, L"Explored Voxel Grids (\u2265 2\u00D72\u00D72 Pass Rate)", fBold, px0, 610.0f, Color(235, 226, 232, 240));
    int nG = min(8, GRID_STATS_COUNT);
    int rowsPerCol = (nG + 1) / 2;
    float rowPitch = (rowsPerCol >= 4) ? 44.0f : 50.0f;
    for (int i = 0; i < nG; ++i) {
        int col = i / rowsPerCol;
        int row = i % rowsPerCol;
        float bx = px0 + col * 315.0f;
        float by = 642.0f + row * rowPitch;
        bool isAct = (i == cur.gridIdx);
        drawShadowText(g, GRID_STATS[i].label, isAct ? fBold : fAxis, bx, by,
                       isAct ? Color(255, 255, 255, 255) : Color(185, 148, 163, 184));
        SolidBrush trk(Color(65, 51, 65, 85));
        g.FillRectangle(&trk, bx, by + 21.0f, 225.0f, isAct ? 9.5f : 7.0f);
        SolidBrush fil(isAct ? Color(255, 56, 189, 248) : Color(195, 16, 185, 129));
        g.FillRectangle(&fil, bx, by + 21.0f, 225.0f * clamp01(GRID_STATS[i].passRate), isAct ? 9.5f : 7.0f);
        wchar_t pctBuf[24];
        std::swprintf(pctBuf, 24, L"%.0f%%", GRID_STATS[i].passRate * 100.0f);
        drawShadowText(g, pctBuf, fAxis, bx + 233.0f, by + 12.0f,
                       isAct ? Color(255, 186, 230, 253) : Color(195, 110, 231, 183));
    }

    // CENTER 3D VIEWPORT (cx = 1035): Unified Shaded Cast-Plaster PQ Tubular OBJ Mesh
    float azim = -0.55f + t * 1.50f;
    Cam camM;
    camM.setup(azim, 0.27f, 3.95f, {0, 0, 1.0f}, 1035.0f, 468.0f, 780.0f);
    drawGroundGrid(g, camM, 0.60f, 3);
    drawOBJShadedCAD(g, camM, cur.objV, cur.objF, cur.objNF,
                     cur.statusKind == 3 ? Color(255, 232, 228, 220) : Color(255, 214, 218, 226),
                     Color(195, 42, 50, 64));
    drawAnchorPins(g, camM, cur.gV, cur.anc, cur.nAnc, 5.2f);

    // RIGHT 3D VIEWPORT (cx = 1595, DIRECTLY ADJACENT!): Live Air-Gapped 3D Plaster FEA
    Cam camF;
    camF.setup(azim, 0.27f, 3.95f, {0, 0, 1.0f}, 1595.0f, 468.0f, 780.0f);
    drawGroundGrid(g, camF, 0.60f, 3);

    Pen gPen(Color(65, 148, 163, 184), 1.2f);
    for (int i = 0; i < cur.gNE; ++i) {
        float x1, y1, d1, x2, y2, d2;
        if (camF.project(toV3(cur.gV[cur.gE[i].u]), x1, y1, d1) &&
            camF.project(toV3(cur.gV[cur.gE[i].v]), x2, y2, d2))
            g.DrawLine(&gPen, x1, y1, x2, y2);
    }

    float defScale = max(70.0f, min(1250.0f, 0.085f / max(0.00004f, cur.dispMm * 0.001f)));
    std::vector<V3> defV(cur.gNV);
    for (int i = 0; i < cur.gNV; ++i)
        defV[i] = toV3(cur.gV[i]) + toV3(cur.disp[i]) * defScale;

    std::vector<Color> sCols(cur.gNE);
    for (int i = 0; i < cur.gNE; ++i) {
        const auto& m = cur.fea[i];
        // Highlight any bar in net axial tension (N > 0) in crimson rose!
        if (m.axialN > 1e-3f || m.sigmaT_MPa > 0.08f)
            sCols[i] = Color(255, 244, 63, 94);
        else
            sCols[i] = heatMapColor(m.sigmaC_MPa / max(0.15f, cur.maxStressMPa));
    }
    drawGraph3D(g, camF, defV, cur.gE, cur.gNE, cur.anc, cur.nAnc, sCols, 3.6f, false);

    // Orange +50 kg top distributed load arrows
    Pen loadPen(Color(255, 245, 158, 11), 2.2f);
    loadPen.SetEndCap(LineCapArrowAnchor);
    float maxZ = 0.0f;
    for (int i = 0; i < cur.gNV; ++i) maxZ = max(maxZ, cur.gV[i].z);
    int arrCount = 0;
    for (int i = 0; i < cur.gNV && arrCount < 8; ++i) {
        if (cur.gV[i].z >= 0.85f * maxZ) {
            float x1, y1, d1, x2, y2, d2;
            if (camF.project(defV[i] + V3{0, 0, 0.28f}, x1, y1, d1) && camF.project(defV[i] + V3{0, 0, 0.04f}, x2, y2, d2)) {
                g.DrawLine(&loadPen, x1, y1, x2, y2);
                arrCount++;
            }
        }
    }

    // Plain-English captions under Center (PQ Tubular) & Right (Adjacent FEA) — zero solver acronyms!
    wchar_t optBuf[140], meshBuf[140], feaBuf1[140], feaBuf2[140];
    std::swprintf(optBuf, 140, L"Option %d / %d  \u2022  %ls", activeIdx + 1, EXPLORE_COUNT, cur.title);
    std::swprintf(meshBuf, 140, L"%.2f kg  \u2022  %d Bars  \u2022  %.2f m\u00B2 Surface Area", cur.massKg, cur.nBars, cur.areaM2);
    Color cTitleCol = (cur.statusKind == 3) ? Color(255, 110, 231, 183)
                    : (cur.statusKind == 0 ? Color(255, 248, 250, 252) : Color(255, 252, 211, 77));
    drawShadowText(g, optBuf, fBold, 1035.0f, 796.0f, cTitleCol, StringAlignmentCenter);
    drawShadowText(g, meshBuf, fAxis, 1035.0f, 825.0f, Color(205, 203, 213, 225), StringAlignmentCenter);

    const wchar_t* vTag = (cur.statusKind == 3) ? L"WINNER \u2713"
                        : (cur.statusKind == 0 ? L"VERIFIED \u2713"
                        : (cur.statusKind == 1 ? L"TENSION REJECT" : L"STABILITY REJECT"));
    std::swprintf(feaBuf1, 140, L"Live Plaster Analysis (+50 kg)  \u2022  %ls", vTag);
    if (cur.tensileBars > 0) {
        std::swprintf(feaBuf2, 140, L"Deflection: %.2f mm  \u2022  %d Tension Bars  \u2022  %.0f%% Compression",
                      cur.dispMm, cur.tensileBars, cur.compDom * 100.0f);
    } else {
        std::swprintf(feaBuf2, 140, L"Deflection: %.3f mm  \u2022  Safety: %.1f\u00D7  \u2022  100%% Compression",
                      cur.dispMm, min(99.9f, cur.minSF));
    }
    Color fTitleCol = (cur.statusKind == 3) ? Color(255, 110, 231, 183)
                    : (cur.statusKind == 0 ? Color(255, 56, 189, 248) : Color(255, 253, 164, 175));
    drawShadowText(g, feaBuf1, fBold, 1595.0f, 796.0f, fTitleCol, StringAlignmentCenter);
    drawShadowText(g, feaBuf2, fAxis, 1595.0f, 825.0f, Color(215, 203, 213, 225), StringAlignmentCenter);

    wchar_t bul1[64], bul2[64], bul3[64];
    std::swprintf(bul1, 64, L"%d Explored Designs", CAMPAIGN_EVALUATED);
    std::swprintf(bul2, 64, L"%d Voxel Resolutions", GRID_STATS_COUNT);
    std::swprintf(bul3, 64, L"%d Pareto-Optimal Forms", CAMPAIGN_PARETO_COUNT);
    drawHeaderLeft(g, L"Multi-Voxel Swarm Design Exploration",
                   L"Sixteen topologies paired with live cast-plaster analysis",
                   {bul1, bul2, bul3});
}

// Ch 3 (frames 690..899, 7.0s): Candidate Lineup — ALL 3 in Unified Shaded CAD Tubular Display
static void renderCh3_Candidates(Graphics& g, int lf, int len) {
    if (lf < 18) {
        drawChapterCard(g, L"02 \u00B7 CANDIDATE LINEUP",
                        L"Comparing Surface Area, Bar Count & Compression",
                        smoothstep(lf < 9 ? lf / 6.0f : (18 - lf) / 6.0f));
        return;
    }
    int f = lf - 18;
    float t = (float)f / (float)(len - 18);
    float azim = -0.58f + t * 0.78f;

    Cam c1, c2, c3;
    c1.setup(azim, 0.27f, 3.95f, {0, 0, 1.0f}, 340.0f, 470.0f, 780.0f);
    c2.setup(azim, 0.27f, 3.95f, {0, 0, 1.0f}, 960.0f, 470.0f, 780.0f);
    c3.setup(azim, 0.27f, 3.95f, {0, 0, 1.0f}, 1580.0f, 470.0f, 780.0f);

    const Color plasterTint(255, 224, 220, 212);
    const Color plasterWire(195, 42, 50, 64);

    // Unified Rhino CAD Shaded Tubular OBJ Display across all 3 candidates!
    drawGroundGrid(g, c1, 0.60f, 3);
    drawOBJShadedCAD(g, c1, BASE_OBJ_VERTS, BASE_OBJ_FACES, BASE_OBJ_NFACES, plasterTint, plasterWire);
    drawAnchorPins(g, c1, BASE_VERTS, BASE_ANCHORS, BASE_NANCHORS);

    drawGroundGrid(g, c2, 0.60f, 3);
    drawOBJShadedCAD(g, c2, ALT_OBJ_VERTS, ALT_OBJ_FACES, ALT_OBJ_NFACES, plasterTint, plasterWire);
    drawAnchorPins(g, c2, ALT_VERTS, ALT_ANCHORS, ALT_NANCHORS);

    drawGroundGrid(g, c3, 0.60f, 3);
    drawOBJShadedCAD(g, c3, CHAMP_OBJ_VERTS, CHAMP_OBJ_FACES, CHAMP_OBJ_NFACES, plasterTint, plasterWire);
    drawAnchorPins(g, c3, CHAMP_VERTS, CHAMP_ANCHORS, CHAMP_NANCHORS);

    Font fCol(L"Calibri", 17.0f, FontStyleBold, UnitPoint);
    Font fDet(L"Calibri", 14.0f, FontStyleRegular, UnitPoint);

    wchar_t l1a[96], l1b[96], l1c[96];
    std::swprintf(l1a, 96, L"1. Initial Baseline  \u2022  %.2f kg", BASE_MASS_KG);
    std::swprintf(l1b, 96, L"%d Bars  \u2022  %.2f m\u00B2 Surface Area", BASE_BAR_COUNT, BASE_AREA_M2);
    std::swprintf(l1c, 96, L"%ls (%ls)", BASE_PRESET_STR, BASE_GRID_STR);
    drawShadowText(g, l1a, fCol, 340.0f, 788.0f, Color(230, 203, 213, 225), StringAlignmentCenter);
    drawShadowText(g, l1b, fDet, 340.0f, 816.0f, Color(190, 148, 163, 184), StringAlignmentCenter);
    drawShadowText(g, l1c, fDet, 340.0f, 842.0f, Color(168, 148, 163, 184), StringAlignmentCenter);

    wchar_t l2a[96], l2b[96];
    std::swprintf(l2a, 96, L"2. Explored Variant  \u2022  %.2f kg", ALT_MASS_KG);
    std::swprintf(l2b, 96, L"%d Bars  \u2022  %.2f m\u00B2 Surface Area", ALT_BAR_COUNT, ALT_AREA_M2);
    drawShadowText(g, l2a, fCol, 960.0f, 788.0f, Color(255, 252, 211, 77), StringAlignmentCenter);
    drawShadowText(g, l2b, fDet, 960.0f, 816.0f, Color(220, 203, 213, 225), StringAlignmentCenter);
    drawShadowText(g, ALT_REASON_STR, fDet, 960.0f, 842.0f, Color(255, 253, 164, 175), StringAlignmentCenter);

    wchar_t l3a[96], l3b[96];
    std::swprintf(l3a, 96, L"3. Verified Champion  \u2022  %.2f kg", CHAMP_MASS_KG);
    std::swprintf(l3b, 96, L"%d Bars  \u2022  %.2f m\u00B2 Surface Area", CHAMP_BAR_COUNT, CHAMP_AREA_M2);
    drawShadowText(g, l3a, fCol, 1580.0f, 788.0f, Color(255, 110, 231, 183), StringAlignmentCenter);
    drawShadowText(g, l3b, fDet, 1580.0f, 816.0f, Color(230, 203, 213, 225), StringAlignmentCenter);
    drawShadowText(g, L"100% Pure Compression  \u2022  Winner", fDet, 1580.0f, 842.0f, Color(255, 110, 231, 183), StringAlignmentCenter);

    drawHeaderLeft(g, L"Pure Compression & Minimal Surface Area",
                   L"Unified cast-plaster comparison across three milestone candidates");
}

// Ch 4 (frames 900..1259, 12.0s): Constituent WFC Tiles + >= 2x2x2 Multi-Voxel Collapse & Welding
static void renderCh4_WFCTiles(Graphics& g, int lf, int len) {
    if (lf < 18) {
        drawChapterCard(g, L"03 \u00B7 VOXEL TILES & TOPOLOGY",
                        L"Six-Face Socket Matching & Multi-Voxel Collapse",
                        smoothstep(lf < 9 ? lf / 6.0f : (18 - lf) / 6.0f));
        return;
    }
    int f = lf - 18;
    int dur = len - 18; // 342 frames (11.4s)

    if (f < 180) {
        // Stage A (6.0s): Cycle cleanly through all 6 constituent WFC tiles (30f = 1.0s each)
        int ti = min(5, f / 30);
        const auto& tg = WFC_SHOWCASE_TILES[ti];

        float mx = 56.0f, my = 272.0f, cs = 52.0f;
        Font fM(L"Calibri", 13.5f, FontStyleBold, UnitPoint);
        Font fS(L"Calibri", 12.5f, FontStyleRegular, UnitPoint);
        drawShadowText(g, L"Six-Direction Socket Adjacency Matrix", fM, mx, my - 32.0f, Color(245, 56, 189, 248));

        for (int r = 0; r < 6; ++r) {
            bool isAct = (r == ti);
            if (isAct) {
                SolidBrush rowGlow(Color(38, 56, 189, 248));
                g.FillRectangle(&rowGlow, mx - 8.0f, my + r * cs - 2.0f, 195.0f + 6 * cs + 10.0f, cs - 2.0f);
            }
            drawShadowText(g, WFC_SHOWCASE_TILES[r].name, fM, mx, my + r * cs + 13.0f,
                           isAct ? Color(255, 255, 255, 255) : Color(175, 148, 163, 184));
            for (int c = 0; c < 6; ++c) {
                float cx = mx + 195.0f + c * cs;
                float cy = my + r * cs;
                int compat = WFC_ADJ_MATRIX[r][c];
                bool isDiagAct = (isAct && c == ti && compat > 0);
                Color cellCol = isDiagAct ? Color(235, 236, 72, 153)
                              : (compat == 2 ? Color(isAct ? 185 : 95, 16, 185, 129)
                              : (compat == 1 ? Color(isAct ? 150 : 75, 56, 189, 248)
                              : Color(45, 30, 41, 59)));
                SolidBrush cb(cellCol);
                g.FillRectangle(&cb, cx, cy, cs - 6.0f, cs - 6.0f);
                drawShadowText(g, compat > 0 ? L"1" : L"\u00B7", fM, cx + (cs - 6.0f) * 0.5f, cy + 13.0f,
                               compat > 0 ? Color(255, 255, 255, 255) : Color(110, 148, 163, 184), StringAlignmentCenter);
            }
        }

        // Active tile 6-Direction Face Sockets (+X, -X, +Y, -Y, +Z, -Z)
        const wchar_t* dirNames[6] = {L"+X", L"-X", L"+Y", L"-Y", L"+Z", L"-Z"};
        float sy = my + 6 * cs + 22.0f;
        drawShadowText(g, L"Active Tile Face Sockets:", fM, mx, sy + 8.0f, Color(220, 203, 213, 225));
        for (int d = 0; d < 6; ++d) {
            float bx = mx + 195.0f + d * cs;
            bool open = tg.sockets[d] > 0;
            SolidBrush sb(open ? Color(190, 16, 185, 129) : Color(55, 30, 41, 59));
            g.FillRectangle(&sb, bx, sy, cs - 6.0f, 36.0f);
            drawShadowText(g, dirNames[d], fS, bx + (cs - 6.0f) * 0.5f, sy + 8.0f,
                           open ? Color(255, 255, 255, 255) : Color(130, 148, 163, 184), StringAlignmentCenter);
        }

        wchar_t tileSum[120];
        std::swprintf(tileSum, 120, L"Tile %d / 6:  %ls   \u2022   %d Structural Bars", ti + 1, tg.name, tg.ne);
        drawShadowText(g, tileSum, fM, mx, sy + 54.0f,
                       ti == 5 ? Color(255, 110, 231, 183) : Color(235, 56, 189, 248));

        // Right: Rotating 3D Unit Voxel + 6 Face-Center Socket Rings
        Cam camR;
        camR.setup(-0.55f + ((float)f / 180.0f) * 1.35f, 0.29f, 2.75f, {0, 0, 0.0f}, 1375.0f, 468.0f, 875.0f);
        drawVoxelBox(g, camR, {0, 0, 0}, {0.5f, 0.5f, 0.5f},
                     ti == 5 ? Color(200, 236, 72, 153) : Color(130, 148, 163, 184), ti == 5 ? 2.0f : 1.4f);

        // 6 Face-Center Socket Markers (+X, -X, +Y, -Y, +Z, -Z)
        const V3 faceCenters[6] = {{0.5f,0,0},{-0.5f,0,0},{0,0.5f,0},{0,-0.5f,0},{0,0,0.5f},{0,0,-0.5f}};
        for (int d = 0; d < 6; ++d) {
            float sx, sy2, dep;
            if (camR.project(faceCenters[d], sx, sy2, dep)) {
                bool open = tg.sockets[d] > 0;
                SolidBrush fb(open ? Color(225, 16, 185, 129) : Color(90, 71, 85, 105));
                g.FillEllipse(&fb, sx - 4.8f, sy2 - 4.8f, 9.6f, 9.6f);
            }
        }

        if (tg.ne > 0) {
            for (int e = 0; e < tg.ne; ++e) {
                V3 a = toV3(tg.v[tg.e[e].u]);
                V3 b = toV3(tg.v[tg.e[e].v]);
                float x1, y1, d1, x2, y2, d2;
                if (camR.project(a, x1, y1, d1) && camR.project(b, x2, y2, d2)) {
                    Color ec = (ti == 5)
                        ? (e % 3 == 0 ? Color(255, 34, 211, 238) : (e % 3 == 1 ? Color(255, 236, 72, 153) : Color(255, 16, 185, 129)))
                        : Color(255, 56, 189, 248);
                    Pen pOut(Color(155, 10, 15, 24), 6.2f); pOut.SetStartCap(LineCapRound); pOut.SetEndCap(LineCapRound);
                    g.DrawLine(&pOut, x1, y1, x2, y2);
                    Pen p(ec, 4.2f); p.SetStartCap(LineCapRound); p.SetEndCap(LineCapRound);
                    g.DrawLine(&p, x1, y1, x2, y2);
                }
            }
        } else {
            drawShadowText(g, L"(Empty Void Voxel)", fS, 1375.0f, 480.0f, Color(160, 148, 163, 184), StringAlignmentCenter);
        }
        drawShadowText(g, tg.name, fM, 1375.0f, 808.0f,
                       ti == 5 ? Color(255, 110, 231, 183) : Color(235, 226, 232, 240), StringAlignmentCenter);

        drawHeaderLeft(g, L"Constituent Voxel Tiles & Socket Rules",
                       L"Six-direction socket matching across modular structural tiles");
    } else {
        // Stage B (5.4s): Live >= 2x2x2 Multi-Voxel WFC Collapse (2D Left + 3D Right) -> Vertex Welding
        float st = (float)(f - 180) / (float)(dur - 180);
        bool weldingPhase = (st >= 0.64f);
        float collapseProg = clamp01(st / 0.60f);
        int activeCells = min(CHAMP_VOXEL_NCELLS, max(1, (int)std::ceil(collapseProg * CHAMP_VOXEL_NCELLS)));
        float weldFade = weldingPhase ? smoothstep((st - 0.64f) / 0.32f) : 0.0f;

        // Left 2D Space: Isotropic Plan (XY Symmetry) + Elevation (XZ Stack) of the nx x ny x nz Voxel Grid
        Font fM(L"Calibri", 14.0f, FontStyleBold, UnitPoint);
        Font fS(L"Calibri", 13.0f, FontStyleRegular, UnitPoint);

        // 2D XY Plan View (x = 70..330, y = 330..590)
        float planSize = 210.0f;
        float px0 = 75.0f, py0 = 345.0f;
        float cellW_P = planSize / CHAMP_GRID_NX;
        float cellH_P = planSize / CHAMP_GRID_NY;
        drawShadowText(g, L"2D Plan (XY Mirror Symmetry)", fM, px0 + planSize * 0.5f, py0 - 30.0f, Color(230, 203, 213, 225), StringAlignmentCenter);
        for (int iy = 0; iy < CHAMP_GRID_NY; ++iy) {
            for (int ix = 0; ix < CHAMP_GRID_NX; ++ix) {
                float rx = px0 + ix * cellW_P;
                float ry = py0 + (CHAMP_GRID_NY - 1 - iy) * cellH_P;
                bool lit = false;
                for (int ci = 0; ci < activeCells; ++ci) {
                    if (CHAMP_VOXEL_CELLS[ci].ix == ix && CHAMP_VOXEL_CELLS[ci].iy == iy) { lit = true; break; }
                }
                SolidBrush cb(lit ? Color(95, 56, 189, 248) : Color(35, 30, 41, 59));
                g.FillRectangle(&cb, rx + 2.0f, ry + 2.0f, cellW_P - 4.0f, cellH_P - 4.0f);
                Pen cp(lit ? Color(210, 56, 189, 248) : Color(90, 71, 85, 105), 1.4f);
                g.DrawRectangle(&cp, rx + 2.0f, ry + 2.0f, cellW_P - 4.0f, cellH_P - 4.0f);
            }
        }
        // Symmetry axes on 2D Plan
        Pen symPen(Color(150, 236, 72, 153), 1.3f);
        symPen.SetDashStyle(DashStyleDash);
        g.DrawLine(&symPen, px0 + planSize * 0.5f, py0 - 8.0f, px0 + planSize * 0.5f, py0 + planSize + 8.0f);
        g.DrawLine(&symPen, px0 - 8.0f, py0 + planSize * 0.5f, px0 + planSize + 8.0f, py0 + planSize * 0.5f);

        // 2D XZ Elevation Stack (x = 400..650, isotropic 1:2 tower aspect ratio)
        float elevH = 340.0f;
        float elevW = elevH * 0.5f;
        float ex0 = 435.0f, ey0 = 280.0f;
        float cellW_E = elevW / CHAMP_GRID_NX;
        float cellH_E = elevH / CHAMP_GRID_NZ;
        drawShadowText(g, L"2D Elevation Stack", fM, ex0 + elevW * 0.5f, ey0 - 30.0f, Color(230, 203, 213, 225), StringAlignmentCenter);
        for (int iz = 0; iz < CHAMP_GRID_NZ; ++iz) {
            for (int ix = 0; ix < CHAMP_GRID_NX; ++ix) {
                float rx = ex0 + ix * cellW_E;
                float ry = ey0 + (CHAMP_GRID_NZ - 1 - iz) * cellH_E;
                bool lit = false;
                for (int ci = 0; ci < activeCells; ++ci) {
                    if (CHAMP_VOXEL_CELLS[ci].ix == ix && CHAMP_VOXEL_CELLS[ci].iz == iz) { lit = true; break; }
                }
                SolidBrush cb(lit ? Color(105, 16, 185, 129) : Color(35, 30, 41, 59));
                g.FillRectangle(&cb, rx + 2.0f, ry + 2.0f, cellW_E - 4.0f, cellH_E - 4.0f);
                Pen cp(lit ? Color(215, 16, 185, 129) : Color(90, 71, 85, 105), 1.4f);
                g.DrawRectangle(&cp, rx + 2.0f, ry + 2.0f, cellW_E - 4.0f, cellH_E - 4.0f);
            }
        }

        wchar_t gridCap[128];
        if (!weldingPhase)
            std::swprintf(gridCap, 128, L"Collapsed %d / %d Voxels  (%ls Grid)", activeCells, CHAMP_VOXEL_NCELLS, CHAMP_GRID_STR);
        else
            std::swprintf(gridCap, 128, L"Welded Single Component: %d Nodes  \u2022  %d Bars", CHAMP_NVERTS, CHAMP_NEDGES);
        drawShadowText(g, gridCap, fM, 345.0f, 675.0f, Color(255, 110, 231, 183), StringAlignmentCenter);

        // Right 3D Space: Multi-Voxel >=2x2x2 Collapse & Coincident Joint Welding
        Cam camR;
        camR.setup(-0.54f + st * 0.85f, 0.27f, 3.85f, {0, 0, 1.0f}, 1330.0f, 470.0f, 800.0f);
        drawGroundGrid(g, camR, 0.62f, 4);

        BYTE boxActiveAlpha = (BYTE)((1.0f - 0.82f * weldFade) * 165.0f);
        BYTE boxIdleAlpha = (BYTE)((1.0f - weldFade) * 52.0f);
        for (int ci = 0; ci < CHAMP_VOXEL_NCELLS; ++ci) {
            const auto& vc = CHAMP_VOXEL_CELLS[ci];
            bool act = (ci < activeCells);
            if (!act && boxIdleAlpha < 4) continue;
            drawVoxelBox(g, camR, {vc.cx, vc.cy, vc.cz}, {vc.hx, vc.hy, vc.hz},
                         act ? Color(boxActiveAlpha, 56, 189, 248) : Color(boxIdleAlpha, 148, 163, 184),
                         act ? 1.6f : 1.0f);
        }

        std::vector<V3> preV(CHAMP_NVERTS);
        for (int i = 0; i < CHAMP_NVERTS; ++i) preV[i] = toV3(CHAMP_PRE_WFC[i]);

        std::vector<Edge2> visEdges;
        std::vector<Color> visCols;
        for (int e = 0; e < CHAMP_NEDGES; ++e) {
            if (weldingPhase || CHAMP_EDGE_WFC_STEP[e] < activeCells) {
                visEdges.push_back(CHAMP_EDGES[e]);
                visCols.push_back(weldingPhase ? Color(255, 34, 211, 238)
                                               : (e % 2 == 0 ? Color(255, 56, 189, 248) : Color(255, 16, 185, 129)));
            }
        }
        if (!visEdges.empty()) {
            drawGraph3D(g, camR, preV, visEdges.data(), (int)visEdges.size(),
                        CHAMP_ANCHORS, weldingPhase ? CHAMP_NANCHORS : 0, visCols, 4.0f, weldingPhase);
        }

        if (!weldingPhase) {
            wchar_t b1[48];
            std::swprintf(b1, 48, L"%ls Voxel Grid", CHAMP_GRID_STR);
            drawHeaderLeft(g, L"Symmetric Multi-Voxel Grid Collapse",
                           L"Step-by-step collapse across the multi-cell tower grid",
                           {b1, L"XY Mirror Symmetry", L"Zero Dangling Bars"});
        } else {
            wchar_t b1[48], b2[48], b3[48];
            std::swprintf(b1, 48, L"%d Welded Nodes", CHAMP_NVERTS);
            std::swprintf(b2, 48, L"%d Compression Bars", CHAMP_NEDGES);
            std::swprintf(b3, 48, L"%d Ground Anchors", CHAMP_NANCHORS);
            drawHeaderLeft(g, L"Welded Centerline Structural Network",
                           L"Shared voxel corners weld into one continuous frame",
                           {b1, b2, b3});
        }
    }
}

// Ch 5 (frames 1260..1619, 12.0s): Compression-Only FDM, PQ Subdivision + 2D Unrolled Strips, & FEA Loop
static void renderCh5_FDM_PQ_FEA(Graphics& g, int lf, int len) {
    if (lf < 18) {
        drawChapterCard(g, L"04 \u00B7 FUNICULAR FORM & FABRICATION",
                        L"Compression Form-Finding, Planar Quads & Unrolled Strips",
                        smoothstep(lf < 9 ? lf / 6.0f : (18 - lf) / 6.0f));
        return;
    }
    int f = lf - 18;
    int stage = min(2, f / 114); // 3 stages x 114 frames (3.80s each >= 3.0s hold invariant!)
    float st = (float)(f - stage * 114) / 114.0f;

    Cam camR;
    camR.setup(-0.50f + ((float)f / 342.0f) * 1.10f, 0.27f, 3.80f, {0, 0, 1.0f}, 1390.0f, 470.0f, 810.0f);
    drawGroundGrid(g, camR, 0.62f, 4);

    if (stage == 0) {
        // STAGE A (3.80s): Continuous WFC -> Compression-Only FDM Relaxation + Force-Density Profile
        float relax = smoothstep(clamp01(st * 1.20f));
        std::vector<V3> curV(CHAMP_NVERTS);
        for (int i = 0; i < CHAMP_NVERTS; ++i)
            curV[i] = lerp3(toV3(CHAMP_PRE_WFC[i]), toV3(CHAMP_VERTS[i]), relax);

        float qMin = 1e9f, qMax = 0.1f;
        for (int i = 0; i < CHAMP_NEDGES; ++i) { qMin = min(qMin, CHAMP_Q[i]); qMax = max(qMax, CHAMP_Q[i]); }
        std::vector<Color> eCols(CHAMP_NEDGES);
        for (int i = 0; i < CHAMP_NEDGES; ++i) {
            float u = (CHAMP_Q[i] - qMin) / max(1e-4f, qMax - qMin);
            eCols[i] = heatMapColor(u * relax);
        }
        drawGraph3D(g, camR, curV, CHAMP_EDGES, CHAMP_NEDGES, CHAMP_ANCHORS, CHAMP_NANCHORS, eCols, 4.2f);

        // Left 2D Space: Per-Bar Force-Density Tuning Chart (100% Plain English!)
        float bx0 = 60.0f, by0 = 310.0f, bw = 755.0f, bh = 310.0f;
        Pen axP(Color(145, 148, 163, 184), 1.5f);
        g.DrawLine(&axP, bx0, by0 + bh, bx0 + bw, by0 + bh);
        g.DrawLine(&axP, bx0, by0, bx0, by0 + bh);
        Font fB(L"Calibri", 14.5f, FontStyleBold, UnitPoint);
        Font fS(L"Calibri", 13.5f, FontStyleRegular, UnitPoint);

        wchar_t qHdr[128];
        std::swprintf(qHdr, 128, L"Per-Bar Force-Density Profile  (%d Compression Bars)", CHAMP_NEDGES);
        drawShadowText(g, qHdr, fB, bx0, by0 - 32.0f, Color(255, 56, 189, 248));

        float stepW = bw / max(1, CHAMP_NEDGES);
        for (int i = 0; i < CHAMP_NEDGES; ++i) {
            float qCur = lerpf(qMin + 0.25f * (qMax - qMin), CHAMP_Q[i], relax);
            float h = clamp01(qCur / max(1.0f, qMax)) * (bh - 18.0f);
            bool hiQ = (qCur > qMin + 0.55f * (qMax - qMin));
            SolidBrush br(hiQ ? Color(255, 245, 158, 11) : Color(255, 34, 211, 238));
            g.FillRectangle(&br, bx0 + i * stepW + 1.5f, by0 + bh - h, max(3.0f, stepW - 3.5f), h);
        }
        drawShadowText(g, L"Amber = Stiffened Primary Legs   \u2022   Cyan = Compression Bracing", fS, bx0, by0 + bh + 16.0f, Color(215, 203, 213, 225));
        drawShadowText(g, L"100% Pure Axial Compression  \u2022  Zero Tension Bars Under Load", fB, bx0, by0 + bh + 48.0f, Color(255, 110, 231, 183));

        drawHeaderLeft(g, L"Compression-Only Funicular Relaxation",
                       L"Force-density tuning pulls bars into pure axial compression");
    } else if (stage == 1) {
        // STAGE B (3.80s): Longitudinal Subdivision + Planar-Quad Tubes + Linked 2D Unrolled Strip Sheet!
        const Color hiCols[4] = {
            Color(255, 34, 211, 238),  // Cyan
            Color(255, 16, 185, 129),  // Emerald
            Color(255, 245, 158, 11),  // Amber
            Color(255, 236, 72, 153)   // Coral-Pink
        };
        int nReveal = min(4, max(1, (int)(st * 5.0f) + 1));

        // Right 3D Space: Subdivided Planar-Quad Tubular Mesh with 4 Linked Highlighted Bars!
        drawOBJShadedCAD(g, camR, CHAMP_OBJ_VERTS, CHAMP_OBJ_FACES, CHAMP_OBJ_NFACES,
                         Color(255, 220, 224, 230), Color(205, 40, 48, 62),
                         CHAMP_OBJ_FACE_BAR, CHAMP_HIGHLIGHT_BARS, hiCols, nReveal);
        drawAnchorPins(g, camR, CHAMP_VERTS, CHAMP_ANCHORS, CHAMP_NANCHORS);

        // Left 2D Space: White-on-#070A10 1:1 Isotropic Per-Bar Unrolled Strip Patterns!
        Font fB(L"Calibri", 14.5f, FontStyleBold, UnitPoint);
        Font fS(L"Calibri", 13.5f, FontStyleRegular, UnitPoint);
        drawShadowText(g, L"2D Unrolled Per-Bar Cut & Fold Strip Sheet  (1:1 Scale)", fB, 60.0f, 208.0f, Color(255, 248, 250, 252));
        drawUnrolledSheet2D(g, 60.0f, 242.0f, 770.0f, 515.0f, CHAMP_HIGHLIGHT_BARS, hiCols, nReveal);

        wchar_t pqLine1[140], pqLine2[140];
        std::swprintf(pqLine1, 140, L"Max Quad Planarity Warp: %.4f mm  (Limit \u2264 0.50 mm)  \u2022  Subdivision Level %d",
                      CHAMP_MAX_WARP_MM, CHAMP_SUBDIV_LEVELS);
        std::swprintf(pqLine2, 140, L"White = Outer Cut Contours  \u2022  Cyan = Fold Creases  \u2022  Total Area: %.2f m\u00B2",
                      CHAMP_AREA_M2);
        drawShadowText(g, pqLine1, fB, 60.0f, 778.0f, Color(255, 110, 231, 183));
        drawShadowText(g, pqLine2, fS, 60.0f, 808.0f, Color(215, 203, 213, 225));

        drawHeaderLeft(g, L"Planar-Quad Tubes & Unrolled Cut Strips",
                       L"Subdivided tubular bars unroll into flat fabrication strips");
    } else {
        // STAGE C (3.80s): Air-Gapped Plaster FEA + Multi-Objective Convergence Chart
        float loadRamp = smoothstep(clamp01(st * 1.25f));
        float defScale = max(120.0f, min(1100.0f, 0.085f / max(0.00004f, CHAMP_DISP_MM * 0.001f))) * loadRamp;
        std::vector<V3> defV(CHAMP_NVERTS);
        for (int i = 0; i < CHAMP_NVERTS; ++i)
            defV[i] = toV3(CHAMP_VERTS[i]) + toV3(CHAMP_DISP[i]) * defScale;

        Pen gPen(Color(70, 148, 163, 184), 1.3f);
        for (int i = 0; i < CHAMP_NEDGES; ++i) {
            float x1, y1, d1, x2, y2, d2;
            if (camR.project(toV3(CHAMP_VERTS[CHAMP_EDGES[i].u]), x1, y1, d1) &&
                camR.project(toV3(CHAMP_VERTS[CHAMP_EDGES[i].v]), x2, y2, d2))
                g.DrawLine(&gPen, x1, y1, x2, y2);
        }

        float pkS = 0.12f;
        for (int i = 0; i < CHAMP_NEDGES; ++i) pkS = max(pkS, CHAMP_FEA[i].sigmaC_MPa);
        std::vector<Color> sCols(CHAMP_NEDGES);
        for (int i = 0; i < CHAMP_NEDGES; ++i)
            sCols[i] = heatMapColor(CHAMP_FEA[i].sigmaC_MPa / pkS);
        drawGraph3D(g, camR, defV, CHAMP_EDGES, CHAMP_NEDGES, CHAMP_ANCHORS, CHAMP_NANCHORS, sCols, 4.5f);

        Pen loadPen(Color(255, 245, 158, 11), 2.6f);
        loadPen.SetEndCap(LineCapArrowAnchor);
        float maxZ = 0.0f;
        for (int i = 0; i < CHAMP_NVERTS; ++i) maxZ = max(maxZ, CHAMP_VERTS[i].z);
        for (int i = 0; i < CHAMP_NVERTS; ++i) {
            if (CHAMP_VERTS[i].z >= 0.85f * maxZ) {
                float x1, y1, d1, x2, y2, d2;
                if (camR.project(defV[i] + V3{0, 0, 0.32f}, x1, y1, d1) && camR.project(defV[i] + V3{0, 0, 0.04f}, x2, y2, d2))
                    g.DrawLine(&loadPen, x1, y1, x2, y2);
            }
        }

        // Left Top: Multi-Objective Convergence Chart (Unrolled Area, Bar Count, Funicular Efficiency)
        float cx0 = 60.0f, cy0 = 282.0f, cw = 740.0f, ch = 232.0f;
        Pen axP(Color(145, 148, 163, 184), 1.5f);
        g.DrawLine(&axP, cx0, cy0 + ch, cx0 + cw, cy0 + ch);
        g.DrawLine(&axP, cx0, cy0, cx0, cy0 + ch);

        float maxA0 = max(0.1f, max(CONV_AREA_M2[0], CONV_AREA_M2[1]));
        float maxB0 = max(1.0f, max(CONV_BARS[0], CONV_BARS[1]));
        float prog = smoothstep(clamp01(st * 1.25f));

        Pen pArea(Color(255, 56, 189, 248), 3.4f);
        Pen pBars(Color(255, 236, 72, 153), 3.2f);
        Pen pEff(Color(255, 16, 185, 129), 3.6f);
        for (int i = 0; i < 3; ++i) {
            float segT = clamp01(prog * 3.0f - i);
            if (segT <= 0.0f) break;
            float x1 = cx0 + (i / 3.0f) * cw;
            float x2 = cx0 + ((i + segT) / 3.0f) * cw;
            float a1 = cy0 + ch - clamp01(CONV_AREA_M2[i] / maxA0) * (ch - 18.0f);
            float a2 = cy0 + ch - clamp01(lerpf(CONV_AREA_M2[i], CONV_AREA_M2[i+1], segT) / maxA0) * (ch - 18.0f);
            float b1 = cy0 + ch - clamp01(CONV_BARS[i] / maxB0) * (ch - 18.0f);
            float b2 = cy0 + ch - clamp01(lerpf(CONV_BARS[i], CONV_BARS[i+1], segT) / maxB0) * (ch - 18.0f);
            float e1 = cy0 + ch - clamp01(CONV_FUN_EFF[i]) * (ch - 18.0f);
            float e2 = cy0 + ch - clamp01(lerpf(CONV_FUN_EFF[i], CONV_FUN_EFF[i+1], segT)) * (ch - 18.0f);
            g.DrawLine(&pArea, x1, a1, x2, a2);
            g.DrawLine(&pBars, x1, b1, x2, b2);
            g.DrawLine(&pEff, x1, e1, x2, e2);
        }

        Font fS(L"Calibri", 13.0f, FontStyleBold, UnitPoint);
        const wchar_t* rLbls[4] = {L"Baseline", L"Round 1", L"Round 2", L"Champion"};
        for (int i = 0; i < 4; ++i)
            drawShadowText(g, rLbls[i], fS, cx0 + (i / 3.0f) * cw, cy0 + ch + 10.0f, Color(200, 148, 163, 184), StringAlignmentCenter);

        wchar_t leg1[128], leg2[128];
        std::swprintf(leg1, 128, L"Cyan: Unrolled Area (%.2f \u2192 %.2f m\u00B2)   \u2022   Pink: Bars (%.0f \u2192 %.0f)",
                      CONV_AREA_M2[0], CHAMP_AREA_M2, CONV_BARS[0], (float)CHAMP_BAR_COUNT);
        std::swprintf(leg2, 128, L"Emerald: Funicular Compression Efficiency (%.0f%% \u2192 %.1f%%)",
                      CONV_FUN_EFF[0] * 100.0f, CHAMP_FUN_EFF * 100.0f);
        drawShadowText(g, leg1, fS, cx0, cy0 - 54.0f, Color(235, 186, 230, 253));
        drawShadowText(g, leg2, fS, cx0, cy0 - 28.0f, Color(255, 110, 231, 183));

        // Left Bottom: Plain-English Air-Gapped FEA Scorecard (strictly y <= 810!)
        Font fH(L"Calibri", 16.0f, FontStyleBold, UnitPoint);
        Font fV(L"Calibri", 14.5f, FontStyleRegular, UnitPoint);
        float ly = 580.0f;
        drawShadowText(g, L"Independent Cast-Plaster Structural Verification (+50 kg)", fH, cx0, ly, Color(255, 110, 231, 183));
        wchar_t s1[128], s2[128], s3[128], s4[128];
        std::swprintf(s1, 128, L"Max Deflection:  %.3f mm  (Allowable Limit 3.33 mm)", CHAMP_DISP_MM);
        std::swprintf(s2, 128, L"Axial State:  100%% Pure Compression  (Zero Brittle Tension)");
        std::swprintf(s3, 128, L"Safety Margins:  %.1f\u00D7 Crushing  \u2022  %.1f\u00D7 Euler Buckling",
                      min(99.9f, CHAMP_SF_COMP), min(99.9f, CHAMP_SF_BUCK));
        std::swprintf(s4, 128, L"5%% Lateral Stability Drift:  %.3f mm  (Safety %.1f\u00D7)",
                      CHAMP_LAT_DISP_MM, min(99.9f, CHAMP_LAT_SF));
        drawShadowText(g, s1, fV, cx0, ly + 38.0f, Color(255, 56, 189, 248));
        drawShadowText(g, s2, fV, cx0, ly + 70.0f, Color(255, 110, 231, 183));
        drawShadowText(g, s3, fV, cx0, ly + 102.0f, Color(240, 226, 232, 240));
        drawShadowText(g, s4, fV, cx0, ly + 134.0f, Color(255, 252, 211, 77));

        drawHeaderLeft(g, L"Air-Gapped Plaster Structural Verification",
                       L"Independent space-frame solver confirms pure compression");
    }
}

// Ch 6 (frames 1620..1799, 6.0s): Verified Pilot v2 Champion + Complete 2D Unrolled Strip Sheet Finale
static void renderCh6_Hero(Graphics& g, int lf, int len) {
    if (lf < 18) {
        drawChapterCard(g, L"05 \u00B7 VERIFIED FABRICATION CHAMPION",
                        L"Watertight Planar-Quad Tower & Cut-Ready Strip Sheet",
                        smoothstep(lf < 9 ? lf / 6.0f : (18 - lf) / 6.0f));
        return;
    }
    int f = lf - 18;
    float t = (float)f / (float)(len - 18);

    // Left Zone (x = 48..608, y = 260..790): Complete 1:1 Isotropic White-on-#070A10 Unrolled Strip Sheet
    Font fS(L"Calibri", 14.0f, FontStyleBold, UnitPoint);
    drawUnrolledSheet2D(g, 52.0f, 268.0f, 550.0f, 515.0f);
    wchar_t sheetLbl[128];
    std::swprintf(sheetLbl, 128, L"Cut-Ready 2D Strip Sheet  \u2022  %.2f m\u00B2 Total Area", CHAMP_AREA_M2);
    drawShadowText(g, sheetLbl, fS, 327.0f, 810.0f, Color(235, 203, 213, 225), StringAlignmentCenter);

    // Right Hero 3D Viewport (cx = 1175): Watertight Planar-Quad Tubular Plaster Tower
    Cam cam;
    cam.setup(-0.52f + t * 0.88f, 0.26f, 3.65f, {0, 0, 1.0f}, 1175.0f, 472.0f, 840.0f);
    drawGroundGrid(g, cam, 0.64f, 4);
    drawOBJShadedCAD(g, cam, CHAMP_OBJ_VERTS, CHAMP_OBJ_FACES, CHAMP_OBJ_NFACES,
                     Color(255, 232, 228, 220), Color(205, 40, 48, 62));
    drawAnchorPins(g, cam, CHAMP_VERTS, CHAMP_ANCHORS, CHAMP_NANCHORS, 6.2f);

    // 3 Steady, Non-Pulsing Calm CAD Leader Callouts (clamped cleanly inside right margin!)
    float tx, ty, td;
    wchar_t ld1[96], ld2[96], ld3[96];
    std::swprintf(ld1, 96, L"50 kg Load  \u2022  %.3f mm Deflection", CHAMP_DISP_MM);
    std::swprintf(ld2, 96, L"%ls Planar-Quad Tubes", CHAMP_SEC_STR);
    std::swprintf(ld3, 96, L"%d Pinned Anchors  \u2022  100%% Compression", CHAMP_NANCHORS);

    if (cam.project({0.0f, 0.0f, 1.95f}, tx, ty, td))
        drawCalmCadLeader(g, tx, ty, min(tx + 185.0f, 1445.0f), ty - 18.0f, ld1, Color(255, 110, 231, 183));
    if (cam.project({0.16f, -0.16f, 1.02f}, tx, ty, td))
        drawCalmCadLeader(g, tx, ty, min(tx + 205.0f, 1445.0f), ty + 8.0f, ld2, Color(255, 56, 189, 248));
    if (cam.project(toV3(CHAMP_VERTS[CHAMP_ANCHORS[0]]), tx, ty, td))
        drawCalmCadLeader(g, tx, ty, min(tx + 195.0f, 1445.0f), min(ty - 8.0f, 760.0f), ld3, Color(255, 248, 250, 252));

    wchar_t b1[64], b2[64], b3[64], b4[64];
    std::swprintf(b1, 64, L"%.2f m\u00B2 Unrolled Area", CHAMP_AREA_M2);
    std::swprintf(b2, 64, L"%d Pure-Compression Bars", CHAMP_BAR_COUNT);
    std::swprintf(b3, 64, L"%.2f kg Cast Plaster", CHAMP_MASS_KG);
    std::swprintf(b4, 64, L"Max Warp %.4f mm", CHAMP_MAX_WARP_MM);

    drawHeaderLeft(g, L"Verified Cast-Plaster Fabrication Champion",
                   L"Watertight planar-quad tower paired with cut-ready strip sheet",
                   {b1, b2, b3, b4});

    // Smooth fade to black on final 15 frames
    if (f > len - 18 - 15) {
        float fa = (float)(f - (len - 18 - 15)) / 15.0f;
        SolidBrush fade(Color((BYTE)(clamp01(fa) * 255.0f), 5, 6, 8));
        g.FillRectangle(&fade, 0, 0, OUT_W, OUT_H);
    }
}

static void renderFrame(Graphics& g, int frame) {
    SolidBrush bg(Color(255, 7, 10, 16));
    g.FillRectangle(&bg, 0, 0, OUT_W, OUT_H);

    if (frame < CH_START[1]) {
        float a = (frame < 12) ? frame / 12.0f : (frame > 48 ? (60 - frame) / 12.0f : 1.0f);
        drawChapterCard(g, L"WFC \u00B7 FDM CAST PLASTER FOUNDRY",
                        L"Compression-Only Planar-Quad Towers & Unrolled Patterns", smoothstep(a));
    } else if (frame < CH_START[2]) {
        renderCh1_Opener(g, frame - CH_START[1], CH_START[2] - CH_START[1]);
    } else if (frame < CH_START[3]) {
        renderCh2_Exploration(g, frame - CH_START[2], CH_START[3] - CH_START[2]);
    } else if (frame < CH_START[4]) {
        renderCh3_Candidates(g, frame - CH_START[3], CH_START[4] - CH_START[3]);
    } else if (frame < CH_START[5]) {
        renderCh4_WFCTiles(g, frame - CH_START[4], CH_START[5] - CH_START[4]);
    } else if (frame < CH_START[6]) {
        renderCh5_FDM_PQ_FEA(g, frame - CH_START[5], CH_START[6] - CH_START[5]);
    } else {
        renderCh6_Hero(g, frame - CH_START[6], CH_START[7] - CH_START[6]);
    }
}

// ============================================================
//  PNG ENCODER + MF H.264 WRITER & POST-ENCODE DECODER VERIFY
// ============================================================
static int getPngClsid(CLSID* pClsid) {
    UINT num = 0, size = 0;
    GetImageEncodersSize(&num, &size);
    if (!size) return -1;
    std::vector<BYTE> buf(size);
    auto* pInfo = reinterpret_cast<ImageCodecInfo*>(buf.data());
    GetImageEncoders(num, size, pInfo);
    for (UINT j = 0; j < num; ++j) {
        if (wcscmp(pInfo[j].MimeType, L"image/png") == 0) { *pClsid = pInfo[j].Clsid; return (int)j; }
    }
    return -1;
}

static void verifyDecodedMP4(const std::wstring& mp4Path, const std::wstring& verifyPngPath) {
    IMFSourceReader* reader = nullptr;
    IMFAttributes* attrs = nullptr;
    MFCreateAttributes(&attrs, 1);
    attrs->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, TRUE);
    if (FAILED(MFCreateSourceReaderFromURL(mp4Path.c_str(), attrs, &reader))) {
        if (attrs) attrs->Release();
        std::printf("WARN: Could not open MP4 for post-decode verify.\n");
        return;
    }
    if (attrs) attrs->Release();

    IMFMediaType* outType = nullptr;
    MFCreateMediaType(&outType);
    outType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    outType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
    reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr, outType);
    outType->Release();

    // Sample all 6 active chapters: Opener, Exploration+FEA, Lineup, >=2x2x2 WFC, PQ+Unrolled Strips, Hero
    const int sampleFrames[6] = {135, 440, 800, 1140, 1450, 1720};
    const int tw = 640, th = 360;
    Bitmap sheet(tw * 3, th * 2, PixelFormat32bppARGB);
    Graphics sg(&sheet);
    sg.SetInterpolationMode(InterpolationModeHighQualityBicubic);
    SolidBrush bg(Color(255, 7, 10, 16));
    sg.FillRectangle(&bg, 0, 0, tw * 3, th * 2);

    int curF = 0, got = 0;
    while (got < 6) {
        DWORD flags = 0;
        LONGLONG ts = 0;
        IMFSample* sample = nullptr;
        HRESULT hr = reader->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, nullptr, &flags, &ts, &sample);
        if (FAILED(hr) || (flags & MF_SOURCE_READERF_ENDOFSTREAM)) break;
        if (sample) {
            if (curF == sampleFrames[got]) {
                IMFMediaBuffer* buf = nullptr;
                sample->ConvertToContiguousBuffer(&buf);
                BYTE* ptr = nullptr;
                DWORD len = 0;
                if (buf && SUCCEEDED(buf->Lock(&ptr, nullptr, &len))) {
                    Bitmap frm(OUT_W, OUT_H, OUT_W * 4, PixelFormat32bppRGB, ptr);
                    int col = got % 3, row = got / 3;
                    sg.DrawImage(&frm, Rect(col * tw, row * th, tw, th));
                    buf->Unlock();
                }
                if (buf) buf->Release();
                got++;
            }
            sample->Release();
            curF++;
        }
    }
    reader->Release();

    CLSID pngClsid;
    if (getPngClsid(&pngClsid) >= 0) sheet.Save(verifyPngPath.c_str(), &pngClsid, nullptr);
    std::printf("Post-encode IMFSourceReader verification decoded %d/6 frames -> saved verify PNG.\n", got);
}

int main() {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    MFStartup(MF_VERSION);
    GdiplusStartupInput gdiIn;
    ULONG_PTR gdiTok = 0;
    GdiplusStartup(&gdiTok, &gdiIn, nullptr);

    std::wstring mp4Path = L"WFC_FDM_Foundry\\foundry_showcase_60s.mp4";
    std::wstring sheetPath = L"WFC_FDM_Foundry\\video_build\\contact_sheet_foundry_60s.png";
    std::wstring verifyPath = L"WFC_FDM_Foundry\\video_build\\mp4_decoded_foundry_60s_verify.png";

    {
        IMFSinkWriter* writer = nullptr;
        IMFAttributes* wAttr = nullptr;
        MFCreateAttributes(&wAttr, 1);
        wAttr->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
        HRESULT hr = MFCreateSinkWriterFromURL(mp4Path.c_str(), nullptr, wAttr, &writer);
        if (wAttr) wAttr->Release();
        if (FAILED(hr)) { std::printf("ERROR: MFCreateSinkWriterFromURL failed 0x%08X\n", (unsigned)hr); return 1; }

        IMFMediaType* outType = nullptr;
        MFCreateMediaType(&outType);
        outType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        outType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
        outType->SetUINT32(MF_MT_AVG_BITRATE, BITRATE);
        outType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        MFSetAttributeSize(outType, MF_MT_FRAME_SIZE, OUT_W, OUT_H);
        MFSetAttributeRatio(outType, MF_MT_FRAME_RATE, FPS, 1);
        MFSetAttributeRatio(outType, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
        DWORD streamIdx = 0;
        hr = writer->AddStream(outType, &streamIdx);
        outType->Release();

        IMFMediaType* inType = nullptr;
        MFCreateMediaType(&inType);
        inType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        inType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
        inType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        inType->SetUINT32(MF_MT_DEFAULT_STRIDE, (UINT32)(OUT_W * 4)); // Top-down positive stride!
        MFSetAttributeSize(inType, MF_MT_FRAME_SIZE, OUT_W, OUT_H);
        MFSetAttributeRatio(inType, MF_MT_FRAME_RATE, FPS, 1);
        MFSetAttributeRatio(inType, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
        hr = writer->SetInputMediaType(streamIdx, inType, nullptr);
        inType->Release();

        hr = writer->BeginWriting();
        if (FAILED(hr)) { std::printf("ERROR: BeginWriting failed 0x%08X\n", (unsigned)hr); return 1; }

        // 4x4 Contact Sheet sampling all chapters, >=2x2x2 WFC collapse, PQ+Unrolled strips & FEA
        const int cFrames[16] = {
            135, 255, 345, 440,
            540, 670, 800, 935,
            1010, 1085, 1140, 1235,
            1340, 1450, 1565, 1720
        };
        const int cw = 480, ch = 270;
        Bitmap contactSheet(cw * 4, ch * 4, PixelFormat32bppARGB);
        Graphics csG(&contactSheet);
        csG.SetInterpolationMode(InterpolationModeHighQualityBicubic);
        int nextCs = 0;

        Bitmap frameBmp(OUT_W, OUT_H, PixelFormat32bppARGB);
        Graphics g(&frameBmp);
        g.SetSmoothingMode(SmoothingModeHighQuality);
        g.SetPixelOffsetMode(PixelOffsetModeHighQuality);
        g.SetTextRenderingHint(TextRenderingHintAntiAliasGridFit);

        const LONGLONG frameDur = 10000000LL / FPS;
        const DWORD frameBytes = OUT_W * OUT_H * 4;

        for (int f = 0; f < TOTAL_FRAMES; ++f) {
            renderFrame(g, f);

            if (nextCs < 16 && f == cFrames[nextCs]) {
                csG.DrawImage(&frameBmp, Rect((nextCs % 4) * cw, (nextCs / 4) * ch, cw, ch));
                nextCs++;
            }

            BitmapData bd;
            Rect lockRect(0, 0, OUT_W, OUT_H);
            frameBmp.LockBits(&lockRect, ImageLockModeRead, PixelFormat32bppARGB, &bd);

            IMFMediaBuffer* buf = nullptr;
            MFCreateMemoryBuffer(frameBytes, &buf);
            BYTE* dst = nullptr;
            buf->Lock(&dst, nullptr, nullptr);
            const BYTE* src = static_cast<const BYTE*>(bd.Scan0);
            for (int y = 0; y < OUT_H; ++y)
                std::memcpy(dst + y * OUT_W * 4, src + y * bd.Stride, OUT_W * 4);
            buf->Unlock();
            buf->SetCurrentLength(frameBytes);
            frameBmp.UnlockBits(&bd);

            IMFSample* sample = nullptr;
            MFCreateSample(&sample);
            sample->AddBuffer(buf);
            sample->SetSampleTime((LONGLONG)f * frameDur);
            sample->SetSampleDuration(frameDur);
            writer->WriteSample(streamIdx, sample);
            sample->Release();
            buf->Release();

            if (f % 300 == 0 || f == TOTAL_FRAMES - 1)
                std::printf("Encoded frame %d / %d (%.1f%%)\n", f + 1, TOTAL_FRAMES, 100.0 * (f + 1) / TOTAL_FRAMES);
        }

        writer->Finalize();
        writer->Release();

        CLSID pngClsid;
        if (getPngClsid(&pngClsid) >= 0) contactSheet.Save(sheetPath.c_str(), &pngClsid, nullptr);
        std::printf("Saved contact sheet and finished encoding %ls (60.0s @ 30 FPS).\n", mp4Path.c_str());

        verifyDecodedMP4(mp4Path, verifyPath);
    }

    GdiplusShutdown(gdiTok);
    MFShutdown();
    CoUninitialize();
    return 0;
}
