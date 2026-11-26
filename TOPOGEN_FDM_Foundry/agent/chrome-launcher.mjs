import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

let injectedLauncherHook = null;

export function setChromeLauncherHook(fn) {
  injectedLauncherHook = typeof fn === 'function' ? fn : null;
}

export function getChromeLauncherHook() {
  return injectedLauncherHook;
}

function fileExists(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return false;
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function queryWindowsRegistryChrome() {
  const keys = [
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
  ];
  for (const key of keys) {
    try {
      const res = spawnSync('reg', ['query', key, '/ve'], {
        encoding: 'utf8',
        timeout: 2500,
        windowsHide: true,
      });
      if (res.status !== 0 || !res.stdout) continue;
      const match = res.stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)$/im);
      if (!match) continue;
      const candidate = match[1].trim().replace(/^"(.*)"$/, '$1');
      if (fileExists(candidate)) {
        return { found: true, chromePath: candidate, source: `registry:${key}` };
      }
    } catch {
      // Ignore registry lookup failures
    }
  }
  return null;
}

function queryCommandPath(lookupCmd, targetBin) {
  try {
    const res = spawnSync(lookupCmd, [targetBin], {
      encoding: 'utf8',
      timeout: 2500,
      windowsHide: true,
    });
    if (res.status !== 0 || !res.stdout) return null;
    for (const line of res.stdout.split(/\r?\n/)) {
      const candidate = line.trim().replace(/^"(.*)"$/, '$1');
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Ignore lookup command errors
  }
  return null;
}

export function discoverChromeBinary({ env = process.env, platform = process.platform } = {}) {
  const envBin = typeof env?.TOPOGEN_CHROME_BIN === 'string' ? env.TOPOGEN_CHROME_BIN.trim() : '';
  if (envBin) {
    const cleaned = envBin.replace(/^"(.*)"$/, '$1');
    if (fileExists(cleaned)) {
      return { found: true, chromePath: path.resolve(cleaned), source: 'env:TOPOGEN_CHROME_BIN' };
    }
    const resolvedFromPath = queryCommandPath(platform === 'win32' ? 'where.exe' : 'which', cleaned);
    if (resolvedFromPath) {
      return { found: true, chromePath: resolvedFromPath, source: 'env:TOPOGEN_CHROME_BIN' };
    }
  }

  if (platform === 'win32') {
    const roots = [
      env?.ProgramFiles || 'C:\\Program Files',
      env?.['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      env?.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    ];
    for (const root of roots) {
      if (!root) continue;
      const candidate = path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
      if (fileExists(candidate)) {
        return { found: true, chromePath: candidate, source: 'windows:standard-path' };
      }
    }

    const regHit = queryWindowsRegistryChrome();
    if (regHit) return regHit;

    const whereHit = queryCommandPath('where.exe', 'chrome.exe');
    if (whereHit) {
      return { found: true, chromePath: whereHit, source: 'windows:where' };
    }

    return { found: false, chromePath: null, source: null };
  }

  if (platform === 'darwin') {
    const macCandidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
    ];
    for (const candidate of macCandidates) {
      if (fileExists(candidate)) {
        return { found: true, chromePath: candidate, source: 'macos:app-bundle' };
      }
    }
    const whichHit = queryCommandPath('which', 'google-chrome');
    if (whichHit) {
      return { found: true, chromePath: whichHit, source: 'macos:which' };
    }
    return { found: false, chromePath: null, source: null };
  }

  const linuxNames = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const linuxDirs = ['/usr/bin', '/usr/local/bin', '/snap/bin'];
  for (const name of linuxNames) {
    const whichHit = queryCommandPath('which', name);
    if (whichHit) {
      return { found: true, chromePath: whichHit, source: `linux:which:${name}` };
    }
    for (const dir of linuxDirs) {
      const candidate = path.join(dir, name);
      if (fileExists(candidate)) {
        return { found: true, chromePath: candidate, source: `linux:path:${candidate}` };
      }
    }
  }

  return { found: false, chromePath: null, source: null };
}

export function buildFoundryTargetUrl({
  port = 8787,
  host = '127.0.0.1',
  surface = 'workbench',
  conversationId = null,
  launchId = null,
} = {}) {
  const pathname = surface === 'launcher'
    ? '/foundry_launcher.html'
    : '/index_TOPOGEN_PQM_ELASTICA_FDM.html';
  const params = [];
  if (typeof conversationId === 'string' && conversationId.trim()) {
    params.push(`conv=${encodeURIComponent(conversationId.trim())}`);
  }
  if (typeof launchId === 'string' && launchId.trim()) {
    params.push(`launch=${encodeURIComponent(launchId.trim())}`);
  }
  const qs = params.length > 0 ? `?${params.join('&')}` : '';
  return `http://${host}:${port}${pathname}${qs}`;
}

function splitCommandTokens(raw) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function spawnDetachedChecked(command, args, spawnOptions, waitSpawnMs = 150) {
  return new Promise(resolve => {
    let settled = false;
    let child;
    try {
      child = spawn(command, args, spawnOptions);
    } catch (err) {
      resolve({
        ok: false,
        code: err?.code || 'CHROME_SPAWN_FAILED',
        error: err?.message || String(err),
      });
      return;
    }

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.unref(); } catch {}
      resolve(result);
    };

    child.once('error', err => {
      finish({
        ok: false,
        code: err?.code || 'CHROME_SPAWN_FAILED',
        error: err?.message || String(err),
      });
    });

    child.once('spawn', () => {
      finish({
        ok: true,
        pid: child.pid || null,
      });
    });

    const timer = setTimeout(() => {
      finish({
        ok: true,
        pid: child.pid || null,
      });
    }, waitSpawnMs);
  });
}

function quoteWindowsArg(arg) {
  const s = String(arg ?? '');
  if (!s.length) return '""';
  if (!/[\s"&|<>^()]/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

export function inspectWindowsDesktopSession({
  env = process.env,
  platform = process.platform,
  forceWin32Probe = false,
  timeoutMs = 3000,
} = {}) {
  if (platform !== 'win32') {
    return {
      platform,
      interactive: true,
      windowStation: null,
      sessionName: null,
      hasExplorer: null,
      probed: false,
    };
  }

  const sessionName = typeof env?.SESSIONNAME === 'string' ? env.SESSIONNAME.trim() : '';
  if (!forceWin32Probe && /^(?:Console|RDP-Tcp)/i.test(sessionName)) {
    return {
      platform: 'win32',
      interactive: true,
      windowStation: 'WinSta0',
      sessionName,
      hasExplorer: true,
      probed: false,
    };
  }

  const psScript = `
$ErrorActionPreference = 'Stop'
$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TopogenWinStaProbe {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool GetUserObjectInformationW(IntPtr hObj, int nIndex, StringBuilder pvInfo, int nLength, out int lpnLengthNeeded);
  public static string GetStationName() {
    IntPtr h = GetProcessWindowStation();
    if (h == IntPtr.Zero) return "";
    int needed = 0;
    GetUserObjectInformationW(h, 2, null, 0, out needed);
    if (needed <= 0) return "";
    StringBuilder sb = new StringBuilder(needed / 2 + 2);
    if (GetUserObjectInformationW(h, 2, sb, needed, out needed)) return sb.ToString().TrimEnd('\\0');
    return "";
  }
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue | Out-Null
$station = ''
try { $station = [TopogenWinStaProbe]::GetStationName() } catch { $station = '' }
$hasExplorer = @(Get-Process -Name explorer -ErrorAction SilentlyContinue).Count -gt 0
$interactive = ($station -ieq 'WinSta0')
@{
  windowStation = $station
  interactive = $interactive
  hasExplorer = $hasExplorer
  sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
} | ConvertTo-Json -Compress
`;

  try {
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env }
    );
    if (res.status === 0 && res.stdout) {
      const parsed = JSON.parse(res.stdout.trim());
      return {
        platform: 'win32',
        interactive: Boolean(parsed.interactive),
        windowStation: typeof parsed.windowStation === 'string' && parsed.windowStation ? parsed.windowStation : null,
        sessionName: sessionName || null,
        hasExplorer: Boolean(parsed.hasExplorer),
        sessionId: typeof parsed.sessionId === 'number' ? parsed.sessionId : null,
        probed: true,
      };
    }
  } catch {
    // Fall through to conservative default
  }

  const fallbackInteractive = sessionName !== '' && !/^services$/i.test(sessionName);
  return {
    platform: 'win32',
    interactive: fallbackInteractive,
    windowStation: fallbackInteractive ? 'WinSta0' : null,
    sessionName: sessionName || null,
    hasExplorer: null,
    probed: false,
  };
}

export function findVisibleChromeWindows({
  timeoutMs = 5000,
  platform = process.platform,
  env = process.env,
} = {}) {
  if (platform !== 'win32') {
    return { ok: true, unsupported: true, platform, windows: [] };
  }

  const psScript = `
$ErrorActionPreference = 'Stop'
$code = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TopogenWin32Enum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  public static List<object> ListForPids(HashSet<uint> pids) {
    var list = new List<object>();
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      uint pid = 0;
      GetWindowThreadProcessId(hWnd, out pid);
      if (!pids.Contains(pid)) return true;
      RECT r;
      if (!GetWindowRect(hWnd, out r)) return true;
      int w = r.Right - r.Left;
      int h = r.Bottom - r.Top;
      if (w <= 0 || h <= 0) return true;
      var sb = new StringBuilder(512);
      GetWindowTextW(hWnd, sb, sb.Capacity);
      list.Add(new {
        pid = (int)pid,
        hwnd = hWnd.ToInt64(),
        title = sb.ToString(),
        width = w,
        height = h,
        visible = true
      });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue | Out-Null
$chromePids = New-Object 'System.Collections.Generic.HashSet[uint32]'
foreach ($p in (Get-Process -Name chrome -ErrorAction SilentlyContinue)) {
  [void]$chromePids.Add([uint32]$p.Id)
}
$wins = @()
if ($chromePids.Count -gt 0) {
  $wins = @([TopogenWin32Enum]::ListForPids($chromePids))
}
@{ ok = $true; chromeProcessCount = $chromePids.Count; windows = $wins } | ConvertTo-Json -Compress -Depth 4
`;

  try {
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env }
    );
    if (res.status !== 0 || !res.stdout) {
      return {
        ok: false,
        platform: 'win32',
        windows: [],
        error: (res.stderr || res.error?.message || 'EnumWindows probe failed').trim(),
      };
    }
    const parsed = JSON.parse(res.stdout.trim());
    const rawWins = Array.isArray(parsed.windows)
      ? parsed.windows
      : (parsed.windows ? [parsed.windows] : []);
    return {
      ok: true,
      platform: 'win32',
      chromeProcessCount: Number(parsed.chromeProcessCount || 0),
      windows: rawWins,
    };
  } catch (err) {
    return {
      ok: false,
      platform: 'win32',
      windows: [],
      error: err?.message || String(err),
    };
  }
}

export function spawnChromeWindowsInteractiveFallback(chromePath, args = [], {
  env = process.env,
  timeoutMs = 6000,
} = {}) {
  const argStr = args.map(quoteWindowsArg).join(' ');
  const psScript = `
$ErrorActionPreference = 'Stop'
$exe = $env:TOPOGEN_LAUNCH_EXE
$argStr = $env:TOPOGEN_LAUNCH_ARG_STR
$argList = @($env:TOPOGEN_LAUNCH_ARGS_JSON | ConvertFrom-Json)

# Tier 1: Out-of-proc Explorer COM Shell.Application (attaches directly to interactive WinSta0\\Default)
try {
  $shell = New-Object -ComObject Shell.Application
  $shell.ShellExecute($exe, $argStr, '', 'open', 1)
  @{ ok = $true; strategy = 'shell-explorer'; pid = $null; windowStation = 'WinSta0\\Default' } | ConvertTo-Json -Compress
  exit 0
} catch {
  $err1 = $_.Exception.Message
}

# Tier 2: Win32_Process.Create with explicit WinSta0\\Default + SW_SHOWNORMAL
try {
  $startupClass = [wmiclass]'Win32_ProcessStartup'
  $startup = $startupClass.CreateInstance()
  $startup.ShowWindow = 1
  $startup.WinstationDesktop = 'WinSta0\\Default'
  $cmdLine = '"' + $exe + '"' + $(if ($argStr) { ' ' + $argStr } else { '' })
  $procClass = [wmiclass]'Win32_Process'
  $created = $procClass.Create($cmdLine, $null, $startup)
  if ($created.ReturnValue -eq 0) {
    @{ ok = $true; strategy = 'wmi-win32-process'; pid = [int]$created.ProcessId; windowStation = 'WinSta0\\Default' } | ConvertTo-Json -Compress
    exit 0
  }
  $err2 = "Win32_Process.Create returned $($created.ReturnValue)"
} catch {
  $err2 = $_.Exception.Message
}

# Tier 3: Start-Process -WindowStyle Normal
try {
  $p = Start-Process -FilePath $exe -ArgumentList $argList -WindowStyle Normal -PassThru
  @{ ok = $true; strategy = 'start-process'; pid = $(if ($p) { [int]$p.Id } else { $null }); windowStation = 'WinSta0\\Default' } | ConvertTo-Json -Compress
  exit 0
} catch {
  $err3 = $_.Exception.Message
}

@{ ok = $false; code = 'WIN32_INTERACTIVE_SPAWN_FAILED'; error = "Explorer: $err1 | WMI: $err2 | Start-Process: $err3" } | ConvertTo-Json -Compress
exit 1
`;

  try {
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
        env: {
          ...env,
          TOPOGEN_LAUNCH_EXE: chromePath,
          TOPOGEN_LAUNCH_ARG_STR: argStr,
          TOPOGEN_LAUNCH_ARGS_JSON: JSON.stringify(args),
        },
      }
    );
    const out = (res.stdout || '').trim();
    if (out) {
      const parsed = JSON.parse(out);
      return parsed;
    }
    return {
      ok: false,
      code: 'WIN32_INTERACTIVE_SPAWN_FAILED',
      error: (res.stderr || res.error?.message || 'Interactive Windows spawn returned no output').trim(),
    };
  } catch (err) {
    return {
      ok: false,
      code: 'WIN32_INTERACTIVE_SPAWN_FAILED',
      error: err?.message || String(err),
    };
  }
}

export async function spawnChromeUrl(targetUrl, {
  chromePath = null,
  env = process.env,
  launcherHook = null,
  extraArgs = [],
  platform = process.platform,
} = {}) {
  if (typeof targetUrl !== 'string' || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(targetUrl)) {
    return {
      ok: false,
      code: 'INVALID_TARGET_URL',
      error: 'Chrome launcher only opens local 127.0.0.1 / localhost Foundry URLs.',
    };
  }

  const cleanExtra = Array.isArray(extraArgs) ? extraArgs.filter(a => typeof a === 'string') : [];
  const hook = typeof launcherHook === 'function' ? launcherHook : injectedLauncherHook;
  if (hook) {
    try {
      const hookRes = await hook({ url: targetUrl, chromePath, extraArgs: cleanExtra, env });
      if (hookRes && hookRes.ok === false) {
        return {
          ok: false,
          mocked: true,
          code: hookRes.code || 'MOCK_LAUNCH_FAILED',
          error: hookRes.error || 'Mock Chrome launcher hook declined spawn.',
          chromePath: chromePath || 'mock-hook',
          url: targetUrl,
        };
      }
      return {
        ok: true,
        mocked: true,
        chromePath: hookRes?.chromePath || chromePath || 'mock-hook',
        pid: hookRes?.pid ?? null,
        url: targetUrl,
      };
    } catch (err) {
      return {
        ok: false,
        mocked: true,
        code: 'MOCK_LAUNCH_ERROR',
        error: err?.message || String(err),
        chromePath: chromePath || 'mock-hook',
        url: targetUrl,
      };
    }
  }

  const mockCmd = typeof env?.TOPOGEN_MOCK_CHROME_CMD === 'string' ? env.TOPOGEN_MOCK_CHROME_CMD.trim() : '';
  if (mockCmd) {
    if (mockCmd === 'noop' || mockCmd === 'true' || mockCmd === '1' || mockCmd === 'none') {
      return {
        ok: true,
        mocked: true,
        chromePath: 'mock-noop',
        pid: null,
        url: targetUrl,
      };
    }

    let cmd = null;
    let baseArgs = [];
    if (mockCmd.startsWith('[')) {
      try {
        const parsed = JSON.parse(mockCmd);
        if (Array.isArray(parsed) && parsed.length > 0) {
          cmd = String(parsed[0]);
          baseArgs = parsed.slice(1).map(String);
        }
      } catch {
        // Fall through to token split
      }
    }
    if (!cmd) {
      if (fileExists(mockCmd) && /\.(?:mjs|cjs|js)$/i.test(mockCmd)) {
        cmd = process.execPath;
        baseArgs = [path.resolve(mockCmd)];
      } else if (fileExists(mockCmd)) {
        cmd = path.resolve(mockCmd);
        baseArgs = [];
      } else {
        const parts = splitCommandTokens(mockCmd);
        cmd = parts[0];
        baseArgs = parts.slice(1);
      }
    }

    const mockSpawn = await spawnDetachedChecked(
      cmd,
      [...baseArgs, targetUrl, ...cleanExtra],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...env, TOPOGEN_LAUNCH_URL: targetUrl },
      }
    );
    if (!mockSpawn.ok) {
      return {
        ok: false,
        mocked: true,
        code: mockSpawn.code,
        error: mockSpawn.error,
        chromePath: cmd,
        url: targetUrl,
      };
    }
    return {
      ok: true,
      mocked: true,
      chromePath: cmd,
      pid: mockSpawn.pid,
      url: targetUrl,
    };
  }

  const resolvedChromePath = (typeof chromePath === 'string' && fileExists(chromePath))
    ? chromePath
    : discoverChromeBinary({ env, platform }).chromePath;

  if (!resolvedChromePath) {
    return {
      ok: false,
      mocked: false,
      code: 'CHROME_NOT_FOUND',
      chromePath: null,
      url: targetUrl,
      error: 'Google Chrome executable was not found. Install Google Chrome or set TOPOGEN_CHROME_BIN.',
    };
  }

  const launchArgs = [...cleanExtra, targetUrl];

  if (platform === 'win32') {
    const desktopSession = inspectWindowsDesktopSession({ env, platform });
    const preferOutOfProc = !desktopSession.interactive || env?.TOPOGEN_FORCE_INTERACTIVE_SPAWN === '1';

    if (preferOutOfProc) {
      const winRes = spawnChromeWindowsInteractiveFallback(resolvedChromePath, launchArgs, { env });
      if (winRes.ok) {
        return {
          ok: true,
          mocked: false,
          chromePath: resolvedChromePath,
          pid: winRes.pid ?? null,
          url: targetUrl,
          launchStrategy: winRes.strategy || 'shell-explorer',
          windowStation: winRes.windowStation || 'WinSta0\\Default',
        };
      }
      // Fall through to direct spawn as last resort
    }

    const spawnRes = await spawnDetachedChecked(
      resolvedChromePath,
      launchArgs,
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        env,
      }
    );

    if (spawnRes.ok) {
      return {
        ok: true,
        mocked: false,
        chromePath: resolvedChromePath,
        pid: spawnRes.pid,
        url: targetUrl,
        launchStrategy: 'direct',
        windowStation: desktopSession.windowStation || 'WinSta0',
      };
    }

    // Direct spawn failed on Windows — fall back to out-of-proc Explorer / Win32_Process.Create
    const fallbackRes = spawnChromeWindowsInteractiveFallback(resolvedChromePath, launchArgs, { env });
    if (fallbackRes.ok) {
      return {
        ok: true,
        mocked: false,
        chromePath: resolvedChromePath,
        pid: fallbackRes.pid ?? null,
        url: targetUrl,
        launchStrategy: fallbackRes.strategy || 'shell-explorer',
        windowStation: fallbackRes.windowStation || 'WinSta0\\Default',
      };
    }

    return {
      ok: false,
      mocked: false,
      code: fallbackRes.code || spawnRes.code,
      chromePath: resolvedChromePath,
      url: targetUrl,
      error: `Failed to spawn Google Chrome (${resolvedChromePath}): direct=${spawnRes.error}; interactiveFallback=${fallbackRes.error}`,
    };
  }

  const spawnRes = await spawnDetachedChecked(
    resolvedChromePath,
    launchArgs,
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env,
    }
  );

  if (!spawnRes.ok) {
    return {
      ok: false,
      mocked: false,
      code: spawnRes.code,
      chromePath: resolvedChromePath,
      url: targetUrl,
      error: `Failed to spawn Google Chrome (${resolvedChromePath}): ${spawnRes.error}`,
    };
  }

  return {
    ok: true,
    mocked: false,
    chromePath: resolvedChromePath,
    pid: spawnRes.pid,
    url: targetUrl,
    launchStrategy: 'direct',
    windowStation: null,
  };
}
