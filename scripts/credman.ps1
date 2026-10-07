<#
  Windows Credential Manager access, compatible with the Orchestrator Connector desktop app
  (target "OrchestratorConnector:<guid>", generic credential, local-machine persistence, UTF-16 blob).

  Dot-source to get Read-OcSecret / Write-OcSecret / Remove-OcSecret, or run directly:
    credman.ps1 -Action read   -Id <guid>   -> prints base64(UTF-8 secret), exit 2 if not found
    credman.ps1 -Action write  -Id <guid>   <- reads base64(UTF-8 secret) from stdin
    credman.ps1 -Action delete -Id <guid>
  Secrets never travel on the command line.
#>
param(
  [ValidateSet('read', 'write', 'delete')][string]$Action,
  [string]$Id
)

$ErrorActionPreference = 'Stop'

if (-not ('OcCredMan' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class OcCredMan
{
    private const int CRED_TYPE_GENERIC = 1;
    private const int CRED_PERSIST_LOCAL_MACHINE = 2;
    private const int ERROR_NOT_FOUND = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWriteW(ref CREDENTIAL credential, int flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDeleteW(string target, int type, int flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);

    public static string Read(string target)
    {
        IntPtr ptr;
        if (!CredReadW(target, CRED_TYPE_GENERIC, 0, out ptr))
        {
            int err = Marshal.GetLastWin32Error();
            if (err == ERROR_NOT_FOUND) return null;
            throw new Win32Exception(err);
        }
        try
        {
            var cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            if (cred.CredentialBlob == IntPtr.Zero || cred.CredentialBlobSize == 0) return string.Empty;
            var bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.Unicode.GetString(bytes);
        }
        finally
        {
            CredFree(ptr);
        }
    }

    public static void Write(string target, string userName, string secret)
    {
        var bytes = Encoding.Unicode.GetBytes(secret ?? string.Empty);
        var blob = Marshal.AllocHGlobal(Math.Max(bytes.Length, 1));
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var cred = new CREDENTIAL
            {
                Type = CRED_TYPE_GENERIC,
                TargetName = target,
                CredentialBlobSize = bytes.Length,
                CredentialBlob = blob,
                Persist = CRED_PERSIST_LOCAL_MACHINE,
                UserName = userName
            };
            if (!CredWriteW(ref cred, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            Marshal.FreeHGlobal(blob);
        }
    }

    public static void Delete(string target)
    {
        if (!CredDeleteW(target, CRED_TYPE_GENERIC, 0))
        {
            int err = Marshal.GetLastWin32Error();
            if (err != ERROR_NOT_FOUND) throw new Win32Exception(err);
        }
    }
}
'@
}

function Get-OcTarget([string]$PresetId) {
  $guid = [Guid]::Parse($PresetId)
  return "OrchestratorConnector:$($guid.ToString('D'))"
}

function Read-OcSecret([string]$PresetId) { [OcCredMan]::Read((Get-OcTarget $PresetId)) }
function Write-OcSecret([string]$PresetId, [string]$Secret) { [OcCredMan]::Write((Get-OcTarget $PresetId), 'OrchestratorConnector', $Secret) }
function Remove-OcSecret([string]$PresetId) { [OcCredMan]::Delete((Get-OcTarget $PresetId)) }

if ($Action) {
  switch ($Action) {
    'read' {
      $secret = Read-OcSecret $Id
      if ($null -eq $secret) { exit 2 }
      [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($secret)))
    }
    'write' {
      $b64 = [Console]::In.ReadToEnd().Trim()
      Write-OcSecret $Id ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)))
    }
    'delete' { Remove-OcSecret $Id }
  }
  exit 0
}
