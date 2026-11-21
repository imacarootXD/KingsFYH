using System.Diagnostics;
using System.Drawing.Imaging;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace RetroExplorer;

public sealed class Win98ShellManager : IDisposable
{
    private const string StateFileName = "win98-session.json";
    private const string TaskbarStateFileName = "win98-taskbar-state.json";

    private const string ShellIconsKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons";
    private const string ExplorerAdvancedKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
    private const string ThisPcIconKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\CLSID\{20D04FE0-3AEA-1069-A2D8-08002B30309D}\DefaultIcon";
    private const string UserFilesIconKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\CLSID\{59031a47-3f72-44a7-89c5-5595fe6b30ee}\DefaultIcon";
    private const string RecycleBinIconKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\CLSID\{645FF040-5081-101B-9F08-00AA002F954E}\DefaultIcon";

    private readonly object sync = new();
    private readonly List<Win98Taskbar> taskbars = new();
    private readonly Dictionary<IntPtr, bool> nativeTaskbarVisibility = new();
    private readonly System.Windows.Forms.Timer rehideTimer = new() { Interval = 1500 };
    private bool active;

    private const int SwHide = 0;
    private const int SwShow = 5;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string? className, string? windowName);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(int wEventId, uint uFlags, string? dwItem1, string? dwItem2);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool WritePrivateProfileString(string lpAppName, string lpKeyName, string? lpString, string lpFileName);

    private const int SHCNE_UPDATEITEM = 0x00002000;
    private const int SHCNE_ASSOCCHANGED = 0x08000000;
    private const uint SHCNF_IDLIST = 0x0000;
    private const uint SHCNF_PATHW = 0x0005;

    public bool Active => active;

    public string GetOverlayStatus()
    {
        var visibleBars = taskbars.Count(t => t.OverlayVisible && !t.IsDisposed);
        var coversScreens = taskbars.Count(t =>
        {
            var screen = Screen.AllScreens.FirstOrDefault(s => s.DeviceName == t.MonitorDevice);
            var b = t.OverlayBounds;
            return screen != null && b.Left <= screen.Bounds.Left && b.Right >= screen.Bounds.Right &&
                   b.Top < screen.Bounds.Bottom && b.Bottom >= screen.Bounds.Bottom;
        });
        return $"WIN98 MODE ON | Taskbars: {visibleBars}/{taskbars.Count} | Desktop Icons & Shortcuts Swapped | Coverage: {coversScreens}/{taskbars.Count}";
    }

    public void Enable()
    {
        lock (sync)
        {
            if (active)
                return;

            try
            {
                var state = new SessionState
                {
                    SessionId = Guid.NewGuid().ToString("N"),
                    ParentProcessId = Environment.ProcessId,
                    StateFile = StateFilePath,
                    AssetDirectory = FindAssetDirectory()
                };

                // Build crisp multi-size .ico files from Win98 PNG assets
                string closedFolderIco = CreateIconOverride("directory_closed_cool-0.png");
                string openFolderIco = CreateIconOverride("directory_open_cool-0.png");
                string computerIco = CreateIconOverride("computer_explorer-0.png");
                string userFolderIco = CreateIconOverride("directory_open_cabinet-0.png");
                string recycleBinIco = CreateIconOverride(FindMatchingAssetName("recycle", "erase_file-0.png"));
                string documentIco = CreateIconOverride("document-0.png");
                string notepadIco = CreateIconOverride("notepad-0.png");
                string htmlIco = CreateIconOverride("html-0.png");
                string executableIco = CreateIconOverride("executable-0.png");

                string browserIco = CreateIconOverride(FindMatchingAssetName("internet", "html-0.png"));
                string terminalIco = CreateIconOverride(FindMatchingAssetName("console", "executable-0.png"));
                string gameIco = CreateIconOverride(FindMatchingAssetName("joystick", "executable-0.png"));

                // 1. Global Shell & System Desktop Icons
                // "0" replaces the global fallback blank white page used for broken/missing-icon shortcuts
                BackupAndSet(state, ShellIconsKey, "0", documentIco);
                BackupAndSet(state, ShellIconsKey, "3", closedFolderIco);
                BackupAndSet(state, ShellIconsKey, "4", openFolderIco);
                BackupAndSet(state, ThisPcIconKey, "", computerIco);
                BackupAndSet(state, UserFilesIconKey, "", userFolderIco);
                BackupAndSet(state, RecycleBinIconKey, "", recycleBinIco);
                BackupAndSet(state, RecycleBinIconKey, "empty", recycleBinIco);
                BackupAndSet(state, RecycleBinIconKey, "full", recycleBinIco);

                // Disable Windows 11 folder live-thumbnail previews
                BackupAndSetDword(state, ExplorerAdvancedKey, "IconsOnly", 1);

                // 2. Extensionless files (.env, c), .zip archives, .url shortcuts, and UserChoice ProgIDs
                BackupAndSet(state, @"Software\Classes\Unknown\DefaultIcon", "", documentIco);
                BackupAndSet(state, @"Software\Classes\CompressedFolder\DefaultIcon", "", userFolderIco);
                BackupAndSet(state, @"Software\Classes\InternetShortcut\DefaultIcon", "", documentIco);

                foreach (var ext in new[] { ".txt", ".md", ".log", ".ini", ".cfg", ".csv" })
                    OverrideExtensionIcon(state, ext, notepadIco);

                foreach (var ext in new[] { ".json", ".py", ".c", ".cpp", ".h", ".cs", ".js", ".ts", ".yml", ".yaml", ".xml" })
                    OverrideExtensionIcon(state, ext, documentIco);

                // 3. Desktop folders (desktop.ini) and Desktop shortcuts (.lnk & .url)
                ApplyDesktopFolderIcons(state, closedFolderIco);
                ApplyDesktopShortcutIcons(state, new ShortcutIconPalette(
                    DefaultApp: executableIco,
                    Browser: browserIco,
                    Editor: notepadIco,
                    Terminal: terminalIco,
                    Game: gameIco,
                    WebShortcut: htmlIco));

                // 4. Classic Win98 Palette & Desktop Wallpaper
                ApplyWin98Colors(state);
                ApplyWallpaper(state);

                SaveState(state);
                RefreshShellIcons();

                // 5. Hide Native Taskbars & Launch Win98 Taskbar Overlays
                HideNativeTaskbars();
                StartWatchdog();

                foreach (var screen in Screen.AllScreens)
                {
                    var bar = new Win98Taskbar(screen);
                    taskbars.Add(bar);
                    bar.ShowOverlay();
                }

                rehideTimer.Tick -= OnRehideTick;
                rehideTimer.Tick += OnRehideTick;
                rehideTimer.Start();
                active = true;
            }
            catch
            {
                Restore();
                throw;
            }
        }
    }

    private void OnRehideTick(object? sender, EventArgs e)
    {
        if (active)
            HideNativeTaskbars();
    }

    public void Restore()
    {
        lock (sync)
        {
            foreach (var bar in taskbars)
            {
                bar.CloseOverlay();
                bar.Dispose();
            }
            taskbars.Clear();
            rehideTimer.Stop();
            RestoreNativeTaskbars();
            active = false;

            if (File.Exists(StateFilePath))
            {
                try
                {
                    var state = JsonSerializer.Deserialize<SessionState>(
                        File.ReadAllText(StateFilePath),
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                    if (state != null)
                    {
                        RestoreDesktopShortcutIcons(state);
                        RestoreDesktopFolderIcons(state);

                        foreach (var fullKey in state.RegistryValues.Keys)
                        {
                            int sep = fullKey.LastIndexOf('|');
                            if (sep > 0)
                            {
                                string keyPath = fullKey[..sep];
                                string valueName = fullKey[(sep + 1)..];
                                RestoreValue(state, keyPath, valueName);
                            }
                        }

                        RestoreDictionary(state, "Colors");
                        RestoreDictionary(state, "Wallpaper");

                        if (state.Wallpaper.TryGetValue("Wallpaper", out var oldWallpaper))
                        {
                            SystemParametersInfo(SpiSetDeskWallpaper, 0, oldWallpaper ?? "", SpifUpdateIniFile | SpifSendChange);
                        }
                    }
                }
                catch
                {
                }
            }

            try
            {
                if (File.Exists(StateFilePath))
                    File.Delete(StateFilePath);

                RefreshShellIcons();
                BroadcastSettingsChange();

                if (!Process.GetProcessesByName("explorer").Any())
                    Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = true });
            }
            catch
            {
            }
        }
    }

    private static void OverrideExtensionIcon(SessionState state, string ext, string icoResource)
    {
        BackupAndSet(state, $@"Software\Classes\{ext}\DefaultIcon", "", icoResource);

        using var userChoice = Registry.CurrentUser.OpenSubKey(
            $@"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{ext}\UserChoice");
        var progId = userChoice?.GetValue("ProgId")?.ToString();
        if (!string.IsNullOrWhiteSpace(progId))
        {
            BackupAndSet(state, $@"Software\Classes\{progId}\DefaultIcon", "", icoResource);
        }
    }

    private static IEnumerable<string> GetDesktopDirectories()
    {
        return new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)
        }
        .Where(d => !string.IsNullOrWhiteSpace(d) && Directory.Exists(d))
        .Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static void ApplyDesktopFolderIcons(SessionState state, string folderIconResource)
    {
        foreach (var desktopDir in GetDesktopDirectories())
        {
            IEnumerable<string> folders;
            try
            {
                folders = Directory.GetDirectories(desktopDir);
            }
            catch
            {
                continue;
            }

            foreach (var folder in folders)
            {
                try
                {
                    var origFolderAttrs = File.GetAttributes(folder);
                    var iniPath = Path.Combine(folder, "desktop.ini");
                    bool iniExisted = File.Exists(iniPath);

                    var backup = new DesktopIniBackup
                    {
                        FolderPath = folder,
                        OriginalFolderAttributes = (int)origFolderAttrs,
                        IniExisted = iniExisted
                    };

                    if (iniExisted)
                    {
                        backup.OriginalIniAttributes = (int)File.GetAttributes(iniPath);
                        backup.OriginalIniBase64 = Convert.ToBase64String(File.ReadAllBytes(iniPath));
                        File.SetAttributes(iniPath, FileAttributes.Normal);
                    }

                    string iniContent = $"[.ShellClassInfo]\r\nIconResource={folderIconResource}\r\n";
                    File.WriteAllText(iniPath, iniContent, Encoding.Unicode);
                    File.SetAttributes(iniPath, FileAttributes.Hidden | FileAttributes.System);
                    File.SetAttributes(folder, origFolderAttrs | FileAttributes.ReadOnly);

                    state.DesktopFolders.Add(backup);
                    SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, folder, null);
                }
                catch
                {
                }
            }
        }
    }

    private static void RestoreDesktopFolderIcons(SessionState state)
    {
        foreach (var backup in state.DesktopFolders)
        {
            try
            {
                if (!Directory.Exists(backup.FolderPath))
                    continue;

                var iniPath = Path.Combine(backup.FolderPath, "desktop.ini");
                if (File.Exists(iniPath))
                    File.SetAttributes(iniPath, FileAttributes.Normal);

                if (backup.IniExisted)
                {
                    var bytes = Convert.FromBase64String(backup.OriginalIniBase64 ?? "");
                    File.WriteAllBytes(iniPath, bytes);
                    File.SetAttributes(iniPath, (FileAttributes)backup.OriginalIniAttributes);
                }
                else if (File.Exists(iniPath))
                {
                    File.Delete(iniPath);
                }

                File.SetAttributes(backup.FolderPath, (FileAttributes)backup.OriginalFolderAttributes);
                SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, backup.FolderPath, null);
            }
            catch
            {
            }
        }
    }

    private static void ApplyDesktopShortcutIcons(SessionState state, ShortcutIconPalette palette)
    {
        Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
        object? shell = shellType != null ? Activator.CreateInstance(shellType) : null;

        try
        {
            foreach (var desktopDir in GetDesktopDirectories())
            {
                IEnumerable<string> files;
                try
                {
                    files = Directory.GetFiles(desktopDir);
                }
                catch
                {
                    continue;
                }

                foreach (var file in files)
                {
                    string ext = Path.GetExtension(file);
                    if (ext.Equals(".lnk", StringComparison.OrdinalIgnoreCase) && shellType != null && shell != null)
                    {
                        ApplyLnkIconOverride(state, shellType, shell, file, palette);
                    }
                    else if (ext.Equals(".url", StringComparison.OrdinalIgnoreCase))
                    {
                        ApplyUrlIconOverride(state, file, palette);
                    }
                }
            }
        }
        finally
        {
            if (shell != null && Marshal.IsComObject(shell))
                Marshal.FinalReleaseComObject(shell);
        }
    }

    private static void ApplyLnkIconOverride(
        SessionState state,
        Type shellType,
        object shell,
        string lnkPath,
        ShortcutIconPalette palette)
    {
        object? shortcut = null;
        try
        {
            var attrs = File.GetAttributes(lnkPath);
            var lastWriteUtc = File.GetLastWriteTimeUtc(lnkPath);
            byte[] originalBytes = File.ReadAllBytes(lnkPath);

            shortcut = shellType.InvokeMember(
                "CreateShortcut",
                BindingFlags.InvokeMethod,
                null,
                shell,
                [lnkPath]);

            if (shortcut == null)
                return;

            var shortcutType = shortcut.GetType();
            string targetPath = shortcutType.InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null)?.ToString() ?? "";
            string origIcon = shortcutType.InvokeMember("IconLocation", BindingFlags.GetProperty, null, shortcut, null)?.ToString() ?? "";

            string chosenIcon = PickShortcutIcon(Path.GetFileNameWithoutExtension(lnkPath), targetPath, palette);

            if ((attrs & FileAttributes.ReadOnly) != 0)
                File.SetAttributes(lnkPath, attrs & ~FileAttributes.ReadOnly);

            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, [chosenIcon]);
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);

            if ((attrs & FileAttributes.ReadOnly) != 0)
                File.SetAttributes(lnkPath, attrs);

            state.DesktopShortcuts.Add(new ShortcutBackup
            {
                FilePath = lnkPath,
                OriginalAttributes = (int)attrs,
                OriginalLastWriteUtc = lastWriteUtc,
                OriginalIconLocation = origIcon,
                OriginalFileBase64 = Convert.ToBase64String(originalBytes)
            });

            SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, lnkPath, null);
        }
        catch
        {
        }
        finally
        {
            if (shortcut != null && Marshal.IsComObject(shortcut))
                Marshal.FinalReleaseComObject(shortcut);
        }
    }

    private static void ApplyUrlIconOverride(SessionState state, string urlPath, ShortcutIconPalette palette)
    {
        try
        {
            var attrs = File.GetAttributes(urlPath);
            var lastWriteUtc = File.GetLastWriteTimeUtc(urlPath);
            byte[] originalBytes = File.ReadAllBytes(urlPath);
            string text = File.ReadAllText(urlPath);

            string chosenIcon = PickShortcutIcon(Path.GetFileNameWithoutExtension(urlPath), text, palette);
            int commaIdx = chosenIcon.LastIndexOf(',');
            string icoFile = commaIdx > 0 ? chosenIcon[..commaIdx] : chosenIcon;
            string icoIndex = commaIdx > 0 ? chosenIcon[(commaIdx + 1)..] : "0";

            if ((attrs & FileAttributes.ReadOnly) != 0)
                File.SetAttributes(urlPath, attrs & ~FileAttributes.ReadOnly);

            WritePrivateProfileString("InternetShortcut", "IconFile", icoFile, urlPath);
            WritePrivateProfileString("InternetShortcut", "IconIndex", icoIndex, urlPath);

            if ((attrs & FileAttributes.ReadOnly) != 0)
                File.SetAttributes(urlPath, attrs);

            state.DesktopShortcuts.Add(new ShortcutBackup
            {
                FilePath = urlPath,
                OriginalAttributes = (int)attrs,
                OriginalLastWriteUtc = lastWriteUtc,
                OriginalFileBase64 = Convert.ToBase64String(originalBytes)
            });

            SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, urlPath, null);
        }
        catch
        {
        }
    }

    private static void RestoreDesktopShortcutIcons(SessionState state)
    {
        foreach (var backup in state.DesktopShortcuts)
        {
            try
            {
                if (!File.Exists(backup.FilePath))
                    continue;

                var currentAttrs = File.GetAttributes(backup.FilePath);
                if ((currentAttrs & FileAttributes.ReadOnly) != 0)
                    File.SetAttributes(backup.FilePath, currentAttrs & ~FileAttributes.ReadOnly);

                if (!string.IsNullOrEmpty(backup.OriginalFileBase64))
                {
                    File.WriteAllBytes(backup.FilePath, Convert.FromBase64String(backup.OriginalFileBase64));
                }

                File.SetAttributes(backup.FilePath, (FileAttributes)backup.OriginalAttributes);
                File.SetLastWriteTimeUtc(backup.FilePath, backup.OriginalLastWriteUtc);
                SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, backup.FilePath, null);
            }
            catch
            {
            }
        }
    }

    private static string PickShortcutIcon(string name, string targetOrContent, ShortcutIconPalette palette)
    {
        string haystack = (name + " " + targetOrContent).ToLowerInvariant();

        if (haystack.Contains("chrome") || haystack.Contains("edge") || haystack.Contains("opera") ||
            haystack.Contains("firefox") || haystack.Contains("brave") || haystack.Contains("comet"))
            return palette.Browser;

        if (haystack.Contains("code") || haystack.Contains("intellij") || haystack.Contains("idea") ||
            haystack.Contains("notepad") || haystack.Contains("studio") || haystack.Contains("pycharm"))
            return palette.Editor;

        if (haystack.Contains("bash") || haystack.Contains("terminal") || haystack.Contains("cygwin") ||
            haystack.Contains("cmd") || haystack.Contains("powershell") || haystack.Contains("cloud sdk"))
            return palette.Terminal;

        if (haystack.Contains("steam") || haystack.Contains("epic") || haystack.Contains("roblox") ||
            haystack.Contains("lunar") || haystack.Contains("paradox") || haystack.Contains("bioshock") ||
            haystack.Contains("lethal") || haystack.Contains("prison") || haystack.Contains("defense") ||
            haystack.Contains("wordle") || haystack.Contains("lego") || haystack.Contains("totally") ||
            haystack.Contains("rungameid"))
            return palette.Game;

        if (haystack.StartsWith("http://") || haystack.StartsWith("https://"))
            return palette.WebShortcut;

        return palette.DefaultApp;
    }

    private void HideNativeTaskbars()
    {
        foreach (var className in new[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" })
        {
            var previous = IntPtr.Zero;
            while (true)
            {
                var hwnd = FindWindowEx(IntPtr.Zero, previous, className, null);
                if (hwnd == IntPtr.Zero)
                    break;
                previous = hwnd;
                if (!nativeTaskbarVisibility.ContainsKey(hwnd))
                    nativeTaskbarVisibility[hwnd] = IsWindowVisible(hwnd);
                ShowWindow(hwnd, SwHide);
            }
        }
        SaveTaskbarState();
    }

    private void RestoreNativeTaskbars()
    {
        foreach (var pair in nativeTaskbarVisibility)
            if (pair.Value && pair.Key != IntPtr.Zero)
                ShowWindow(pair.Key, SwShow);
        nativeTaskbarVisibility.Clear();
        try { File.Delete(TaskbarStateFilePath); } catch { }
    }

    public void RestoreOrphanedSession()
    {
        try
        {
            if (File.Exists(TaskbarStateFilePath))
            {
                var snapshot = JsonSerializer.Deserialize<Dictionary<string, bool>>(File.ReadAllText(TaskbarStateFilePath));
                if (snapshot != null)
                {
                    foreach (var entry in snapshot)
                        if (entry.Value && long.TryParse(entry.Key, out var handle))
                            ShowWindow(new IntPtr(handle), SwShow);
                }
                File.Delete(TaskbarStateFilePath);
            }

            if (File.Exists(StateFilePath))
                Restore();
        }
        catch
        {
        }
    }

    public void Toggle()
    {
        if (active)
            Restore();
        else
            Enable();
    }

    public void Dispose()
    {
        Restore();
        rehideTimer.Dispose();
    }

    private static string StateFilePath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RetroExplorer", StateFileName);

    private static string TaskbarStateFilePath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RetroExplorer", TaskbarStateFileName);

    private void SaveTaskbarState()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(TaskbarStateFilePath)!);
        File.WriteAllText(TaskbarStateFilePath, JsonSerializer.Serialize(
            nativeTaskbarVisibility.ToDictionary(p => p.Key.ToInt64().ToString(), p => p.Value)));
    }

    private static void SaveState(SessionState state)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(StateFilePath)!);
        File.WriteAllText(StateFilePath, JsonSerializer.Serialize(state));
    }

    private static void BackupAndSet(SessionState state, string keyPath, string name, string value)
    {
        bool keyExisted = Registry.CurrentUser.OpenSubKey(keyPath) != null;
        using var key = Registry.CurrentUser.CreateSubKey(keyPath);
        if (key == null)
            return;

        var original = key.GetValue(name);
        var originalKind = original == null ? null : key.GetValueKind(name).ToString();
        state.RegistryValues[keyPath + "|" + name] = new RegistryValueSnapshot
        {
            KeyExisted = keyExisted,
            Exists = original != null,
            Kind = originalKind,
            Value = original
        };
        key.SetValue(name, value, RegistryValueKind.String);
    }

    private static void BackupAndSetDword(SessionState state, string keyPath, string name, int value)
    {
        bool keyExisted = Registry.CurrentUser.OpenSubKey(keyPath) != null;
        using var key = Registry.CurrentUser.CreateSubKey(keyPath);
        if (key == null)
            return;

        var original = key.GetValue(name);
        var originalKind = original == null ? null : key.GetValueKind(name).ToString();
        state.RegistryValues[keyPath + "|" + name] = new RegistryValueSnapshot
        {
            KeyExisted = keyExisted,
            Exists = original != null,
            Kind = originalKind,
            Value = original
        };
        key.SetValue(name, value, RegistryValueKind.DWord);
    }

    private static void RestoreValue(SessionState state, string keyPath, string name)
    {
        if (!state.RegistryValues.TryGetValue(keyPath + "|" + name, out var snapshot))
            return;

        using var key = Registry.CurrentUser.OpenSubKey(keyPath, true);
        if (key == null)
            return;

        if (!snapshot.Exists)
        {
            key.DeleteValue(name, false);
            if (!snapshot.KeyExisted && key.ValueCount == 0 && key.SubKeyCount == 0)
            {
                key.Close();
                Registry.CurrentUser.DeleteSubKey(keyPath, false);

                int lastSlash = keyPath.LastIndexOf('\\');
                if (lastSlash > 0)
                {
                    string parentPath = keyPath[..lastSlash];
                    if (parentPath.StartsWith(@"Software\Classes\", StringComparison.OrdinalIgnoreCase))
                    {
                        using var parent = Registry.CurrentUser.OpenSubKey(parentPath, true);
                        if (parent != null && parent.ValueCount == 0 && parent.SubKeyCount == 0)
                        {
                            parent.Close();
                            Registry.CurrentUser.DeleteSubKey(parentPath, false);
                        }
                    }
                }
            }
            return;
        }

        if (Enum.TryParse<RegistryValueKind>(snapshot.Kind, out var kind))
            key.SetValue(name, ConvertSnapshotValue(snapshot.Value, kind), kind);
    }

    private static object ConvertSnapshotValue(object? value, RegistryValueKind kind)
    {
        if (value is JsonElement element)
        {
            return kind switch
            {
                RegistryValueKind.DWord => element.TryGetInt32(out var dword) ? dword : element.GetRawText(),
                RegistryValueKind.QWord => element.TryGetInt64(out var qword) ? qword : element.GetRawText(),
                RegistryValueKind.MultiString => element.EnumerateArray().Select(x => x.GetString() ?? "").ToArray(),
                RegistryValueKind.Binary => Convert.FromBase64String(element.GetString() ?? ""),
                _ => element.GetString() ?? element.GetRawText()
            };
        }
        return value ?? "";
    }

    private static void ApplyWin98Colors(SessionState state)
    {
        using var key = Registry.CurrentUser.CreateSubKey(@"Control Panel\Colors");
        if (key == null)
            return;

        var values = new Dictionary<string, string>
        {
            ["ActiveTitle"] = "0 0 128",
            ["Background"] = "0 128 128",
            ["Window"] = "255 255 255",
            ["WindowText"] = "0 0 0",
            ["ButtonFace"] = "192 192 192",
            ["ButtonText"] = "0 0 0",
            ["ButtonHighlight"] = "255 255 255",
            ["ButtonShadow"] = "128 128 128",
            ["GrayText"] = "128 128 128",
            ["Menu"] = "192 192 192",
            ["MenuText"] = "0 0 0",
            ["Scrollbar"] = "192 192 192"
        };

        foreach (var pair in values)
        {
            state.Colors[pair.Key] = key.GetValue(pair.Key)?.ToString();
            key.SetValue(pair.Key, pair.Value, RegistryValueKind.String);
        }
    }

    private static void RestoreDictionary(SessionState state, string dictionaryName)
    {
        using var key = Registry.CurrentUser.CreateSubKey(
            dictionaryName == "Colors" ? @"Control Panel\Colors" : @"Control Panel\Desktop");
        if (key == null)
            return;

        var values = dictionaryName == "Colors" ? state.Colors : state.Wallpaper;
        foreach (var pair in values)
        {
            if (pair.Value == null)
                key.DeleteValue(pair.Key, false);
            else
                key.SetValue(pair.Key, pair.Value, RegistryValueKind.String);
        }
    }

    private static void ApplyWallpaper(SessionState state)
    {
        using var desktop = Registry.CurrentUser.CreateSubKey(@"Control Panel\Desktop");
        if (desktop == null)
            return;

        foreach (var name in new[] { "Wallpaper", "WallpaperStyle", "TileWallpaper" })
        {
            var value = desktop.GetValue(name);
            state.Wallpaper[name] = value?.ToString();
        }

        var wallpaperDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RetroExplorer");
        Directory.CreateDirectory(wallpaperDirectory);

        var wallpaperPath = FindExternalWallpaper(wallpaperDirectory);
        if (wallpaperPath == null)
        {
            wallpaperPath = Path.Combine(wallpaperDirectory, "win98-teal.bmp");
            CreateTealBitmap(wallpaperPath);
        }

        desktop.SetValue("Wallpaper", wallpaperPath, RegistryValueKind.String);
        desktop.SetValue("WallpaperStyle", "2", RegistryValueKind.String);
        desktop.SetValue("TileWallpaper", "0", RegistryValueKind.String);
        SystemParametersInfo(SpiSetDeskWallpaper, 0, wallpaperPath, SpifUpdateIniFile | SpifSendChange);
        BroadcastSettingsChange();
    }

    private static string? FindExternalWallpaper(string destinationDirectory)
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "assets", "win95background.jpg"),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "assets", "win95background.jpg"))
        };
        var source = candidates.FirstOrDefault(File.Exists);
        if (source == null)
            return null;

        var destination = Path.Combine(destinationDirectory, "win95background.jpg");
        File.Copy(source, destination, true);
        return destination;
    }

    private static void CreateTealBitmap(string path)
    {
        using var bitmap = new Bitmap(32, 32);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.Clear(Color.FromArgb(0, 128, 128));
        bitmap.Save(path, ImageFormat.Bmp);
    }

    private static string FindMatchingAssetName(string keyword, string fallback)
    {
        var assetDir = FindAssetDirectory();
        if (Directory.Exists(assetDir))
        {
            var match = Directory.EnumerateFiles(assetDir, "*.png")
                .Select(Path.GetFileName)
                .FirstOrDefault(n => n != null && n.Contains(keyword, StringComparison.OrdinalIgnoreCase));
            if (match != null)
                return match;
        }
        return fallback;
    }

    private static string CreateIconOverride(string fileName)
    {
        var assetDirectory = FindAssetDirectory();
        var sourcePath = Path.Combine(assetDirectory, fileName);
        if (!File.Exists(sourcePath))
            sourcePath = Path.Combine(assetDirectory, "directory_closed_cool-0.png");

        var iconDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RetroExplorer", "icons");
        Directory.CreateDirectory(iconDirectory);
        var iconPath = Path.Combine(iconDirectory, Path.GetFileNameWithoutExtension(fileName) + ".ico");

        if (File.Exists(sourcePath))
        {
            try
            {
                SavePngAsMultiSizeIco(sourcePath, iconPath);
            }
            catch
            {
                return sourcePath;
            }
        }
        return iconPath + ",0";
    }

    private static void SavePngAsMultiSizeIco(string sourcePngPath, string outputIcoPath)
    {
        int[] sizes = [16, 32, 48];
        var pngBlobs = new List<byte[]>();

        using var original = new Bitmap(sourcePngPath);
        foreach (int size in sizes)
        {
            using var resized = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(resized))
            {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
                g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;
                g.DrawImage(original, 0, 0, size, size);
            }
            using var ms = new MemoryStream();
            resized.Save(ms, ImageFormat.Png);
            pngBlobs.Add(ms.ToArray());
        }

        using var fs = File.Create(outputIcoPath);
        using var bw = new BinaryWriter(fs);

        bw.Write((ushort)0);
        bw.Write((ushort)1);
        bw.Write((ushort)sizes.Length);

        int offset = 6 + (16 * sizes.Length);
        for (int i = 0; i < sizes.Length; i++)
        {
            byte dim = (byte)(sizes[i] >= 256 ? 0 : sizes[i]);
            bw.Write(dim);
            bw.Write(dim);
            bw.Write((byte)0);
            bw.Write((byte)0);
            bw.Write((ushort)1);
            bw.Write((ushort)32);
            bw.Write(pngBlobs[i].Length);
            bw.Write(offset);
            offset += pngBlobs[i].Length;
        }

        foreach (var blob in pngBlobs)
            bw.Write(blob);
    }

    private static string FindAssetDirectory()
    {
        var published = Path.Combine(AppContext.BaseDirectory, "assets", "Windows 98 icons");
        if (Directory.Exists(published))
            return published;
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..",
            "assets", "Windows 98 icons"));
    }

    private static void RefreshShellIcons()
    {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, null, null);
    }

    private void StartWatchdog()
    {
        var executable = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(executable))
            return;

        var appAssembly = Path.Combine(AppContext.BaseDirectory, "RetroExplorer.dll");
        var isDotnetHost = Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase);
        var arguments = isDotnetHost && File.Exists(appAssembly)
            ? $"\"{appAssembly}\" --win98-watchdog {Environment.ProcessId}"
            : "--win98-watchdog " + Environment.ProcessId;

        Process.Start(new ProcessStartInfo
        {
            FileName = executable,
            Arguments = arguments,
            WorkingDirectory = AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        });
    }

    public static void RunWatchdog(int parentProcessId)
    {
        try
        {
            using var parent = Process.GetProcessById(parentProcessId);
            parent.WaitForExit();
        }
        catch
        {
        }

        try
        {
            new Win98ShellManager().RestoreOrphanedSession();
        }
        catch
        {
        }
    }

    private static void BroadcastSettingsChange()
    {
        SendMessageTimeout(new IntPtr(0xffff), 0x001a, IntPtr.Zero,
            "Environment", 0, 1000, out _);
    }

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTimeout(IntPtr hWnd, int msg, IntPtr wParam,
        string lParam, int flags, int timeout, out IntPtr result);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool SystemParametersInfo(int action, int param, string pvParam, int flags);

    private const int SpiSetDeskWallpaper = 20;
    private const int SpifUpdateIniFile = 1;
    private const int SpifSendChange = 2;

    private sealed record ShortcutIconPalette(
        string DefaultApp,
        string Browser,
        string Editor,
        string Terminal,
        string Game,
        string WebShortcut);
}

internal sealed class SessionState
{
    public string SessionId { get; set; } = "";
    public int ParentProcessId { get; set; }
    public string StateFile { get; set; } = "";
    public string AssetDirectory { get; set; } = "";
    public Dictionary<string, RegistryValueSnapshot> RegistryValues { get; set; } = new();
    public Dictionary<string, string?> Colors { get; set; } = new();
    public Dictionary<string, string?> Wallpaper { get; set; } = new();
    public List<DesktopIniBackup> DesktopFolders { get; set; } = new();
    public List<ShortcutBackup> DesktopShortcuts { get; set; } = new();
}

internal sealed class RegistryValueSnapshot
{
    public bool KeyExisted { get; set; }
    public bool Exists { get; set; }
    public string? Kind { get; set; }
    public object? Value { get; set; }
}

internal sealed class DesktopIniBackup
{
    public string FolderPath { get; set; } = "";
    public int OriginalFolderAttributes { get; set; }
    public bool IniExisted { get; set; }
    public int OriginalIniAttributes { get; set; }
    public string? OriginalIniBase64 { get; set; }
}

internal sealed class ShortcutBackup
{
    public string FilePath { get; set; } = "";
    public int OriginalAttributes { get; set; }
    public DateTime OriginalLastWriteUtc { get; set; }
    public string OriginalIconLocation { get; set; } = "";
    public string? OriginalFileBase64 { get; set; }
}