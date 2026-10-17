# Mouse and keyboard helper for Buddy. Reads one JSON command per line from stdin and answers OK, POS x y, or ERR message.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class W {
  [StructLayout(LayoutKind.Sequential)] public struct KI { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT {
    [FieldOffset(0)] public uint type;
    [FieldOffset(8)] public KI ki;
    [FieldOffset(8)] public MI mi;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X; public int Y; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int d, UIntPtr e);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] a, int size);

  static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }

  static bool IsExt(ushort vk) {
    return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B;
  }

  public static void Vk(ushort vk, bool down) {
    INPUT i = new INPUT(); i.type = 1; i.ki.wVk = vk;
    i.ki.dwFlags = (down ? 0u : 2u) | (IsExt(vk) ? 1u : 0u);
    Send(i);
  }

  public static void Text(string s) {
    foreach (char c in s) {
      if (c == '\r') continue;
      if (c == '\n') { Vk(0x0D, true); Vk(0x0D, false); continue; }
      INPUT d = new INPUT(); d.type = 1; d.ki.wScan = c; d.ki.dwFlags = 4; Send(d);
      INPUT u = new INPUT(); u.type = 1; u.ki.wScan = c; u.ki.dwFlags = 4 | 2; Send(u);
      System.Threading.Thread.Sleep(8);
    }
  }

  public static void Btn(string b, bool down) {
    uint f = b == "r" ? (down ? 8u : 16u) : b == "m" ? (down ? 0x20u : 0x40u) : (down ? 2u : 4u);
    mouse_event(f, 0, 0, 0, UIntPtr.Zero);
  }

  public static void Wheel(int dy, int dx) {
    if (dy != 0) mouse_event(0x800, 0, 0, dy, UIntPtr.Zero);
    if (dx != 0) mouse_event(0x1000, 0, 0, dx, UIntPtr.Zero);
  }
}
"@

[void][W]::SetProcessDPIAware()

while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ($line.Trim() -eq '') { continue }
  try {
    $o = $line | ConvertFrom-Json
    switch ($o.op) {
      'move'  { [void][W]::SetCursorPos([int]$o.x, [int]$o.y); [Console]::Out.WriteLine('OK') }
      'btn'   { [W]::Btn([string]$o.b, [bool]$o.down); [Console]::Out.WriteLine('OK') }
      'wheel' { [W]::Wheel([int]$o.dy, [int]$o.dx); [Console]::Out.WriteLine('OK') }
      'vk'    { [W]::Vk([uint16]$o.vk, [bool]$o.down); [Console]::Out.WriteLine('OK') }
      'text'  { [W]::Text([string]$o.text); [Console]::Out.WriteLine('OK') }
      'pos'   { $p = New-Object W+PT; [void][W]::GetCursorPos([ref]$p); [Console]::Out.WriteLine('POS ' + $p.X + ' ' + $p.Y) }
      default { [Console]::Out.WriteLine('ERR unknown op') }
    }
  } catch {
    [Console]::Out.WriteLine('ERR ' + ($_.Exception.Message -replace "[\r\n]+", ' '))
  }
}
