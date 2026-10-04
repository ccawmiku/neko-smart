# GPL-3.0-or-later; derived from openclash-modern tools/run-web.ps1.
param([Parameter(Mandatory=$true)][string]$Command,[string]$LogName="check",[ValidateRange(512,4096)][int]$MemoryMiB=1536)
$ErrorActionPreference="Stop"
$env:NODE_OPTIONS="--max-old-space-size=768"
$env:NEXT_TELEMETRY_DISABLED="1"
$env:RAYON_NUM_THREADS="2"
$env:UV_THREADPOOL_SIZE="2"
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LimitedNeko {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic BasicLimitInformation; public IO IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential)] struct CPU { public uint ControlFlags, CpuRate; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public uint cb; public string lpReserved,lpDesktop,lpTitle; public uint dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags; public short wShowWindow,cbReserved2; public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr h,int cls,IntPtr p,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr h,IntPtr p);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup si,out ProcessInfo pi);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr p,uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr p,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static void Check(bool result) { if(!result) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  static void Set<T>(IntPtr job,int cls,T info) { int size=Marshal.SizeOf(typeof(T)); IntPtr ptr=Marshal.AllocHGlobal(size); try { Marshal.StructureToPtr(info,ptr,false); Check(SetInformationJobObject(job,cls,ptr,(uint)size)); } finally { Marshal.FreeHGlobal(ptr); } }
  public static int Run(string cwd,string cmd,string logfile,ulong memoryBytes) {
    IntPtr job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) Check(false);
    ProcessInfo pi=new ProcessInfo();
    try {
      var limits=new Extended(); limits.BasicLimitInformation.LimitFlags=0x2000|0x200; limits.JobMemoryLimit=(UIntPtr)memoryBytes; Set(job,9,limits);
      Set(job,15,new CPU { ControlFlags=5,CpuRate=1250 });
      var si=new Startup(); si.cb=(uint)Marshal.SizeOf(typeof(Startup));
      var command=new StringBuilder("cmd.exe /d /s /c \""+cmd+" > \""+logfile+"\" 2>&1\"");
      Check(CreateProcess(null,command,IntPtr.Zero,IntPtr.Zero,false,0x08000000|0x4|0x4000,IntPtr.Zero,cwd,ref si,out pi));
      try { Check(AssignProcessToJobObject(job,pi.process)); } catch { TerminateProcess(pi.process,1); throw; }
      ResumeThread(pi.thread); WaitForSingleObject(pi.process,0xffffffff); uint code; GetExitCodeProcess(pi.process,out code); return (int)code;
    } finally { if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread); if(pi.process!=IntPtr.Zero) CloseHandle(pi.process); CloseHandle(job); }
  }
}
'@

$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$taskLogs=Join-Path $taskRoot "artifacts"
New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
$taskLog=Join-Path $taskLogs ($LogName+".log")
Write-Host "neko-smart: CPU <=12.5% of host, process-tree memory <=$MemoryMiB MiB, BelowNormal"
$taskCode=[LimitedNeko]::Run($taskRoot,$Command,$taskLog,[uint64]$MemoryMiB*1024*1024)
Get-Content -LiteralPath $taskLog -Encoding utf8 -Tail 65
exit $taskCode
