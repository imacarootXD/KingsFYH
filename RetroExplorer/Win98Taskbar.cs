using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace RetroExplorer;

internal sealed class Win98Taskbar : Form
{
    private readonly System.Windows.Forms.Timer clockTimer = new() { Interval = 1000 };
    private readonly System.Windows.Forms.Timer layoutTimer = new() { Interval = 750 };
    private readonly System.Windows.Forms.Timer windowPollTimer = new() { Interval = 450 };

    private readonly Label clock = new();
    private readonly Panel trayPanel = new();
    private readonly PictureBox trayVolumeIcon = new();
    private readonly Button startButton;
    private readonly FlowLayoutPanel taskButtonsPanel = new();
    private readonly Win98StartMenuForm startMenuForm;

    private readonly string monitorDevice;
    private bool isPositioning;
    private bool appBarRegistered;
    private uint appBarCallbackId;
    private string lastWindowSignature = "";

    public string MonitorDevice => monitorDevice;
    public Rectangle OverlayBounds => Bounds;
    public bool OverlayVisible => Visible;

    public Win98Taskbar(Screen screen)
    {
        monitorDevice = screen.DeviceName;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        BackColor = Color.FromArgb(192, 192, 192);
        Font = new Font("Tahoma", 9F, FontStyle.Regular);
        Text = "Retro Explorer Taskbar";

        startMenuForm = new Win98StartMenuForm();

        startButton = new Button
        {
            Text = " Start",
            Width = 84,
            Height = 28,
            Left = 4,
            Top = 5,
            Font = new Font("Tahoma", 9F, FontStyle.Bold),
            FlatStyle = FlatStyle.Standard,
            TextImageRelation = TextImageRelation.ImageBeforeText,
            ImageAlign = ContentAlignment.MiddleLeft,
            TextAlign = ContentAlignment.MiddleCenter,
            Image = LoadTaskbarAsset("key_win-0.png") ?? LoadTaskbarAsset("computer_explorer-0.png")
        };
        startButton.Click += (_, _) => ToggleStartMenu();
        Controls.Add(startButton);

        taskButtonsPanel.Left = startButton.Right + 6;
        taskButtonsPanel.Top = 5;
        taskButtonsPanel.Height = 28;
        taskButtonsPanel.WrapContents = false;
        taskButtonsPanel.AutoScroll = false;
        taskButtonsPanel.BackColor = Color.Transparent;
        taskButtonsPanel.Padding = new Padding(0);
        taskButtonsPanel.Margin = new Padding(0);
        Controls.Add(taskButtonsPanel);

        trayPanel.Dock = DockStyle.Right;
        trayPanel.Width = 104;
        trayPanel.BorderStyle = BorderStyle.Fixed3D;
        trayPanel.BackColor = Color.FromArgb(192, 192, 192);
        trayPanel.Padding = new Padding(4, 2, 4, 2);

        trayVolumeIcon.Width = 16;
        trayVolumeIcon.Height = 16;
        trayVolumeIcon.Left = 6;
        trayVolumeIcon.Top = 6;
        trayVolumeIcon.SizeMode = PictureBoxSizeMode.StretchImage;
        trayVolumeIcon.Image = LoadTaskbarAsset("computer_explorer-0.png");
        trayPanel.Controls.Add(trayVolumeIcon);

        clock.Left = 26;
        clock.Top = 2;
        clock.Width = 72;
        clock.Height = 24;
        clock.TextAlign = ContentAlignment.MiddleCenter;
        clock.Font = new Font("Tahoma", 8.5F, FontStyle.Regular);
        trayPanel.Controls.Add(clock);

        Controls.Add(trayPanel);

        clockTimer.Tick += (_, _) => UpdateClock();
        layoutTimer.Tick += (_, _) =>
        {
            if (Visible)
                PositionOnDesktop();
        };
        windowPollTimer.Tick += (_, _) =>
        {
            if (Visible)
                RefreshOpenWindowButtons();
        };

        UpdateClock();

        FormClosing += (_, _) =>
        {
            UnregisterAppBar();
            startMenuForm.Close();
            startMenuForm.Dispose();
            clockTimer.Dispose();
            layoutTimer.Dispose();
            windowPollTimer.Dispose();
        };
    }

    protected override CreateParams CreateParams
    {
        get
        {
            const int WS_EX_TOOLWINDOW = 0x00000080;
            const int WS_EX_NOACTIVATE = 0x08000000;
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        // Classic Windows 98 top 2px highlight edge
        using var whitePen = new Pen(Color.White, 1);
        using var lightPen = new Pen(Color.FromArgb(223, 223, 223), 1);
        e.Graphics.DrawLine(whitePen, 0, 0, ClientSize.Width, 0);
        e.Graphics.DrawLine(lightPen, 0, 1, ClientSize.Width, 1);
    }

    public void ShowOverlay()
    {
        if (InvokeRequired)
        {
            BeginInvoke(ShowOverlay);
            return;
        }

        startMenuForm.Hide();
        PositionOnDesktop();
        RegisterOrUpdateAppBar();
        lastWindowSignature = "";
        RefreshOpenWindowButtons();

        clockTimer.Start();
        UpdateClock();
        layoutTimer.Start();
        windowPollTimer.Start();

        Show();
        BringToFront();
    }

    public void CloseOverlay()
    {
        if (InvokeRequired)
        {
            BeginInvoke(CloseOverlay);
            return;
        }

        startMenuForm.Hide();
        UnregisterAppBar();
        clockTimer.Stop();
        layoutTimer.Stop();
        windowPollTimer.Stop();
        Hide();
        Visible = false;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        PositionOnDesktop();
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        UnregisterAppBar();
        base.OnHandleDestroyed(e);
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (Visible)
            PositionOnDesktop();
    }

    private void PositionOnDesktop()
    {
        if (isPositioning)
            return;

        var screen = Screen.AllScreens.FirstOrDefault(s => s.DeviceName == monitorDevice);
        if (screen == null)
            return;

        isPositioning = true;
        try
        {
            var bounds = screen.Bounds;
            var height = Math.Max(36, (int)Math.Round(38 * DeviceDpi / 96f));
            var targetBounds = new Rectangle(bounds.Left, bounds.Bottom - height, bounds.Width, height);

            if (Bounds != targetBounds)
                Bounds = targetBounds;

            int innerHeight = height - 8;
            startButton.Top = 5;
            startButton.Height = innerHeight;
            startButton.Width = Math.Min(86, Math.Max(64, ClientSize.Width / 4));

            trayPanel.Height = innerHeight;
            trayVolumeIcon.Top = Math.Max(2, (innerHeight - 16) / 2 - 1);
            clock.Height = innerHeight - 4;

            taskButtonsPanel.Left = startButton.Right + 6;
            taskButtonsPanel.Top = 5;
            taskButtonsPanel.Height = innerHeight;
            taskButtonsPanel.Width = Math.Max(60, ClientSize.Width - taskButtonsPanel.Left - trayPanel.Width - 6);

            if (appBarRegistered && screen.Primary)
                RegisterOrUpdateAppBar();
        }
        finally
        {
            isPositioning = false;
        }
    }

    private void ToggleStartMenu()
    {
        if (startMenuForm.Visible)
        {
            startMenuForm.Hide();
            return;
        }

        startMenuForm.Location = new Point(Left + 2, Top - startMenuForm.Height);
        startMenuForm.Show();
        startMenuForm.BringToFront();
        startMenuForm.Activate();
    }

    private void RefreshOpenWindowButtons()
    {
        var windows = EnumerateTaskbarWindows();
        var foreground = GetForegroundWindow();

        // Build a lightweight signature to avoid unnecessary UI flicker
        var sb = new StringBuilder();
        foreach (var win in windows)
            sb.Append(win.Handle.ToInt64()).Append('|').Append(win.Title).Append('|').Append(win.Handle == foreground).Append(';');

        var signature = sb.ToString();
        if (signature == lastWindowSignature)
            return;
        lastWindowSignature = signature;

        taskButtonsPanel.SuspendLayout();
        try
        {
            while (taskButtonsPanel.Controls.Count > 0)
            {
                var ctrl = taskButtonsPanel.Controls[0];
                taskButtonsPanel.Controls.RemoveAt(0);
                ctrl.Dispose();
            }

            if (windows.Count == 0)
                return;

            int availableWidth = Math.Max(120, taskButtonsPanel.Width - 4);
            int buttonWidth = Math.Clamp((availableWidth / windows.Count) - 4, 90, 175);

            foreach (var win in windows)
            {
                bool isActive = win.Handle == foreground;
                var btn = new Win98TaskButton(win.Handle, win.Title, win.Icon, isActive)
                {
                    Width = buttonWidth,
                    Height = taskButtonsPanel.Height,
                    Margin = new Padding(0, 0, 4, 0)
                };
                taskButtonsPanel.Controls.Add(btn);
            }
        }
        finally
        {
            taskButtonsPanel.ResumeLayout();
        }
    }

    private List<TaskWindowInfo> EnumerateTaskbarWindows()
    {
        var results = new List<TaskWindowInfo>();
        var ownPid = Environment.ProcessId;

        EnumWindows((hwnd, _) =>
        {
            if (hwnd == Handle || hwnd == startMenuForm.Handle)
                return true;
            if (!IsWindowVisible(hwnd))
                return true;

            int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
            if ((exStyle & WS_EX_TOOLWINDOW) != 0)
                return true;

            // Skip owned popup windows unless explicitly marked WS_EX_APPWINDOW
            if (GetWindow(hwnd, GW_OWNER) != IntPtr.Zero && (exStyle & WS_EX_APPWINDOW) == 0)
                return true;

            int length = GetWindowTextLength(hwnd);
            if (length <= 0)
                return true;

            var titleBuilder = new StringBuilder(length + 1);
            GetWindowText(hwnd, titleBuilder, titleBuilder.Capacity);
            string title = titleBuilder.ToString().Trim();
            if (string.IsNullOrEmpty(title))
                return true;

            var classBuilder = new StringBuilder(64);
            GetClassName(hwnd, classBuilder, classBuilder.Capacity);
            string className = classBuilder.ToString();
            if (className is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd"
                or "Windows.UI.Core.CoreWindow" or "ApplicationFrameWindow")
            {
                // Allow ApplicationFrameWindow only if it has a real title
                if (className != "ApplicationFrameWindow")
                    return true;
            }

            // Skip hidden overlay forms belonging to this process
            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == ownPid && Control.FromHandle(hwnd) is Win98Taskbar or Win98StartMenuForm)
                return true;

            results.Add(new TaskWindowInfo(hwnd, title, GetWindowSmallIcon(hwnd)));
            return true;
        }, IntPtr.Zero);

        return results;
    }

    private static Image? GetWindowSmallIcon(IntPtr hwnd)
    {
        try
        {
            IntPtr hIcon = IntPtr.Zero;
            SendMessageTimeout(hwnd, WM_GETICON, new IntPtr(ICON_SMALL2), IntPtr.Zero, SMTO_ABORTIFHUNG, 50, out hIcon);
            if (hIcon == IntPtr.Zero)
                SendMessageTimeout(hwnd, WM_GETICON, new IntPtr(ICON_SMALL), IntPtr.Zero, SMTO_ABORTIFHUNG, 50, out hIcon);
            if (hIcon == IntPtr.Zero)
                hIcon = GetClassLongPtr(hwnd, GCLP_HICONSM);
            if (hIcon == IntPtr.Zero)
                hIcon = GetClassLongPtr(hwnd, GCLP_HICON);

            if (hIcon != IntPtr.Zero)
            {
                using var icon = Icon.FromHandle(hIcon);
                return new Bitmap(icon.ToBitmap(), new Size(16, 16));
            }
        }
        catch
        {
        }

        return LoadTaskbarAsset("document-0.png");
    }

    private void RegisterOrUpdateAppBar()
    {
        var screen = Screen.AllScreens.FirstOrDefault(s => s.DeviceName == monitorDevice);
        if (screen == null || !screen.Primary || !IsHandleCreated)
            return;

        var abd = new APPBARDATA
        {
            cbSize = Marshal.SizeOf<APPBARDATA>(),
            hWnd = Handle
        };

        if (!appBarRegistered)
        {
            appBarCallbackId = RegisterWindowMessage("RetroExplorerAppBarMsg");
            abd.uCallbackMessage = appBarCallbackId;
            SHAppBarMessage(ABM_NEW, ref abd);
            appBarRegistered = true;
        }

        abd.uEdge = ABE_BOTTOM;
        abd.rc = new RECT
        {
            Left = Bounds.Left,
            Top = Bounds.Top,
            Right = Bounds.Right,
            Bottom = Bounds.Bottom
        };

        SHAppBarMessage(ABM_QUERYPOS, ref abd);
        abd.rc.Top = abd.rc.Bottom - Bounds.Height;
        SHAppBarMessage(ABM_SETPOS, ref abd);
    }

    private void UnregisterAppBar()
    {
        if (!appBarRegistered || !IsHandleCreated)
            return;

        var abd = new APPBARDATA
        {
            cbSize = Marshal.SizeOf<APPBARDATA>(),
            hWnd = Handle
        };
        SHAppBarMessage(ABM_REMOVE, ref abd);
        appBarRegistered = false;
    }

    private void UpdateClock()
    {
        clock.Text = DateTime.Now.ToString("h:mm tt");
    }

    internal static Image? LoadTaskbarAsset(string fileName)
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "assets", "Windows 98 icons", fileName),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "assets", "Windows 98 icons", fileName))
        };

        var path = candidates.FirstOrDefault(File.Exists);
        if (path == null)
            return null;

        try
        {
            using var source = new Bitmap(path);
            return new Bitmap(source, new Size(16, 16));
        }
        catch
        {
            return null;
        }
    }

    internal static void BringWindowToFront(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero)
            return;

        if (GetForegroundWindow() == hwnd && !IsIconic(hwnd))
        {
            ShowWindow(hwnd, SW_MINIMIZE);
            return;
        }

        if (IsIconic(hwnd))
            ShowWindow(hwnd, SW_RESTORE);

        SetForegroundWindow(hwnd);
    }

    private sealed record TaskWindowInfo(IntPtr Handle, string Title, Image? Icon);

    #region Win32 Interop

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_APPWINDOW = 0x00040000;
    private const uint GW_OWNER = 4;

    private const uint WM_GETICON = 0x007F;
    private const int ICON_SMALL = 0;
    private const int ICON_SMALL2 = 2;
    private const int GCLP_HICON = -14;
    private const int GCLP_HICONSM = -34;
    private const uint SMTO_ABORTIFHUNG = 0x0002;

    private const int SW_MINIMIZE = 6;
    private const int SW_RESTORE = 9;

    private const uint ABM_NEW = 0x00000000;
    private const uint ABM_REMOVE = 0x00000001;
    private const uint ABM_QUERYPOS = 0x00000002;
    private const uint ABM_SETPOS = 0x00000003;
    private const uint ABE_BOTTOM = 3;

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

    [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")]
    private static extern IntPtr GetClassLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string lpString);

    [DllImport("shell32.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern uint SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct APPBARDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uCallbackMessage;
        public uint uEdge;
        public RECT rc;
        public IntPtr lParam;
    }

    #endregion
}

/// <summary>Custom Win98 taskbar button supporting sunken active state and raised inactive state.</summary>
internal sealed class Win98TaskButton : Control
{
    private readonly IntPtr targetHwnd;
    private readonly Image? icon;
    private readonly bool isActive;

    public Win98TaskButton(IntPtr hwnd, string title, Image? icon, bool isActive)
    {
        targetHwnd = hwnd;
        Text = title;
        this.icon = icon;
        this.isActive = isActive;
        DoubleBuffered = true;
        Font = new Font("Tahoma", 8.5F, isActive ? FontStyle.Bold : FontStyle.Regular);
        BackColor = isActive ? Color.FromArgb(223, 223, 223) : Color.FromArgb(192, 192, 192);
        ForeColor = Color.Black;
        Cursor = Cursors.Default;
    }

    protected override void OnClick(EventArgs e)
    {
        base.OnClick(e);
        Win98Taskbar.BringWindowToFront(targetHwnd);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        ControlPaint.DrawBorder3D(
            e.Graphics,
            ClientRectangle,
            isActive ? Border3DStyle.Sunken : Border3DStyle.Raised);

        int offset = isActive ? 1 : 0;
        int textLeft = 6 + offset;

        if (icon != null)
        {
            int iconTop = (Height - 16) / 2 + offset;
            e.Graphics.DrawImage(icon, new Rectangle(5 + offset, iconTop, 16, 16));
            textLeft = 24 + offset;
        }

        var textRect = new Rectangle(textLeft, 2 + offset, Math.Max(10, Width - textLeft - 5), Height - 4);
        TextRenderer.DrawText(
            e.Graphics,
            Text,
            Font,
            textRect,
            ForeColor,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            icon?.Dispose();
        base.Dispose(disposing);
    }
}

/// <summary>Floating popup Start Menu with classic Windows 98 navy sidebar.</summary>
internal sealed class Win98StartMenuForm : Form
{
    public Win98StartMenuForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.FromArgb(192, 192, 192);
        Font = new Font("Tahoma", 9F);
        Width = 232;
        Height = 228;

        var sidebar = new Panel
        {
            Dock = DockStyle.Left,
            Width = 24,
            BackColor = Color.FromArgb(0, 0, 128)
        };
        sidebar.Paint += (_, e) =>
        {
            using var brush = new System.Drawing.Drawing2D.LinearGradientBrush(
                sidebar.ClientRectangle,
                Color.FromArgb(0, 0, 128),
                Color.FromArgb(16, 132, 208),
                System.Drawing.Drawing2D.LinearGradientMode.Vertical);
            e.Graphics.FillRectangle(brush, sidebar.ClientRectangle);

            var state = e.Graphics.Save();
            e.Graphics.TranslateTransform(3, sidebar.Height - 8);
            e.Graphics.RotateTransform(-90);
            using var font = new Font("Tahoma", 10F, FontStyle.Bold);
            e.Graphics.DrawString("Windows 98", font, Brushes.White, 0, 0);
            e.Graphics.Restore(state);
        };
        Controls.Add(sidebar);

        var items = new (string Label, string Icon)[]
        {
            ("Retro Explorer", "computer_explorer-0.png"),
            ("New Folder", "directory_closed_cool-0.png"),
            ("Search", "magnifying_glass-0.png"),
            ("Windows 98 Desktop Preview", "desktop-0.png"),
            ("Restore Modern Windows", "key_win-0.png"),
            ("Close Overlay", "erase_file-0.png")
        };

        int top = 6;
        foreach (var (label, iconName) in items)
        {
            var btn = new Button
            {
                Text = "  " + label,
                Left = 28,
                Top = top,
                Width = 198,
                Height = 34,
                FlatStyle = FlatStyle.Flat,
                TextAlign = ContentAlignment.MiddleLeft,
                TextImageRelation = TextImageRelation.ImageBeforeText,
                ImageAlign = ContentAlignment.MiddleLeft,
                Image = Win98Taskbar.LoadTaskbarAsset(iconName),
                BackColor = Color.FromArgb(192, 192, 192),
                ForeColor = Color.Black
            };
            btn.FlatAppearance.BorderSize = 0;
            btn.MouseEnter += (_, _) =>
            {
                btn.BackColor = Color.FromArgb(0, 0, 128);
                btn.ForeColor = Color.White;
            };
            btn.MouseLeave += (_, _) =>
            {
                btn.BackColor = Color.FromArgb(192, 192, 192);
                btn.ForeColor = Color.Black;
            };
            btn.Click += (_, _) =>
            {
                Hide();
                DispatchAction(label);
            };
            Controls.Add(btn);
            top += 36;
        }

        Deactivate += (_, _) => Hide();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        ControlPaint.DrawBorder3D(e.Graphics, ClientRectangle, Border3DStyle.Raised);
    }

    private static void DispatchAction(string action)
    {
        var form = Application.OpenForms.OfType<MainForm>().FirstOrDefault();
        if (form == null)
            return;

        if (action is "Restore Modern Windows" or "Close Overlay")
            form.ToggleWin98SystemMode();
        else if (action == "Windows 98 Desktop Preview")
            form.OpenDesktopPreview();
        else
            form.PerformMenuAction(action);
    }
}